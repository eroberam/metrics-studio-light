from __future__ import annotations

from typing import Any, Iterable, Sequence

import pandas as pd

from metrics_studio.config import EvaluationConfig, FilterConfig, InputSourceConfig


def _is_missing(value: Any) -> bool:
    if value is None:
        return True
    try:
        return bool(pd.isna(value))
    except Exception:
        return False


def metadata_value(value: Any) -> str:
    if _is_missing(value) or str(value).strip() == "":
        return "UNKNOWN"
    return repair_mojibake(str(value))


def repair_mojibake(value: str) -> str:
    """Repair common UTF-8 text that was decoded as Latin-1/Windows-1252."""
    current = value
    for _ in range(3):
        if not any(marker in current for marker in ("Ã", "Â", "â", "�")):
            break
        try:
            candidate = current.encode("latin1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            break
        if candidate == current:
            break
        current = candidate
    return current


def task_filter_config(config: EvaluationConfig, task_type: str | None = None) -> FilterConfig:
    task = (task_type or config.task_type).lower().strip()
    if task == "binary":
        return config.binary
    if task == "age_estimation":
        return FilterConfig(
            auto_detect_filter_variables=config.age_estimation.auto_detect_filter_variables,
            filter_variables=config.age_estimation.filter_variables,
            exclude_filter_variables=config.age_estimation.exclude_filter_variables,
        )
    return FilterConfig()


def explicit_filter_variables(config: EvaluationConfig, task_type: str | None = None) -> set[str]:
    return {str(x) for x in (task_filter_config(config, task_type).filter_variables or ())}


def source_reserved_columns(source: InputSourceConfig) -> set[str]:
    reserved = {
        str(source.variable_gt or ""),
        str(source.variable_pred or ""),
        str(source.variable_path or ""),
        str(source.variable_record_id or ""),
    }

    reserved.discard("")
    return reserved


def metadata_filter_columns(
    df: pd.DataFrame,
    source: InputSourceConfig,
    config: EvaluationConfig,
    task_type: str | None = None,
    extra_excluded: Iterable[str] = (),
) -> list[str]:
    filter_config = task_filter_config(config, task_type)
    excluded = set(str(x) for x in (filter_config.exclude_filter_variables or ()))
    excluded.update(source_reserved_columns(source))
    excluded.update(str(x) for x in extra_excluded)

    columns: list[str] = []
    explicit = [str(x) for x in (filter_config.filter_variables or ()) if str(x) in df.columns]
    for col in explicit:
        if col not in columns:
            columns.append(col)

    if bool(filter_config.auto_detect_filter_variables):
        for col in df.columns:
            col_s = str(col)
            if col_s in excluded or col_s in columns:
                continue
            columns.append(col_s)

    return columns


def normalize_metadata_columns(df: pd.DataFrame, columns: Sequence[str]) -> pd.DataFrame:
    out = df.copy()
    for col in columns:
        if col in out.columns:
            out[col] = out[col].map(metadata_value)
    out.attrs["filter_columns"] = list(columns)
    return out
