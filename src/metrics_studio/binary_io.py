"""Input loading and normalization."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from metrics_studio.config import EvaluationConfig, InputSourceConfig
from metrics_studio.filters import explicit_filter_variables, metadata_filter_columns, normalize_metadata_columns


def _load_dataframe(path: Path) -> pd.DataFrame:
    """Load a CSV or JSON-list file into a DataFrame."""
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(path)
    if suffix == ".json":
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, list):
            raise ValueError(f"JSON '{path}' must contain a list of objects.")
        return pd.DataFrame(payload)
    raise ValueError(f"Unsupported input format '{suffix}' in '{path}'.")


def _require_column(df: pd.DataFrame, column: str, path: Path, field_name: str) -> None:
    if column not in df.columns:
        available = ", ".join(map(str, df.columns))
        raise ValueError(
            f"Column '{column}' (declared as '{field_name}') not found in '{path}'. "
            f"Available columns: {available}"
        )


def load_and_normalize(source: InputSourceConfig, config: EvaluationConfig) -> pd.DataFrame:
    """Load a source file and return a normalized DataFrame with columns:
       record_id, path, label, score, plus any extra original columns.
    """
    path = source.path
    df = _load_dataframe(path)

    _require_column(df, source.variable_gt, path, "variable_gt")
    _require_column(df, source.variable_pred, path, "variable_pred")

    # Optional columns: silently demote to None if absent.
    path_col = source.variable_path if (source.variable_path in df.columns) else None
    rid_col = source.variable_record_id if (source.variable_record_id in df.columns) else None

    out = pd.DataFrame({
        "record_id": df[rid_col] if rid_col else np.arange(len(df), dtype=int),
        "path": df[path_col].astype(str) if path_col else [f"{path.stem}_{i}" for i in range(len(df))],
        "label": pd.to_numeric(df[source.variable_gt], errors="coerce"),
        "score": pd.to_numeric(df[source.variable_pred], errors="coerce"),
    })

    # Preserve any extra original columns the user may want for later joins.
    reserved = {source.variable_gt, source.variable_pred, path_col, rid_col} - {None}
    reserved -= explicit_filter_variables(config, "binary")
    for c in df.columns:
        if c not in reserved and c not in out.columns:
            out[c] = df[c].values

    before = len(out)
    out = out.dropna(subset=["label", "score"]).reset_index(drop=True)
    dropped = before - len(out)
    if dropped:
        print(f"[warn] '{path.name}': dropped {dropped} rows with non-numeric label/score.")

    out["label"] = out["label"].astype(int)

    _validate_labels(out, config, path)
    filter_columns = metadata_filter_columns(out, source, config, "binary")
    return normalize_metadata_columns(out, filter_columns)


def _validate_labels(df: pd.DataFrame, config: EvaluationConfig, path: Path) -> None:
    valid = {config.negative_label, config.positive_label}
    found = set(df["label"].unique().tolist())
    invalid = found - valid
    if invalid:
        raise ValueError(
            f"Invalid labels in '{path}': {sorted(invalid)}. Expected: {sorted(valid)}."
        )
    counts = df["label"].value_counts().to_dict()
    if counts.get(config.negative_label, 0) == 0 or counts.get(config.positive_label, 0) == 0:
        raise ValueError(f"'{path}' must contain both classes.")
