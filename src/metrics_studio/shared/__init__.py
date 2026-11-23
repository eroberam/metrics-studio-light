"""Shared dashboard components."""
from .filter_panel import build_filter_panel
from .html_builder import comparison_table, fmt, fmt_pct, import_plotly, kpi_card, paginated_table, plotly_script
from .plotly_config import PLOTLY_CONFIG
from .runtime import runtime_blocks, runtime_config
from .scripts import (
    APP_SHELL_JS,
    COHORT_RISK_JS,
    COMPARE_JS,
    DOMAIN_JS,
    FILTER_ENGINE_JS,
    FORMAT_JS,
    I18N_JS,
    ICONS_JS,
    MODEL_DETAILS_JS,
    NOTES_JS,
    PLOT_PRESENTATION_JS,
    RESPONSIVE_TABLES_JS,
    SHARED_JS,
    STATS_JS,
    TABLE_PAGINATE_JS,
    TOOLTIP_JS,
    UTILS_JS,
    V2_AGGREGATORS_JS,
    V2_SHELL_JS,
)
from .styles import BASE_CSS, CORE_CSS, FILTER_CSS, NOTES_CSS, SHARED_CSS, STUDIO_CSS, TABLE_CSS, TOOLTIP_CSS

__all__ = [
    "SHARED_CSS", "CORE_CSS", "STUDIO_CSS", "BASE_CSS", "FILTER_CSS", "TABLE_CSS", "TOOLTIP_CSS", "NOTES_CSS",
    "SHARED_JS", "APP_SHELL_JS", "COMPARE_JS", "UTILS_JS", "TOOLTIP_JS", "FILTER_ENGINE_JS", "TABLE_PAGINATE_JS", "PLOT_PRESENTATION_JS", "DOMAIN_JS",
    "I18N_JS", "ICONS_JS", "MODEL_DETAILS_JS", "RESPONSIVE_TABLES_JS", "FORMAT_JS", "STATS_JS", "NOTES_JS",
    "V2_AGGREGATORS_JS", "COHORT_RISK_JS", "V2_SHELL_JS",
    "build_filter_panel", "fmt", "fmt_pct", "kpi_card", "import_plotly", "paginated_table",
    "comparison_table", "plotly_script", "PLOTLY_CONFIG", "runtime_blocks", "runtime_config",
]
