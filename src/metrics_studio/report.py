"""High-level v2 report API.

The public class intentionally delegates to the same validated configuration
and atomic pipeline as the legacy functional API.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Mapping, Optional, Union

from metrics_studio.config import (
    EvaluationConfig,
    _read_config_mapping,
    config_from_documents,
)

Document = Union[str, Path, Mapping[str, Any]]


@dataclass(frozen=True)
class ExportResult:
    root_dir: Path
    html_path: Path
    xlsx_path: Path
    warnings: tuple[str, ...] = ()


def _document(value: Document, label: str) -> tuple[dict[str, Any], Path]:
    if isinstance(value, Mapping):
        return dict(value), Path.cwd().resolve()
    path = Path(value).expanduser().resolve()
    if not path.exists():
        raise FileNotFoundError(f"{label} configuration not found: {path}")
    return _read_config_mapping(path), path.parent


class EvaluationReport:
    """Build any supported evaluation panel from three focused documents."""

    def __init__(
        self,
        *,
        data: Document,
        settings: Document,
        filter: Optional[Document] = None,
    ) -> None:
        settings_raw, settings_base = _document(settings, "settings")
        data_raw, data_base = _document(data, "data")
        if filter is None:
            filter_raw: dict[str, Any] = {}
        else:
            filter_raw, _filter_base = _document(filter, "filter")
        self._config = config_from_documents(
            settings_raw,
            data_raw,
            filter_raw,
            settings_base=settings_base,
            data_base=data_base,
        )

    @property
    def config(self) -> EvaluationConfig:
        return self._config

    def export(self, name: Optional[str] = None) -> ExportResult:
        """Generate HTML/XLSX and return their final paths.

        ``name`` is a single run-directory component, never a nested path.
        """

        root = self._config.output_root_dir
        if name is not None:
            run_name = str(name).strip()
            if (
                not run_name
                or run_name in {".", ".."}
                or Path(run_name).name != run_name
                or "/" in run_name
                or "\\" in run_name
            ):
                raise ValueError("export name must be a non-empty directory name, not a path.")
            root = root / run_name

        config = replace(self._config, output_root_dir=root)
        from metrics_studio.pipeline import run_evaluation

        return run_evaluation(config)
