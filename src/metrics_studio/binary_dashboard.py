from __future__ import annotations

import html
import json
import math
from pathlib import Path
from typing import Sequence

import numpy as np
import pandas as pd

from metrics_studio.binary_metrics import ModelArtifacts, align_scores, compute_threshold_result
from metrics_studio.config import EvaluationConfig
from metrics_studio.i18n import t_attr, t_span, tr
from metrics_studio.shared import (
    CORE_CSS,
    SHARED_JS,
    STUDIO_CSS,
    paginated_table,
    plotly_script,
    runtime_blocks,
)
from metrics_studio.shared.filter_panel import build_filter_panel
from metrics_studio.shared.html_builder import ci_line


def _worst_cases_section(artifacts, config, selected_idx: int | None = None, table_idx: int | None = None) -> str:
    """Most confident misclassifications at the operating threshold, per model."""
    thr = _target_threshold(config)
    higher = bool(config.positive_if_higher_score)
    out = []
    for idx, art in enumerate(artifacts):
        if selected_idx is not None and idx != selected_idx:
            continue
        score = np.asarray(art.scores_original, dtype=float)
        label = np.asarray(art.labels, dtype=int)
        rid = art.df["record_id"].astype(str).to_numpy()
        pred_pos = score >= thr if higher else score <= thr
        pred_label = np.where(pred_pos, config.positive_label, config.negative_label)
        error = pred_label != label
        margin = np.abs(score - thr)
        order = np.argsort(-margin)
        rows = []
        for i in order:
            if not error[i]:
                continue
            rows.append({
                "id": rid[i],
                "score": f"{score[i]:.4f}",
                "label": str(int(label[i])),
                "pred": str(int(pred_label[i])),
                "margin": f"{margin[i]:.4f}",
            })
            if len(rows) >= 200:
                break
        if not rows:
            continue
        columns = [("id", "ID"), ("score", "Score"), ("label", "Actual"), ("pred", "Predicted"), ("margin", "|score − threshold|")]
        label_keys = {"id": "col.id", "score": "col.score", "label": "col.actual", "pred": "col.predicted"}
        out.append(
            f'<div class="model-case-table"><section class="dash-section"><div class="section-title">{t_span("panel.binary.worst_title")}</div>'
            + paginated_table(f"binary-worst-{idx if table_idx is None else table_idx}", columns, rows, page_size=10,
                              export_name=f"binary_worst_cases_{idx if table_idx is None else table_idx}",
                              note_key=None, label_keys=label_keys,
                              note="")
            + f'<p class="muted small">{t_span("panel.binary.worst_note", thr=f"{thr:.4f}")}</p>'
            + "</section></div>"
        )
    return "\n".join(out)


LOG_PLOT_FLOOR = 1e-6


def _reference_rates(config: EvaluationConfig) -> list[float]:
    values = getattr(config, "operational_reference_rates", (0.1, 0.01, 0.001))
    out = []
    for value in values:
        try:
            rate = float(value)
        except (TypeError, ValueError):
            continue
        if 0.0 < rate < 1.0 and rate not in out:
            out.append(rate)
    return out or [0.1, 0.01, 0.001]


def _min_positive_reference(config: EvaluationConfig) -> float:
    return min(_reference_rates(config) + [0.001])


def _log_floor(config: EvaluationConfig) -> float:
    return max(min(_min_positive_reference(config) / 10.0, 1e-3), LOG_PLOT_FLOOR)


def _fmt(value: float, digits: int = 4) -> str:
    if value is None or not np.isfinite(value):
        return "-"
    return f"{value:.{digits}f}"


def _fmt_pct(value: float, digits: int = 2) -> str:
    if value is None or not np.isfinite(value):
        return "-"
    return f"{100.0 * value:.{digits}f}%"


def _json_float(value: float | None) -> float | None:
    if value is None:
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(value):
        return None
    return value


def _target_threshold(config: EvaluationConfig) -> float:
    return float(config.custom_threshold if config.custom_threshold is not None else 0.5)


def _class_role_names(config: EvaluationConfig) -> dict[int, str]:
    """Semantic class names from case_study.class_roles, e.g. {1: "attack"}."""
    return {int(label): str(role) for role, label in config.case_study.class_roles.items()}


def _positive_class_name(config: EvaluationConfig) -> str:
    role = _class_role_names(config).get(int(config.positive_label))
    if role:
        return f"{role} (label={config.positive_label})"
    return f"Positive class (label={config.positive_label})"


def _positive_class_span(config: EvaluationConfig) -> str:
    role = _class_role_names(config).get(int(config.positive_label))
    if role:
        return html.escape(f"{role} (label={config.positive_label})")
    return t_span("panel.binary.positive_class", label=config.positive_label)


def _negative_class_name(config: EvaluationConfig) -> str:
    role = _class_role_names(config).get(int(config.negative_label))
    if role:
        return f"{role} (label={config.negative_label})"
    return f"Negative class (label={config.negative_label})"


def _negative_class_span(config: EvaluationConfig) -> str:
    role = _class_role_names(config).get(int(config.negative_label))
    if role:
        return html.escape(f"{role} (label={config.negative_label})")
    return t_span("panel.binary.negative_class", label=config.negative_label)


def _prediction_positive_span(config: EvaluationConfig) -> str:
    return t_span("panel.binary.pred_positive", label=config.positive_label)


def _prediction_negative_span(config: EvaluationConfig) -> str:
    return t_span("panel.binary.pred_negative", label=config.negative_label)


def _decision_rule_text(config: EvaluationConfig) -> str:
    operator = ">=" if config.positive_if_higher_score else "<="
    return f"score {operator} threshold → positive class"


def _filter_variables_from_art(art: ModelArtifacts, config: EvaluationConfig | None = None) -> list[str]:
    if config is not None and (
        config.filter_policy.to_include_evaluation or config.filter_policy.evaluation_explicit
    ):
        return [str(c) for c in config.filter_policy.to_include_evaluation if c in art.df.columns]
    return [str(c) for c in art.df.attrs.get("filter_columns", []) if c in art.df.columns]


def _selector_panel(art: ModelArtifacts, config: EvaluationConfig) -> str:
    variables = _filter_variables_from_art(art, config)
    if not variables:
        return ""
    var_values = {
        v: sorted(art.df[v].astype(str).fillna("UNKNOWN").unique().tolist())
        for v in variables
    }
    return build_filter_panel(variables, var_values)


def _metrics_at_exact_threshold(art: ModelArtifacts, config: EvaluationConfig, threshold_original: float):
    """Compute dashboard metrics exactly at the selected threshold.

    The threshold is interpreted in the user's original score units. This avoids
    selecting the nearest value from the plotting sweep and keeps values such as
    0.5000 exact in the model summary.
    """
    threshold_aligned = float(
        align_scores(np.array([threshold_original], dtype=float), config.positive_if_higher_score)[0]
    )
    return compute_threshold_result(
        model_name=art.model_name,
        labels=art.labels,
        aligned_scores=art.scores_aligned,
        threshold_aligned=threshold_aligned,
        name="custom_threshold",
        config=config,
    )


def _row_percentages(r) -> dict[str, float]:
    neg_total = r.tn + r.fp
    pos_total = r.fn + r.tp
    return {
        "tn": (r.tn / neg_total) if neg_total else 0.0,
        "fp": (r.fp / neg_total) if neg_total else 0.0,
        "fn": (r.fn / pos_total) if pos_total else 0.0,
        "tp": (r.tp / pos_total) if pos_total else 0.0,
    }


def _confusion_matrix_html(r, config: EvaluationConfig) -> str:
    pct = _row_percentages(r)
    return f"""
    <div class="confusion-card">
      <h3>{t_span("panel.binary.confusion_title")} <span data-threshold-label>{_fmt(float(r.threshold_original))}</span></h3>
      <div class="confusion-matrix">
        <div class="cell header"></div>
        <div class="cell header">{_prediction_negative_span(config)}</div>
        <div class="cell header">{_prediction_positive_span(config)}</div>

        <div class="cell header">{_negative_class_span(config)}</div>
        <div class="cell tn">
          <span>TN</span>
          <div class="cell-value"><strong data-cell-count="tn">{r.tn}</strong><em data-cell-pct="tn">({_fmt_pct(pct['tn'], 1)})</em></div>
        </div>
        <div class="cell fp">
          <span>FP</span>
          <div class="cell-value"><strong data-cell-count="fp">{r.fp}</strong><em data-cell-pct="fp">({_fmt_pct(pct['fp'], 1)})</em></div>
        </div>

        <div class="cell header">{_positive_class_span(config)}</div>
        <div class="cell fn">
          <span>FN</span>
          <div class="cell-value"><strong data-cell-count="fn">{r.fn}</strong><em data-cell-pct="fn">({_fmt_pct(pct['fn'], 1)})</em></div>
        </div>
        <div class="cell tp">
          <span>TP</span>
          <div class="cell-value"><strong data-cell-count="tp">{r.tp}</strong><em data-cell-pct="tp">({_fmt_pct(pct['tp'], 1)})</em></div>
        </div>
      </div>
    </div>
    """



def _select_operating_point(art: ModelArtifacts, condition_metric: str, condition_target: float, value_metric: str) -> dict[str, float]:
    """Select an operating point from the plotted sweep under a practical constraint.

    For FAR@FRR=x, the selected threshold is the point with FRR <= x that gives
    the lowest FAR. For FRR@FAR=x, it is the point with FAR <= x that gives the
    lowest FRR. If no point satisfies the constraint, the closest point to the
    target condition is returned.
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
        # Primary objective: minimize the reported value metric.
        # Tie-breaker: stay close to the target constraint instead of going to an unnecessarily extreme threshold.
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


def _target_label(value: float) -> str:
    if value >= 0.01:
        return _fmt_pct(value, 2)
    return _fmt_pct(value, 3)


def _operating_targets_html(artifacts: Sequence[ModelArtifacts], config: EvaluationConfig) -> str:
    """One shared table; reference thresholds never depend on the manual slider."""
    targets = _reference_rates(config)
    definitions = (
        [("panel.binary.far_at_frr", f"FRR ≤ {_target_label(value)}", "frr", value, "far") for value in targets]
        + [("panel.binary.frr_at_far", f"FAR ≤ {_target_label(value)}", "far", value, "frr") for value in targets]
        + [("panel.binary.references", "EER", "eer", None, None),
           ("panel.binary.references", "Max F1", "f1_max", None, None)]
    )
    groups = "".join(
        f'<th scope="colgroup" colspan="3" data-model-index="{index}">{html.escape(art.model_name)}</th>'
        for index, art in enumerate(artifacts)
    )
    subheads = "".join(
        f'<th scope="col" data-model-index="{index}">{label}</th>'
        for index in range(len(artifacts)) for label in (t_span("col.threshold"), "FAR", "FRR")
    )
    rows = []
    for row_index, (category, label, condition, target, metric) in enumerate(definitions):
        cells = []
        for index, art in enumerate(artifacts):
            if target is not None:
                point = _select_operating_point(art, condition, target, metric)
            else:
                result = next((item for item in art.threshold_results if item.name == condition), None)
                point = {"threshold": result.threshold_original, "far": result.far, "frr": result.frr} if result else {}
            for key in ("threshold", "far", "frr"):
                value = point.get(key)
                display = t_span("v2.notAvailable") if value is None or not np.isfinite(value) else (
                    _fmt(value) if key == "threshold" else _fmt_pct(value)
                )
                cells.append(f'<td data-model-index="{index}">{display}</td>')
        category_cell = ""
        if row_index == 0 or definitions[row_index - 1][0] != category:
            span = sum(item[0] == category for item in definitions)
            category_cell = f'<th scope="rowgroup" rowspan="{span}">{t_span(category)}</th>'
        rows.append(f'<tr>{category_cell}<th scope="row">{html.escape(label)}</th>{"".join(cells)}</tr>')
    return (
        '<section class="dm-binary-operating">'
        f'<h2>{t_span("panel.binary.operating_comparison")}</h2>'
        f'<p class="dm-binary-section-note">{t_span("panel.binary.operating_comparison_help")}</p>'
        '<div class="dm-comparison-table-wrap"><table class="dm-operating-table">'
        f'<thead><tr><th colspan="2" rowspan="2">{t_span("col.target")}</th>{groups}</tr><tr>{subheads}</tr></thead>'
        f'<tbody>{"".join(rows)}</tbody></table></div></section>'
    )


def _threshold_logit_bias(threshold: float) -> float:
    """Additive decision offset: logit(p) + bias >= 0 iff p >= threshold.

    Endpoints are limits, not finite offsets. A logit has no real value outside
    the probability domain. This display helper never changes predictions.
    """
    if not math.isfinite(threshold) or not 0 <= threshold <= 1:
        return float("nan")
    if threshold == 0:
        return float("inf")
    if threshold == 1:
        return float("-inf")
    return math.log1p(-threshold) - math.log(threshold)


def _binary_metrics_matrix(artifacts: Sequence[ModelArtifacts], config: EvaluationConfig, threshold: float) -> str:
    """One metric per row and one model per column for direct horizontal reading."""
    results = [_metrics_at_exact_threshold(art, config, threshold) for art in artifacts]
    ci_cfg = config.statistics.confidence_intervals
    show_ci = ci_cfg.enabled and ci_cfg.display == "secondary"

    def values(art, result):
        return {
            "logit_bias": _threshold_logit_bias(result.threshold_original),
            "eer": 0.5 * (art.eer_far + art.eer_frr),
            "threshold": result.threshold_original,
            "far": result.far,
            "frr": result.frr,
            "roc_auc": art.global_metrics.get("roc_auc", float("nan")),
            "pr_auc": art.global_metrics.get("average_precision", float("nan")),
            "recall": result.recall_pos,
            "precision": result.precision_pos,
            "accuracy": result.accuracy,
            "brier": art.global_metrics.get("brier_score", float("nan")),
            "ece": art.global_metrics.get("ece", float("nan")),
        }

    definitions = [
        ("logit_bias", tr("panel.binary.logit_bias"), "logit", "neutral", None),
        ("eer", "EER", "pct", "lower", None),
        ("far", "FAR", "pct", "lower", "far"),
        ("frr", "FRR", "pct", "lower", "frr"),
        ("roc_auc", "ROC-AUC", "num", "higher", "roc_auc"),
        ("pr_auc", "PR-AUC", "num", "higher", "average_precision"),
        ("recall", "Recall", "pct", "higher", None),
        ("precision", "Precision", "pct", "higher", None),
        ("accuracy", "Accuracy", "pct", "higher", "accuracy"),
        ("brier", "Brier", "num", "lower", None),
        ("ece", "ECE", "num", "lower", None),
    ]
    model_values = [
        values(art, result)
        for art, result in zip(artifacts, results, strict=True)
    ]
    heads = "".join(
        f'<th scope="col" data-model-index="{idx}">{html.escape(art.model_name)}</th>'
        for idx, art in enumerate(artifacts)
    )
    threshold_cells = "".join(
        f'<td data-model-index="{index}" data-threshold-cell="model-{index}"></td>'
        for index in range(len(artifacts))
    )
    rows = [f'<tr class="dm-binary-threshold-row"><th scope="row">{t_span("panel.binary.threshold_label")}</th>{threshold_cells}</tr>']
    for key, label, kind, better, ci_key in definitions:
        cells = []
        for idx, (art, vals) in enumerate(
            zip(artifacts, model_values, strict=True)
        ):
            raw = float(vals[key])
            display = _fmt_pct(raw) if kind == "pct" else _fmt(raw)
            if kind == "logit" and math.isinf(raw):
                display = "+∞" if raw > 0 else "−∞"
            ci_html = ""
            if show_ci and ci_key and art.ci.get(ci_key):
                ci_html = ci_line(
                    art.ci.get(ci_key), n=int(art.n_pos + art.n_neg), level=ci_cfg.level,
                    metric=ci_key, kind=kind, digits=2 if kind == "pct" else 4,
                ).replace('class="kpi-ci"', f'class="kpi-ci" data-ci-model="model-{idx}"', 1)
            cells.append(
                f'<td data-label="{html.escape(art.model_name)}"><div class="model-matrix-value" data-model-id="model-{idx}" '
                f'data-metric-value="{html.escape(key)}" data-raw="{raw!r}" data-fmt="{html.escape(kind)}" '
                f'data-compare-metric="{html.escape(key)}" data-model-index="{idx}" data-compare-raw="{raw!r}" '
                f'data-better="{html.escape(better)}">{html.escape(display)}</div>'
                f'{ci_html}<div class="metric-subtitle" data-model-id="model-{idx}" data-metric-subtitle="{html.escape(key)}"></div></td>'
            )
        label_html = f'<span data-metric-key="{html.escape(key)}">{html.escape(label)}</span>'
        if key == "logit_bias":
            label_html = (
                f'<abbr tabindex="0" title="{t_attr("panel.binary.logit_bias_help")}">'
                f'{t_span("panel.binary.logit_bias")}</abbr>'
            )
        rows.append(f'<tr><th scope="row">{label_html}</th>{"".join(cells)}</tr>')
    return (
        '<div class="model-matrix-wrap"><table class="model-metrics-table">'
        f'<thead><tr><th scope="col">{t_span("col.metric")}</th>{heads}</tr></thead><tbody>{"".join(rows)}</tbody></table></div>'
    )


def _model_overview_card(art: ModelArtifacts, config: EvaluationConfig, threshold_original: float, model_id: str, idx: int = 0) -> str:
    r = _metrics_at_exact_threshold(art, config, threshold_original)
    matrix_html = _confusion_matrix_html(r, config)
    source = config.input_sources[idx] if idx < len(config.input_sources) else None
    exp_attrs = (
        f' data-experiment-id="{html.escape(source.resolved_experiment_id)}" data-role="{html.escape(source.role)}"'
        if source else ""
    )

    # Bounds for the interactive threshold slider (padded score range).
    scores = np.asarray(art.scores_original, dtype=float)
    s_lo, s_hi = float(np.nanmin(scores)), float(np.nanmax(scores))
    if not (np.isfinite(s_lo) and np.isfinite(s_hi)) or s_hi <= s_lo:
        s_lo, s_hi = 0.0, 1.0
    pad = (s_hi - s_lo) * 0.02 or 0.01
    s_lo, s_hi = s_lo - pad, s_hi + pad
    s_step = max((s_hi - s_lo) / 1000.0, 1e-6)

    return f"""
    <article class="model-operating-panel" data-model-id="{html.escape(model_id)}"{exp_attrs}>
      <div class="model-header">
        <div>
          <h2>{html.escape(art.model_name)}</h2>
        </div>
        <div class="model-meta">
          <span>{_negative_class_span(config)}: <b>{art.n_neg}</b></span>
          <span>{_positive_class_span(config)}: <b>{art.n_pos}</b></span>
        </div>
      </div>

      {_selector_panel(art, config)}

      <div class="model-operating-flow">
          <div class="threshold-card" data-threshold-owner="{html.escape(model_id)}">
            <label for="threshold-{html.escape(model_id)}">{t_span("panel.binary.threshold_label")}</label>
            <div class="threshold-controls">
              <input id="threshold-{html.escape(model_id)}" data-threshold-input type="number" step="0.0001" value="{_fmt(float(threshold_original))}" inputmode="decimal">
              <input data-threshold-slider type="range" min="{s_lo:.6f}" max="{s_hi:.6f}" step="{s_step:.6f}" value="{float(threshold_original):.6f}" data-i18n-attr="aria-label:panel.binary.threshold_slider" aria-label="{t_attr('panel.binary.threshold_slider')}">
            </div>
            <p data-threshold-feedback class="threshold-feedback">{t_span("panel.binary.threshold_feedback")}</p>
          </div>
          {matrix_html}
      </div>


    </article>
    """


def _generate_overview(artifacts: Sequence[ModelArtifacts], config: EvaluationConfig) -> str:
    target_th = _target_threshold(config)
    panels = "\n".join(
        _model_overview_card(art, config, target_th, f"model-{idx}", idx)
        for idx, art in enumerate(artifacts)
    )
    return f"""
    <section class="models-workspace dm-binary-fixed">
      {_binary_metrics_matrix(artifacts, config, target_th)}
      {_operating_targets_html(artifacts, config)}
      <section class="dm-binary-confusions">
        <h2>{t_span("panel.binary.confusions_comparison")}</h2>
        <p class="dm-binary-section-note">{t_span("panel.binary.confusions_current_help")}</p>
        <div class="dm-binary-matrix-grid">{panels}</div>
      </section>
    </section>
    """



def _worst_cases_workspace(artifacts: Sequence[ModelArtifacts], config: EvaluationConfig) -> str:
    panels = []
    for idx, art in enumerate(artifacts):
        cases = _worst_cases_section([art], config, 0, idx)
        if not cases:
            continue
        panels.append(
            f'<article class="model-section" data-model-id="model-{idx}">'
            f'<div class="model-header"><h2>{html.escape(art.model_name)}</h2></div>{cases}</article>'
        )
    if not panels:
        return ""
    return (
        '<section class="models-workspace binary-cases-workspace"><div class="workspace-head">'
        '<div><span class="workspace-eyebrow">Metrics Studio</span>'
        f'<h2 class="workspace-title">{t_span("panel.binary.worst_title")}</h2></div>'
        f'<p>{t_span("panel.binary.worst_workspace_help")}</p></div>'
        f'<div class="model-operating-grid" style="--model-count:{len(panels)}">{"".join(panels)}</div></section>'
    )


def _dashboard_data_json(artifacts: Sequence[ModelArtifacts], config: EvaluationConfig) -> str:
    models = {}
    for idx, art in enumerate(artifacts):
        model_id = f"model-{idx}"
        filter_variables = _filter_variables_from_art(art, config)
        metadata_rows = [
            {variable: str(row.get(variable, "UNKNOWN")) for variable in filter_variables}
            for _, row in art.df.iterrows()
        ]
        source = config.input_sources[idx] if idx < len(config.input_sources) else None
        baseline_scores = None
        if source and source.variable_baseline_pred and source.variable_baseline_pred in art.df.columns:
            base = pd.to_numeric(art.df[source.variable_baseline_pred], errors="coerce")
            baseline_scores = [None if pd.isna(v) else float(v) for v in base]
        models[model_id] = {
            "model_name": art.model_name,
            "experiment_id": config.input_sources[idx].resolved_experiment_id,
            "curve_thresholds": art.sweep_thresholds.astype(float).tolist(),
            "labels": art.labels.astype(int).tolist(),
            "scores": art.scores_original.astype(float).tolist(),
            "baseline_scores": baseline_scores,
            "metadata": metadata_rows,
            "filter_variables": filter_variables,
            "positive_label": 1,
            "negative_label": 0,
            "positive_if_higher_score": bool(config.positive_if_higher_score),
            "roc_auc": _json_float(art.global_metrics.get("roc_auc")),
            "average_precision": _json_float(art.global_metrics.get("average_precision")),
            "eer": _json_float(0.5 * (art.eer_far + art.eer_frr)),
            "eer_thr": _json_float(art.eer_thr),
            "brier": _json_float(art.global_metrics.get("brier_score")),
            "ece": _json_float(art.global_metrics.get("ece")),
        }

    payload = {
        "positive_name": _positive_class_name(config),
        "negative_name": _negative_class_name(config),
        "decision_rule": _decision_rule_text(config),
        "models": models,
        "curve_config": {
            "log_floor": _log_floor(config),
            "roc_x": config.labels.roc_x,
            "roc_y": config.labels.roc_y,
        },
    }
    text = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    return text.replace("</", "<\\/")


def _css() -> str:
    return """
    :root {
      /* Binary reuses the shared design tokens (base.css) so it inherits light/dark
         theming automatically. --bg and --muted are intentionally NOT redefined here
         so they fall through to the shared (theme-aware) values. */
      --panel: var(--card);
      --panel-soft: var(--soft);
      --panel-softer: var(--soft);
      --border: var(--hair);
      --text: var(--ink);
      --muted-2: #94a3b8;
      --accent: #2563eb;
      --accent-dark: #1d4ed8;
      --shadow: var(--elev-1);
    }
    * { box-sizing: border-box; }
    body {
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
    }
    .container {
      max-width: 1560px;
      margin: 0 auto;
      padding: 22px;
    }
    .hero {
      background: linear-gradient(180deg, #1c2b42 0%, var(--navy, #172235) 100%);
      color: white;
      border-radius: var(--r-xl);
      padding: 30px 34px;
      box-shadow: var(--elev-2);
      margin-bottom: 24px;
    }
    .hero h1 {
      margin: 0 0 7px 0;
      font-size: 27px;
      font-weight: 800;
      line-height: 1.2;
      letter-spacing: -0.01em;
    }
    .hero p {
      margin: 0;
      color: #cfd8e6;
      max-width: 1000px;
      font-size: 13.5px;
      line-height: 1.55;
    }
    .config-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 18px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 10px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.10);
      border: 1px solid rgba(255, 255, 255, 0.16);
      color: #e2e8f0;
      font-size: 13px;
      white-space: nowrap;
    }
    .model-overview,
    .plot-section {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--r-lg);
      box-shadow: var(--shadow);
      padding: 24px 26px;
      margin-bottom: 20px;
    }
    .model-header,
    .section-title-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 18px;
      margin-bottom: 18px;
    }
    h2 {
      margin: 0 0 6px 0;
      font-size: 21px;
      letter-spacing: -0.01em;
    }
    h3 {
      margin: 0 0 12px 0;
      font-size: 16px;
    }
    .muted {
      color: var(--muted);
      margin: 0;
      font-size: 14px;
    }
    .small { font-size: 13px; }
    .model-meta {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
      color: var(--muted);
      font-size: 13px;
    }
    .model-meta span {
      background: var(--panel-soft);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 7px 10px;
    }
    /* Filter-panel styles (.gfp*/.filter-check) now come from the shared filters.css. */
    .summary-layout {
      display: grid;
      grid-template-columns: minmax(390px, 0.78fr) minmax(520px, 1fr);
      gap: 24px;
      align-items: start;
    }
    .summary-left,
    .summary-right {
      min-width: 0;
    }
    .summary-right {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .metric-rows {
      display: grid;
      gap: 10px;
    }
    .metric-row {
      display: grid;
      gap: 10px;
    }
    .metric-row-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .metric-row-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .metric-row-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .metric-card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--r-md);
      box-shadow: var(--elev-1);
      padding: 15px 16px 14px;
      min-height: 104px;
      display: flex;
      flex-direction: column;
      transition: transform .14s ease, box-shadow .14s ease, border-color .14s ease;
    }
    .metric-card:hover {
      transform: translateY(-2px);
      box-shadow: var(--elev-2);
      border-color: var(--hair-strong);
    }
    .metric-title {
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      font-weight: 800;
      margin-bottom: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    /* .info-icon and the #g-tooltip engine now come from the shared TOOLTIP_CSS/JS. */
    .metric-value {
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -0.025em;
      line-height: 1.05;
      margin-top: auto;
      padding-top: 10px;
      margin-bottom: 5px;
      color: var(--text);
      font-variant-numeric: tabular-nums;
    }
    .metric-subtitle {
      color: var(--muted);
      font-size: 12px;
      min-height: 16px;
    }
    .metric-subtitle.good { color: var(--ok); font-weight: 700; }
    .metric-subtitle.bad { color: var(--danger); font-weight: 700; }
    .threshold-card,
    .confusion-card {
      background: var(--panel-soft);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 16px;
    }
    .threshold-card label {
      display: block;
      color: var(--subhead);
      font-size: 13px;
      font-weight: 700;
      margin-bottom: 10px;
    }
    .threshold-controls {
      display: grid;
      grid-template-columns: minmax(180px, 1fr);
      gap: 10px;
      align-items: center;
    }
    .threshold-controls input {
      width: 100%;
      height: 44px;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 0 14px;
      font-size: 15px;
      font-weight: 650;
      color: var(--text);
      background: var(--panel);
      outline: none;
    }
    .threshold-controls input:focus {
      border-color: #94a3b8;
      box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.24);
    }
    .threshold-feedback {
      margin: 9px 0 0 0;
      font-size: 12px;
      color: var(--muted);
    }
    .threshold-feedback.invalid { color: #b91c1c; }
    .confusion-matrix {
      display: grid;
      grid-template-columns: 1.1fr repeat(2, 1fr);
      border: 1px solid var(--border);
      border-radius: 14px;
      overflow: hidden;
      background: var(--card);
    }
    .cell {
      min-height: 72px;
      padding: 10px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      border-right: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
      text-align: center;
    }
    .cell:nth-child(3n) { border-right: 0; }
    .cell:nth-last-child(-n + 3) { border-bottom: 0; }
    .cell.header {
      background: var(--panel-softer);
      color: var(--subhead);
      font-size: 12px;
      font-weight: 650;
    }
    .cell span {
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 4px;
    }
    .cell-value {
      display: inline-flex;
      align-items: baseline;
      justify-content: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .cell strong {
      font-size: 25px;
      letter-spacing: -0.02em;
    }
    .cell em {
      color: var(--muted);
      font-size: 13px;
      font-style: normal;
      font-weight: 650;
    }
    .tp { background: rgba(22, 163, 74, 0.13); }
    .tn { background: rgba(37, 99, 235, 0.13); }
    .fp { background: rgba(217, 119, 6, 0.15); }
    .fn { background: rgba(220, 38, 38, 0.13); }

    .plot-section {
      padding: 18px 18px 8px 18px;
    }
    """


def _javascript() -> str:
    return """
    <script>
    (function () {
      const raw = document.getElementById('dashboard-data');
      if (!raw) return;
      const dashboardData = JSON.parse(raw.textContent);

      function isFiniteNumber(value) {
        return typeof value === 'number' && Number.isFinite(value);
      }

      const tt = (k, a) => window.DM_I18N ? DM_I18N.t(k, a) : k;

      function fmt(value, digits = 4) {
        if (!isFiniteNumber(value)) return '-';
        return value.toFixed(digits);
      }

      function fmtPct(value, digits) {
        if (!isFiniteNumber(value)) return '-';
        if (digits === undefined && window.DM_FMT) return DM_FMT.fmt(value, 'pct');
        return (100 * value).toFixed(digits === undefined ? 2 : digits) + '%';
      }

      function safeDiv(num, den) {
        return den ? num / den : 0;
      }

      function selectedFilterValues(root, model) {
        const modelId = root.getAttribute('data-model-id');
        const scope = document.querySelector(`.control-dock-card[data-filter-owner="${modelId}"]`) || root;
        const result = {};
        const variables = model.filter_variables || [];
        for (const variable of variables) {
          result[variable] = new Set(
            Array.from(scope.querySelectorAll(`.filter-selector[data-filter-var="${variable}"]:checked`))
              .map(x => x.value)
          );
        }
        return result;
      }

      function rowPassesFilters(rowMeta, filters, variables) {
        for (const variable of variables || []) {
          const selected = filters[variable] || new Set();
          if (selected.size === 0) return false;
          const value = String((rowMeta || {})[variable] ?? "UNKNOWN");
          if (!selected.has(value)) return false;
        }
        return true;
      }

      function selectedRows(model, root) {
        const filters = selectedFilterValues(root, model);
        const variables = model.filter_variables || [];
        const bs = model.baseline_scores || null;
        const rows = [];
        for (let i = 0; i < model.scores.length; i++) {
          if (!rowPassesFilters((model.metadata || [])[i], filters, variables)) continue;
          const row = { label: model.labels[i], score: model.scores[i] };
          if (bs && Number.isFinite(bs[i])) row.base = bs[i];
          rows.push(row);
        }
        return rows;
      }

      function computeMetrics(model, threshold, root) {
        const positiveIfHigher = !!model.positive_if_higher_score;
        const rows = selectedRows(model, root);

        let tp = 0, tn = 0, fp = 0, fn = 0;
        for (const row of rows) {
          const label = row.label;
          const predPositive = positiveIfHigher ? row.score >= threshold : row.score <= threshold;
          if (label === 1 && predPositive) tp += 1;
          else if (label === 1 && !predPositive) fn += 1;
          else if (label === 0 && predPositive) fp += 1;
          else tn += 1;
        }

        const posTotal = tp + fn;
        const negTotal = tn + fp;
        const total = posTotal + negTotal;
        const recall = safeDiv(tp, posTotal);
        const specificity = safeDiv(tn, negTotal);
        const precision = safeDiv(tp, tp + fp);
        const accuracy = safeDiv(tp + tn, total);
        const f1 = (precision + recall) ? (2 * precision * recall) / (precision + recall) : 0;
        const far = safeDiv(fn, posTotal);
        const frr = safeDiv(fp, negTotal);

        return {
          threshold, tp, tn, fp, fn,
          recall, specificity, precision, accuracy, f1, far, frr,
          tnPct: safeDiv(tn, negTotal),
          fpPct: safeDiv(fp, negTotal),
          fnPct: safeDiv(fn, posTotal),
          tpPct: safeDiv(tp, posTotal)
        };
      }

      function setText(root, selector, value) {
        const el = root.querySelector(selector);
        if (el) el.textContent = value;
      }

      function thresholdLogitBias(threshold) {
        if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) return NaN;
        if (threshold === 0) return Infinity;
        if (threshold === 1) return -Infinity;
        return Math.log1p(-threshold) - Math.log(threshold);
      }

      function setMetric(root, key, raw, kind) {
        const modelId = root.getAttribute('data-model-id');
        const selector = `[data-model-id="${modelId}"][data-metric-value="${key}"], [data-model-id="${modelId}"] [data-metric-value="${key}"]`;
        document.querySelectorAll(selector).forEach(el => {
          el.textContent = window.DM_FMT ? DM_FMT.fmt(raw, kind) : String(raw);
          el.setAttribute('data-raw', raw);
          el.setAttribute('data-fmt', kind);
          el.setAttribute('data-compare-raw', isFiniteNumber(raw) ? raw : '');
        });
      }

      function updateModel(modelId, threshold) {
        const model = dashboardData.models[modelId];
        const root = document.querySelector(`.model-operating-panel[data-model-id="${modelId}"]`);
        if (!model || !root) return;

        const metrics = computeMetrics(model, threshold, root);
        window.DM_BINARY_CURVES?.update(modelId,threshold,selectedRows(model,root));

        setMetric(root, 'threshold', metrics.threshold, 'threshold');
        setMetric(root, 'logit_bias', thresholdLogitBias(metrics.threshold), 'logit');
        setMetric(root, 'far', metrics.far, 'pct');
        setMetric(root, 'frr', metrics.frr, 'pct');
        setMetric(root, 'recall', metrics.recall, 'pct');
        setMetric(root, 'precision', metrics.precision, 'pct');
        setMetric(root, 'accuracy', metrics.accuracy, 'pct');

        // Absolute metrics are independent of the selected comparison reference.

        setText(root, '[data-threshold-label]', fmt(metrics.threshold));
        setText(root, '[data-cell-count="tn"]', String(metrics.tn));
        setText(root, '[data-cell-count="fp"]', String(metrics.fp));
        setText(root, '[data-cell-count="fn"]', String(metrics.fn));
        setText(root, '[data-cell-count="tp"]', String(metrics.tp));
        setText(root, '[data-cell-pct="tn"]', '(' + fmtPct(metrics.tnPct, 1) + ')');
        setText(root, '[data-cell-pct="fp"]', '(' + fmtPct(metrics.fpPct, 1) + ')');
        setText(root, '[data-cell-pct="fn"]', '(' + fmtPct(metrics.fnPct, 1) + ')');
        setText(root, '[data-cell-pct="tp"]', '(' + fmtPct(metrics.tpPct, 1) + ')');


        const feedback = document.querySelector(`[data-threshold-owner="${modelId}"] [data-threshold-feedback]`) || root.querySelector('[data-threshold-feedback]');
        if (feedback) {
          feedback.textContent = tt('panel.binary.feedback_recomputed', { t: fmt(metrics.threshold), n: metrics.tp + metrics.tn + metrics.fp + metrics.fn });
          feedback.removeAttribute('data-i18n');
          feedback.classList.remove('invalid');
        }

        scheduleCIs(root, model, threshold);
      }

      // Client-side CI recompute (spec 3.4) at the active threshold. ROC-AUC and
      // PR-AUC retain their server-computed interval with a scope tooltip.
      // Selecting a slot must not replace an unchanged server interval.
      const ciSignatures = new WeakMap();
      function scheduleCIs(root, model, threshold) {
        if (!window.DMStats) return;
        const rows = selectedRows(model, root);
        const n = rows.length;
        const positiveIfHigher = !!model.positive_if_higher_score;
        const sig = root.getAttribute('data-model-id') + '|th=' + threshold + '|' + DMStats.signature(root);
        const previous = ciSignatures.get(root);
        ciSignatures.set(root, sig);
        if (previous === undefined || previous === sig) return;
        function counts(idx) {
          let tp = 0, tn = 0, fp = 0, fn = 0;
          for (const i of idx) {
            const r = rows[i];
            const predPositive = positiveIfHigher ? r.score >= threshold : r.score <= threshold;
            if (r.label === 1 && predPositive) tp++;
            else if (r.label === 1) fn++;
            else if (predPositive) fp++;
            else tn++;
          }
          return { tp, tn, fp, fn };
        }
        const fns = {
          accuracy: idx => { const c = counts(idx); const t = c.tp + c.tn + c.fp + c.fn; return t ? (c.tp + c.tn) / t : NaN; },
          f1: idx => { const c = counts(idx); const d = 2 * c.tp + c.fp + c.fn; return d ? 2 * c.tp / d : NaN; },
          far: idx => { const c = counts(idx); const p = c.tp + c.fn; return p ? c.fn / p : NaN; },
          frr: idx => { const c = counts(idx); const g = c.tn + c.fp; return g ? c.fp / g : NaN; },
        };
        const modelId = root.getAttribute('data-model-id');
        const ciEls = Array.from(root.querySelectorAll('[data-ci-metric]')).concat(Array.from(document.querySelectorAll(`[data-ci-model="${modelId}"]`)));
        ciEls.forEach(el => {
          const m = el.getAttribute('data-ci-metric');
          if (!m) return; // A non-calculable server interval stays unavailable.
          if (!fns[m]) { el.title = tt('ci.stale_unfiltered'); return; }
          DMStats.schedule(el, { n, statFn: fns[m] || null, signature: sig, kind: (m === 'roc_auc' || m === 'average_precision') ? 'num' : 'pct' });
        });
      }

      function parseThreshold(input) {
        if (!input) return null;
        const rawValue = String(input.value || '').replace(',', '.');
        if (!rawValue.trim()) return null;
        const value = Number(rawValue);
        return Number.isFinite(value) ? value : null;
      }

      const bindings = new Map();
      let pendingUpdate = 0, forceUpdate = false;
      function scheduleUpdates(force=false) {
        forceUpdate ||= force;
        if(pendingUpdate)return;
        pendingUpdate=requestAnimationFrame(()=>{
          pendingUpdate=0;const force=forceUpdate;forceUpdate=false;
          bindings.forEach(binding=>{
            const manager=window.DM_V2_MODELS;
            const threshold=manager?.getThreshold(binding.id)??parseThreshold(binding.input);
            if(!Number.isFinite(threshold))return;
            const bounds=manager?.getThresholdBounds(binding.id);
            if(binding.slider&&bounds&&Number.isFinite(bounds.min)&&Number.isFinite(bounds.max)){
              binding.slider.min=String(bounds.min);binding.slider.max=String(bounds.max);
              binding.slider.step=String(Math.max((bounds.max-bounds.min)/10000,1e-6));
              binding.slider.value=String(threshold);
            }
            if(binding.input&&Number(binding.input.value)!==threshold)binding.input.value=String(threshold);
            binding.input?.removeAttribute('aria-invalid');
            if(!force&&binding.last===threshold)return;
            binding.last=threshold;updateModel(binding.modelId,threshold);
            document.dispatchEvent(new CustomEvent('dm:thresholdchange',{detail:{modelId:binding.modelId,experimentId:binding.id,threshold}}));
          });
          document.dispatchEvent(new CustomEvent('dm:thresholdsupdated'));
        });
      }
      document.querySelectorAll('.model-operating-panel[data-model-id]').forEach((root) => {
        const modelId = root.getAttribute('data-model-id');
        const controls = document.querySelector('[data-threshold-owner="' + modelId + '"]');
        const input = controls?.querySelector('[data-threshold-input]');
        const slider = controls?.querySelector('[data-threshold-slider]');
        const feedback = controls?.querySelector('[data-threshold-feedback]');
        const id=root.dataset.experimentId;
        bindings.set(id,{id,modelId,input,slider,last:null});
        window.DM_V2_MODELS?.registerThreshold(id,parseThreshold(input),{min:Number(slider?.min),max:Number(slider?.max)});

        function apply(event) {
          const threshold = parseThreshold(input);
          if (threshold === null) {
            input?.setAttribute('aria-invalid', 'true');
            if (feedback) {
              feedback.textContent = tt('panel.binary.feedback_invalid');
              feedback.removeAttribute('data-i18n');
              feedback.classList.add('invalid');
            }
            return;
          }
          input?.removeAttribute('aria-invalid');
          if(window.DM_V2_MODELS)window.DM_V2_MODELS.setThreshold(id,threshold);
          if(!event?.target?.matches("[data-threshold-input],[data-threshold-slider]"))scheduleUpdates(true);
          else scheduleUpdates();
        }

        if (input) {
          input.addEventListener('input', apply);
          input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') apply();
          });
        }
        if (slider) {
          slider.addEventListener('input', () => {
            if (input) input.value = Number(slider.value).toFixed(4);
            apply({target:slider});
          });
        }
        if (input && slider) {
          input.addEventListener('input', () => {
            const v = Number(String(input.value).replace(',', '.'));
            if (Number.isFinite(v)) slider.value = v;
          });
        }

        root.querySelectorAll('.filter-selector').forEach(cb => cb.addEventListener('change', apply));
        root.querySelectorAll('.filter-select-all').forEach(btn => btn.addEventListener('click', () => {
          const variable = btn.dataset.filterVar;
          root.querySelectorAll(`.filter-selector[data-filter-var="${variable}"]`).forEach(cb => cb.checked = true);
          apply();
        }));
        root.querySelectorAll('.filter-clear-all').forEach(btn => btn.addEventListener('click', () => {
          const variable = btn.dataset.filterVar;
          root.querySelectorAll(`.filter-selector[data-filter-var="${variable}"]`).forEach(cb => cb.checked = false);
          apply();
        }));
        const selectAll = root.querySelector('.select-all-filters');
        if (selectAll) selectAll.addEventListener('click', () => {
          root.querySelectorAll('.filter-selector').forEach(cb => cb.checked = true);
          apply();
        });
        const clearAll = root.querySelector('.clear-all-filters');
        if (clearAll) clearAll.addEventListener('click', () => {
          root.querySelectorAll('.filter-selector').forEach(cb => cb.checked = false);
          apply();
        });
        apply();
      });

      window.DM_V2_MODELS?.subscribeThresholds(()=>scheduleUpdates());
      document.dispatchEvent(new CustomEvent('dm:comparisonready'));
      const refreshAll = () => scheduleUpdates(true);
      refreshAll();
      document.addEventListener('dm:langchange', refreshAll);
      document.addEventListener('dm:decimalschange', refreshAll);
      document.addEventListener('dm:modelschange', refreshAll);
    })();
    </script>
    """


def save_dashboard(artifacts: Sequence[ModelArtifacts], html_dir: Path, config: EvaluationConfig) -> Path:
    overview_html = _generate_overview(artifacts, config)
    dashboard_data = _dashboard_data_json(artifacts, config)

    html_content = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>{html.escape(config.titles.dashboard)}</title>
      {plotly_script(config.ui.plotly_delivery)}
      <style>{CORE_CSS}
{_css()}
{STUDIO_CSS}\n{(Path(__file__).parent / "shared/assets/binary_curves.css").read_text(encoding="utf-8")}</style>
    </head>
    <body>
      <main class="container">
        <section class="hero">
          <h1>{html.escape(config.titles.dashboard)}</h1>
          <p>{t_span('panel.binary.hero')}</p>
          <div class="config-strip">
            <span class="pill">{_positive_class_span(config)}</span>
            <span class="pill">{_negative_class_span(config)}</span>
          </div>
        </section>

        {overview_html}

        <section id="binary-curves-workbench" class="plot-section dm-binary-curves">
          <h2 class="dm-v2-sr-only">{t_span('panel.binary.section.curves.title')}</h2>
          <div class="dm-binary-curve-grid">
            <article class="dm-binary-curve-card" data-binary-curve="roc">
              <h3>{t_span('plot.roc_curve')}</h3>
              <div id="binary-roc" class="dm-binary-curve-plot"></div>
            </article>
            <article class="dm-binary-curve-card" data-binary-curve="det">
              <h3>{t_span('plot.det_curve')} <abbr tabindex="0" title="{t_attr('panel.binary.curves.detHelp')}" aria-label="{t_attr('panel.binary.curves.detHelp')}">i</abbr></h3>
              <div id="binary-det" class="dm-binary-curve-plot"></div>
            </article>
          </div>
        </section>

        <section id="binary-threshold-workbench" class="plot-section dm-binary-threshold">
          <header class="dm-binary-threshold-head">
            <div><h2>{t_span('panel.binary.section.threshold.title')}</h2>
              <p>{t_span('panel.binary.curves.subtitle')}</p></div>
            <div class="dm-binary-curve-controls"></div>
          </header>
          <p class="dm-binary-log-note" hidden>{t_span('panel.binary.curves.logNote')}</p>
          <div class="dm-binary-decision-grid"></div>
          <div class="dm-binary-combined" hidden>
            <p class="dm-binary-line-key">{t_span('panel.binary.curves.lineKey')}</p>
            <div id="binary-decision-combined" class="dm-binary-combined-plot"></div>
          </div>
        </section>

        <section id="binary-distributions-workbench" class="plot-section dm-binary-evidence">
          <header class="dm-binary-threshold-head">
            <div><h2>{t_span('panel.binary.section.diag.title')}</h2>
              <p>{t_span('panel.binary.section.diag.sub')}</p></div>
            <div class="dm-binary-curve-controls"></div>
          </header>
          <div class="dm-binary-evidence-key"><div class="dm-binary-evidence-legend"></div>
            <abbr tabindex="0" title="{t_attr('panel.binary.distributions.kdeHelp')}" aria-label="{t_attr('panel.binary.distributions.kdeHelp')}">i</abbr></div>
          <div class="dm-binary-evidence-grid"></div>
        </section>

        <section id="binary-calibration-workbench" class="plot-section dm-binary-evidence">
          <header class="dm-binary-threshold-head">
            <div><h2>{t_span('panel.binary.section.calib.title')}</h2>
              <p>{t_span('panel.binary.section.calib.sub')}</p></div>
            <div class="dm-binary-curve-controls"></div>
          </header>
          <div class="dm-binary-evidence-key"><div class="dm-binary-evidence-legend"></div>
            <abbr tabindex="0" title="{t_attr('panel.binary.distributions.calibrationHelp')}" aria-label="{t_attr('panel.binary.distributions.calibrationHelp')}">i</abbr></div>
          <div class="dm-binary-evidence-grid"></div>
          <div class="dm-binary-evidence-combined" hidden>
            <p class="dm-binary-line-key">{t_span('panel.binary.distributions.combinedKey')}</p>
            <div id="binary-calibration-combined"></div>
          </div>
        </section>

        {_worst_cases_workspace(artifacts, config)}

      </main>

      <div id="g-tooltip"></div>
      {runtime_blocks(config, "binary", artifacts=artifacts)}
      <script type="application/json" id="dashboard-data">{dashboard_data}</script>
      <script>{SHARED_JS}</script>
      <script>{(Path(__file__).parent / "shared/assets/binary_curves.js").read_text(encoding="utf-8")}</script>\n      <script>{(Path(__file__).parent / "shared/assets/binary_distributions.js").read_text(encoding="utf-8")}</script>\n      {_javascript()}
    </body>
    </html>
    """

    out_path = html_dir / "dashboard_binary.html"
    out_path.write_text(html_content, encoding="utf-8")
    return out_path
