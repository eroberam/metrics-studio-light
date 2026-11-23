"""Metric computation: per-threshold and global, vectorized sweeps.

Conventions used in this module
-------------------------------
- label 1 = positive class. In the PAD use case, positive = spoof / attack.
- label 0 = negative class. In the PAD use case, negative = bona fide / real user.
- prediction = 1 when the aligned score is >= threshold.

For PAD/biometric reporting with positive = spoof:
- TP: spoof correctly detected as spoof.
- FN: spoof incorrectly accepted as bona fide.
- FP: bona fide incorrectly rejected as spoof.
- TN: bona fide correctly accepted as bona fide.

Therefore:
- FAR / APCER = FN / (TP + FN): attack presentations accepted as bona fide.
- FRR / BPCER = FP / (TN + FP): bona fide presentations rejected as attacks.
- ACER / HTER = (FAR + FRR) / 2.

For a standard ROC curve:
- FPR = FP / (FP + TN) = FRR/BPCER under this PAD convention.
- TPR = TP / (TP + FN) = Recall for spoof detection.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd
from scipy.stats import norm
from sklearn.metrics import (
    average_precision_score,
    cohen_kappa_score,
    confusion_matrix,
    det_curve,
    matthews_corrcoef,
    precision_recall_curve,
    precision_recall_fscore_support,
    roc_auc_score,
    roc_curve,
)

from metrics_studio.binary_io import load_and_normalize
from metrics_studio.config import EvaluationConfig, InputSourceConfig
from metrics_studio.shared.stats import bootstrap_ci

EPS = 1e-12


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class ThresholdResult:
    """All metrics at a single operating threshold."""
    model_name: str
    name: str                       # e.g. "eer", "f1_max", "min_hter", "grid_0.50"
    threshold_aligned: float        # internal aligned threshold
    threshold_original: float       # threshold in user's original score units
    tp: int
    tn: int
    fp: int
    fn: int
    accuracy: float
    balanced_accuracy: float
    precision_pos: float
    recall_pos: float
    f1_pos: float
    precision_neg: float
    recall_neg: float
    f1_neg: float
    far: float                      # PAD FAR/APCER = FN / P
    frr: float                      # PAD FRR/BPCER = FP / N
    hter: float                     # ACER/HTER = (FAR + FRR) / 2
    specificity: float              # TNR = TN / N
    npv: float
    mcc: float
    cohen_kappa: float
    youden_j: float                 # TPR - FPR = sensitivity + specificity - 1


@dataclass
class ModelArtifacts:
    model_name: str
    df: pd.DataFrame
    labels: np.ndarray              # normalized labels: 0/1
    scores_original: np.ndarray     # original model scores
    scores_aligned: np.ndarray      # higher score always means more positive
    curves: Dict[str, np.ndarray] = field(default_factory=dict)
    global_metrics: Dict[str, float] = field(default_factory=dict)
    threshold_results: List[ThresholdResult] = field(default_factory=list)
    threshold_grid_df: pd.DataFrame = field(default_factory=pd.DataFrame)

    # Dense threshold sweep for dashboard and reports.
    # sweep_thresholds are expressed in original score units.
    sweep_thresholds: np.ndarray = field(default_factory=lambda: np.array([]))
    sweep_far: np.ndarray = field(default_factory=lambda: np.array([]))       # FAR/APCER = FN/P
    sweep_frr: np.ndarray = field(default_factory=lambda: np.array([]))       # FRR/BPCER = FP/N
    sweep_recall: np.ndarray = field(default_factory=lambda: np.array([]))    # TPR = TP/P
    sweep_precision: np.ndarray = field(default_factory=lambda: np.array([]))
    sweep_acc: np.ndarray = field(default_factory=lambda: np.array([]))
    sweep_f1: np.ndarray = field(default_factory=lambda: np.array([]))
    sweep_tp: np.ndarray = field(default_factory=lambda: np.array([]))
    sweep_tn: np.ndarray = field(default_factory=lambda: np.array([]))
    sweep_fp: np.ndarray = field(default_factory=lambda: np.array([]))
    sweep_fn: np.ndarray = field(default_factory=lambda: np.array([]))
    sweep_logits: np.ndarray = field(default_factory=lambda: np.array([]))

    # EER marker from the dense sweep.
    eer_thr: float = 0.0             # original threshold units
    eer_far: float = 0.0             # FAR/APCER at EER marker
    eer_frr: float = 0.0             # FRR/BPCER at EER marker

    # Class counts.
    n_pos: int = 0
    n_neg: int = 0

    # Bootstrap CIs as {metric: (lo, hi)}: roc_auc / average_precision plus
    # accuracy / f1 / far / frr at the reference threshold (custom or EER).
    ci: Dict[str, Tuple[float, float]] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Score helpers
# ---------------------------------------------------------------------------
def align_scores(scores: np.ndarray, positive_if_higher: bool) -> np.ndarray:
    """Return scores where higher values always mean more evidence for label 1."""
    return scores if positive_if_higher else -scores


def to_original_threshold(threshold_aligned: float, positive_if_higher: bool) -> float:
    return threshold_aligned if positive_if_higher else -threshold_aligned


def probit(p: np.ndarray) -> np.ndarray:
    return norm.ppf(np.clip(p, EPS, 1.0 - EPS))


def _safe_logit(p: np.ndarray) -> np.ndarray:
    """Compute logit only for values strictly inside (0, 1); return NaN otherwise."""
    p = np.asarray(p, dtype=float)
    with np.errstate(divide="ignore", invalid="ignore"):
        mask = (p > 0.0) & (p < 1.0)
        out = np.full_like(p, np.nan, dtype=float)
        out[mask] = np.log(p[mask]) - np.log(1.0 - p[mask])
    return out


def _safe_div(num: np.ndarray, den: np.ndarray) -> np.ndarray:
    return np.divide(num, den, out=np.zeros_like(num, dtype=float), where=den != 0)


# ---------------------------------------------------------------------------
# Per-threshold metrics (scalar)
# ---------------------------------------------------------------------------
def compute_threshold_result(
    model_name: str,
    labels: np.ndarray,
    aligned_scores: np.ndarray,
    threshold_aligned: float,
    name: str,
    config: EvaluationConfig,
) -> ThresholdResult:
    predictions = (aligned_scores >= threshold_aligned).astype(int)
    tn, fp, fn, tp = confusion_matrix(labels, predictions, labels=[0, 1]).ravel()
    n = len(labels)

    p_by_c, r_by_c, f1_by_c, _ = precision_recall_fscore_support(
        labels, predictions, labels=[0, 1], zero_division=0,
    )

    recall_pos = tp / (tp + fn) if (tp + fn) else 0.0              # TPR
    specificity = tn / (tn + fp) if (tn + fp) else 0.0             # TNR
    fpr = fp / (fp + tn) if (fp + tn) else 0.0                     # standard ROC FPR

    # PAD/biometric convention with positive = spoof.
    far = fn / (fn + tp) if (fn + tp) else 0.0                     # FAR/APCER
    frr = fp / (fp + tn) if (fp + tn) else 0.0                     # FRR/BPCER

    npv = tn / (tn + fn) if (tn + fn) else 0.0
    mcc = float(matthews_corrcoef(labels, predictions)) if len(np.unique(predictions)) > 1 else 0.0
    kappa = float(cohen_kappa_score(labels, predictions))
    if np.isnan(kappa):
        kappa = 0.0

    return ThresholdResult(
        model_name=model_name,
        name=name,
        threshold_aligned=float(threshold_aligned),
        threshold_original=float(to_original_threshold(threshold_aligned, config.positive_if_higher_score)),
        tp=int(tp), tn=int(tn), fp=int(fp), fn=int(fn),
        accuracy=float((tp + tn) / n),
        balanced_accuracy=float(0.5 * (recall_pos + specificity)),
        precision_pos=float(p_by_c[1]),
        recall_pos=float(r_by_c[1]),
        f1_pos=float(f1_by_c[1]),
        precision_neg=float(p_by_c[0]),
        recall_neg=float(r_by_c[0]),
        f1_neg=float(f1_by_c[0]),
        far=float(far),
        frr=float(frr),
        hter=float(0.5 * (far + frr)),
        specificity=float(specificity),
        npv=float(npv),
        mcc=mcc,
        cohen_kappa=kappa,
        youden_j=float(recall_pos - fpr),
    )


# ---------------------------------------------------------------------------
# Vectorized threshold sweep using every unique score as candidate threshold
# ---------------------------------------------------------------------------
def build_threshold_sweep(labels: np.ndarray, aligned_scores: np.ndarray) -> pd.DataFrame:
    order = np.argsort(-aligned_scores, kind="mergesort")
    s_sorted = aligned_scores[order]
    l_sorted = labels[order].astype(int)

    pos_mask = l_sorted == 1
    neg_mask = l_sorted == 0

    tp_cum = np.cumsum(pos_mask)
    fp_cum = np.cumsum(neg_mask)

    unique_scores, first_idx, counts = np.unique(s_sorted, return_index=True, return_counts=True)
    end_idx = first_idx + counts - 1

    tp = tp_cum[end_idx].astype(np.int64)
    fp = fp_cum[end_idx].astype(np.int64)
    p_total = int(pos_mask.sum())
    n_total = int(neg_mask.sum())
    fn = p_total - tp
    tn = n_total - fp

    precision = _safe_div(tp, tp + fp)
    recall = _safe_div(tp, tp + fn)             # TPR
    specificity = _safe_div(tn, tn + fp)        # TNR
    accuracy = (tp + tn) / (p_total + n_total)
    balanced_accuracy = 0.5 * (recall + specificity)
    f1 = _safe_div(2.0 * precision * recall, precision + recall)

    far = _safe_div(fn, fn + tp)                # FAR/APCER
    frr = _safe_div(fp, fp + tn)                # FRR/BPCER = standard FPR
    hter = 0.5 * (far + frr)
    youden = recall - frr                       # TPR - FPR

    return pd.DataFrame({
        "threshold_aligned": unique_scores,
        "tp": tp, "fp": fp, "tn": tn, "fn": fn,
        "precision": precision,
        "recall": recall,
        "specificity": specificity,
        "accuracy": accuracy,
        "balanced_accuracy": balanced_accuracy,
        "f1": f1,
        "far": far,
        "frr": frr,
        "hter": hter,
        "youden_j": youden,
        "roc_fpr": frr,
        "roc_tpr": recall,
        "apcer": far,
        "bpcer": frr,
        "acer": hter,
    }).sort_values("threshold_aligned", ascending=False).reset_index(drop=True)


# ---------------------------------------------------------------------------
# Operating points + curves
# ---------------------------------------------------------------------------
def compute_curves_and_operating_points(
    labels: np.ndarray,
    aligned_scores: np.ndarray,
) -> Tuple[Dict[str, float], Dict[str, np.ndarray]]:
    # sklearn DET uses standard FPR = FP/N and FNR = FN/P.
    # In this PAD setup: FPR = BPCER/FRR and FNR = APCER/FAR.
    fpr_det, fnr_det, thr_det = det_curve(labels, aligned_scores)
    threshold_logits_det = _safe_logit(thr_det)

    eer_idx = int(np.argmin(np.abs(fpr_det - fnr_det)))
    eer_threshold = float(thr_det[eer_idx])

    fpr_roc, tpr_roc, thr_roc = roc_curve(labels, aligned_scores)
    precision_pr, recall_pr, thr_pr = precision_recall_curve(labels, aligned_scores)

    if len(thr_pr) > 0:
        p, r = precision_pr[:-1], recall_pr[:-1]
        denom = p + r
        f1_pr = np.divide(2.0 * p * r, denom, out=np.zeros_like(denom, dtype=float), where=denom != 0)
        f1_threshold = float(thr_pr[int(np.nanargmax(f1_pr))])
    else:
        f1_pr = np.array([], dtype=float)
        f1_threshold = float(np.median(aligned_scores))

    curves = {
        "fpr_det": fpr_det,
        "fnr_det": fnr_det,
        "thresholds_det": thr_det,
        "threshold_logits_det": threshold_logits_det,
        "eer_idx": np.array([eer_idx], dtype=int),
        "fpr_roc": fpr_roc,
        "tpr_roc": tpr_roc,
        "thresholds_roc": thr_roc,
        "precision_pr": precision_pr,
        "recall_pr": recall_pr,
        "thresholds_pr": thr_pr,
        "f1_pr": f1_pr,
    }
    operating = {"eer": eer_threshold, "f1_max": f1_threshold}
    return operating, curves


def compute_global_metrics(
    labels: np.ndarray,
    aligned_scores: np.ndarray,
    scores_original: np.ndarray,
    positive_if_higher_score: bool,
) -> Dict[str, float]:
    metrics: Dict[str, float] = {
        "roc_auc": float(roc_auc_score(labels, aligned_scores)),
        "average_precision": float(average_precision_score(labels, aligned_scores)),
        "n_samples": int(len(labels)),
        "n_negative": int((labels == 0).sum()),
        "n_positive": int((labels == 1).sum()),
        "positive_prevalence": float((labels == 1).mean()),
    }

    # Calibration metrics are meaningful only if the score can be interpreted as
    # a probability of the positive class. If lower scores mean positive, invert
    # the probability as p_positive = 1 - score.
    s_min, s_max = float(scores_original.min()), float(scores_original.max())
    if 0.0 - 1e-9 <= s_min and s_max <= 1.0 + 1e-9:
        p_pos_raw = scores_original if positive_if_higher_score else 1.0 - scores_original
        p = np.clip(p_pos_raw, EPS, 1.0 - EPS)

        metrics["brier_score"] = float(np.mean((labels - p) ** 2))
        metrics["log_loss"] = float(-np.mean(labels * np.log(p) + (1 - labels) * np.log(1 - p)))

        # Expected Calibration Error with 10 equal-width bins.
        # np.digitize against inner edges keeps p=0 and p=1 inside valid bins.
        n_bins = 10
        bins = np.linspace(0.0, 1.0, n_bins + 1)
        bin_indices = np.digitize(p, bins[1:-1], right=True)  # values 0..n_bins-1
        ece = 0.0
        for i in range(n_bins):
            mask = bin_indices == i
            if np.any(mask):
                bin_acc = float(np.mean(labels[mask]))
                bin_conf = float(np.mean(p[mask]))
                ece += (np.sum(mask) / len(labels)) * abs(bin_acc - bin_conf)
        metrics["ece"] = float(ece)

        logits_pred = _safe_logit(p)
        prior_pos = metrics["positive_prevalence"]
        prior_logit = _safe_logit(np.array([prior_pos]))[0] if 0 < prior_pos < 1 else 0.0
        metrics["model_bias_logits"] = float(np.nanmean(logits_pred) - prior_logit)
    else:
        metrics["brier_score"] = float("nan")
        metrics["log_loss"] = float("nan")
        metrics["ece"] = float("nan")
        metrics["model_bias_logits"] = float("nan")

    return metrics


# ---------------------------------------------------------------------------
# Threshold grid for FAR/FRR operation table
# ---------------------------------------------------------------------------
def build_threshold_grid_df(
    model_name: str,
    labels: np.ndarray,
    scores_original: np.ndarray,
    config: EvaluationConfig,
) -> pd.DataFrame:
    g = config.threshold_grid
    thresholds = np.round(np.arange(g.start, g.end + g.step / 2.0, g.step), 10)
    aligned_scores = align_scores(scores_original, config.positive_if_higher_score)

    rows: List[Dict[str, float]] = []
    for thr_orig in thresholds:
        thr_aligned = float(align_scores(np.array([thr_orig]), config.positive_if_higher_score)[0])
        r = compute_threshold_result(
            model_name=model_name,
            labels=labels,
            aligned_scores=aligned_scores,
            threshold_aligned=thr_aligned,
            name=f"grid_{thr_orig:.2f}",
            config=config,
        )
        rows.append({
            "model_name": model_name,
            "threshold": float(thr_orig),
            "tp": r.tp, "tn": r.tn, "fp": r.fp, "fn": r.fn,
            "far": r.far,
            "frr": r.frr,
            "hter": r.hter,
            "apcer": r.far,
            "bpcer": r.frr,
            "acer": r.hter,
            "roc_fpr": r.frr,
            "roc_tpr": r.recall_pos,
            "precision_pos": r.precision_pos,
            "recall_pos": r.recall_pos,
            "f1_pos": r.f1_pos,
            "accuracy": r.accuracy,
            "balanced_accuracy": r.balanced_accuracy,
            "specificity": r.specificity,
            "mcc": r.mcc,
            "youden_j": r.youden_j,
        })
    return pd.DataFrame(rows)


def _dense_original_thresholds(scores_original: np.ndarray, config: EvaluationConfig) -> np.ndarray:
    """Return dense thresholds in original score units for dashboard/reporting."""
    g = config.threshold_grid
    start = float(g.start)
    end = float(g.end)
    if not np.isfinite(start) or not np.isfinite(end) or end <= start:
        start = float(np.nanmin(scores_original))
        end = float(np.nanmax(scores_original))
    if end <= start:
        end = start + 1.0
    return np.linspace(start, end, 1001)


# ---------------------------------------------------------------------------
# Top-level: evaluate one model
# ---------------------------------------------------------------------------
def evaluate_one_model(source: InputSourceConfig, config: EvaluationConfig) -> ModelArtifacts:
    df = load_and_normalize(source, config)
    model_name = source.display_name

    scores_original = df["score"].to_numpy(dtype=float)
    labels = (df["label"].to_numpy(dtype=int) == config.positive_label).astype(int)
    scores_aligned = align_scores(scores_original, config.positive_if_higher_score)

    operating, curves = compute_curves_and_operating_points(labels, scores_aligned)
    global_metrics = compute_global_metrics(
        labels=labels,
        aligned_scores=scores_aligned,
        scores_original=scores_original,
        positive_if_higher_score=config.positive_if_higher_score,
    )

    full_sweep = build_threshold_sweep(labels, scores_aligned)
    min_hter_idx = int(full_sweep["hter"].idxmin())
    min_hter_threshold = float(full_sweep.loc[min_hter_idx, "threshold_aligned"])

    threshold_results = [
        compute_threshold_result(model_name, labels, scores_aligned, operating["eer"], "eer", config),
        compute_threshold_result(model_name, labels, scores_aligned, operating["f1_max"], "f1_max", config),
        compute_threshold_result(model_name, labels, scores_aligned, min_hter_threshold, "min_hter", config),
    ]

    threshold_grid_df = build_threshold_grid_df(model_name, labels, scores_original, config)

    # Dense threshold sweep for Plotly dashboard and exported sweep reports.
    # Thresholds are stored and displayed in original score units.
    sweep_thresholds = _dense_original_thresholds(scores_original, config)
    sweep_thresholds_aligned = align_scores(sweep_thresholds, config.positive_if_higher_score)
    preds = scores_aligned[None, :] >= sweep_thresholds_aligned[:, None]

    P = int(np.sum(labels == 1))
    N = int(np.sum(labels == 0))

    tp_v = np.sum(preds & (labels == 1), axis=1)
    fp_v = np.sum(preds & (labels == 0), axis=1)
    tn_v = np.sum(~preds & (labels == 0), axis=1)
    fn_v = np.sum(~preds & (labels == 1), axis=1)

    far_v = np.divide(fn_v, P, out=np.zeros_like(fn_v, dtype=float), where=P != 0)  # APCER/FAR
    frr_v = np.divide(fp_v, N, out=np.zeros_like(fp_v, dtype=float), where=N != 0)  # BPCER/FRR/FPR
    rec_v = np.divide(tp_v, P, out=np.zeros_like(tp_v, dtype=float), where=P != 0)  # TPR
    acc_v = (tp_v + tn_v) / (P + N) if (P + N) > 0 else np.zeros_like(tp_v, dtype=float)

    prec_v = np.divide(tp_v, tp_v + fp_v, out=np.zeros_like(tp_v, dtype=float), where=(tp_v + fp_v) != 0)
    f1_v = np.divide(2 * prec_v * rec_v, prec_v + rec_v, out=np.zeros_like(rec_v, dtype=float), where=(prec_v + rec_v) != 0)
    logits_v = _safe_logit(sweep_thresholds)

    idx_eer = int(np.nanargmin(np.abs(far_v - frr_v)))

    # Bootstrap CIs at the reference threshold (custom when set, EER otherwise).
    if config.custom_threshold is not None:
        ref_thr_aligned = float(align_scores(np.asarray([config.custom_threshold], dtype=float),
                                             config.positive_if_higher_score)[0])
    else:
        ref_thr_aligned = float(operating["eer"])
    ci = _bootstrap_ci(labels, scores_aligned, ref_thr_aligned, config)

    return ModelArtifacts(
        model_name=model_name,
        df=df,
        labels=labels,
        scores_original=scores_original,
        scores_aligned=scores_aligned,
        curves=curves,
        global_metrics=global_metrics,
        threshold_results=threshold_results,
        threshold_grid_df=threshold_grid_df,
        sweep_thresholds=sweep_thresholds,
        sweep_far=far_v,
        sweep_frr=frr_v,
        sweep_recall=rec_v,
        sweep_precision=prec_v,
        sweep_acc=acc_v,
        sweep_f1=f1_v,
        sweep_tp=tp_v,
        sweep_tn=tn_v,
        sweep_fp=fp_v,
        sweep_fn=fn_v,
        sweep_logits=logits_v,
        eer_thr=float(sweep_thresholds[idx_eer]),
        eer_far=float(far_v[idx_eer]),
        eer_frr=float(frr_v[idx_eer]),
        n_pos=P,
        n_neg=N,
        ci=ci,
    )


def _bootstrap_ci(
    labels: np.ndarray, scores_aligned: np.ndarray, threshold_aligned: float, config: EvaluationConfig
) -> Dict[str, Tuple[float, float]]:
    """Bootstrap CIs for ROC-AUC / Average Precision and the threshold metrics."""
    def _auc(idx: np.ndarray) -> float:
        yt = labels[idx]
        if len(np.unique(yt)) < 2:
            return float("nan")
        return float(roc_auc_score(yt, scores_aligned[idx]))

    def _ap(idx: np.ndarray) -> float:
        yt = labels[idx]
        if len(np.unique(yt)) < 2:
            return float("nan")
        return float(average_precision_score(yt, scores_aligned[idx]))

    def _counts(idx: np.ndarray) -> Tuple[float, float, float, float]:
        yt = labels[idx]
        pred = scores_aligned[idx] >= threshold_aligned
        tp = float(np.sum(pred & (yt == 1)))
        fp = float(np.sum(pred & (yt == 0)))
        tn = float(np.sum(~pred & (yt == 0)))
        fn = float(np.sum(~pred & (yt == 1)))
        return tp, fp, tn, fn

    def _accuracy(idx: np.ndarray) -> float:
        tp, fp, tn, fn = _counts(idx)
        total = tp + fp + tn + fn
        return (tp + tn) / total if total else float("nan")

    def _f1(idx: np.ndarray) -> float:
        tp, fp, tn, fn = _counts(idx)
        denom = 2 * tp + fp + fn
        return 2 * tp / denom if denom else float("nan")

    def _far(idx: np.ndarray) -> float:
        tp, fp, tn, fn = _counts(idx)
        pos = tp + fn
        return fn / pos if pos else float("nan")

    def _frr(idx: np.ndarray) -> float:
        tp, fp, tn, fn = _counts(idx)
        neg = tn + fp
        return fp / neg if neg else float("nan")

    return bootstrap_ci(
        len(labels),
        {
            "roc_auc": _auc,
            "average_precision": _ap,
            "accuracy": _accuracy,
            "f1": _f1,
            "far": _far,
            "frr": _frr,
        },
        config.statistics.confidence_intervals,
    )
