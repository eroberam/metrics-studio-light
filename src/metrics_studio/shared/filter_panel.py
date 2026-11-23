from __future__ import annotations

import html as _html
from typing import Dict, List

from metrics_studio.i18n import t_span


def build_filter_panel(
    all_vars: List[str],
    var_values: Dict[str, List[str]],
    *,
    checkbox_class: str = "filter-selector",
    global_select_id: str = "",
    global_clear_id: str = "",
    global_select_class: str = "select-all-filters",
    global_clear_class: str = "clear-all-filters",
) -> str:
    """Unified filter panel — a titled card with one block per variable.

    Each variable is a block: a header row (variable name + per-variable all/none)
    and its value chips below. JS hook classes are preserved so the shared filter
    engine (GFP) keeps working unchanged.
    """
    if not all_vars:
        return ""

    sel_label = t_span("panel.filters.select_all")
    clr_label = t_span("panel.filters.clear")
    btn_sel = (
        f"<button type='button' id='{_html.escape(global_select_id)}'>{sel_label}</button>"
        if global_select_id else
        f"<button type='button' class='{_html.escape(global_select_class)}'>{sel_label}</button>"
    )
    btn_clr = (
        f"<button type='button' id='{_html.escape(global_clear_id)}'>{clr_label}</button>"
        if global_clear_id else
        f"<button type='button' class='{_html.escape(global_clear_class)}'>{clr_label}</button>"
    )

    groups = []
    for v in all_vars:
        values = sorted(var_values.get(v, []))
        chips = "".join(
            f"<label class='filter-check'>"
            f"<input type='checkbox' class='{_html.escape(checkbox_class)}' "
            f"data-filter-var='{_html.escape(v)}' value='{_html.escape(val)}' checked>"
            f"<span>{_html.escape(val)}</span></label>"
            for val in values
        )
        groups.append(
            f"<div class='gfp-group'>"
            f"<div class='gfp-group-head'>"
            f"<span class='gfp-label'>{_html.escape(v)}</span>"
            f"<div class='gfp-grp-act'>"
            f"<button type='button' class='filter-select-all' data-filter-var='{_html.escape(v)}'>&#10003; {t_span('panel.filters.all')}</button>"
            f"<button type='button' class='filter-clear-all' data-filter-var='{_html.escape(v)}'>&#10007; {t_span('panel.filters.none')}</button>"
            f"</div></div>"
            f"<div class='gfp-chips'>{chips}</div>"
            f"</div>"
        )

    return (
        f"<section class='gfp'>"
        f"<div class='gfp-head'>"
        f"<span class='gfp-title'><span class='gfp-title-icon' data-dm-icon='filter' aria-hidden='true'></span>{t_span('panel.filters.title')}</span>"
        f"<div class='gfp-head-act'>{btn_sel}{btn_clr}</div>"
        f"</div>"
        f"<div class='gfp-groups'>{''.join(groups)}</div>"
        f"</section>"
    )
