"""Adapters around the project's scientific reference libraries."""
from __future__ import annotations

from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd

from metrics_studio.config import ConfidenceIntervalConfig
from metrics_studio.shared.stats import bootstrap_ci


def validate_normalized_frame(
    frame: pd.DataFrame,
    *,
    task: str,
) -> pd.DataFrame:
    """Validate the task-neutral frame with a lazy Pandera contract."""

    import pandera.pandas as pa

    required = ("ground_truth", "prediction")
    missing = [column for column in required if column not in frame.columns]
    if missing:
        raise ValueError(
            f"Normalized {task} data is missing required columns: {missing}."
        )
    if frame.columns.duplicated().any():
        duplicated = frame.columns[frame.columns.duplicated()].tolist()
        raise ValueError(f"Normalized {task} data has duplicate columns: {duplicated}.")
    if frame.empty:
        raise ValueError(f"Normalized {task} data contains no evaluable rows.")

    schema = pa.DataFrameSchema(
        {
            column: pa.Column(nullable=True, required=True)
            for column in required
        },
        checks=pa.Check(lambda data: len(data) > 0, error="frame must contain rows"),
        strict=False,
        coerce=False,
        name=task,
    )
    try:
        return schema.validate(frame, lazy=True)
    except pa.errors.SchemaErrors as exc:
        failures = exc.failure_cases.head(12).to_dict(orient="records")
        raise ValueError(
            f"Normalized {task} data failed its scientific schema: {failures}"
        ) from exc


def fairlearn_group_audit(
    rows: pd.DataFrame,
    variables: Sequence[str],
    *,
    numerator: str = "_worst_num",
    denominator: str = "_worst_den",
    min_samples: int = 20,
    kind: str = "ratio",
    ci_config: ConfidenceIntervalConfig | None = None,
    resample_groups: Sequence[Any] | None = None,
) -> list[dict[str, Any]]:
    """Return neutral performance-by-group evidence via MetricFrame."""

    from fairlearn.metrics import MetricFrame

    if rows.empty or numerator not in rows or denominator not in rows:
        return []

    def ratio(y_true: np.ndarray, y_pred: np.ndarray) -> float:
        total = float(np.nansum(y_true))
        if total <= 0:
            return float("nan")
        value = float(np.nansum(y_pred) / total)
        if kind == "f1":
            return 2 * value
        if kind == "rmse":
            return float(np.sqrt(value))
        return value

    evidence: list[dict[str, Any]] = []
    den = pd.to_numeric(rows[denominator], errors="coerce").fillna(0).to_numpy()
    num = pd.to_numeric(rows[numerator], errors="coerce").fillna(0).to_numpy()
    clusters = (
        np.asarray(resample_groups)
        if resample_groups is not None else None
    )
    if clusters is not None and len(clusters) != len(rows):
        raise ValueError("resample_groups must align one-to-one with audit rows.")
    for variable in variables:
        if variable not in rows:
            continue
        groups = rows[variable].fillna("UNKNOWN").astype(str)
        counts = groups.value_counts(dropna=False)
        eligible = counts[counts >= min_samples]
        if eligible.empty:
            evidence.append({
                "variable": variable,
                "overall": ratio(den, num),
                "difference": None,
                "ratio": None,
                "groups": [],
            })
            continue
        mask = groups.isin(eligible.index)
        metric_frame = MetricFrame(
            metrics={"metric": ratio},
            y_true=den[mask],
            y_pred=num[mask],
            sensitive_features=groups[mask],
        )
        by_group = metric_frame.by_group["metric"]
        values = [
            {
                "group": str(group),
                "n": int(eligible.loc[group]),
                "value": float(value) if np.isfinite(value) else None,
                "ci": None,
            }
            for group, value in by_group.items()
        ]
        if ci_config is not None:
            for item in values:
                positions = np.flatnonzero(mask.to_numpy() & groups.eq(item["group"]).to_numpy())
                group_den = den[positions]
                group_num = num[positions]

                def group_statistic(
                    indices: np.ndarray,
                    denominators: np.ndarray = group_den,
                    numerators: np.ndarray = group_num,
                ) -> float:
                    return ratio(denominators[indices], numerators[indices])

                intervals = bootstrap_ci(
                    len(positions),
                    {"metric": group_statistic},
                    ci_config,
                    groups=clusters[positions] if clusters is not None else None,
                )
                interval = intervals.get("metric")
                if interval and np.isfinite(interval).all():
                    item["ci"] = [float(interval[0]), float(interval[1])]
        overall_value = float(metric_frame.overall["metric"])
        for item in values:
            item["difference"] = (
                item["value"] - overall_value if item["value"] is not None else None
            )
            item["ratio"] = (
                item["value"] / overall_value
                if item["value"] is not None and overall_value != 0 else None
            )
        finite = [item["value"] for item in values if item["value"] is not None]
        evidence.append({
            "variable": variable,
            "overall": overall_value,
            "difference": float(max(finite) - min(finite)) if finite else None,
            "ratio": (
                float(min(finite) / max(finite))
                if finite and max(finite) != 0 else None
            ),
            "groups": values,
        })
    return evidence
