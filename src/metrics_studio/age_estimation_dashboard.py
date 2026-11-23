"""Age estimation dashboard: multi-model comparison, global filters, NIST/ACCS/fairness."""
from __future__ import annotations

import html
import json
from pathlib import Path
from typing import Any, List, Sequence

import numpy as np
import pandas as pd

from metrics_studio.age_estimation_metrics import AgeEstimationArtifacts
from metrics_studio.config import EvaluationConfig
from metrics_studio.i18n import t_attr, t_span, tr
from metrics_studio.shared import (
    CORE_CSS,
    PLOTLY_CONFIG,
    SHARED_JS,
    STUDIO_CSS,
    paginated_table,
    plotly_script,
    runtime_blocks,
)
from metrics_studio.shared.filter_panel import build_filter_panel


def _worst_cases_section(artifacts) -> str:
    """Paginated worst-predictions table (by absolute age error) for each model."""
    out = []
    for idx, art in enumerate(artifacts):
        df = getattr(art, "worst_predictions_df", None)
        if df is None or df.empty:
            continue
        rows = []
        for _, r in df.iterrows():
            rows.append({
                "id": "" if pd.isna(r.get("record_id")) else str(r.get("record_id")),
                "gt": f"{float(r['y_true']):.1f}" if "y_true" in df.columns else "",
                "pred": f"{float(r['y_pred']):.1f}" if "y_pred" in df.columns else "",
                "err": f"{float(r['abs_error']):.2f}" if "abs_error" in df.columns else "",
            })
        columns = [("id", "ID"), ("gt", tr("col.actual_age")), ("pred", tr("col.predicted_age")), ("err", tr("col.abs_error"))]
        label_keys = {"id": "col.id", "gt": "col.actual_age", "pred": "col.predicted_age", "err": "col.abs_error"}
        out.append(
            f'<article class="model-section model-case-table" data-model-id="model-{idx}"><div class="model-header"><h2>{html.escape(art.model_name)}</h2></div>'
            f'<section class="dash-section"><div class="section-title">{t_span("panel.age.worst_title")}</div>'
            + paginated_table(f"age-worst-{idx}", columns, rows, page_size=10,
                              export_name=f"age_worst_cases_{idx}",
                              note_key="panel.age.worst_note", label_keys=label_keys)
            + "</section></article>"
        )
    if not out:
        return ""
    return (
        '<section class="models-workspace age-cases-workspace"><div class="workspace-head">'
        f'<div><span class="workspace-eyebrow">Metrics Studio</span><h2 class="workspace-title">{t_span("panel.age.worst_workspace")}</h2></div>'
        f'<p>{t_span("panel.age.worst_workspace_help")}</p></div>'
        f'<div class="model-operating-grid" style="--model-count:{len(out)}">{"".join(out)}</div></section>'
    )

PALETTE = ["#0F766E", "#4059A7", "#B66B18", "#7755A6", "#C65345", "#16859A", "#18845E", "#9A5B78"]
GREY = "#66736f"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _import_plotly():
    try:
        import plotly.graph_objects as go
        from plotly.subplots import make_subplots
        return go, make_subplots
    except ImportError as exc:
        raise ImportError("pip install plotly") from exc


def _fmt(x: Any, d: int = 2) -> str:
    if x is None:
        return "—"
    try:
        f = float(x)
    except Exception:
        return "—"
    return "—" if not np.isfinite(f) else f"{f:.{d}f}"


def _pct(x: Any, d: int = 1) -> str:
    if x is None:
        return "—"
    try:
        f = float(x)
    except Exception:
        return "—"
    return "—" if not np.isfinite(f) else f"{100*f:.{d}f}%"


def _filter_vars(art: AgeEstimationArtifacts) -> List[str]:
    return [str(c) for c in art.predictions_df.attrs.get("filter_columns", []) if c in art.predictions_df.columns]


# ---------------------------------------------------------------------------
# Static Plotly: pairwise error distribution
# ---------------------------------------------------------------------------
def _static_pairwise(artifacts: Sequence[AgeEstimationArtifacts]) -> str:
    if len(artifacts) < 2:
        return ""
    go, _ = _import_plotly()
    import plotly.graph_objects as go_real

    # Match by index (assumes same dataset order)
    min_n = min(len(a.abs_error) for a in artifacts)
    traces = []
    pairs_done: set = set()
    for i, a1 in enumerate(artifacts):
        for j, a2 in enumerate(artifacts):
            if i >= j:
                continue
            key = (i, j)
            if key in pairs_done:
                continue
            pairs_done.add(key)
            diff = np.abs(a1.abs_error[:min_n] - a2.abs_error[:min_n])
            label = f"|err({a1.model_name}) − err({a2.model_name})|"
            traces.append(go_real.Histogram(
                x=diff, name=label,
                marker_color=PALETTE[(i + j) % len(PALETTE)],
                opacity=0.72, nbinsx=40,
                hovertemplate=f"{tr('plot.delta_error')}: %{{x:.2f}} {tr('plot.years')}<br>{tr('plot.count')}: %{{y}}<extra></extra>",
            ))

    fig = go_real.Figure(data=traces)
    fig.update_layout(
        height=340, template="plotly_white", barmode="overlay",
        title=dict(text=tr("plot.pairwise_error_difference"), font=dict(size=14, color="#1e3a8a")),
        margin=dict(l=55, r=24, t=54, b=52),
        font=dict(color="#1f2937", size=12),
        xaxis=dict(title=tr("plot.absolute_error_difference_years"), gridcolor="#e5e7eb"),
        yaxis=dict(title=tr("plot.frequency"), gridcolor="#e5e7eb"),
        legend=dict(orientation="h", x=0, y=1.18),
    )
    return fig.to_html(full_html=False, include_plotlyjs=False, config=PLOTLY_CONFIG)


# ---------------------------------------------------------------------------
# Static Plotly: FPR heatmap (Y=actual age, X=challenge threshold, color=FPR%)
# ---------------------------------------------------------------------------
def _static_fpr_heatmap(artifacts: Sequence[AgeEstimationArtifacts], config: EvaluationConfig) -> str:
    if not artifacts or all(a.fpr_by_age_df.empty for a in artifacts):
        return ""
    go, make_subplots = _import_plotly()
    import plotly.graph_objects as go_real

    challenges  = sorted(config.age_estimation.challenge_thresholds)
    min_age     = config.age_estimation.challenge_min_age
    max_age     = max(challenges) - 1
    all_ages    = list(range(min_age, max_age + 1))

    x_labels = [f"{tr('panel.age.challenge_prefix')}-{t}" for t in challenges]
    y_labels = [str(a) for a in all_ages]

    n_models = len(artifacts)
    cols = min(n_models, 2)
    rows = (n_models + cols - 1) // cols

    fig = make_subplots(
        rows=rows, cols=cols,
        subplot_titles=[a.model_name for a in artifacts],
        horizontal_spacing=0.12, vertical_spacing=0.15,
    )

    pastel_scale = [
        [0.00, "#e8f5e9"], [0.20, "#c8e6c9"], [0.40, "#fffde7"],
        [0.60, "#ffe0b2"], [0.80, "#ffccbc"], [1.00, "#ef9a9a"],
    ]
    all_txt_pct:   List = []
    all_txt_count: List = []

    for m_idx, art in enumerate(artifacts):
        r = m_idx // cols + 1
        c = m_idx % cols + 1

        z, txt_pct, txt_count = [], [], []
        for age in all_ages:
            row_z, row_pct, row_cnt = [], [], []
            for T in challenges:
                if age >= T:
                    row_z.append(None); row_pct.append(""); row_cnt.append("")
                else:
                    sub = art.fpr_by_age_df[
                        (art.fpr_by_age_df["challenge"] == T) &
                        (art.fpr_by_age_df["actual_age"] == age)
                    ]
                    if sub.empty or sub.iloc[0]["n"] == 0:
                        row_z.append(None); row_pct.append(""); row_cnt.append("")
                    else:
                        fpr = sub.iloc[0]["fpr"]
                        n   = int(sub.iloc[0]["n"])
                        if np.isnan(fpr):
                            row_z.append(None); row_pct.append(""); row_cnt.append("")
                        else:
                            row_z.append(round(float(fpr) * 100, 1))
                            row_pct.append(f"{100*fpr:.0f}%")
                            row_cnt.append(f"{int(round(fpr*n))}/{n}")
            z.append(row_z)
            txt_pct.append(row_pct)
            txt_count.append(row_cnt)

        all_txt_pct.append(txt_pct)
        all_txt_count.append(txt_count)

        show_scale = (m_idx == n_models - 1)
        fig.add_trace(go_real.Heatmap(
            z=z, x=x_labels, y=y_labels,
            text=txt_pct,
            texttemplate="%{text}",
            textfont=dict(size=11, color="#334155"),
            colorscale=pastel_scale,
            zmin=0, zmax=100,
            showscale=show_scale,
            colorbar=dict(title=dict(text="FPR (%)"), thickness=14, len=0.85),
            xgap=2, ygap=2,
            hovertemplate=f"{tr('panel.age.challenge_prefix')}: %{{x}}<br>{tr('col.actual_age')}: %{{y}}<br>FPR: %{{z:.1f}}%<extra></extra>",
        ), row=r, col=c)

    trace_idxs = list(range(n_models))
    cell_h = max(22, 280 // max(len(all_ages), 1))
    height = max(360, len(all_ages) * cell_h + 140) * rows
    fig.update_layout(
        height=height, template="plotly_white",
        margin=dict(l=55, r=80, t=80, b=60),
        font=dict(color="#1f2937", size=12),
        updatemenus=[dict(
            type="buttons",
            direction="right",
            x=0.0, xanchor="left",
            y=1.07, yanchor="bottom",
            bgcolor="#f1f5f9",
            bordercolor="#cbd5e1",
            font=dict(size=12, color="#1e3a8a"),
            active=0,
            buttons=[
                dict(
                    label=" % FPR ",
                    method="restyle",
                    args=[{"text": all_txt_pct}, trace_idxs],
                ),
                dict(
                    label=" Failures / Total ",
                    method="restyle",
                    args=[{"text": all_txt_count}, trace_idxs],
                ),
            ],
        )],
    )
    fig.update_xaxes(title_text="Challenge threshold", tickangle=-15, automargin=True)
    fig.update_yaxes(title_text="Actual age", autorange="reversed", automargin=True)
    fig.update_annotations(font=dict(size=13, color="#1e3a8a"))
    return fig.to_html(full_html=False, include_plotlyjs=False, config=PLOTLY_CONFIG)


# ---------------------------------------------------------------------------
# Static Plotly: binary sweep — Accuracy / FAR / FRR / BA vs decision threshold Y
# ---------------------------------------------------------------------------
def _static_binary_sweep(artifacts: Sequence[AgeEstimationArtifacts], config: EvaluationConfig) -> str:
    dfs = [(a, a.binary_sweep_df) for a in artifacts if not a.binary_sweep_df.empty]
    if not dfs:
        return ""
    go, _ = _import_plotly()
    import plotly.graph_objects as go_real

    thresholds  = sorted(config.age_estimation.thresholds)
    fpr_targets = sorted(config.age_estimation.fpr_targets)

    METRIC_COLORS = {
        "accuracy":          "#18845E",
        "far":               "#C65345",
        "frr":               "#4059A7",
        "balanced_accuracy": "#7755A6",
    }
    METRIC_LABELS = {
        "accuracy": "Accuracy",
        "far": "FAR",
        "frr": "FRR",
        "balanced_accuracy": "BA",
    }
    # One dash style per threshold so curves of the same metric are visually grouped
    TH_DASH = {
        T: s
        for T, s in zip(
            thresholds, ["solid", "dash", "dot", "longdash"], strict=False
        )
    }
    # One model-width offset for multiple models
    MODEL_WIDTH = {m_idx: 2.0 + m_idx * 0.8 for m_idx in range(len(dfs))}

    fig = go_real.Figure()
    shown: set = set()

    for m_idx, (art, df) in enumerate(dfs):
        for T in thresholds:
            sub = df[df["age_threshold"] == T].sort_values("decision_Y")
            if sub.empty:
                continue
            dash  = TH_DASH[T]
            width = MODEL_WIDTH[m_idx]
            for metric in ["accuracy", "far", "frr", "balanced_accuracy"]:
                label = f"{METRIC_LABELS[metric]}"
                # Show one legend entry per metric (first threshold, first model only)
                sl = (T == thresholds[0]) and (m_idx == 0) and label not in shown
                if sl:
                    shown.add(label)
                suffix = f" ({art.model_name})" if len(dfs) > 1 else ""
                fig.add_trace(go_real.Scatter(
                    x=sub["decision_Y"],
                    y=sub[metric],
                    mode="lines",
                    name=label + suffix,
                    legendgroup=label,
                    showlegend=sl,
                    line=dict(color=METRIC_COLORS[metric], dash=dash, width=width),
                    hovertemplate=f"AGE≥{T} | Y=%{{x}}<br>{METRIC_LABELS[metric]}: %{{y:.1%}}<extra></extra>",
                ))

    # Vertical dotted lines at each natural operating point (Y = T)
    for T in thresholds:
        fig.add_vline(
            x=T, line_width=1.5, line_dash="dot", line_color="#475569",
            annotation_text=f"AGE ≥ {T}", annotation_position="bottom right",
            annotation_font_size=11, annotation_font_color="#475569",
        )

    # Horizontal FAR target lines
    for tgt in fpr_targets:
        fig.add_hline(
            y=tgt, line_width=1, line_dash="dot", line_color="#94a3b8",
            annotation_text=f"FAR {tgt:.0%}", annotation_position="right",
            annotation_font_size=9,
        )

    # Dash-style legend for thresholds
    th_legend_traces = [
        go_real.Scatter(
            x=[None], y=[None], mode="lines",
            name=f"AGE ≥ {T}",
            line=dict(color="#64748b", dash=TH_DASH[T], width=2),
            showlegend=True,
        )
        for T in thresholds
    ]
    for legend_trace in th_legend_traces:
        fig.add_trace(legend_trace)

    fig.update_layout(
        height=490, template="plotly_white",
        margin=dict(l=55, r=90, t=30, b=130),
        font=dict(color="#1f2937", size=12),
        legend=dict(
            orientation="h", x=0, y=-0.28, yanchor="top",
            bgcolor="rgba(255,255,255,.95)", bordercolor="#e5e7eb", borderwidth=1,
            tracegroupgap=4,
        ),
        xaxis=dict(
            title=tr("plot.age_decision_threshold"),
            gridcolor="#e5e7eb", automargin=True,
        ),
        yaxis=dict(
            title=tr("plot.metric_value"),
            tickformat=".0%", range=[-0.02, 1.05], gridcolor="#e5e7eb",
        ),
    )
    return fig.to_html(full_html=False, include_plotlyjs=False, config=PLOTLY_CONFIG)


# ---------------------------------------------------------------------------
# Static Plotly: error bins (5-year bands, per model, with value labels)
# ---------------------------------------------------------------------------
def _static_error_bins(artifacts: Sequence[AgeEstimationArtifacts]) -> str:
    dfs = [a.error_bins_true_df for a in artifacts if not a.error_bins_true_df.empty]
    if not dfs:
        return ""
    go, make_subplots = _import_plotly()
    import plotly.graph_objects as go_real

    fig = make_subplots(rows=1, cols=2,
                        subplot_titles=("MAE and RMSE by real-age range",
                                        "Bias by real-age range"),
                        horizontal_spacing=0.12)
    shown: set = set()
    for m_idx, (art, df) in enumerate(zip(artifacts, dfs, strict=True)):
        sl = art.model_name not in shown
        shown.add(art.model_name)
        x   = df["bin"].astype(str)
        mae = df["mae"].round(2)
        rmse = df["rmse"].round(2)
        bias = df["bias"].round(2)
        col = PALETTE[m_idx % len(PALETTE)]

        fig.add_trace(go_real.Bar(
            x=x, y=mae, name=art.model_name,
            marker_color=col, opacity=0.85,
            showlegend=sl, legendgroup=art.model_name,
            text=[f"{v:.2f}" for v in mae],
            textposition="outside",
            textangle=0,
            textfont=dict(size=11),
            cliponaxis=False,
            hovertemplate=f"{tr('plot.bin')}: %{{x}}<br>MAE: %{{y:.2f}}<extra></extra>",
        ), row=1, col=1)
        fig.add_trace(go_real.Bar(
            x=x, y=rmse, name=art.model_name + " RMSE",
            marker_color=col, opacity=0.50,
            showlegend=False, legendgroup=art.model_name,
            text=[f"{v:.2f}" for v in rmse],
            textposition="outside",
            textangle=0,
            textfont=dict(size=11),
            cliponaxis=False,
            hovertemplate=f"{tr('plot.bin')}: %{{x}}<br>RMSE: %{{y:.2f}}<extra></extra>",
        ), row=1, col=1)
        fig.add_trace(go_real.Scatter(
            x=x, y=bias, mode="lines+markers+text", name=art.model_name,
            line=dict(color=col, width=2), marker=dict(size=8),
            text=[f"{v:.2f}" for v in bias],
            textposition="top center", textfont=dict(size=11),
            showlegend=False, legendgroup=art.model_name,
            hovertemplate=f"{tr('plot.bin')}: %{{x}}<br>{tr('chart.stats.bias')}: %{{y:.2f}}<extra></extra>",
        ), row=1, col=2)

    fig.add_hline(y=0, line_width=1.5, line_dash="dash", line_color="#111827", row=1, col=2)
    fig.update_layout(
        height=430, template="plotly_white", barmode="group",
        margin=dict(l=55, r=24, t=70, b=100),
        font=dict(color="#1f2937", size=12),
        legend=dict(orientation="h", x=0, y=1.15, bgcolor="rgba(255,255,255,.9)"),
        uniformtext=dict(mode="hide", minsize=9),
    )
    fig.update_xaxes(tickangle=-40, automargin=True, gridcolor="#e5e7eb")
    fig.update_yaxes(title_text="Error (years)", row=1, col=1, gridcolor="#e5e7eb",
                     autorange=True)
    fig.update_yaxes(title_text="Bias (years)", row=1, col=2, gridcolor="#e5e7eb")
    fig.update_annotations(font=dict(size=13, color="#1e3a8a"))
    return fig.to_html(full_html=False, include_plotlyjs=False, config=PLOTLY_CONFIG)


# ---------------------------------------------------------------------------
# Static Plotly: image count by age  (spline line + fill, no bars)
# ---------------------------------------------------------------------------
def _hex_rgba(hex_col: str, alpha: float) -> str:
    h = hex_col.lstrip("#")
    return f"rgba({int(h[0:2],16)},{int(h[2:4],16)},{int(h[4:6],16)},{alpha})"


def _static_age_distribution(artifacts: Sequence[AgeEstimationArtifacts]) -> str:
    if not artifacts:
        return ""
    go, _ = _import_plotly()
    import plotly.graph_objects as go_real

    fig = go_real.Figure()
    for m_idx, art in enumerate(artifacts):
        ages_int = np.floor(art.y_true).astype(int)
        unique_ages, counts = np.unique(ages_int, return_counts=True)
        col = PALETTE[m_idx % len(PALETTE)]
        fig.add_trace(go_real.Scatter(
            x=unique_ages, y=counts,
            name=art.model_name,
            mode="lines+markers",
            line=dict(shape="spline", smoothing=0.8, width=2.5, color=col),
            marker=dict(size=6, color=col, opacity=0.85),
            fill="tozeroy",
            fillcolor=_hex_rgba(col, 0.10),
            hovertemplate=f"{tr('plot.age')}: %{{x}}<br>N: %{{y}}<extra></extra>",
        ))

    fig.update_layout(
        height=300, template="plotly_white",
        margin=dict(l=52, r=24, t=18, b=52),
        font=dict(color="#1f2937", size=12),
        legend=dict(orientation="h", x=0, y=1.16, bgcolor="rgba(255,255,255,.9)"),
        xaxis=dict(title=tr("plot.actual_age_years"), dtick=5, gridcolor="#e5e7eb", automargin=True),
        yaxis=dict(title=tr("plot.n_images"), gridcolor="#e5e7eb"),
    )
    return fig.to_html(full_html=False, include_plotlyjs=False, config=PLOTLY_CONFIG)


# ---------------------------------------------------------------------------
# HTML helpers
# ---------------------------------------------------------------------------
def _build_global_filter_panel(artifacts: Sequence[AgeEstimationArtifacts]) -> str:
    all_vars: List[str] = []
    var_values: dict = {}
    for art in artifacts:
        for v in _filter_vars(art):
            if v not in all_vars:
                all_vars.append(v)
            vals = art.predictions_df[v].astype(str).unique().tolist()
            var_values.setdefault(v, set()).update(vals)

    if not all_vars:
        return ""

    # Canonical dialect: .filter-selector chips + class-based global buttons,
    # wired by the shared GFP.wireGlobal engine.
    return build_filter_panel(
        all_vars,
        {v: sorted(var_values[v]) for v in all_vars},
    )


# ---------------------------------------------------------------------------
# Dashboard JSON (embedded data for JS)
# ---------------------------------------------------------------------------
def _build_dashboard_json(artifacts: Sequence[AgeEstimationArtifacts], config: EvaluationConfig) -> str:
    cfg = config.age_estimation
    models: dict = {}
    all_filter_vars: List[str] = []
    global_filter_values: dict = {}

    for idx, art in enumerate(artifacts):
        model_id = f"model-{idx}"
        fvars = _filter_vars(art)
        for v in fvars:
            if v not in all_filter_vars:
                all_filter_vars.append(v)
            vals = art.predictions_df[v].astype(str).unique().tolist()
            global_filter_values.setdefault(v, set()).update(vals)

        source = config.input_sources[idx] if idx < len(config.input_sources) else None
        base_col = None
        if source and source.variable_baseline_pred and source.variable_baseline_pred in art.predictions_df.columns:
            base_col = source.variable_baseline_pred

        ci_cfg = config.statistics.confidence_intervals
        ci_json = {
            k: [float(v[0]), float(v[1])]
            for k, v in (art.ci or {}).items()
            if all(np.isfinite(x) for x in v)
        } if (ci_cfg.enabled and ci_cfg.display == "secondary") else {}
        models[model_id] = {
            "name": art.model_name,
            "experimentId": source.resolved_experiment_id if source else model_id,
            "n_original": art.n_original,
            "n_ftp": art.n_ftp,
            "ci": ci_json,
            "ciLevel": ci_cfg.level,
            "filterVariables": fvars,
            "thresholds": list(sorted(cfg.thresholds)),
            "challengeThresholds": list(sorted(cfg.challenge_thresholds)),
            "challengeMinAge": cfg.challenge_min_age,
            "fprTargets": sorted(cfg.fpr_targets),
            "fprApplicationAges": list(cfg.fpr_application_ages),
            "fprApplicationThreshold": cfg.fpr_application_threshold,
            "balancedAccuracyFarTarget": cfg.balanced_accuracy_far_target,
            "accuracyWindows": list(cfg.accuracy_windows),
            "ageBands": [["< 18", 0, 17], ["18–30", 18, 30], ["31–50", 31, 50], ["51–80", 51, 80], ["> 80", 81, 999]],
            "rows": [
                {
                    "record_id": str(row.get("record_id", row.name)),
                    "gt_age": float(row["y_true"]),
                    "pred_age": float(row["y_pred"]),
                    "metadata": {v: str(row.get(v, "UNKNOWN")) for v in fvars},
                    **({"base_age": float(row[base_col])}
                       if base_col is not None and pd.notna(row[base_col]) else {}),
                }
                for _, row in art.predictions_df.iterrows()
            ],
        }

    payload = {
        "models": models,
        "modelIds": [f"model-{i}" for i in range(len(artifacts))],
        "globalFilterVars": all_filter_vars,
        "globalFilterValues": {k: sorted(v) for k, v in global_filter_values.items()},
    }
    return json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")


# ---------------------------------------------------------------------------
# Main save function
# ---------------------------------------------------------------------------
def save_age_estimation_dashboard(
    artifacts: Sequence[AgeEstimationArtifacts],
    html_dir: Path,
    config: EvaluationConfig,
) -> Path:
    cfg = config.age_estimation
    dashboard_json    = _build_dashboard_json(artifacts, config)
    global_filter_html = _build_global_filter_panel(artifacts)

    palette_js = json.dumps(PALETTE)

    _age_specific_css = """
.section-subtitle{font-size:13px;color:var(--muted);margin:-8px 0 12px;}
.color-by-sel{border:1px solid var(--line);border-radius:6px;padding:3px 6px;font-size:12px;background:var(--card);color:var(--ink);cursor:pointer;}
.fpr-tables-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;}
.fpr-table-wrap{width:100%;max-width:100%;overflow:visible;}
.fpr-table{border-collapse:collapse;table-layout:fixed;font-size:12px;white-space:normal;width:100%;}
.fpr-table th{background:var(--thead);padding:8px 10px;border-bottom:2px solid var(--line);text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:.04em;}
.fpr-table td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:center;font-weight:700;font-size:13px;}
.fpr-table td:first-child{text-align:left;font-weight:600;color:var(--subhead);}
.fpr-app-wrap{overflow:visible;margin-bottom:6px;width:100%;max-width:100%;}
.fpr-app-table{border-collapse:collapse;table-layout:fixed;font-size:12px;white-space:normal;width:100%;}
.fpr-app-table th{background:var(--thead);padding:7px 9px;border-bottom:2px solid var(--line);text-align:center;font-size:11px;letter-spacing:.04em;}
.fpr-app-table th:first-child{text-align:left;min-width:110px;}
.fpr-app-table td{padding:6px 9px;border-bottom:1px solid var(--line);text-align:center;font-weight:700;font-size:12px;}
.fpr-app-table td:first-child{text-align:left;font-weight:700;color:var(--heading);}
.fpr-group-header{background:rgba(37,99,235,.14)!important;color:var(--heading)!important;font-weight:800!important;border-left:2px solid #93c5fd;}
.ba-far-badge{display:inline-block;background:rgba(37,99,235,.14);color:var(--heading);border:1px solid #93c5fd;border-radius:999px;padding:3px 10px;font-size:11px;font-weight:800;letter-spacing:.04em;margin-left:8px;}
.chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:8px;}
.chip{background:var(--chip);border:1px solid var(--line);color:var(--muted);padding:5px 9px;border-radius:999px;font-size:11px;font-weight:700;}
.target-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;margin-bottom:8px;}
.legend-dot{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:4px;vertical-align:middle;}
.age-active-chart-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.age-active-chart-grid:has(> :only-child){grid-template-columns:1fr}
"""
    _age_css = CORE_CSS + _age_specific_css + STUDIO_CSS

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(config.titles.dashboard)}</title>
  {plotly_script(config.ui.plotly_delivery)}
  <style>
{_age_css}
  </style>
</head>
<body>
<main class="page">
  <header class="hero">
    <h1>{html.escape(config.titles.dashboard)}</h1>
    <p>{t_span('panel.age.hero')}</p>
  </header>

  {global_filter_html}

  <!-- ══ TABLES ══════════════════════════════════════════════════════ -->

  <section class="dash-section">
    <div class="section-title" data-nav-section>{t_span('panel.age.summary_title')}</div>
    <p class="section-desc">{t_span('panel.age.summary_desc')}</p>
    <div id="summary-table" class="summary-table-wrap"><!-- JS --></div>
  </section>

  <section class="dash-section">
    <div class="section-title" data-nav-section>{t_span('panel.age.compliance_title')}
      <span class="ba-far-badge">FAR ≤ {cfg.balanced_accuracy_far_target:.0%}</span>
    </div>
    <p class="section-desc">{t_span('panel.age.compliance_desc')}</p>
    <div id="compliance-table"><!-- JS --></div>
  </section>

  <div class="two-col-grid">
    <section class="dash-section">
      <div class="section-title" data-nav-section>{t_span('panel.age.challenge_title')}</div>
      <p class="section-desc">{t_span('panel.age.challenge_desc', min_age=cfg.challenge_min_age)}</p>
      <div id="challenge-table"><!-- JS --></div>
    </section>
    <section class="dash-section">
      <div class="section-title">{t_span('panel.age.band_title')}</div>
      <p class="section-desc">{t_span('panel.age.band_desc')}</p>
      <div class="age-band-wrap"><div id="age-band-table"><!-- JS --></div></div>
    </section>
  </div>

  <!-- CHARTS -->

  <section class="dash-section">
    <div class="section-title" data-nav-section>{t_span('panel.age.heatmap_title')}</div>
    <div id="fig-fpr-heatmaps" class="age-active-chart-grid"></div>
  </section>

  <section class="dash-section">
    <div class="section-title">{t_span('panel.age.dist_title')}</div>
    <p class="section-desc">{t_span('panel.age.dist_desc')}</p>
    <div id="fig-age-distribution" class="plot-target"></div>
  </section>

  <section class="dash-section">
    <div class="section-title" data-nav-section>{t_span('panel.age.sweep_title')}</div>
    <div id="fig-age-sweep" class="plot-target"></div>
  </section>

  <section class="dash-section">
    <div class="section-title" data-nav-section>{t_span('panel.age.visual_title')}</div>
    <p class="section-desc">{t_span('panel.age.visual_desc')}</p>
    <div class="figures-grid">
      <div class="chart-card">
        <div class="chart-head">
          <h3>{t_span('panel.age.scatter_title')}</h3>
          <p class="chart-explanation">{t_span('panel.age.scatter_desc')}</p>
        <p>{t_span('panel.age.color_by')} <select class="color-by-sel" id="scatter-color-by" data-i18n-attr="aria-label:panel.age.color_by" aria-label="{t_attr('panel.age.color_by')}"><option value="">— {t_span('common.model')} —</option>{_color_by_options(artifacts)}</select></p>
        </div>
        <div id="fig-scatter-stats" class="chart-stat-strip" aria-live="polite"></div>
        <div id="fig-scatter" class="plot-target"></div>
      </div>
      <div class="chart-card">
        <div class="chart-head">
          <h3>{t_span('panel.age.variation_title')}</h3>
          <p class="chart-explanation">{t_span('panel.age.variation_desc')}</p>
        </div>
        <div id="fig-variation-stats" class="chart-stat-strip" aria-live="polite"></div>
        <div id="fig-variation" class="plot-target"></div>
      </div>
    </div>
    <div class="chart-card-full"><div class="chart-head"><h3>{t_span('panel.age.pairwise_title')}</h3>
      <p class="chart-explanation">{t_span('panel.age.pairwise_desc')}</p></div>
      <div id="fig-age-pairwise" class="plot-target"></div>
    </div>
  </section>

  <section class="dash-section">
    <div class="section-title">{t_span('panel.age.range_title')}</div>
    <div id="fig-age-ranges" class="plot-target"></div>
  </section>

  {_worst_cases_section(artifacts)}

</main>
<div id="g-tooltip"></div>

        {runtime_blocks(config, "age_estimation", artifacts=artifacts)}
<script type="application/json" id="dd">{dashboard_json}</script>
""" + '<script>\n' + SHARED_JS + '\n</script>\n' + f"""<script>
(function(){{
  const DATA = JSON.parse(document.getElementById("dd").textContent);
  const ALL_MODEL_IDS = DATA.modelIds || Object.keys(DATA.models);
  let MODEL_IDS = ALL_MODEL_IDS.slice();
  const PALETTE = {palette_js};
  const MODEL_COLORS = {{}};
  ALL_MODEL_IDS.forEach((id,i) => MODEL_COLORS[id] = PALETTE[i % PALETTE.length]);
  function activeModelIds(experimentIds) {{
    const mapped=(experimentIds||[]).map(experimentId=>
      ALL_MODEL_IDS.find(id=>DATA.models[id]?.experimentId===experimentId)
    ).filter(Boolean);
    return mapped.length?mapped:ALL_MODEL_IDS.slice();
  }}
  const tchart = (key,args) => window.DM_I18N ? DM_I18N.t(key,args) : key;
  function percentile(values, p) {{
    if (!values.length) return NaN;
    const sorted = [...values].sort((a,b)=>a-b), index = (sorted.length - 1) * p;
    const lo = Math.floor(index), hi = Math.ceil(index);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
  }}
  function kde(values, pointCount=180, lowerBound=null) {{
    const samples=values.map(Number).filter(Number.isFinite);
    if(!samples.length)return {{x:[],y:[],bandwidth:NaN,n:0}};
    const lo=Math.min(...samples),hi=Math.max(...samples),span=Math.max(hi-lo,.5);
    const avg=mean(samples),variance=mean(samples.map(value=>(value-avg)**2));
    const sd=Math.sqrt(Math.max(0,variance));
    const iqr=percentile(samples,.75)-percentile(samples,.25);
    const scale=Math.min(sd||Infinity,(iqr/1.34)||Infinity);
    const fallback=Math.max(span/18,.35);
    const bandwidth=Math.max(.18,Number.isFinite(scale)?0.9*scale*Math.pow(samples.length,-.2):fallback);
    const bounded=Number.isFinite(lowerBound);
    const start=bounded?lowerBound:lo-3*bandwidth,end=hi+3*bandwidth;
    const step=(end-start)/(pointCount-1||1);
    const x=Array.from({{length:pointCount}},(_value,index)=>start+index*step);
    const normalizer=samples.length*bandwidth*Math.sqrt(2*Math.PI);
    const y=x.map(position=>samples.reduce((sum,value)=>{{
      const z=(position-value)/bandwidth;
      const reflected=bounded?(position-(2*lowerBound-value))/bandwidth:null;
      return sum+Math.exp(-.5*z*z)+(bounded?Math.exp(-.5*reflected*reflected):0);
    }},0)/normalizer);
    return {{x,y,bandwidth,n:samples.length}};
  }}
  function alphaColor(hex,alpha) {{
    const value=String(hex||"").replace("#","");
    if(!/^[0-9a-f]{{6}}$/i.test(value))return `rgba(15,118,110,${{alpha}})`;
    const numeric=parseInt(value,16);
    return `rgba(${{numeric>>16}},${{(numeric>>8)&255}},${{numeric&255}},${{alpha}})`;
  }}
  function linearFit(xs, ys) {{
    const mx=mean(xs), my=mean(ys); let cov=0, variance=0;
    for(let i=0;i<xs.length;i++){{cov+=(xs[i]-mx)*(ys[i]-my);variance+=(xs[i]-mx)**2;}}
    const slope=variance?cov/variance:NaN; return {{slope,intercept:my-slope*mx}};
  }}
  function setChartStats(id, items) {{
    const target=document.getElementById(id+"-stats"); if(!target)return;
    target.innerHTML=items.map(item=>'<article class="chart-stat"'+
      (Number.isInteger(item.modelIndex)?' data-model-index="'+item.modelIndex+'"':'')+
      '><span>'+item.label+'</span><strong>'+item.value+'</strong><small>'+(item.note||'')+'</small></article>').join('');
  }}

  // ---- Global filter selection (recomputed from the DOM by the shared engine) ----
  function currentSelection() {{
    return GFP.selectedSetsGlobal(DATA.globalFilterVars || []);
  }}

  function getRows(modelId) {{
    const m = DATA.models[modelId]; if (!m) return [];
    const sel = currentSelection();
    return m.rows.filter(row => {{
      for (const v of (m.filterVariables||[])) {{
        const s = sel[v];
        if (!s || !s.size) return true;
        if (!s.has((row.metadata||{{}})[v]||"UNKNOWN")) return false;
      }}
      return true;
    }});
  }}

  // ---- Metrics from filtered rows ----
  function metrics(rows) {{
    const n = rows.length;
    if (!n) return {{n,mae:NaN,mdae:NaN,sd:NaN,acc1:NaN,acc3:NaN,acc5:NaN,bias:NaN}};
    const ae = rows.map(r=>Math.abs(r.pred_age-r.gt_age));
    const res = rows.map(r=>r.pred_age-r.gt_age);
    const windows = DATA.models[MODEL_IDS[0]]?.accuracyWindows||[1,3,5];
    const accAt = {{}};
    for (const w of windows) {{
      const k = Number.isInteger(w) ? "acc_at_"+Math.round(w) : "acc_at_"+w;
      accAt[k] = ae.filter(e=>e<=w).length/n;
    }}
    return {{n, mae:mean(ae), mdae:median(ae), sd:stdev(res), bias:mean(res), ...accAt}};
  }}

  // ---- Summary table (MAE, Acc@N, SD — no MDAE, no Bias) ----
  function renderSummaryTable() {{
    const windows = DATA.models[MODEL_IDS[0]]?.accuracyWindows||[1,3,5];
    const accCols = windows.map(w => Number.isInteger(w) ? 'acc_at_'+Math.round(w) : 'acc_at_'+w);
    const labels = ['N'+ii('age_valid_predictions'),'MAE'+ii('age_mae'),
      ...windows.map(w=>'Acc@'+w+'y'+ii('age_accuracy_window')),'SD'+ii('age_error_std')];
    const matrixRows=labels.map(label=>'<tr><th scope="row">'+label+'</th>');
    const modelHeads=ALL_MODEL_IDS.map((id,index)=>'<th scope="col" data-model-index="'+index+'">'+DATA.models[id].name+'</th>').join('');
    const ttx = (k,a) => window.DM_I18N ? DM_I18N.t(k,a) : k;
    for (const id of ALL_MODEL_IDS) {{
      const modelIndex=ALL_MODEL_IDS.indexOf(id);
      const m = DATA.models[id];
      const rowsSel = getRows(id);
      const mtr = metrics(rowsSel);
      let maeCell = '<span data-raw="'+mtr.mae+'" data-fmt="num">'+num(mtr.mae)+'</span>';
      // Baseline experiment delta (spec 3.6) over the filtered rows.
      const withBase = rowsSel.filter(r => Number.isFinite(r.base_age));
      if (withBase.length > 1) {{
        const baseMae = mean(withBase.map(r => Math.abs(r.base_age - r.gt_age)));
        if (Number.isFinite(baseMae) && baseMae !== 0) {{
          const dd = (mtr.mae - baseMae) / Math.abs(baseMae);
          const cls = dd < 0 ? "good" : "bad";
          maeCell += '<div class="kpi-detail '+cls+'">'+(dd < 0 ? "▼ " : "▲ ")+pct(Math.abs(dd),1)+' '+ttx("common.vs_baseline")+'</div>';
        }}
      }}
      if (m.ci && m.ci.mae) {{
        const lvl = Math.round((m.ciLevel||0.95)*100);
        maeCell += '<div class="kpi-ci" data-ci-metric="mae" data-ci-model="'+id+'">' +
                   '<span class="kpi-ci-label">'+ttx('ci.label',{{pct:lvl}})+': </span>' +
                   '<span class="kpi-ci-range" data-ci-lo="'+m.ci.mae[0]+'" data-ci-hi="'+m.ci.mae[1]+'" data-fmt="num">' +
                   num(m.ci.mae[0])+'–'+num(m.ci.mae[1])+'</span></div>';
      }}
      const values = [
        '<span>'+mtr.n+' / '+m.n_original+'</span>',
        '<div data-compare-metric="mae" data-model-index="'+modelIndex+'" data-compare-raw="'+mtr.mae+'" data-better="lower">'+maeCell+'</div>',
        ...accCols.map(k=>'<span data-compare-raw="'+mtr[k]+'" data-better="higher" data-raw="'+mtr[k]+'" data-fmt="pct">'+pct(mtr[k])+'</span>'),
        '<span data-compare-raw="'+mtr.sd+'" data-better="lower" data-raw="'+mtr.sd+'" data-fmt="num">'+num(mtr.sd)+'</span>'
      ];
      values.forEach((value,index)=>matrixRows[index]+='<td data-model-index="'+modelIndex+'">'+value+'</td>');
    }}
    document.getElementById('summary-table').innerHTML =
      '<table class="model-metrics-table"><thead><tr><th scope="col">'+tchart('common.metric')+'</th>'+modelHeads+'</tr></thead><tbody>'+
      matrixRows.map(row=>row+'</tr>').join('')+'</tbody></table>';
    if(window.DM_V2_MODELS){{
      DM_COMPARISON.tableSlots(document.querySelector('#summary-table table'),ALL_MODEL_IDS.map(id=>({{id:DATA.models[id].experimentId}})),DM_V2_MODELS.getSlots());
      document.dispatchEvent(new CustomEvent('dm:taskmetricschange'));
    }}

  }}

  // ---- Compliance Operating Points table ----
  function renderComplianceTable() {{
    const m0 = DATA.models[MODEL_IDS[0]];
    const thresholds  = (m0.thresholds||[18,21,25]).slice().sort((a,b)=>a-b);
    const fprTargets  = (m0.fprTargets||[0.10,0.05,0.01]).slice().sort((a,b)=>b-a);
    const rowsMap = {{}};
    for (const id of MODEL_IDS) rowsMap[id] = getRows(id);
    const mHdrs = MODEL_IDS.map(id =>
      '<th colspan="5" data-model-index="'+ALL_MODEL_IDS.indexOf(id)+'" style="border-left:2px solid #cbd5e1">'+DATA.models[id].name+'</th>'
    ).join('');
    const sHdrs = MODEL_IDS.map(id => {{
      const index=ALL_MODEL_IDS.indexOf(id);
      return '<th data-model-index="'+index+'">Y*'+ii('age_decision_threshold_y')+'</th>' +
      '<th data-model-index="'+index+'">FAR'+ii('age_far_at_y')+'</th>' +
      '<th data-model-index="'+index+'">FRR'+ii('age_frr_at_y')+'</th>' +
           '<th data-model-index="'+index+'">'+tchart('common.accuracy')+ii('age_accuracy_at_y')+'</th>' +
      '<th data-model-index="'+index+'">B-ACC'+ii('age_balanced_accuracy_at_y')+'</th>';
    }}
    ).join('');
    let rows = '';
    for (const T of thresholds) {{
      let isFirst = true;
      for (const target of fprTargets) {{
        const groupBorder = isFirst ? 'border-top:2px solid #cbd5e1' : '';
        let row = '<td style="font-weight:800;color:var(--heading);'+groupBorder+'">'+(isFirst ? '≥ '+T : '')+'</td>';
        row += '<td style="color:var(--muted);font-size:11px;font-weight:700;white-space:nowrap;'+groupBorder+'">FAR ≤ '+(target*100).toFixed(0)+'%</td>';
        for (const id of MODEL_IDS) {{
          const modelIndex=ALL_MODEL_IDS.indexOf(id);
          const {{ba, far, frr, Y, acc}} = computeBalancedAccuracy(rowsMap[id], T, target);
          const yTxt = (Y===null||Y===undefined) ? '—' : Y;
          row += '<td data-model-index="'+modelIndex+'" style="border-left:2px solid #e5eaf1;font-weight:800;'+groupBorder+'">'+yTxt+'</td>' +
                 '<td data-model-index="'+modelIndex+'" style="'+groupBorder+'">'+pct(far)+'</td>' +
                 '<td data-model-index="'+modelIndex+'" style="'+groupBorder+'">'+pct(frr)+'</td>' +
                 '<td data-model-index="'+modelIndex+'" style="'+groupBorder+'">'+pct(acc)+'</td>' +
                 '<td data-model-index="'+modelIndex+'" style="'+groupBorder+'">'+pct(ba)+'</td>';
        }}
        rows += '<tr>'+row+'</tr>';
        isFirst = false;
      }}
    }}
    document.getElementById('compliance-table').innerHTML =
      '<div class="challenge-table-wrap"><table class="challenge-table"><thead>' +
      '<tr><th rowspan="2">AGE_TH</th><th rowspan="2">'+tchart('col.target')+'</th>'+mHdrs+'</tr>' +
      '<tr>'+sHdrs+'</tr>' +
      '</thead><tbody>'+rows+'</tbody></table></div>';
  }}

  // ---- ② Figures ----
  function renderScatter() {{
    if (typeof Plotly==="undefined") return;
    const colorBy = document.getElementById("scatter-color-by")?.value||"";
    const traces = [];
    for (const id of MODEL_IDS) {{
      const rows = getRows(id);
      const m = DATA.models[id];
      if (colorBy && m.filterVariables.includes(colorBy)) {{
        const groups = {{}};
        for (const r of rows) {{
          const cat = (r.metadata||{{}})[colorBy]||"UNKNOWN";
          if (!groups[cat]) groups[cat]={{x:[],y:[]}};
          groups[cat].x.push(r.gt_age); groups[cat].y.push(r.pred_age);
        }}
        Object.entries(groups).forEach(([cat,g],ci) => traces.push({{
          type:"scattergl", mode:"markers", name:`${{m.name}} / ${{cat}}`,
          meta:{{experiment_id:m.experimentId}},
          x:g.x, y:g.y, legendgroup: m.name+"_"+cat,
          marker:{{size:rows.length>3000?3:5, color:PALETTE[ci%PALETTE.length], opacity:0.60}}
        }}));
      }} else {{
        const idx = ALL_MODEL_IDS.indexOf(id);
        traces.push({{
          type:"scattergl", mode:"markers", name:m.name,
          meta:{{experiment_id:m.experimentId}},
          x:rows.map(r=>r.gt_age), y:rows.map(r=>r.pred_age),
          marker:{{size:rows.length>3000?3:5, color:MODEL_COLORS[id], opacity:0.55}}
        }});
      }}
      if (rows.length > 1) {{
        const xs=rows.map(r=>r.gt_age), ys=rows.map(r=>r.pred_age), fit=linearFit(xs,ys);
        const lo=Math.min(...xs), hi=Math.max(...xs);
        traces.push({{type:"scatter",mode:"lines",name:tchart("panel.age.trend",{{model:m.name}}),legendgroup:m.name,
          meta:{{experiment_id:m.experimentId}},
          x:[lo,hi],y:[fit.intercept+fit.slope*lo,fit.intercept+fit.slope*hi],
          line:{{color:MODEL_COLORS[id],width:2,dash:"dot"}},hoverinfo:"skip"}});
      }}
    }}
    setChartStats("fig-scatter", MODEL_IDS.map(id=>{{
      const m=DATA.models[id], mt=metrics(getRows(id));
      return {{label:m.name,value:"MAE "+num(mt.mae),note:mt.n+" "+tchart("common.samples")+" | "+tchart("chart.stats.bias")+" "+num(mt.bias),modelIndex:ALL_MODEL_IDS.indexOf(id)}};
    }}));
    const allGt = MODEL_IDS.flatMap(id=>getRows(id).map(r=>r.gt_age));
    const allPr = MODEL_IDS.flatMap(id=>getRows(id).map(r=>r.pred_age));
    const minV = Math.min(...allGt,...allPr)-1, maxV = Math.max(...allGt,...allPr)+1;
    traces.push({{type:"scatter",mode:"lines",name:tchart("plot.ideal_y"),x:[minV,maxV],y:[minV,maxV],
      line:{{color:"#111827",width:2,dash:"dash"}},showlegend:true}});
    Plotly.react("fig-scatter", traces, {{
      height:360, template:"plotly_white",
      margin:{{l:52,r:16,t:18,b:46}},
      xaxis:{{title:(window.DM_I18N?DM_I18N.t("panel.age.axis.actual_age"):"Actual age (GT)"),gridcolor:"#e5e7eb",automargin:true}},
      yaxis:{{title:(window.DM_I18N?DM_I18N.t("panel.age.axis.predicted_age"):"Predicted age"),gridcolor:"#e5e7eb",automargin:true}},
      legend:{{orientation:"h",x:0,y:1.18,bgcolor:"rgba(255,255,255,.9)"}},
    }}, {{responsive:true}});
  }}

  function renderVariation() {{
    if (typeof Plotly==="undefined") return;
    const traces = [];
    for (const id of MODEL_IDS) {{
      const rows = getRows(id);
      const m = DATA.models[id];
      traces.push({{
        type:"scattergl", mode:"markers", name:m.name,
        meta:{{experiment_id:m.experimentId}},
        x:rows.map(r=>r.gt_age), y:rows.map(r=>r.pred_age-r.gt_age),
        marker:{{size:rows.length>3000?3:5, color:MODEL_COLORS[id], opacity:0.50}},
      }});
    }}
    setChartStats("fig-variation", MODEL_IDS.map(id=>{{
      const rows=getRows(id), residuals=rows.map(r=>r.pred_age-r.gt_age), absolute=residuals.map(Math.abs);
      return {{label:DATA.models[id].name,value:tchart("chart.stats.bias")+" "+num(mean(residuals)),note:tchart("chart.stats.p95_abs_error")+" "+num(percentile(absolute,.95)),modelIndex:ALL_MODEL_IDS.indexOf(id)}};
    }}));
    const allGt = MODEL_IDS.flatMap(id=>getRows(id).map(r=>r.gt_age));
    const minV = Math.min(...allGt)-1, maxV = Math.max(...allGt)+1;
    traces.push({{type:"scatter",mode:"lines",name:tchart("plot.zero_error"),x:[minV,maxV],y:[0,0],
      line:{{color:"#111827",width:1.5,dash:"dash"}},showlegend:true}});
    Plotly.react("fig-variation", traces, {{
      height:360, template:"plotly_white",
      margin:{{l:52,r:16,t:18,b:46}},
      xaxis:{{title:(window.DM_I18N?DM_I18N.t("panel.age.axis.actual_age"):"Actual age (GT)"),gridcolor:"#e5e7eb",automargin:true}},
      yaxis:{{title:(window.DM_I18N?DM_I18N.t("panel.age.axis.residual_years"):"Residual (pred − GT) years"),zeroline:false,gridcolor:"#e5e7eb",automargin:true}},
      legend:{{orientation:"h",x:0,y:1.18,bgcolor:"rgba(255,255,255,.9)"}},
    }}, {{responsive:true}});
  }}

  function commonLayout(extra) {{
    return Object.assign({{
      height:340,template:"plotly_white",margin:{{l:55,r:20,t:24,b:52}},
      font:{{size:11}},legend:{{orientation:"h",x:0,y:1.16}},
    }},extra||{{}});
  }}

  function renderFprHeatmaps() {{
    const host=document.getElementById("fig-fpr-heatmaps");
    if(!host||typeof Plotly==="undefined")return;
    host.dataset.comparison="per_model";
    host.replaceChildren();
    const targets=MODEL_IDS.map((id,position)=>{{
      const model=DATA.models[id],rows=getRows(id);
      const card=document.createElement("article");card.className="chart-card";
      card.dataset.experimentId=model.experimentId;
      const title=document.createElement("h3");title.className="chart-model-title";title.textContent=model.name;
      const plot=document.createElement("div");plot.id="fig-fpr-heatmap-"+position;plot.className="plot-target";
      card.append(title,plot);host.appendChild(card);
      return {{model,rows,plot}};
    }});
    // Plot only after every card participates in the grid. Rendering the first
    // matrix while it was still the sole child captured the full-row width and
    // left its Plotly canvas stale once the comparison card was appended.
    targets.forEach(({{model,rows,plot}})=>{{
      const challenges=(model.challengeThresholds||[]).slice().sort((a,b)=>a-b);
      const minAge=model.challengeMinAge||14,maxAge=Math.max(...challenges)-1;
      const ages=Array.from({{length:Math.max(0,maxAge-minAge+1)}},(_value,index)=>minAge+index);
      const z=ages.map(age=>challenges.map(threshold=>{{
        if(age>=threshold)return null;
        const cohort=rows.filter(row=>Math.round(row.gt_age)===age);
        return cohort.length?100*cohort.filter(row=>row.pred_age>=threshold).length/cohort.length:null;
      }}));
      Plotly.react(plot,[{{
        type:"heatmap",z,x:challenges.map(value=>tchart("panel.age.challenge_prefix")+"-"+value),y:ages.map(String),
        text:z.map(row=>row.map(value=>Number.isFinite(value)?num(value,1)+"%":"")),
        texttemplate:"%{{text}}",meta:{{experiment_id:model.experimentId}},
        colorscale:[[0,"#e8f5e9"],[.4,"#fffde7"],[.7,"#ffccbc"],[1,"#ef9a9a"]],
        zmin:0,zmax:100,hovertemplate:"%{{y}} · %{{x}}<br>FPR %{{z:.1f}}%<extra></extra>",
      }}],commonLayout({{
        height:Math.max(320,ages.length*24),margin:{{l:48,r:20,t:18,b:68}},
        xaxis:{{tickangle:-25}},yaxis:{{title:tchart("col.actual_age")}},
      }}),{{responsive:true}});
    }});
  }}

  function renderAgeDistribution() {{
    if(typeof Plotly==="undefined")return;
    const traces=[];
    const reference=getRows(MODEL_IDS[0]);
    const densityTrace=(name,values,color,meta={{}})=>{{
      const density=kde(values,180,0);
      return {{
        type:"scatter",mode:"lines",name,x:density.x,y:density.y,meta,
        line:{{color,width:2.5,shape:"spline",smoothing:.65}},
        fill:"tozeroy",fillcolor:alphaColor(color,.18),
        customdata:density.x.map(()=>[density.n,density.bandwidth]),
        hovertemplate:"<b>"+name+"</b><br>"+tchart("plot.age_years")+
          ": %{{x:.2f}}<br>"+tchart("plot.density")+": %{{y:.4f}}<br>"+
          tchart("common.samples")+": %{{customdata[0]}}<br>"+
          tchart("plot.bandwidth")+": %{{customdata[1]:.3f}}<extra></extra>",
      }};
    }};
    traces.push(densityTrace(tchart("plot.ground_truth"),reference.map(row=>row.gt_age),"#64748B"));
    MODEL_IDS.forEach(id=>{{
      const model=DATA.models[id],rows=getRows(id);
      traces.push(densityTrace(model.name,rows.map(row=>row.pred_age),MODEL_COLORS[id],{{experiment_id:model.experimentId}}));
    }});
    Plotly.react("fig-age-distribution",traces,commonLayout({{
      hovermode:"x unified",xaxis:{{title:tchart("plot.age_years")}},
      yaxis:{{title:tchart("plot.density"),rangemode:"tozero"}},
    }}),{{responsive:true}});
  }}

  function renderAgeSweep() {{
    if(typeof Plotly==="undefined")return;
    const traces=[];
    MODEL_IDS.forEach(id=>{{
      const model=DATA.models[id],rows=getRows(id);
      const ageThreshold=(model.thresholds||[18])[0]||18;
      const decisions=Array.from({{length:61}},(_value,index)=>index*2);
      const far=[],frr=[];
      decisions.forEach(decision=>{{
        const result=computeBinaryMetrics(rows,ageThreshold,decision);
        far.push(result.far);frr.push(result.frr);
      }});
      traces.push(
        {{type:"scatter",mode:"lines",name:model.name+" · FAR",x:decisions,y:far,
          line:{{color:MODEL_COLORS[id],width:2}},meta:{{experiment_id:model.experimentId}}}},
        {{type:"scatter",mode:"lines",name:model.name+" · FRR",x:decisions,y:frr,
          line:{{color:MODEL_COLORS[id],width:2,dash:"dot"}},meta:{{experiment_id:model.experimentId}}}},
      );
    }});
    Plotly.react("fig-age-sweep",traces,commonLayout({{
      xaxis:{{title:"Decision age Y"}},yaxis:{{title:"Rate",tickformat:".0%",range:[0,1.02]}},
    }}),{{responsive:true}});
  }}

  function renderPairwise() {{
    if(typeof Plotly==="undefined")return;
    const target="fig-age-pairwise";
    if(MODEL_IDS.length<2){{
      Plotly.react(target,[],commonLayout({{
        annotations:[{{text:tchart("common.select_two_models"),xref:"paper",yref:"paper",x:.5,y:.5,showarrow:false}}],
      }}),{{responsive:true}});return;
    }}
    const referenceId=window.DM_V2_MODELS?.getReferenceId();
    const leftId=MODEL_IDS.find(id=>DATA.models[id].experimentId===referenceId)||MODEL_IDS[0],left=DATA.models[leftId];
    const traces=[];
    MODEL_IDS.filter(id=>id!==leftId).forEach(rightId=>{{
      const right=DATA.models[rightId];
      const rightRows=new Map(getRows(rightId).map(row=>[String(row.record_id),row]));
      const differences=[];
      getRows(leftId).forEach(row=>{{
        const peer=rightRows.get(String(row.record_id));if(!peer)return;
        differences.push(Math.abs(Math.abs(row.pred_age-row.gt_age)-Math.abs(peer.pred_age-peer.gt_age)));
      }});
      if(!differences.length)return;
      const density=kde(differences,180,0),name=left.name+" ↔ "+right.name,color=MODEL_COLORS[rightId];
      traces.push({{
        type:"scatter",mode:"lines",x:density.x,y:density.y,name,
        line:{{color,width:2.75,shape:"spline",smoothing:.65}},
        fill:"tozeroy",fillcolor:alphaColor(color,.2),
        meta:{{experiment_ids:[left.experimentId,right.experimentId]}},
        customdata:density.x.map(()=>[density.n,density.bandwidth]),
        hovertemplate:"<b>"+name+"</b><br>"+tchart("plot.absolute_error_difference_years")+
          ": %{{x:.2f}}<br>"+tchart("plot.density")+": %{{y:.4f}}<br>"+
          tchart("common.paired_samples")+": %{{customdata[0]}}<br>"+
          tchart("plot.bandwidth")+": %{{customdata[1]:.3f}}<extra></extra>",
      }});
    }});
    if(!traces.length){{
      Plotly.react(target,[],commonLayout({{
        annotations:[{{text:tchart("common.no_common_record_ids"),xref:"paper",yref:"paper",x:.5,y:.5,showarrow:false}}],
      }}),{{responsive:true}});return;
    }}
    Plotly.react(target,traces,commonLayout({{hovermode:"x unified",xaxis:{{title:tchart("plot.absolute_error_difference_years")}},
      yaxis:{{title:tchart("plot.density"),rangemode:"tozero"}}}}),{{responsive:true}});
  }}

  function renderAgeRanges() {{
    if(typeof Plotly==="undefined")return;
    const traces=[];
    MODEL_IDS.forEach(id=>{{
      const model=DATA.models[id],rows=getRows(id),labels=[],values=[];
      (model.ageBands||[]).forEach(([label,lower,upper])=>{{
        const cohort=rows.filter(row=>row.gt_age>=lower&&row.gt_age<=upper);
        labels.push(label);values.push(cohort.length?mean(cohort.map(row=>Math.abs(row.pred_age-row.gt_age))):null);
      }});
      traces.push({{
        type:"bar",name:model.name,x:labels,y:values,marker:{{color:MODEL_COLORS[id]}},
        text:values.map(value=>Number.isFinite(value)?num(value):""),textposition:"outside",
        meta:{{experiment_id:model.experimentId}},
      }});
    }});
    Plotly.react("fig-age-ranges",traces,commonLayout({{
      barmode:"group",xaxis:{{title:"Actual-age band"}},yaxis:{{title:"MAE (years)"}},
    }}),{{responsive:true}});
  }}

  // ---- Binary classification metrics at a given decision Y ----
  function computeBinaryMetrics(rows, ageTh, decisionY) {{
    const adults = rows.filter(r => r.gt_age >= ageTh);
    const minors = rows.filter(r => r.gt_age  < ageTh);
    const nAdults = adults.length, nMinors = minors.length, n = rows.length;
    const tp = adults.filter(r => r.pred_age >= decisionY).length;
    const fn = nAdults - tp;
    const fp = minors.filter(r => r.pred_age >= decisionY).length;
    const tn = nMinors - fp;
    const acc = n > 0 ? (tp + tn) / n : NaN;
    const far = nMinors > 0 ? fp / nMinors : NaN;
    const frr = nAdults > 0 ? fn / nAdults : NaN;
    const ba  = Number.isFinite(far) && Number.isFinite(frr) ? 1 - (far + frr) / 2 : NaN;
    return {{tp, tn, fp, fn, acc, far, frr, ba, nAdults, nMinors}};
  }}

  // ---- Compute BA @ fixed FAR (also returns Accuracy at Y*) ----
  function computeBalancedAccuracy(rows, thresholdAge, farTarget) {{
    const adults = rows.filter(r => r.gt_age >= thresholdAge);
    const minors = rows.filter(r => r.gt_age  < thresholdAge);
    if (!adults.length || !minors.length) return {{ba:NaN, far:NaN, frr:NaN, Y:null, acc:NaN}};
    const adultPreds = adults.map(r => r.pred_age);
    const minorPreds = minors.map(r => r.pred_age);
    for (let Y = 1; Y <= 120; Y++) {{
      const far = minorPreds.filter(p => p >= Y).length / minorPreds.length;
      if (far <= farTarget) {{
        const frr = adultPreds.filter(p => p < Y).length / adultPreds.length;
        const m   = computeBinaryMetrics(rows, thresholdAge, Y);
        return {{ba: 1 - (far + frr) / 2, far, frr, Y, acc: m.acc}};
      }}
    }}
    return {{ba:NaN, far:NaN, frr:NaN, Y:">120", acc:NaN}};
  }}

  // ---- Challenge-Zone Accuracy (MAE, N) ----
  function renderChallengeTable() {{
    const rowsMap = {{}};
    for (const id of MODEL_IDS) rowsMap[id] = getRows(id);
    const m0 = DATA.models[MODEL_IDS[0]];
    const challenges = (m0.challengeThresholds||[]).slice().sort((a,b) => a-b);
    const minAge = m0.challengeMinAge || 14;
    const mHdrs = MODEL_IDS.map(id =>
      '<th colspan="2" data-model-index="'+ALL_MODEL_IDS.indexOf(id)+'" style="border-left:2px solid #cbd5e1">'+DATA.models[id].name+'</th>'
    ).join('');
    const sHdrs = MODEL_IDS.map(id => {{
      const index=ALL_MODEL_IDS.indexOf(id);
      return '<th data-model-index="'+index+'">MAE'+ii('age_subgroup_mae')+'</th>' +
      '<th data-model-index="'+index+'">N'+ii('age_subgroup_n')+'</th>';
    }}
    ).join('');
    let rows = '';
    for (const T of challenges) {{
      let row = '<td>'+tchart('panel.age.challenge_prefix')+'-'+T+'</td>';
      for (const id of MODEL_IDS) {{
        const modelIndex=ALL_MODEL_IDS.indexOf(id);
        const sub = rowsMap[id].filter(r => r.gt_age >= minAge && r.gt_age < T);
        const n = sub.length;
        if (!n) {{ row += '<td data-model-index="'+modelIndex+'">—</td><td data-model-index="'+modelIndex+'">0</td>'; continue; }}
        const ae = sub.map(r => Math.abs(r.pred_age - r.gt_age));
        row += '<td data-model-index="'+modelIndex+'">'+num(mean(ae))+'</td><td data-model-index="'+modelIndex+'">'+n+'</td>';
      }}
      rows += '<tr>'+row+'</tr>';
    }}
    document.getElementById('challenge-table').innerHTML =
      '<div class="challenge-table-wrap"><table class="challenge-table"><thead>' +
      '<tr><th rowspan="2">'+tchart('panel.age.challenge_prefix')+'</th>'+mHdrs+'</tr>' +
      '<tr>'+sHdrs+'</tr>' +
      '</thead><tbody>'+rows+'</tbody></table></div>';
  }}

  // ---- Error by Age Band (MAE, N) ----
  function renderAgeBandTable() {{
    const rowsMap = {{}};
    for (const id of MODEL_IDS) rowsMap[id] = getRows(id);
    const ageBands = [['< 18',0,17],['18–30',18,30],['31–50',31,50],['51–80',51,80],['> 80',81,999]];
    const mHdrs = MODEL_IDS.map(id =>
      '<th colspan="2" data-model-index="'+ALL_MODEL_IDS.indexOf(id)+'" style="border-left:2px solid #cbd5e1">'+DATA.models[id].name+'</th>'
    ).join('');
    const sHdrs = MODEL_IDS.map(id => {{
      const index=ALL_MODEL_IDS.indexOf(id);
      return '<th data-model-index="'+index+'">MAE'+ii('age_band_mae')+'</th>' +
      '<th data-model-index="'+index+'">N'+ii('age_band_n')+'</th>';
    }}
    ).join('');
    let rows = '';
    for (const [bandName, bandMin, bandMax] of ageBands) {{
      let row = '<td>'+bandName+'</td>';
      for (const id of MODEL_IDS) {{
        const modelIndex=ALL_MODEL_IDS.indexOf(id);
        const f = rowsMap[id].filter(r => r.gt_age >= bandMin && r.gt_age <= bandMax);
        if (!f.length) {{ row += '<td data-model-index="'+modelIndex+'">—</td><td data-model-index="'+modelIndex+'">0</td>'; continue; }}
        const ae = f.map(r => Math.abs(r.pred_age - r.gt_age));
        row += '<td data-model-index="'+modelIndex+'">'+num(mean(ae))+'</td><td data-model-index="'+modelIndex+'">'+f.length+'</td>';
      }}
      rows += '<tr>'+row+'</tr>';
    }}
    document.getElementById('age-band-table').innerHTML =
      '<table class="age-band-table"><thead>' +
      '<tr><th rowspan="2">'+tchart('panel.age.age_band')+'</th>'+mHdrs+'</tr>' +
      '<tr>'+sHdrs+'</tr></thead><tbody>'+rows+'</tbody></table>';
  }}

  // ---- Client-side CI recompute for the summary MAE (spec 3.4) ----
  let _ciBooted = false;
  function scheduleCIs() {{
    if (!window.DMStats) return;
    if (!_ciBooted) {{ _ciBooted = true; return; }}
    for (const id of MODEL_IDS) {{
      const el = document.querySelector(`[data-ci-metric="mae"][data-ci-model="${{id}}"]`);
      if (!el) continue;
      const rows = getRows(id);
      const ae = rows.map(r => Math.abs(r.pred_age - r.gt_age));
      const statFn = idx => {{ let s = 0; for (const i of idx) s += ae[i]; return s / idx.length; }};
      DMStats.schedule(el, {{ n: rows.length, statFn, signature: id + "|" + DMStats.signature(document), kind: "num" }});
    }}
  }}

  // ---- Main refresh ----
  function refreshAll() {{
    if(!MODEL_IDS.length)return;
    renderSummaryTable();
    renderComplianceTable();
    renderChallengeTable();
    renderAgeBandTable();
    renderFprHeatmaps();
    renderAgeDistribution();
    renderAgeSweep();
    renderScatter();
    renderVariation();
    renderPairwise();
    renderAgeRanges();
    scheduleCIs();
  }}

  // ---- Filter events ----
  // Shared engine wires filter chips + per-group + global buttons and runs
  // refreshAll() once on load.
  GFP.wireGlobal(refreshAll);
  document.getElementById("scatter-color-by")?.addEventListener("change", renderScatter);
  document.addEventListener("dm:modelschange",event=>{{
    const next=activeModelIds(event.detail?.active);
    ALL_MODEL_IDS.forEach(id=>MODEL_COLORS[id]=window.DM_V2_MODELS.getColor(DATA.models[id].experimentId));
    MODEL_IDS=next;refreshAll();
  }});
  document.addEventListener("dm:langchange", refreshAll);
  document.addEventListener("dm:decimalschange", refreshAll);

}})();
</script>
</body>
</html>"""

    out_path = html_dir / "dashboard_age_estimation.html"
    out_path.write_text(html_content, encoding="utf-8")
    return out_path


# ---------------------------------------------------------------------------
# Helpers called during HTML building
# ---------------------------------------------------------------------------
def _color_by_options(artifacts: Sequence[AgeEstimationArtifacts]) -> str:
    seen: List[str] = []
    for art in artifacts:
        for v in _filter_vars(art):
            if v not in seen:
                seen.append(v)
    return "".join(f'<option value="{html.escape(v)}">{html.escape(v)}</option>' for v in seen)
