from __future__ import annotations

from pathlib import Path

from metrics_studio.glossary import domains_json

_A = Path(__file__).parent / "assets"

UTILS_JS          = (_A / "utils.js").read_text(encoding="utf-8")
TOOLTIP_JS        = (_A / "tooltip.js").read_text(encoding="utf-8")
FILTER_ENGINE_JS  = (_A / "filter_engine.js").read_text(encoding="utf-8")
TABLE_PAGINATE_JS = (_A / "table_paginate.js").read_text(encoding="utf-8")
PLOT_PRESENTATION_JS          = (_A / "plot_presentation.js").read_text(encoding="utf-8")
I18N_JS           = (_A / "i18n.js").read_text(encoding="utf-8")
FORMAT_JS         = (_A / "format.js").read_text(encoding="utf-8")
STATS_JS          = (_A / "stats.js").read_text(encoding="utf-8")
NOTES_JS          = (_A / "notes.js").read_text(encoding="utf-8")
ICONS_JS          = (_A / "icons.js").read_text(encoding="utf-8")

# Compatibility export only: mobile table transformation is no longer bundled.
RESPONSIVE_TABLES_JS = ""
MODEL_DETAILS_JS   = (_A / "model_details.js").read_text(encoding="utf-8")
MODEL_TABS_JS      = (_A / "model_tabs.js").read_text(encoding="utf-8")
COMPARE_JS         = (_A / "compare.js").read_text(encoding="utf-8")
CONTROL_DOCKS_JS   = (_A / "control_docks.js").read_text(encoding="utf-8")
AT_A_GLANCE_JS    = (_A / "at_a_glance.js").read_text(encoding="utf-8")
SECTION_NAV_JS    = (_A / "section_nav.js").read_text(encoding="utf-8")
APP_SHELL_JS      = (_A / "app_shell.js").read_text(encoding="utf-8")
V2_AGGREGATORS_JS = (_A / "v2_aggregators.js").read_text(encoding="utf-8")
COHORT_RISK_JS    = (_A / "cohort_risk.js").read_text(encoding="utf-8")
PATH_IMAGES_JS = (_A / "path_images.js").read_text(encoding="utf-8")
BINARY_SAMPLES_JS = (_A / "binary_samples.js").read_text(encoding="utf-8")
STATISTICS_VIEW_JS = (_A / "statistics_view.js").read_text(encoding="utf-8")
RELATIONSHIP_EXPLORER_JS = (_A / "relationship_explorer.js").read_text(encoding="utf-8")
V2_SHELL_JS       = (_A / "v2_shell.js").read_text(encoding="utf-8")
COMPARISON_MANAGER_JS = (_A / "comparison_manager.js").read_text(encoding="utf-8")
# Domain alias map is bundled with domain.js so the selector needs no per-page data.
DOMAIN_JS         = "window.DM_DOMAIN_LABELS=" + domains_json() + ";\n" + (_A / "domain.js").read_text(encoding="utf-8")

SHARED_JS = (
    I18N_JS + "\n" + FORMAT_JS + "\n" + STATS_JS + "\n" + UTILS_JS + "\n" + TOOLTIP_JS + "\n"
    + FILTER_ENGINE_JS + "\n" + TABLE_PAGINATE_JS + "\n" + PLOT_PRESENTATION_JS + "\n" + DOMAIN_JS + "\n" + NOTES_JS
    + "\n" + ICONS_JS + "\n" + APP_SHELL_JS
    + "\n" + MODEL_DETAILS_JS + "\n" + MODEL_TABS_JS + "\n" + COMPARE_JS + "\n" + AT_A_GLANCE_JS + "\n" + SECTION_NAV_JS
    + "\n" + CONTROL_DOCKS_JS + "\n" + V2_AGGREGATORS_JS
    + "\n" + COHORT_RISK_JS + "\n" + COMPARISON_MANAGER_JS + "\n" + PATH_IMAGES_JS + "\n" + BINARY_SAMPLES_JS + "\n" + STATISTICS_VIEW_JS + "\n" + RELATIONSHIP_EXPLORER_JS + "\n" + V2_SHELL_JS
)
