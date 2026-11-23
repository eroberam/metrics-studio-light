"""Canonical run provenance shared by HTML and workbook exports."""
from __future__ import annotations

import dataclasses
import datetime as dt
import hashlib
import json
import platform
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any, Mapping

from metrics_studio._version import __version__
from metrics_studio.config import EvaluationConfig

MANIFEST_SCHEMA_VERSION = "1.0"
_MANIFEST_ATTRIBUTE = "_metrics_studio_run_manifest"
_CORE_DISTRIBUTIONS = (
    "numpy",
    "pandas",
    "scipy",
    "scikit-learn",
    "plotly",
    "PyYAML",
    "openpyxl",
    "pandera",
    "fairlearn",
)


def _canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _normalise_config_value(value: Any, *, field_name: str = "") -> Any:
    if dataclasses.is_dataclass(value):
        return {
            field.name: _normalise_config_value(
                getattr(value, field.name),
                field_name=field.name,
            )
            for field in dataclasses.fields(value)
            if not field.name.startswith("_") and field.name != "output_root_dir"
        }
    if isinstance(value, Path):
        # Publication and checkout locations are not part of scientific identity.
        return value.name
    if isinstance(value, Mapping):
        return {
            str(key): _normalise_config_value(value[key], field_name=str(key))
            for key in sorted(value, key=lambda item: str(item))
        }
    if isinstance(value, (tuple, list)):
        return [
            _normalise_config_value(item, field_name=field_name)
            for item in value
        ]
    if isinstance(value, set):
        return sorted(
            (_normalise_config_value(item, field_name=field_name) for item in value),
            key=lambda item: _canonical_json(item),
        )
    return value


def effective_config(config: EvaluationConfig) -> dict[str, Any]:
    """Return the normalized effective configuration used for scientific identity."""

    return _normalise_config_value(config)


def _file_sha256(path: Path, cache: dict[Path, str | None]) -> str | None:
    resolved = path.expanduser().resolve()
    if resolved in cache:
        return cache[resolved]
    try:
        digest = hashlib.sha256()
        with resolved.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        result: str | None = digest.hexdigest()
    except OSError:
        result = None
    cache[resolved] = result
    return result


def _file_metadata(path: Path, cache: dict[Path, str | None]) -> dict[str, Any]:
    resolved = path.expanduser().resolve()
    try:
        stat = resolved.stat()
        size_bytes: int | None = stat.st_size
        modified_at = (
            dt.datetime.fromtimestamp(stat.st_mtime, tz=dt.timezone.utc)
            .isoformat(timespec="seconds")
            .replace("+00:00", "Z")
        )
    except OSError:
        size_bytes = None
        modified_at = None
    return {
        "file_name": resolved.name,
        "size_bytes": size_bytes,
        "modified_at": modified_at,
        "sha256": _file_sha256(resolved, cache),
    }


def _declared_resources(
    manifest_path: Path,
    cache: dict[Path, str | None],
) -> list[dict[str, Any]]:
    if manifest_path.suffix.lower() != ".json":
        return []
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    if not isinstance(payload, Mapping):
        return []
    resources = payload.get("resources")
    tables = resources.get("tables") if isinstance(resources, Mapping) else None
    if not isinstance(tables, Mapping):
        tables = payload.get("tables")
    if not isinstance(tables, Mapping):
        return []

    records = []
    for name in sorted(tables):
        specification = tables[name]
        declared = (
            specification.get("path")
            if isinstance(specification, Mapping)
            else specification
        )
        if not isinstance(declared, str) or not declared.strip():
            continue
        path = Path(declared).expanduser()
        if not path.is_absolute():
            path = manifest_path.parent / path
        if not path.is_file():
            continue
        records.append({
            "name": str(name),
            **_file_metadata(path, cache),
        })
    return records


def _dependency_versions() -> dict[str, str]:
    resolved = {}
    for distribution in _CORE_DISTRIBUTIONS:
        try:
            resolved[distribution] = version(distribution)
        except PackageNotFoundError:
            continue
    return dict(sorted(resolved.items(), key=lambda item: item[0].lower()))


def build_run_manifest(
    config: EvaluationConfig,
    task: str,
    *,
    generated_at: str | None = None,
) -> dict[str, Any]:
    """Build a stable-identity, timestamped provenance manifest."""

    normalized = effective_config(config)
    config_sha256 = _sha256_bytes(_canonical_json(normalized).encode("utf-8"))
    cache: dict[Path, str | None] = {}
    inputs = []
    for source in config.input_sources:
        path = source.path.expanduser().resolve()
        inputs.append({
            "experiment_id": source.resolved_experiment_id,
            "role": source.role,
            **_file_metadata(path, cache),
            "resources": _declared_resources(path, cache),
        })

    dependencies = _dependency_versions()
    environment = {
        "python": platform.python_version(),
        "implementation": platform.python_implementation(),
        "system": platform.system(),
        "machine": platform.machine(),
    }
    identity = {
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "task": task,
        "package_version": __version__,
        "config_sha256": config_sha256,
        "inputs": [
            {
                "experiment_id": item["experiment_id"],
                "role": item["role"],
                "sha256": item["sha256"],
                "resources": [
                    {"name": resource["name"], "sha256": resource["sha256"]}
                    for resource in item["resources"]
                ],
            }
            for item in inputs
        ],
        "python": environment["python"],
        "implementation": environment["implementation"],
        "dependencies": dependencies,
    }
    identity_sha256 = _sha256_bytes(_canonical_json(identity).encode("utf-8"))
    if generated_at is None:
        generated_at = (
            dt.datetime.now(tz=dt.timezone.utc)
            .isoformat(timespec="seconds")
            .replace("+00:00", "Z")
        )
    return {
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "run_id": f"dmr-{identity_sha256[:24]}",
        "identity_sha256": identity_sha256,
        "task": task,
        "package_name": "metrics-studio-light",
        "package_version": __version__,
        "generated_at": generated_at,
        "plotly_delivery": config.ui.plotly_delivery,
        "config_sha256": config_sha256,
        "effective_config": normalized,
        "inputs": inputs,
        "environment": environment,
        "dependencies": dependencies,
    }


def attach_run_manifest(
    config: EvaluationConfig,
    manifest: Mapping[str, Any],
) -> None:
    """Attach one pipeline manifest without extending the public config schema."""

    setattr(config, _MANIFEST_ATTRIBUTE, dict(manifest))


def run_manifest(config: EvaluationConfig, task: str) -> dict[str, Any]:
    """Return the pipeline manifest, or build one for standalone rendering."""

    attached = getattr(config, _MANIFEST_ATTRIBUTE, None)
    if isinstance(attached, Mapping) and attached.get("task") == task:
        return dict(attached)
    return build_run_manifest(config, task)


__all__ = [
    "MANIFEST_SCHEMA_VERSION",
    "attach_run_manifest",
    "build_run_manifest",
    "effective_config",
    "run_manifest",
]
