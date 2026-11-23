"""Validated bilingual methodology assembled from external text catalogues."""
from __future__ import annotations

from typing import Any

from .glossary import load_methodology_guides

_TEXT_FIELDS = (
    "title",
    "question",
    "definition",
    "formula",
    "interpretation",
    "assumptions",
    "limitations",
    "example",
)


def _catalogue(lang: str) -> dict[str, dict[str, Any]]:
    entries = load_methodology_guides(lang).get("entries") or {}
    if not isinstance(entries, dict):
        raise ValueError(f"Invalid methodology-guide catalogue for '{lang}'.")
    return {str(key): dict(value or {}) for key, value in entries.items()}


def _validate_catalogues(
    english: dict[str, dict[str, Any]],
    spanish: dict[str, dict[str, Any]],
) -> None:
    if english.keys() != spanish.keys():
        missing_es = sorted(english.keys() - spanish.keys())
        missing_en = sorted(spanish.keys() - english.keys())
        raise ValueError(
            "Methodology-guide catalogue mismatch: "
            f"missing_es={missing_es}, missing_en={missing_en}"
        )
    for key in english:
        for metadata in ("contexts", "category"):
            if english[key].get(metadata) != spanish[key].get(metadata):
                raise ValueError(
                    f"Methodology guide '{key}' has inconsistent '{metadata}' metadata."
                )
        for lang, entry in (("en", english[key]), ("es", spanish[key])):
            missing = [field for field in _TEXT_FIELDS if not str(entry.get(field, "")).strip()]
            if missing:
                raise ValueError(
                    f"Methodology guide '{key}' is missing {lang} text: {missing}"
                )


def methodology_payload(task: str) -> list[dict[str, Any]]:
    """Return complete bilingual methodology entries for one generated panel."""
    english = _catalogue("en")
    spanish = _catalogue("es")
    _validate_catalogues(english, spanish)
    payload: list[dict[str, Any]] = []
    for key, source in english.items():
        contexts = tuple(str(value) for value in source.get("contexts") or ())
        if "*" not in contexts and task not in contexts:
            continue
        translated = spanish[key]
        entry: dict[str, Any] = {
            "key": key,
            "category": str(source["category"]),
            "references": list(source.get("references") or ()),
        }
        for field in _TEXT_FIELDS:
            entry[field] = str(source[field])
            entry[f"{field}_es"] = str(translated[field])
        payload.append(entry)
    return payload
