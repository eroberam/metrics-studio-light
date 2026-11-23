"""Embedded runtime configuration blocks shared by every dashboard.

``runtime_blocks()`` returns the four JSON <script> islands the client-side
modules read:

- ``#dm-ui-config``          ui / statistics / case_study / experiments metadata
- ``#i18n-data``             both locale tables (i18n.js)
- ``#glossary-data``         bilingual scientific metric definitions (tooltip.js)
- ``#research-notes-data``   persisted research notes (notes.js; seeded empty)
"""
from __future__ import annotations

import json
from dataclasses import asdict
from typing import Any, Dict, Optional, Sequence

from metrics_studio.config import EvaluationConfig
from metrics_studio.glossary import glossary_json, load_glossary
from metrics_studio.i18n import i18n_json
from metrics_studio.shared.provenance import run_manifest


def runtime_config(config: EvaluationConfig, task: str, *, baseline_id: Optional[str] = None) -> Dict[str, Any]:
    ci = config.statistics.confidence_intervals
    if baseline_id is None:
        baseline_id = next(
            (s.resolved_experiment_id for s in config.input_sources if s.role == "baseline"), None
        )
    manifest = run_manifest(config, task)
    return {
        "task": task,
        "ui": {
            "language": "en",
            "decimals": config.ui.decimals,
            "decimals_min": config.ui.decimals_min,
            "decimals_max": config.ui.decimals_max,
            "allow_runtime_decimal_change": config.ui.allow_runtime_decimal_change,
            "plotly_delivery": config.ui.plotly_delivery,
            "metric_decimals": dict(config.ui.metric_decimals),
            "comparison": asdict(config.ui.comparison),
        },
        "statistics": {
            "group_audit_min_samples": config.statistics.group_audit_min_samples,
            "confidence_intervals": {
                "enabled": ci.enabled,
                "level": ci.level,
                "method": ci.method,
                "n_resamples": ci.n_resamples,
                "seed": ci.seed,
                "display": ci.display,
                "resample_unit": ci.resample_unit,
            },
        },
        "case_study": {
            "default": config.case_study.default,
            "selectable": list(config.case_study.effective_selectable(task)),
            "allow_runtime_change": config.case_study.allow_runtime_change,
            "class_roles": dict(config.case_study.class_roles),
            "custom_profile": config.case_study.custom_profile,
        },
        "experiments": [
            {"id": s.resolved_experiment_id, "name": s.display_name, "role": s.role}
            for s in config.input_sources
        ],
        "baseline_id": baseline_id,
        "package_version": manifest["package_version"],
        "generated_at": manifest["generated_at"],
        "run_manifest": manifest,
    }


def _script_json(dom_id: str, payload: str) -> str:
    return f'<script type="application/json" id="{dom_id}">{payload}</script>'


def runtime_blocks(
    config: EvaluationConfig,
    task: str,
    *,
    baseline_id: Optional[str] = None,
    artifacts: Optional[Sequence[object]] = None,
) -> str:
    from metrics_studio.shared.v2 import _clean

    cfg_json = json.dumps(
        _clean(runtime_config(config, task, baseline_id=baseline_id)),
        ensure_ascii=False, separators=(",", ":"), allow_nan=False,
    ).replace("</", "<\\/")
    blocks = (
        _script_json("dm-ui-config", cfg_json)
        + "\n" + _script_json("i18n-data", i18n_json())
        + "\n" + _script_json("glossary-data", glossary_json(load_glossary().keys()))
        + "\n" + _script_json("research-notes-data", '{"notes": []}')
    )
    if artifacts is not None:
        from metrics_studio.shared.v2 import build_v2_payload

        v2_json = json.dumps(
            _clean(build_v2_payload(artifacts, config)),
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        ).replace("</", "<\\/")
        blocks += "\n" + _script_json("dm-v2-report-data", v2_json)
    return blocks
