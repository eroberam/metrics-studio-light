"""Shared Plotly display configuration.

Gives every chart a consistent, discoverable toolbar: a high-res PNG export button,
zoom / pan / autoscale / reset, and hover — without the Plotly logo. Selection tools
remain available to scatter plots and are harmlessly disabled by Plotly where they do
not apply. Used server-side via ``fig.to_html(..., config=PLOTLY_CONFIG)``.
The dynamic (JS-rendered) charts get the same options merged in by ``plot_presentation.js``.
"""
from __future__ import annotations

PLOTLY_CONFIG = {
    "responsive": True,
    "displaylogo": False,
    "displayModeBar": True,
    "scrollZoom": False,
    "doubleClick": "reset+autosize",
    "toImageButtonOptions": {"format": "png", "filename": "metrics_studio_chart", "scale": 2},
}
