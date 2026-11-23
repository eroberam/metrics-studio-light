from __future__ import annotations

from pathlib import Path
from typing import Optional, Sequence

import numpy as np
import pandas as pd

from metrics_studio.binary_metrics import (
    ModelArtifacts,
    ThresholdResult,
    align_scores,
    compute_threshold_result,
)
from metrics_studio.config import EvaluationConfig

EPS = 1e-12


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------
def _clean_df(df: pd.DataFrame) -> pd.DataFrame:
    """Make DataFrames robust for CSV/XLSX export."""
    out = df.copy()
    out.replace([np.inf, -np.inf], np.nan, inplace=True)
    return out


def _safe_logit_scalar(p: float) -> float:
    if p is None or not np.isfinite(p) or p <= 0.0 or p >= 1.0:
        return float("nan")
    return float(np.log(p) - np.log(1.0 - p))


def _target_threshold(config: Optional[EvaluationConfig]) -> float:
    if config is None or config.custom_threshold is None:
        return 0.5
    return float(config.custom_threshold)


def _reference_rates(config: Optional[EvaluationConfig]) -> tuple[float, ...]:
    if config is None:
        return (0.1, 0.01, 0.001)
    return tuple(float(x) for x in config.operational_reference_rates)


def _decision_rule_text(config: Optional[EvaluationConfig]) -> str:
    if config is None:
        return "score >= threshold → positive class"
    operator = ">=" if config.positive_if_higher_score else "<="
    return f"score {operator} threshold → positive_label={config.positive_label}"


def _class_name(config: Optional[EvaluationConfig], normalized_class: int) -> str:
    if config is None:
        return "positive" if normalized_class == 1 else "negative"
    label = config.positive_label if normalized_class == 1 else config.negative_label
    return f"positive_label={label}" if normalized_class == 1 else f"negative_label={label}"


def _row_percentages(r: ThresholdResult) -> dict[str, float]:
    neg_total = r.tn + r.fp
    pos_total = r.fn + r.tp
    return {
        "tn_pct_row": (r.tn / neg_total) if neg_total else 0.0,
        "fp_pct_row": (r.fp / neg_total) if neg_total else 0.0,
        "fn_pct_row": (r.fn / pos_total) if pos_total else 0.0,
        "tp_pct_row": (r.tp / pos_total) if pos_total else 0.0,
    }


# ---------------------------------------------------------------------------
# Threshold / operating point helpers
# ---------------------------------------------------------------------------
def _metrics_at_exact_threshold(
    art: ModelArtifacts,
    config: Optional[EvaluationConfig],
    threshold_original: float,
) -> ThresholdResult:
    """Compute metrics exactly at the configured threshold in original score units."""
    if config is None:
        # Backward-compatible fallback: use the closest point from the sweep.
        idx = int(np.nanargmin(np.abs(np.asarray(art.sweep_thresholds, dtype=float) - threshold_original)))
        return ThresholdResult(
            model_name=art.model_name,
            name="custom_threshold_nearest",
            threshold_aligned=float(art.sweep_thresholds[idx]),
            threshold_original=float(art.sweep_thresholds[idx]),
            tp=int(art.sweep_tp[idx]), tn=int(art.sweep_tn[idx]),
            fp=int(art.sweep_fp[idx]), fn=int(art.sweep_fn[idx]),
            accuracy=float(art.sweep_acc[idx]),
            balanced_accuracy=float(0.5 * (art.sweep_recall[idx] + (1.0 - art.sweep_frr[idx]))),
            precision_pos=float(art.sweep_precision[idx]),
            recall_pos=float(art.sweep_recall[idx]),
            f1_pos=float(art.sweep_f1[idx]),
            precision_neg=float("nan"), recall_neg=float("nan"), f1_neg=float("nan"),
            far=float(art.sweep_far[idx]), frr=float(art.sweep_frr[idx]),
            hter=float(0.5 * (art.sweep_far[idx] + art.sweep_frr[idx])),
            specificity=float(1.0 - art.sweep_frr[idx]),
            npv=float("nan"), mcc=float("nan"), cohen_kappa=float("nan"),
            youden_j=float(art.sweep_recall[idx] - art.sweep_frr[idx]),
        )

    threshold_aligned = float(
        align_scores(np.array([threshold_original], dtype=float), config.positive_if_higher_score)[0]
    )
    return compute_threshold_result(
        model_name=art.model_name,
        labels=art.labels,
        aligned_scores=art.scores_aligned,
        threshold_aligned=threshold_aligned,
        name="configured_threshold",
        config=config,
    )


def _select_operating_point(
    art: ModelArtifacts,
    condition_metric: str,
    condition_target: float,
    value_metric: str,
) -> dict[str, float]:
    """Select one threshold under an operational constraint.

    - FAR@FRR=x: select a threshold with FRR <= x and minimum FAR.
    - FRR@FAR=x: select a threshold with FAR <= x and minimum FRR.
    - If the constraint is not feasible, return the closest threshold to the target.
    """
    thresholds = np.asarray(art.sweep_thresholds, dtype=float)
    far = np.asarray(art.sweep_far, dtype=float)
    frr = np.asarray(art.sweep_frr, dtype=float)

    condition = frr if condition_metric == "frr" else far
    value = far if value_metric == "far" else frr

    valid = np.isfinite(thresholds) & np.isfinite(condition) & np.isfinite(value)
    if not np.any(valid):
        return {"threshold": float("nan"), "far": float("nan"), "frr": float("nan"), "feasible": 0.0}

    feasible_mask = valid & (condition <= condition_target + 1e-12)
    if np.any(feasible_mask):
        idxs = np.where(feasible_mask)[0]
        order = np.lexsort((np.abs(condition[idxs] - condition_target), value[idxs]))
        idx = int(idxs[order[0]])
        feasible = 1.0
    else:
        idxs = np.where(valid)[0]
        idx = int(idxs[np.nanargmin(np.abs(condition[idxs] - condition_target))])
        feasible = 0.0

    return {
        "threshold": float(thresholds[idx]),
        "far": float(far[idx]),
        "frr": float(frr[idx]),
        "feasible": feasible,
    }


# ---------------------------------------------------------------------------
# DataFrame builders
# ---------------------------------------------------------------------------
def _build_panel_summary_df(artifacts: Sequence[ModelArtifacts], config: Optional[EvaluationConfig]) -> pd.DataFrame:
    rows = []
    threshold = _target_threshold(config)
    for art in artifacts:
        r = _metrics_at_exact_threshold(art, config, threshold)
        pct = _row_percentages(r)
        eer = 0.5 * (float(art.eer_far) + float(art.eer_frr))
        rows.append({
            "model_name": art.model_name,
            "positive_label": getattr(config, "positive_label", 1),
            "negative_label": getattr(config, "negative_label", 0),
            "decision_rule": _decision_rule_text(config),
            "n_negative": art.n_neg,
            "n_positive": art.n_pos,
            "configured_threshold": r.threshold_original,
            "configured_threshold_logit": _safe_logit_scalar(r.threshold_original),
            "eer": eer,
            "eer_threshold": art.eer_thr,
            "far": r.far,
            "frr": r.frr,
            "roc_auc": art.global_metrics.get("roc_auc", np.nan),
            "pr_auc_average_precision": art.global_metrics.get("average_precision", np.nan),
            "recall": r.recall_pos,
            "precision": r.precision_pos,
            "accuracy": r.accuracy,
            "f1": r.f1_pos,
            "brier": art.global_metrics.get("brier_score", np.nan),
            "ece": art.global_metrics.get("ece", np.nan),
            "model_bias_logits": art.global_metrics.get("model_bias_logits", np.nan),
            "tp": r.tp,
            "tn": r.tn,
            "fp": r.fp,
            "fn": r.fn,
            **pct,
        })
    return _clean_df(pd.DataFrame(rows))


def _build_operating_points_df(artifacts: Sequence[ModelArtifacts], config: Optional[EvaluationConfig]) -> pd.DataFrame:
    rows = []
    targets = _reference_rates(config)

    for art in artifacts:
        for target in targets:
            point = _select_operating_point(art, "frr", target, "far")
            rows.append({
                "model_name": art.model_name,
                "point_type": "FAR@FRR",
                "constraint_metric": "FRR",
                "constraint_target": target,
                "reported_metric": "FAR",
                "threshold": point["threshold"],
                "far": point["far"],
                "frr": point["frr"],
                "feasible": bool(point["feasible"]),
            })

        for target in targets:
            point = _select_operating_point(art, "far", target, "frr")
            rows.append({
                "model_name": art.model_name,
                "point_type": "FRR@FAR",
                "constraint_metric": "FAR",
                "constraint_target": target,
                "reported_metric": "FRR",
                "threshold": point["threshold"],
                "far": point["far"],
                "frr": point["frr"],
                "feasible": bool(point["feasible"]),
            })

        tr = {x.name: x for x in art.threshold_results}
        for name, label in (("eer", "EER"), ("f1_max", "Max F1"), ("min_hter", "Min mean error")):
            r = tr.get(name)
            if r is None:
                continue
            rows.append({
                "model_name": art.model_name,
                "point_type": label,
                "constraint_metric": "reference",
                "constraint_target": np.nan,
                "reported_metric": label,
                "threshold": r.threshold_original,
                "far": r.far,
                "frr": r.frr,
                "feasible": True,
                "recall": r.recall_pos,
                "precision": r.precision_pos,
                "accuracy": r.accuracy,
                "f1": r.f1_pos,
            })

    return _clean_df(pd.DataFrame(rows))


def _build_threshold_sweep_df(artifacts: Sequence[ModelArtifacts]) -> pd.DataFrame:
    dfs = []
    for art in artifacts:
        specificity = 1.0 - np.asarray(art.sweep_frr, dtype=float)
        balanced_accuracy = 0.5 * (np.asarray(art.sweep_recall, dtype=float) + specificity)
        neg_total = np.asarray(art.sweep_tn, dtype=float) + np.asarray(art.sweep_fp, dtype=float)
        pos_total = np.asarray(art.sweep_tp, dtype=float) + np.asarray(art.sweep_fn, dtype=float)
        tn_pct = np.divide(art.sweep_tn, neg_total, out=np.zeros_like(neg_total, dtype=float), where=neg_total != 0)
        fp_pct = np.divide(art.sweep_fp, neg_total, out=np.zeros_like(neg_total, dtype=float), where=neg_total != 0)
        fn_pct = np.divide(art.sweep_fn, pos_total, out=np.zeros_like(pos_total, dtype=float), where=pos_total != 0)
        tp_pct = np.divide(art.sweep_tp, pos_total, out=np.zeros_like(pos_total, dtype=float), where=pos_total != 0)

        df = pd.DataFrame({
            "model_name": art.model_name,
            "n_negative": art.n_neg,
            "n_positive": art.n_pos,
            "threshold": art.sweep_thresholds,
            "threshold_logit": art.sweep_logits,
            "far": art.sweep_far,
            "frr": art.sweep_frr,
            "roc_fpr": art.sweep_frr,
            "roc_tpr_recall": art.sweep_recall,
            "precision": art.sweep_precision,
            "specificity_tnr": specificity,
            "balanced_accuracy": balanced_accuracy,
            "accuracy": art.sweep_acc,
            "f1": art.sweep_f1,
            "tp": art.sweep_tp,
            "tn": art.sweep_tn,
            "fp": art.sweep_fp,
            "fn": art.sweep_fn,
            "tn_pct_row": tn_pct,
            "fp_pct_row": fp_pct,
            "fn_pct_row": fn_pct,
            "tp_pct_row": tp_pct,
        })
        dfs.append(df)

    if not dfs:
        return pd.DataFrame()
    return _clean_df(pd.concat(dfs, ignore_index=True))


def _build_calibration_bins_df(
    artifacts: Sequence[ModelArtifacts],
    config: Optional[EvaluationConfig],
    n_bins: int = 10,
) -> pd.DataFrame:
    rows = []
    for art in artifacts:
        scores = np.asarray(art.scores_original, dtype=float)
        labels = np.asarray(art.labels, dtype=int)
        if len(scores) == 0:
            continue
        if np.nanmin(scores) < -1e-9 or np.nanmax(scores) > 1.0 + 1e-9:
            rows.append({
                "model_name": art.model_name,
                "calibration_available": False,
                "reason": "scores_outside_0_1",
            })
            continue

        positive_if_higher = True if config is None else config.positive_if_higher_score
        prob_pos = scores if positive_if_higher else 1.0 - scores
        prob_pos = np.clip(prob_pos, 0.0, 1.0)
        bins = np.linspace(0.0, 1.0, n_bins + 1)

        class_specs = [
            (1, "positive", _class_name(config, 1), prob_pos, (labels == 1).astype(float)),
            (0, "negative", _class_name(config, 0), 1.0 - prob_pos, (labels == 0).astype(float)),
        ]
        for target_class, class_role, class_label, class_score, observed in class_specs:
            bin_idx = np.clip(np.digitize(class_score, bins, right=False) - 1, 0, n_bins - 1)
            total = len(class_score)
            for i in range(n_bins):
                mask = bin_idx == i
                count = int(np.sum(mask))
                if count == 0:
                    rows.append({
                        "model_name": art.model_name,
                        "calibration_available": True,
                        "class_role": class_role,
                        "class_label": class_label,
                        "target_class_normalized": target_class,
                        "bin_start": float(bins[i]),
                        "bin_end": float(bins[i + 1]),
                        "score_mean": np.nan,
                        "observed_frequency": np.nan,
                        "n": 0,
                        "n_pct": 0.0,
                    })
                    continue
                rows.append({
                    "model_name": art.model_name,
                    "calibration_available": True,
                    "class_role": class_role,
                    "class_label": class_label,
                    "target_class_normalized": target_class,
                    "bin_start": float(bins[i]),
                    "bin_end": float(bins[i + 1]),
                    "score_mean": float(np.mean(class_score[mask])),
                    "observed_frequency": float(np.mean(observed[mask])),
                    "n": count,
                    "n_pct": float(count / max(1, total)),
                })

    return _clean_df(pd.DataFrame(rows))


def _build_global_metrics_df(artifacts: Sequence[ModelArtifacts]) -> pd.DataFrame:
    rows = []
    for art in artifacts:
        row = {"model_name": art.model_name}
        row.update(art.global_metrics)
        rows.append(row)
    return _clean_df(pd.DataFrame(rows))


def _build_predictions_df(artifacts: Sequence[ModelArtifacts]) -> pd.DataFrame:
    source_name = "source_model_name"
    suffix = 2
    while any(source_name in art.df.columns for art in artifacts):
        source_name = f"source_model_name_{suffix}"
        suffix += 1
    frames = []
    for art in artifacts:
        df = art.df.copy()
        if "model_name" in df.columns:
            df.rename(columns={"model_name": source_name}, inplace=True)
        df.insert(0, "model_name", art.model_name)
        frames.append(df)
    return _clean_df(pd.concat(frames, ignore_index=True) if frames else pd.DataFrame())


# ---------------------------------------------------------------------------
# JSON report
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def save_reports(
    artifacts: Sequence[ModelArtifacts],
    reports_dir: Path,
    config: Optional[EvaluationConfig] = None,
) -> None:
    """Write one consolidated Excel report aligned with the dashboard.

    Generated file:
    - report_binary.xlsx

    The workbook keeps the full report content in separate sheets:
    - panel_summary: dashboard KPI snapshot at the configured threshold.
    - operating_points: FAR@FRR and FRR@FAR targets plus EER/F1 references.
    - metrics_sweep: full metric evolution by threshold.
    - calibration_bins: positive and negative class reliability bins.
    - global_metrics: global model metrics.
    - predictions: normalized row-level data plus metadata filter columns.

    No auxiliary CSV, XLSX or JSON files are generated.
    """
    reports_dir.mkdir(parents=True, exist_ok=True)

    panel_summary_df = _build_panel_summary_df(artifacts, config)
    operating_points_df = _build_operating_points_df(artifacts, config)
    metrics_sweep_df = _build_threshold_sweep_df(artifacts)
    calibration_bins_df = _build_calibration_bins_df(artifacts, config)
    global_metrics_df = _build_global_metrics_df(artifacts)
    predictions_df = _build_predictions_df(artifacts)

    try:
        out_path = reports_dir / "report_binary.xlsx"
        with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
            _clean_df(panel_summary_df).to_excel(writer, sheet_name="panel_summary", index=False)
            _clean_df(operating_points_df).to_excel(writer, sheet_name="operating_points", index=False)
            _clean_df(metrics_sweep_df).to_excel(writer, sheet_name="metrics_sweep", index=False)
            _clean_df(calibration_bins_df).to_excel(writer, sheet_name="calibration_bins", index=False)
            _clean_df(global_metrics_df).to_excel(writer, sheet_name="global_metrics", index=False)
            _clean_df(predictions_df).to_excel(writer, sheet_name="predictions", index=False)
    except ImportError as err:
        raise ImportError("Install openpyxl to generate report_binary.xlsx: pip install openpyxl") from err

    print(f"[reports] Wrote consolidated binary dashboard report to: {reports_dir / 'report_binary.xlsx'}")
