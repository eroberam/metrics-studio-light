"""Interface internationalization (spec §3.1).

UI strings live in ``locales/{en,es}.json`` as flat dot.notation keys. Python
renders the final English text plus a ``data-i18n`` attribute; the client
(``shared/assets/i18n.js``) re-applies the active language at runtime from the
embedded locale JSON — no reload, no template engine.

Standardized metric names (ROC-AUC, MAE, EER, CER, APCER, …) are NOT locale
keys: they are literal and never translated.
"""
from __future__ import annotations

import functools
import html as _html
import json
from pathlib import Path
from typing import Any, Dict, List

_LOCALES_DIR = Path(__file__).parent / "locales"
LANGUAGES = ("en", "es")


@functools.lru_cache(maxsize=None)
def load_locale(lang: str) -> Dict[str, str]:
    path = _LOCALES_DIR / f"{lang}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    return {str(k): str(v) for k, v in data.items()}


def tr(key: str, **fmt: Any) -> str:
    """English text for ``key`` (server-side render). Unknown key -> the key itself."""
    text = load_locale("en").get(key, key)
    if fmt:
        try:
            text = text.format(**fmt)
        except (KeyError, IndexError):
            pass
    return text


def t_attr(key: str, **fmt: Any) -> str:
    """Escaped English text for use inside an HTML attribute value."""
    return _html.escape(tr(key, **fmt), quote=True)


def t_span(key: str, **fmt: Any) -> str:
    """``<span data-i18n="key">EN</span>`` — the client swaps textContent on switch.

    Parameterized strings also carry ``data-i18n-args`` so the substitution can
    be re-applied in the other language.
    """
    args_attr = ""
    if fmt:
        args_json = json.dumps(fmt, ensure_ascii=False).replace("</", "<\\/")
        args_attr = f" data-i18n-args='{_html.escape(args_json, quote=True)}'"
    return f'<span data-i18n="{_html.escape(key, quote=True)}"{args_attr}>{_html.escape(tr(key, **fmt))}</span>'


def i18n_json() -> str:
    """Both locales as JSON, safe to embed in a <script> tag."""
    payload = {lang: load_locale(lang) for lang in LANGUAGES}
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def missing_keys() -> Dict[str, List[str]]:
    """Keys present in one locale but not another (test hook; empty = parity)."""
    out: Dict[str, List[str]] = {}
    key_sets = {lang: set(load_locale(lang)) for lang in LANGUAGES}
    for lang in LANGUAGES:
        others = set().union(*(key_sets[o] for o in LANGUAGES if o != lang))
        missing = sorted(others - key_sets[lang])
        if missing:
            out[lang] = missing
    return out
