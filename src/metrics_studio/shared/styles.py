from __future__ import annotations

from pathlib import Path

_A = Path(__file__).parent / "assets"

BASE_CSS    = (_A / "base.css").read_text(encoding="utf-8")
FILTER_CSS  = (_A / "filters.css").read_text(encoding="utf-8")
TABLE_CSS   = (_A / "tables.css").read_text(encoding="utf-8")
TOOLTIP_CSS = (_A / "tooltip.css").read_text(encoding="utf-8")
NOTES_CSS   = (_A / "notes.css").read_text(encoding="utf-8")
STUDIO_CSS = "\n".join(
    (
        (_A / "studio.css").read_text(encoding="utf-8"),
        (_A / "v2.css").read_text(encoding="utf-8"),
        (_A / "workbench.css").read_text(encoding="utf-8"),
        (_A / "comparison.css").read_text(encoding="utf-8"),
        (_A / "binary_samples.css").read_text(encoding="utf-8"),
        (_A / "statistics_view.css").read_text(encoding="utf-8"),
        (_A / "relationship_explorer.css").read_text(encoding="utf-8"),
    ),
)

CORE_CSS = BASE_CSS + "\n" + FILTER_CSS + "\n" + TABLE_CSS + "\n" + TOOLTIP_CSS + "\n" + NOTES_CSS
# Public complete design-system bundle. Dashboard assemblers use CORE_CSS +
# task-specific rules + STUDIO_CSS to preserve the intentional cascade order.
SHARED_CSS = CORE_CSS + "\n" + STUDIO_CSS
