"""Central metrics glossary.

Single source of truth for the descriptive text and metadata of every metric.
Loaded once from ``metrics.yaml`` and consumed both server-side (Python KPI
cards) and client-side (JS tables), so a description lives in exactly one place.
"""
from __future__ import annotations

import functools
import json
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

_GLOSSARY_PATH = Path(__file__).parent / "metrics.yaml"
_DOMAINS_PATH = Path(__file__).parent / "domains.yaml"
_METHODOLOGY_PATHS = {
    "en": Path(__file__).parent / "methodology_en.yaml",
    "es": Path(__file__).parent / "methodology_es.yaml",
}
_GUIDE_PATHS = {
    "en": Path(__file__).parent / "guides_en.yaml",
    "es": Path(__file__).parent / "guides_es.yaml",
}


@functools.lru_cache(maxsize=1)
def load_glossary() -> Dict[str, Dict[str, Any]]:
    """Load and cache the metric glossary as ``{key: {label, description, ...}}``."""
    try:
        import yaml
    except ImportError as exc:  # pragma: no cover - dependency guard
        raise ImportError("Install PyYAML to load the metrics glossary: `pip install pyyaml`") from exc
    data = yaml.safe_load(_GLOSSARY_PATH.read_text(encoding="utf-8")) or {}
    glossary = {str(k): dict(v or {}) for k, v in data.items()}
    incomplete = sorted(
        key for key, value in glossary.items()
        if not str(value.get("description", "")).strip()
        or not str(value.get("description_es", "")).strip()
    )
    if incomplete:
        raise ValueError(f"Incomplete bilingual glossary entries: {incomplete}")
    return glossary


def metric_info(key: str) -> Optional[Dict[str, Any]]:
    """Full glossary entry for ``key`` (or ``None`` if unknown)."""
    return load_glossary().get(key)


def describe(key: str, lang: str = "en") -> str:
    """Tooltip description for ``key`` in ``lang`` (empty string if unknown).

    Missing localized copy returns an empty string; catalogue validation keeps
    bundled entries complete and prevents cross-language runtime fallbacks.
    """
    info = metric_info(key)
    if not info:
        return ""
    return str(info.get("description" if lang == "en" else f"description_{lang}", ""))


def label_for(key: str, default: str = "") -> str:
    """Display label for ``key`` (or ``default`` if not set)."""
    info = metric_info(key)
    return str(info.get("label", default)) if info else default


def glossary_subset(keys: Iterable[str]) -> Dict[str, Dict[str, Any]]:
    """The glossary restricted to ``keys`` (unknown keys are skipped)."""
    g = load_glossary()
    return {k: g[k] for k in keys if k in g}


def glossary_json(keys: Iterable[str]) -> str:
    """JSON of ``{key: {"en": description, "es": description}}`` for ``keys``,
    safe to embed in a <script>.

    Used to hand metric descriptions to client-rendered tooltips via ``ii(key)``
    and hover-time resolution (utils.js / tooltip.js pick the active language).
    """
    subset = {
        k: {"en": v.get("description", ""), "es": v.get("description_es", "")}
        for k, v in glossary_subset(keys).items()
    }
    return json.dumps(subset, ensure_ascii=False).replace("</", "<\\/")


@functools.lru_cache(maxsize=1)
def load_domains() -> Dict[str, Dict[str, str]]:
    """Load and cache the per-domain metric label aliases as ``{domain: {key: label}}``."""
    try:
        import yaml
    except ImportError as exc:  # pragma: no cover - dependency guard
        raise ImportError("Install PyYAML to load the domain aliases: `pip install pyyaml`") from exc
    data = yaml.safe_load(_DOMAINS_PATH.read_text(encoding="utf-8")) or {}
    return {str(d): {str(k): str(v) for k, v in (m or {}).items()} for d, m in data.items()}


def domain_label(key: str, domain: str) -> str:
    """Label for metric ``key`` in ``domain`` (falls back to the canonical glossary label)."""
    alias = load_domains().get(domain, {}).get(key)
    return alias if alias else label_for(key, key)


def domains_json() -> str:
    """JSON of the full domain-alias map, safe to embed in a <script>."""
    return json.dumps(load_domains(), ensure_ascii=False).replace("</", "<\\/")


@functools.lru_cache(maxsize=len(_METHODOLOGY_PATHS))
def load_methodology(lang: str) -> Dict[str, Any]:
    """Load a complete metric-methodology language catalogue.

    The catalogue is intentionally separate from executable metric metadata:
    scientific copy can be reviewed without editing calculation code and a
    missing translation becomes a validation error instead of an English
    runtime fallback.
    """
    try:
        import yaml
    except ImportError as exc:  # pragma: no cover - dependency guard
        raise ImportError(
            "Install PyYAML to load methodology translations: `pip install pyyaml`"
        ) from exc
    try:
        path = _METHODOLOGY_PATHS[lang]
    except KeyError as exc:
        raise ValueError(f"Unsupported methodology language: {lang}") from exc
    return dict(yaml.safe_load(path.read_text(encoding="utf-8")) or {})


def load_methodology_es() -> Dict[str, Any]:
    """Backward-compatible convenience accessor for the Spanish catalogue."""
    return load_methodology("es")


@functools.lru_cache(maxsize=len(_GUIDE_PATHS))
def load_methodology_guides(lang: str) -> Dict[str, Any]:
    """Load the non-metric methodology copy for one exact language.

    Guide selection metadata is duplicated across the catalogues deliberately:
    validation can therefore detect a translation that is missing, misplaced or
    assigned to the wrong panel without using another language as a fallback.
    """
    try:
        import yaml
    except ImportError as exc:  # pragma: no cover - dependency guard
        raise ImportError(
            "Install PyYAML to load methodology translations: `pip install pyyaml`"
        ) from exc
    try:
        path = _GUIDE_PATHS[lang]
    except KeyError as exc:
        raise ValueError(f"Unsupported methodology-guide language: {lang}") from exc
    return dict(yaml.safe_load(path.read_text(encoding="utf-8")) or {})
