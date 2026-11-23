"""Build the task-neutral data island consumed by the v2 dashboard shell."""
from __future__ import annotations

import math
from pathlib import Path, PureWindowsPath
from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd

from metrics_studio.config import EvaluationConfig
from metrics_studio.filters import task_filter_config
from metrics_studio.methodology_registry import methodology_payload
from metrics_studio.metric_registry import (
    DEFAULT_WORST_CASE_METRICS,
    METRIC_ENGINE,
    METRIC_REGISTRY,
)
from metrics_studio.shared.aggregators import measurement_type
from metrics_studio.shared.scientific import validate_normalized_frame

_RESERVED = {
    "record_id", "path", "label", "score", "y_true", "y_pred", "absolute_error",
    "residual", "prediction", "ground_truth", "_worst_num", "_worst_den",
}

_TASK_TABLE_FIELDS = {
    "binary": ("threshold_grid_df",),
    "age_estimation": (
        "compliance_df", "challenge_df", "fpr_by_age_df",
        "fpr_application_df", "age_band_group_df", "balanced_accuracy_df",
        "fairness_df",
    ),
}

_TASK_WORST_METRICS = {
    "binary": (
        ("far", "ratio", "_wc_far_num", "_wc_far_den"),
        ("frr", "ratio", "_wc_frr_num", "_wc_frr_den"),
        ("accuracy", "ratio", "_wc_accuracy_num", "_wc_accuracy_den"),
    ),
    "age_estimation": (
        ("mae", "ratio", "_wc_mae_num", "_wc_mae_den"),
        ("rmse", "rmse", "_wc_rmse_num", "_wc_rmse_den"),
    ),
}


def _clean(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        return float(value) if math.isfinite(float(value)) else None
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if isinstance(value, (pd.Timestamp,)):
        return value.isoformat()
    if isinstance(value, Mapping):
        return {str(key): _clean(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, np.ndarray)):
        return [_clean(item) for item in value]
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return str(value) if not isinstance(value, (str, int)) else value


def _frame(artifact: object) -> pd.DataFrame:
    for name in ("df", "predictions_df"):
        value = getattr(artifact, name, None)
        if isinstance(value, pd.DataFrame) and not value.empty:
            return value.reset_index(drop=True).copy()
    return pd.DataFrame()


def _case_frame(artifact: object, fallback: pd.DataFrame) -> pd.DataFrame:
    for name in (
        "worst_predictions_df", "worst_cases_df", "problematic_df", "cases_df",
        "field_details_df", "predictions_df",
    ):
        value = getattr(artifact, name, None)
        if isinstance(value, pd.DataFrame) and not value.empty:
            return value.reset_index(drop=True).copy()
    return fallback


def _augment(frame: pd.DataFrame, artifact: object, config: EvaluationConfig) -> pd.DataFrame:
    task = config.task_type
    out = frame.copy()
    n = len(out)
    if task == "binary" and n:
        labels = np.asarray(getattr(artifact, "labels", out.get("label", [])))
        scores = np.asarray(getattr(artifact, "scores_original", out.get("score", [])))
        size = min(n, len(labels), len(scores))
        out = out.iloc[:size].copy()
        labels, scores = labels[:size], scores[:size]
        threshold = config.custom_threshold if config.custom_threshold is not None else 0.5
        predictions = scores >= threshold if config.positive_if_higher_score else scores <= threshold
        predicted_labels = np.where(
            predictions, config.positive_label, config.negative_label
        )
        out["ground_truth"] = labels.astype(int)
        out["prediction"] = predicted_labels.astype(int)
        negative = labels == config.negative_label
        positive = labels == config.positive_label
        # Preserve the mature binary panel convention: the positive class is
        # the attack/error class, so FAR/APCER is its false-negative rate.
        out["_worst_num"] = (positive & ~predictions).astype(float)
        out["_worst_den"] = positive.astype(float)
        out["_wc_far_num"] = out["_worst_num"]
        out["_wc_far_den"] = out["_worst_den"]
        out["_wc_frr_num"] = (negative & predictions).astype(float)
        out["_wc_frr_den"] = negative.astype(float)
        out["_wc_accuracy_num"] = (labels == predicted_labels).astype(float)
        out["_wc_accuracy_den"] = 1.0
    elif task == "age_estimation" and n:
        truth = np.asarray(getattr(artifact, "y_true", out.get("y_true", [])), dtype=float)
        pred = np.asarray(getattr(artifact, "y_pred", out.get("y_pred", [])), dtype=float)
        size = min(n, len(truth), len(pred))
        out = out.iloc[:size].copy()
        out["ground_truth"] = truth[:size]
        out["prediction"] = pred[:size]
        out["absolute_error"] = np.abs(pred[:size] - truth[:size])
        out["residual"] = pred[:size] - truth[:size]
        out["_worst_num"] = out["absolute_error"]
        out["_worst_den"] = 1.0
        out["_wc_mae_num"] = out["absolute_error"]
        out["_wc_mae_den"] = 1.0
        out["_wc_rmse_num"] = out["residual"] ** 2
        out["_wc_rmse_den"] = 1.0
    return out


def _error_frame(
    artifact: object,
    frame: pd.DataFrame,
    config: EvaluationConfig,
) -> pd.DataFrame:
    """Recover each mature task's original error-case ranking for Table."""

    task = config.task_type
    if task == "binary":
        out = frame.copy()
        scores = np.asarray(getattr(artifact, "scores_original", []), dtype=float)
        size = min(len(out), len(scores))
        out = out.iloc[:size].copy()
        out["score"] = scores[:size]
        threshold = config.custom_threshold if config.custom_threshold is not None else 0.5
        out["error_margin"] = np.abs(scores[:size] - threshold)
        if {"ground_truth", "prediction"}.issubset(out.columns):
            out = out[out["ground_truth"] != out["prediction"]]
        return out.sort_values("error_margin", ascending=False).reset_index(drop=True)
    return _case_frame(artifact, frame)


def _enrich_case_filters(
    cases: pd.DataFrame,
    frame: pd.DataFrame,
    filter_variables: Sequence[str],
) -> pd.DataFrame:
    """Attach global-filter metadata to ranked cases when their task table omits it."""

    if cases.empty or frame.empty:
        return cases
    missing = [
        name for name in filter_variables
        if name not in cases.columns and name in frame.columns
    ]
    if not missing:
        return cases
    join_key = next(
        (
            name
            for name in ("record_id", "sample_id", "image_id", "document_id", "field_id")
            if name in cases.columns and name in frame.columns
        ),
        None,
    )
    if join_key is None:
        return cases
    metadata = frame[[join_key, *missing]].drop_duplicates(join_key, keep="first")
    return cases.merge(metadata, on=join_key, how="left", validate="many_to_one")


def _other_tables(
    artifact: object,
    config: EvaluationConfig,
    source_path: Path,
) -> list[dict[str, Any]]:
    tables = []
    table_fields = _TASK_TABLE_FIELDS.get(config.task_type, ())
    for name in table_fields:
        frame = getattr(artifact, name, None)
        if not isinstance(frame, pd.DataFrame) or frame.empty:
            continue
        tables.append({
            "key": name.removesuffix("_df"),
            "name": name.removesuffix("_df").replace("_", " ").title(),
            "rows": _records(frame, 500, source_path),
            "total_rows": len(frame),
        })
    return tables


def _scalar_columns(frame: pd.DataFrame) -> list[str]:
    columns = []
    for column in frame.columns:
        series = frame[column].dropna()
        if series.empty:
            columns.append(str(column))
            continue
        sample = series.iloc[0]
        if not isinstance(sample, (dict, list, tuple, np.ndarray)):
            columns.append(str(column))
    return columns


def _detect_variables(
    frames: Sequence[pd.DataFrame], config: EvaluationConfig
) -> tuple[list[str], list[str], list[str]]:
    if not frames:
        return [], [], []
    common = set(_scalar_columns(frames[0]))
    for frame in frames[1:]:
        common.intersection_update(_scalar_columns(frame))
    common = {name for name in common if name not in _RESERVED and not name.startswith("_")}

    explicit_eval = list(config.filter_policy.to_include_evaluation)
    explicit_audit = list(config.filter_policy.to_include_audit)
    missing_eval = [name for name in explicit_eval if name not in common]
    missing_audit = [name for name in explicit_audit if name not in common]
    if missing_eval:
        raise ValueError(
            "Evaluation filter variables must exist in every input source; "
            f"missing from the common evaluated schema: {missing_eval}."
        )
    if missing_audit:
        raise ValueError(
            "Audit variables must exist in every input source; "
            f"missing from the common evaluated schema: {missing_audit}."
        )
    invalid_audit = [
        name for name in explicit_audit
        if any(
            measurement_type(frame[name].tolist()) == "continuous_numeric"
            for frame in frames
        )
    ]
    if invalid_audit:
        raise ValueError(
            "Audit variables must be categorical or discrete numeric; "
            f"continuous variables are not supported: {invalid_audit}."
        )

    if explicit_eval or config.filter_policy.evaluation_explicit:
        evaluation = explicit_eval
    else:
        legacy = list(task_filter_config(config).filter_variables)
        evaluation = [name for name in legacy if name in common]
        if not evaluation and config.filter_policy.auto_detect_filter_variables:
            for name in sorted(common):
                cardinalities = [frame[name].nunique(dropna=True) for frame in frames]
                if max(cardinalities, default=0) <= 30:
                    evaluation.append(name)

    # Statistics is independent of Evaluation filters, including explicit [].
    # A union preserves fields supplied by only one model; availability is
    # declared per model instead of manufacturing missing columns for others.
    statistics = sorted({
        name for frame in frames for name in _scalar_columns(frame)
        if not name.startswith("_")
    })
    return evaluation, statistics, explicit_audit


def _variable_role(name: str) -> str:
    normalized = name.lower()
    if normalized == "record_id" or normalized.endswith("_id"):
        return "identifier"
    if normalized in {"path", "image_path"} or normalized.endswith("_path"):
        return "path"
    if normalized in {
        "ground_truth", "y_true", "label", "gt", "gt_norm", "truth", "target",
        "target_age", "reference",
    } or normalized.startswith(("ground_truth_", "target_")):
        return "target"
    if normalized in {
        "prediction", "y_pred", "score", "pred", "pred_norm", "confidence",
        "probability", "predicted_label", "predicted_age",
    } or normalized.startswith(("prediction_", "predicted_", "score_", "probability_")):
        return "prediction"
    return "metadata"


def _schema_type(frames: Sequence[pd.DataFrame], name: str) -> str:
    series = [
        frame[name].dropna()
        for frame in frames
        if name in frame and not frame[name].dropna().empty
    ]
    if not series:
        return "unknown"
    if all(pd.api.types.is_bool_dtype(values) for values in series):
        return "boolean"
    if all(pd.api.types.is_numeric_dtype(values) for values in series):
        return "number"
    # Object columns can contain numeric strings or arbitrary identifiers.
    # Python's scalar parser safely rejects hashes with exponent-like prefixes;
    # pandas' native numeric coercion can crash on extremely large exponents.
    try:
        if all(math.isfinite(float(value)) for values in series for value in values):
            return "number"
    except (TypeError, ValueError, OverflowError):
        pass
    return "string"


def _statistics_schema(
    frames: Sequence[pd.DataFrame],
    config: EvaluationConfig,
) -> dict[str, Any]:
    union = {
        name
        for frame in frames
        for name in _scalar_columns(frame)
        if not name.startswith("_")
    }
    priorities = {"identifier": 0, "path": 1, "target": 2, "prediction": 3, "metadata": 4}
    variables = []
    for name in sorted(
        union,
        key=lambda item: (
            priorities[_variable_role(item)],
            item.lower(),
        ),
    ):
        variables.append({
            "key": name,
            "role": _variable_role(name),
            "schema_type": _schema_type(frames, name),
            "available_in": [
                source.resolved_experiment_id
                for source, frame in zip(
                    config.input_sources, frames, strict=True
                )
                if name in frame
            ],
        })
    return {
        "missing_tokens": ["UNKNOWN"],
        "variables": variables,
    }


def _table_image_url(path_value: str, source_path: Path) -> str | None:
    """Reference an accessible source file; never read, encode or copy its bytes."""

    if not path_value or path_value.lower().startswith(("data:", "blob:", "javascript:")):
        return None
    # Preserve native Windows / UNC references when a report is built in WSL.
    windows = PureWindowsPath(path_value)
    if windows.is_absolute() and not Path(path_value).is_absolute():
        return windows.as_uri()
    candidate = Path(path_value).expanduser()
    if not candidate.is_absolute():
        candidate = source_path.parent / candidate
    try:
        return candidate.resolve().as_uri() if candidate.is_file() else None
    except (OSError, ValueError):
        return None


def _records(
    frame: pd.DataFrame, limit: int, source_path: Path, *, previews: bool = True,
) -> list[dict[str, Any]]:
    if frame.empty:
        return []
    columns = _scalar_columns(frame)
    rows = []
    for record in frame.loc[:, columns].head(limit).to_dict(orient="records"):
        cleaned = {str(key): _clean(value) for key, value in record.items()}
        image_value = next(
            (cleaned.get(key) for key in ("path", "image_path") if cleaned.get(key)),
            None,
        )
        if previews and image_value:
            reference = _table_image_url(str(image_value), source_path)
            if reference:
                cleaned["_image"] = reference
        rows.append(cleaned)
    return rows


def _binary_samples(
    frame: pd.DataFrame,
    artifact: object,
    source_path: Path,
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """Complete scalar dataset with external source-image references.

    Stable row ordinals distinguish duplicate record IDs. Normalized truth comes
    from the evaluator, not the source's numeric label convention or predictions.
    """
    rows = _records(frame, len(frame), source_path)
    labels = np.asarray(getattr(artifact, "labels", []), dtype=int)
    names: dict[str, str] = {}
    for index, row in enumerate(rows):
        row["_sample_index"] = index
        row["_binary_label"] = int(labels[index])
    # A source-provided class name is safe only when it maps unambiguously to
    # one normalized truth label. Never use a stale source prediction name.
    for label in (0, 1):
        values = {
            str(row["true_label"]) for row in rows
            if row["_binary_label"] == label and row.get("true_label") is not None
        }
        if len(values) == 1:
            names[str(label)] = values.pop()
    if len(set(names.values())) < len(names):
        names = {}
    return rows, names


def _binary_cohort_records(
    frame: pd.DataFrame,
    dimensions: Sequence[str],
) -> list[dict[str, Any]]:
    """Return the complete, minimal binary evidence needed by the live risk engine."""

    columns = [
        column for column in ("ground_truth", "score", *dimensions)
        if column in frame.columns
    ]
    if frame.empty or not {"ground_truth", "score"}.issubset(columns):
        return []
    return [
        {str(key): _clean(value) for key, value in record.items()}
        for record in frame.loc[:, columns].to_dict(orient="records")
    ]


def _metric_values(artifact: object, task: str) -> dict[str, Any]:
    """Adapt each mature task result to stable registry identifiers."""

    values = dict(getattr(artifact, "global_metrics", {}) or {})
    if task == "binary":
        values["far"] = getattr(artifact, "eer_far", None)
        values["frr"] = getattr(artifact, "eer_frr", None)
        operating = getattr(artifact, "threshold_results", ()) or ()
        if operating:
            reference = operating[0]
            for key in (
                "accuracy", "balanced_accuracy", "mcc", "cohen_kappa",
            ):
                values[key] = getattr(reference, key, None)
    return values


def build_v2_payload(
    artifacts: Sequence[object],
    config: EvaluationConfig,
) -> dict[str, Any]:
    task = config.task_type
    frames = [_augment(_frame(artifact), artifact, config) for artifact in artifacts]
    for frame in frames:
        validate_normalized_frame(frame, task=task)
    evaluation_vars, statistics_vars, _ = _detect_variables(frames, config)
    default_worst = DEFAULT_WORST_CASE_METRICS[task]
    worst_metric = config.worst_case.metric or default_worst
    definition = METRIC_REGISTRY.resolve(worst_metric)
    if task not in definition.tasks:
        raise ValueError(
            f"worst_case.metric='{worst_metric}' is not compatible with task_type='{task}'."
        )

    experiments = []
    for index, (artifact, frame) in enumerate(
        zip(artifacts, frames, strict=True)
    ):
        source = config.input_sources[index]
        global_metrics = _metric_values(artifact, task)
        ci = getattr(artifact, "ci", {}) or {}
        n = int(global_metrics.get("n_samples", len(frame)) or len(frame))
        metric_results = METRIC_ENGINE.collect(task, global_metrics, ci=ci, n=n)
        errors = _error_frame(artifact, frame, config)
        errors = _enrich_case_filters(errors, frame, evaluation_vars)
        experiment_payload = {
            "id": source.resolved_experiment_id,
            "name": source.display_name,
            "role": source.role,
            "metrics": [
                {
                    "key": result.key,
                    "value": _clean(result.value),
                    "ci": (list(result.ci) if result.ci and all(
                        value is not None and math.isfinite(float(value))
                        for value in result.ci
                    ) else None),
                    "n": result.n,
                }
                for result in metric_results
            ],
            "rows": [] if task == "binary" else _records(frame, len(frame), source.path),
            "cases": _records(errors, 500, source.path, previews=task != "binary"),
            "tables": _other_tables(artifact, config, source.path),
        }
        if task == "binary":
            experiment_payload["rows"], experiment_payload["sample_class_names"] = _binary_samples(
                frame, artifact, source.path,
            )
            experiment_payload["cohort_rows"] = _binary_cohort_records(
                frame,
                evaluation_vars,
            )
        experiments.append(experiment_payload)

    worst_metrics = [
        {
            "key": key,
            "kind": kind,
            "numerator": numerator,
            "denominator": denominator,
        }
        for key, kind, numerator, denominator
        in _TASK_WORST_METRICS.get(task, ())
    ]
    if worst_metric not in {item["key"] for item in worst_metrics}:
        worst_metrics.insert(0, {
            "key": worst_metric,
            "kind": "ratio",
            "numerator": "_worst_num",
            "denominator": "_worst_den",
        })
    if task == "binary":
        worst_metrics = [
            {"key": key, "kind": "dynamic", "numerator": None, "denominator": None}
            for key in (
                "far", "frr", "accuracy", "precision", "recall", "f1",
                "tar", "error_rate",
            )
        ]

    return {
        "task": task,
        "max_active_models": min(
            len(experiments), config.ui.comparison.max_active or len(experiments)
        ),
        "panel_mode": None,
        "filter_variables": evaluation_vars,
        "statistics_variables": statistics_vars,
        "group_audit_min_samples": config.statistics.group_audit_min_samples,
        "statistics_schema": _statistics_schema(frames, config),
        "metric_definitions": METRIC_REGISTRY.payload(task),
        "methodology_definitions": methodology_payload(task),
        "worst_case": {
            "enabled": config.worst_case.enabled,
            "metric": worst_metric,
            "min_samples": config.worst_case.min_samples,
            "kind": "ratio",
            "available_metrics": worst_metrics,
            "dimensions": evaluation_vars[:5],
            "dynamic_intersections": task == "binary",
            "decision_threshold": (
                config.custom_threshold
                if config.custom_threshold is not None else 0.5
            ),
            "positive_label": config.positive_label,
            "negative_label": config.negative_label,
            "positive_if_higher_score": config.positive_if_higher_score,
            "minimum_error_events": 3,
            "redundancy_tolerance": 0.01,
        },
        "experiments": experiments,
    }
