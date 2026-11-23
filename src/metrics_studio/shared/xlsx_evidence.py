"""Append task-neutral scientific evidence to the consolidated workbook."""
from __future__ import annotations

from pathlib import Path
from typing import Sequence

import pandas as pd

from metrics_studio.config import EvaluationConfig
from metrics_studio.methodology_registry import methodology_payload
from metrics_studio.metric_registry import METRIC_ENGINE, METRIC_REGISTRY
from metrics_studio.shared.provenance import run_manifest
from metrics_studio.shared.scientific import fairlearn_group_audit
from metrics_studio.shared.v2 import (
    _augment,
    _detect_variables,
    _frame,
    _metric_values,
)


def _audit_resample_groups(
    frame: pd.DataFrame,
    config: EvaluationConfig,
):
    """Resolve the cluster identifier used only by exported group evidence."""

    unit = config.statistics.confidence_intervals.resample_unit.lower()
    if unit in {"sample", "row", "record", "document"}:
        return None
    aliases = {
        "subject": ("subject_id", "subject", "participant_id", "participant"),
        "image": ("image_id", "image"),
    }.get(unit, (unit, f"{unit}_id"))
    column = next((candidate for candidate in aliases if candidate in frame), None)
    return frame[column].fillna("UNKNOWN").astype(str).to_numpy() if column else None


def _metric_evidence(
    artifacts: Sequence[object],
    config: EvaluationConfig,
) -> pd.DataFrame:
    rows = []
    for artifact in artifacts:
        values = _metric_values(artifact, config.task_type)
        intervals = getattr(artifact, "ci", {}) or {}
        n = int(values.get("n_samples", 0) or 0)
        for result in METRIC_ENGINE.collect(
            config.task_type,
            values,
            ci=intervals,
            n=n,
        ):
            definition = METRIC_REGISTRY.resolve(result.key)
            rows.append({
                "model_name": getattr(artifact, "model_name", ""),
                "metric_id": result.key,
                "value": result.value,
                "ci_low": result.ci[0] if result.ci else None,
                "ci_high": result.ci[1] if result.ci else None,
                "n": result.n,
                "unit": definition.unit,
                "direction": definition.direction,
                "ci_method": config.statistics.confidence_intervals.method,
                "resample_unit": config.statistics.confidence_intervals.resample_unit,
            })
    return pd.DataFrame(rows)


def _group_evidence(
    artifacts: Sequence[object],
    config: EvaluationConfig,
) -> pd.DataFrame:
    frames = [_augment(_frame(artifact), artifact, config) for artifact in artifacts]
    _, _, variables = _detect_variables(frames, config)
    rows = []
    for artifact, frame in zip(artifacts, frames, strict=True):
        evidence = fairlearn_group_audit(
            frame,
            variables,
            min_samples=config.statistics.group_audit_min_samples,
            kind="ratio",
            ci_config=config.statistics.confidence_intervals,
            resample_groups=_audit_resample_groups(frame, config),
        )
        for variable_evidence in evidence:
            groups = variable_evidence["groups"] or [{
                "group": None,
                "n": None,
                "value": None,
            }]
            for group in groups:
                rows.append({
                    "model_name": getattr(artifact, "model_name", ""),
                    "variable": variable_evidence["variable"],
                    "group": group["group"],
                    "n": group["n"],
                    "metric_value": group["value"],
                    "ci_low": group["ci"][0] if group.get("ci") else None,
                    "ci_high": group["ci"][1] if group.get("ci") else None,
                    "ci_method": config.statistics.confidence_intervals.method,
                    "resample_unit": config.statistics.confidence_intervals.resample_unit,
                    "overall": variable_evidence["overall"],
                    "difference_vs_overall": group.get("difference"),
                    "ratio_vs_overall": group.get("ratio"),
                    "range_difference": variable_evidence["difference"],
                    "min_max_ratio": variable_evidence["ratio"],
                    "min_samples": config.statistics.group_audit_min_samples,
                    "interpretation": (
                        "Descriptive quality-of-service diagnostic; "
                        "not a fairness certification."
                    ),
                })
    return pd.DataFrame(rows)


def _methodology_evidence(
    artifacts: Sequence[object],
    config: EvaluationConfig,
) -> pd.DataFrame:
    available = {
        result.key
        for artifact in artifacts
        for result in METRIC_ENGINE.collect(
            config.task_type,
            _metric_values(artifact, config.task_type),
            ci=getattr(artifact, "ci", {}) or {},
        )
    }
    rows = []
    for key in sorted(available):
        definition = METRIC_REGISTRY.resolve(key)
        rows.append({
            "id": f"metric:{key}",
            "category": "metric",
            "title_en": definition.label,
            "title_es": definition.label_es,
            "formula": definition.formula,
            "formula_es": definition.formula_es,
            "interpretation_en": definition.interpretation,
            "interpretation_es": definition.interpretation_es,
            "limitations_en": definition.limitations,
            "limitations_es": definition.limitations_es,
            "references": " | ".join(definition.references),
        })
    for definition in methodology_payload(config.task_type):
        rows.append({
            "id": definition["key"],
            "category": definition["category"],
            "title_en": definition["title"],
            "title_es": definition["title_es"],
            "formula": definition["formula"],
            "formula_es": definition["formula_es"],
            "interpretation_en": definition["interpretation"],
            "interpretation_es": definition["interpretation_es"],
            "limitations_en": definition["limitations"],
            "limitations_es": definition["limitations_es"],
            "references": " | ".join(definition["references"]),
        })
    return pd.DataFrame(rows)


def _manifest_summary(manifest: dict) -> pd.DataFrame:
    environment = manifest["environment"]
    return pd.DataFrame([
        {"key": "schema_version", "value": manifest["schema_version"]},
        {"key": "run_id", "value": manifest["run_id"]},
        {"key": "identity_sha256", "value": manifest["identity_sha256"]},
        {"key": "task", "value": manifest["task"]},
        {"key": "package_name", "value": manifest["package_name"]},
        {"key": "package_version", "value": manifest["package_version"]},
        {"key": "generated_at", "value": manifest["generated_at"]},
        {"key": "config_sha256", "value": manifest["config_sha256"]},
        {"key": "plotly_delivery", "value": manifest["plotly_delivery"]},
        {"key": "python", "value": environment["python"]},
        {"key": "implementation", "value": environment["implementation"]},
        {"key": "system", "value": environment["system"]},
        {"key": "machine", "value": environment["machine"]},
    ])


def _manifest_inputs(manifest: dict) -> pd.DataFrame:
    rows = []
    for source_index, item in enumerate(manifest["inputs"]):
        common = {
            "source_index": source_index,
            "experiment_id": item["experiment_id"],
            "role": item["role"],
            "input_file": item["file_name"],
            "input_size_bytes": item["size_bytes"],
            "input_modified_at": item["modified_at"],
            "input_sha256": item["sha256"],
        }
        rows.append({
            **common,
            "resource_name": None,
            "resource_file": None,
            "resource_size_bytes": None,
            "resource_modified_at": None,
            "resource_sha256": None,
        })
        for resource in item["resources"]:
            rows.append({
                **common,
                "resource_name": resource["name"],
                "resource_file": resource["file_name"],
                "resource_size_bytes": resource["size_bytes"],
                "resource_modified_at": resource["modified_at"],
                "resource_sha256": resource["sha256"],
            })
    return pd.DataFrame(rows)


def _manifest_dependencies(manifest: dict) -> pd.DataFrame:
    return pd.DataFrame([
        {"distribution": name, "version": dependency_version}
        for name, dependency_version in manifest["dependencies"].items()
    ])


def _flatten_config(value: object, prefix: str = "") -> list[dict[str, object]]:
    if isinstance(value, dict):
        rows = []
        for key, item in value.items():
            child = f"{prefix}.{key}" if prefix else str(key)
            rows.extend(_flatten_config(item, child))
        return rows
    if isinstance(value, list):
        rows = []
        for index, item in enumerate(value):
            rows.extend(_flatten_config(item, f"{prefix}[{index}]"))
        return rows
    return [{"key": prefix, "value": value}]


def _manifest_config(manifest: dict) -> pd.DataFrame:
    return pd.DataFrame(_flatten_config(manifest["effective_config"]))


def append_scientific_evidence(
    artifacts: Sequence[object],
    reports_dir: Path,
    config: EvaluationConfig,
) -> None:
    """Add common metric, audit, library-diagnostic and methodology sheets."""

    workbooks = list(reports_dir.glob("*.xlsx"))
    if len(workbooks) != 1:
        raise RuntimeError(
            f"Expected one workbook before scientific enrichment, found {len(workbooks)}."
        )
    manifest = run_manifest(config, config.task_type)
    sheets = {
        "scientific_metrics": _metric_evidence(artifacts, config),
        "group_audit": _group_evidence(artifacts, config),
        "methodology_registry": _methodology_evidence(artifacts, config),
        "run_manifest": _manifest_summary(manifest),
        "run_inputs": _manifest_inputs(manifest),
        "run_dependencies": _manifest_dependencies(manifest),
        "effective_config": _manifest_config(manifest),
    }
    with pd.ExcelWriter(
        workbooks[0],
        engine="openpyxl",
        mode="a",
        if_sheet_exists="replace",
    ) as writer:
        for name, frame in sheets.items():
            if not frame.empty:
                frame.to_excel(writer, sheet_name=name[:31], index=False)
