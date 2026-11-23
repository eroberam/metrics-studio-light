from __future__ import annotations

import html as _html
from typing import Any, Optional, Tuple

import numpy as np

from metrics_studio.i18n import t_attr, t_span, tr


def fmt(x: Any, digits: int = 4) -> str:
    if x is None:
        return "N/A"
    try:
        xf = float(x)
    except Exception:
        return "N/A"
    return "N/A" if not np.isfinite(xf) else f"{xf:.{digits}f}"


def fmt_pct(x: Any) -> str:
    if x is None:
        return "N/A"
    try:
        xf = float(x)
    except Exception:
        return "N/A"
    return "N/A" if not np.isfinite(xf) else f"{100.0 * xf:.2f}%"


def ci_line(
    ci: Optional[Tuple[float, float]],
    *,
    n: Optional[int] = None,
    level: float = 0.95,
    metric: Optional[str] = None,
    kind: str = "num",
    digits: int = 4,
) -> str:
    """Secondary CI line for a KPI card: ``95% CI: a–b · n = N`` (spec §3.4).

    ``metric`` is the stable id stats.js uses to recompute the interval on
    filter changes. Returns "" when there is no interval to show.
    """
    if not ci:
        return ""
    if not all(v is not None and np.isfinite(v) for v in ci):
        return f'<div class="kpi-ci">{t_span("v2.notAvailable")}</div>'
    pct = int(round(level * 100))
    metric_attr = f' data-ci-metric="{_html.escape(metric)}"' if metric else ""
    scale = 100.0 if kind == "pct" else 1.0
    suffix = "%" if kind == "pct" else ""
    lo, hi = (f"{scale * v:.{digits}f}" for v in ci)
    rng = (
        f'<span class="kpi-ci-range" data-ci-lo="{ci[0]!r}" data-ci-hi="{ci[1]!r}" data-fmt="{_html.escape(kind)}">'
        f"{lo}–{hi}{suffix}</span>"
    )
    n_html = f" · {_html.escape(tr('ci.n_eq', n=f'{n:,}'))}" if n is not None else ""
    return (
        f'<div class="kpi-ci"{metric_attr}>{t_span("ci.label", pct=pct)}: {rng}'
        f'<span class="kpi-ci-n">{n_html}</span></div>'
    )


def kpi_card(
    label: str,
    value: str,
    detail: str,
    info: str = "",
    *,
    metric_key: str | None = None,
    kpi_key: str | None = None,
    raw: Any = None,
    kind: str = "num",
    label_key: str | None = None,
    detail_key: str | None = None,
    ci: Optional[Tuple[float, float]] = None,
    ci_n: Optional[int] = None,
    ci_level: float = 0.95,
    ci_metric: str | None = None,
    ci_digits: int = 4,
) -> str:
    """Render a KPI card. If ``metric_key`` is given and ``info`` is empty, the
    tooltip text is pulled from the central glossary — the single source of truth.

    ``kpi_key`` is the stable id JS uses to update the card (labels are dynamic
    under i18n/case-study profiles, so lookups must never key on the label).
    ``raw``/``kind`` expose the unformatted value so DM_FMT can reformat it when
    the global decimal precision changes. ``detail_key`` renders the detail as a
    translatable span; ``ci``/``ci_n``/``ci_metric`` add the secondary CI line.
    """
    if metric_key and not info:
        from metrics_studio.glossary import describe
        info = describe(metric_key)
    tooltip_key_attr = f' data-tooltip-key="{_html.escape(metric_key)}"' if metric_key and info else ""
    icon = (
        f' <span class="info-icon" tabindex="0"{tooltip_key_attr} data-tooltip="{_html.escape(info)}">i</span>'
        if info else ""
    )
    key_attr = f' data-metric-key="{_html.escape(metric_key)}"' if metric_key else ""
    label_html = (
        t_span(label_key) if label_key
        else _html.escape(label)
    )
    kpi_key_attr = f' data-kpi-key="{_html.escape(kpi_key)}"' if kpi_key else ""
    raw_attr = ""
    if raw is not None:
        try:
            raw_f = float(raw)
            if np.isfinite(raw_f):
                raw_attr = f' data-raw="{raw_f!r}" data-fmt="{_html.escape(kind)}"'
        except (TypeError, ValueError):
            pass
    detail_html = t_span(detail_key) if detail_key else _html.escape(detail)
    ci_html = ci_line(ci, n=ci_n, level=ci_level, metric=ci_metric, kind=kind, digits=ci_digits)
    return (
        f'<div class="kpi-card" data-kpi="{_html.escape(label)}"{kpi_key_attr}>'
        f'<div class="kpi-label"><span{key_attr}>{label_html}</span>{icon}</div>'
        f'<div class="kpi-value"{raw_attr}>{_html.escape(value)}</div>'
        f'<div class="kpi-detail">{detail_html}</div>'
        f'{ci_html}'
        f'</div>'
    )


def import_plotly():
    try:
        import plotly.graph_objects as go
        from plotly.subplots import make_subplots
    except ImportError as exc:
        raise ImportError("pip install plotly") from exc
    return go, make_subplots


def plotly_script(delivery: str = "cdn") -> str:
    """Return the Plotly runtime tag for a generated standalone dashboard."""
    if delivery == "inline":
        try:
            from plotly.offline import get_plotlyjs
        except ImportError as exc:
            raise ImportError("pip install plotly") from exc
        javascript = get_plotlyjs().replace("</script>", "<\\/script>")
        return f"<script>{javascript}</script>"
    if delivery != "cdn":
        raise ValueError("Plotly delivery must be 'cdn' or 'inline'.")
    return '<script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>'


def comparison_table(model_names, rows, *, note="", note_key=None, baseline_index=None):
    """Cross-model comparison table (models as rows, metrics as columns).

    ``rows`` is a list of ``(label, cells, better)`` where ``cells`` is a list of
    ``(display, raw)`` aligned with ``model_names`` (``raw`` may be ``None``), and
    ``better`` is ``"higher"`` | ``"lower"`` | ``None`` — which model's cell to
    highlight as best. Callers render this only when there are >= 2 models.
    ``baseline_index`` tags that model's column as the baseline experiment.
    """
    best_by_metric: list[set[int]] = []
    for _label, cells, better in rows:
        best_idx: set[int] = set()
        finite = [(i, float(r)) for i, (_d, r) in enumerate(cells)
                  if r is not None and np.isfinite(r)]
        if finite and better in ("higher", "lower"):
            best = (max if better == "higher" else min)(v for _i, v in finite)
            best_idx = {i for i, v in finite if abs(v - best) < 1e-12}
        best_by_metric.append(best_idx)

    heads = [f'<th scope="col">{t_span("common.model")}</th>']
    heads.extend(f'<th scope="col">{_html.escape(str(label))}</th>' for label, _cells, _better in rows)
    body = []
    for model_idx, name in enumerate(model_names):
        baseline = baseline_index is not None and model_idx == baseline_index
        tag = f' <span class="cmp-baseline-tag">{t_span("common.baseline")}</span>' if baseline else ""
        cells_html = []
        for metric_idx, (label, cells, _better) in enumerate(rows):
            disp, _raw = cells[model_idx]
            classes = []
            if model_idx in best_by_metric[metric_idx]:
                classes.append("cmp-best")
            if baseline:
                classes.append("cmp-baseline")
            cls = f' class="{" ".join(classes)}"' if classes else ""
            best_mark = (
                f'<span class="cmp-best-mark" data-i18n-attr="aria-label:accessibility.best_value" '
                f'aria-label="{t_attr("accessibility.best_value")}">◆</span>'
                if model_idx in best_by_metric[metric_idx]
                else ""
            )
            raw_value = "" if _raw is None else str(_raw)
            cells_html.append(
                f'<td{cls} data-label="{_html.escape(str(label))}" data-compare-metric="metric-{metric_idx}" '
                f'data-model-index="{model_idx}" data-compare-raw="{_html.escape(raw_value)}" '
                f'data-better="{_html.escape(str(_better or "neutral"))}">{best_mark}{_html.escape(str(disp))}</td>'
            )
        row_class = ' class="cmp-baseline-row"' if baseline else ""
        body.append(
            f'<tr{row_class}><th scope="row" data-label="{_html.escape(tr("common.model"))}">'
            f'{_html.escape(str(name))}{tag}</th>{"".join(cells_html)}</tr>'
        )
    if note_key:
        note_html = f'<p class="section-desc">{t_span(note_key)}</p>'
    elif note:
        note_html = f'<p class="section-desc">{_html.escape(str(note))}</p>'
    else:
        note_html = ""
    return (
        f'<section class="dash-section comparison-section"><div class="section-title">{t_span("common.model_comparison")}</div>'
        + note_html
        + '<div class="summary-table-wrap"><table class="summary-table model-comparison-table"><thead><tr>'
        + f'{"".join(heads)}</tr></thead><tbody>{"".join(body)}</tbody></table></div>'
        + "</section>"
    )


def paginated_table(table_id, columns, rows, *, page_size=10, export_name=None, title="", note="",
                    title_key=None, note_key=None, label_keys=None):
    """Client-side paginated table with optional CSV export (wired by table_paginate.js).

    ``columns`` is a list of ``(key, label)``; ``rows`` a list of ``{key: value}`` dicts
    (values are shown verbatim, so format numbers before passing them in).
    ``title_key``/``note_key``/``label_keys`` render the corresponding strings as
    translatable spans (``label_keys`` maps a column key to its i18n key).
    """
    import json as _json
    label_keys = label_keys or {}
    cols = [{"key": str(k), "label": str(lbl)} for k, lbl in columns]
    thead = "".join(
        f"<th>{t_span(label_keys[str(k)]) if str(k) in label_keys else _html.escape(str(lbl))}</th>"
        for k, lbl in columns
    )
    cols_json = _json.dumps(cols, ensure_ascii=False).replace("</", "<\\/")
    rows_json = _json.dumps(list(rows), ensure_ascii=False).replace("</", "<\\/")
    export_attr = f' data-export-name="{_html.escape(export_name)}"' if export_name else ""
    export_btn = (
        f'<button type="button" class="tpt-export" data-i18n="table.export">{_html.escape(tr("table.export"))}</button>'
        if export_name else ""
    )
    if title_key:
        title_html = f"<h3>{t_span(title_key)}</h3>"
    else:
        title_html = f"<h3>{_html.escape(str(title))}</h3>" if title else ""
    if note_key:
        note_html = f'<p class="muted small">{t_span(note_key)}</p>'
    else:
        note_html = f'<p class="muted small">{_html.escape(str(note))}</p>' if note else ""
    return (
        f'<section class="dash-section paginated-table" data-paginated-table="{_html.escape(str(table_id))}" '
        f'data-page-size="{int(page_size)}"{export_attr}>'
        f'<div class="tpt-head">{title_html}{export_btn}</div>{note_html}'
        f'<div class="table-scroll"><table class="metrics-table"><thead><tr>{thead}</tr></thead><tbody></tbody></table></div>'
        f'<div class="tpt-pager"></div>'
        f'<script type="application/json" id="cols-{_html.escape(str(table_id))}">{cols_json}</script>'
        f'<script type="application/json" id="rows-{_html.escape(str(table_id))}">{rows_json}</script>'
        f'</section>'
    )
