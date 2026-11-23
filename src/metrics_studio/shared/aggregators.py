"""Pure Python mirrors of the browser-side v2 aggregators."""
from __future__ import annotations

import math
from typing import Any, Mapping, Optional, Sequence


def _number(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return number if math.isfinite(number) else 0.0


def is_missing(value: Any, missing_tokens: Sequence[str] = ("UNKNOWN",)) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and not math.isfinite(value):
        return True
    if not isinstance(value, str):
        return False
    token = value.strip().upper()
    return (
        not token
        or token in {"NAN", "INFINITY", "+INFINITY", "-INFINITY", "INF", "+INF", "-INF"}
        or token in {str(item).strip().upper() for item in missing_tokens}
    )


def measurement_type(
    values: Sequence[Any],
    missing_tokens: Sequence[str] = ("UNKNOWN",),
) -> str:
    valid = [value for value in values if not is_missing(value, missing_tokens)]
    if not valid:
        return "categorical"
    try:
        numeric = all(
            not isinstance(value, bool) and math.isfinite(float(value))
            for value in valid
        )
    except (TypeError, ValueError):
        numeric = False
    if not numeric:
        return "categorical"
    unique = len({str(value) for value in valid})
    return (
        "continuous_numeric"
        if unique >= 10 and unique / len(valid) >= 0.01
        else "discrete_numeric"
    )


def group_key(row: Mapping[str, Any], variables: Sequence[str]) -> str:
    if not variables:
        return "All active samples"
    parts = []
    for variable in variables:
        value = row.get(variable)
        missing = is_missing(value)
        parts.append(f"{variable}={'UNKNOWN' if missing else value}")
    return ", ".join(parts)


def worst_case(
    rows: Sequence[Mapping[str, Any]],
    variables: Sequence[str],
    min_samples: int,
    kind: str,
    direction: str,
) -> Optional[dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = group_key(row, variables)
        group = groups.setdefault(
            key,
            {"key": key, "n": 0, "num": 0.0, "den": 0.0, "tp": 0.0, "fp": 0.0, "fn": 0.0},
        )
        group["n"] += 1
        group["num"] += _number(row.get("_worst_num"))
        group["den"] += _number(row.get("_worst_den"))
        group["tp"] += _number(row.get("_tp"))
        group["fp"] += _number(row.get("_fp"))
        group["fn"] += _number(row.get("_fn"))

    eligible = []
    for group in groups.values():
        denominator = (
            2 * group["tp"] + group["fp"] + group["fn"]
            if kind == "f1"
            else group["den"]
        )
        if group["n"] < min_samples or denominator <= 0:
            continue
        group["value"] = (
            2 * group["tp"] / denominator
            if kind == "f1"
            else group["num"] / denominator
        )
        eligible.append(group)
    reverse_value = direction != "higher"
    eligible.sort(
        key=lambda group: (
            -group["value"] if reverse_value else group["value"],
            -group["n"],
            group["key"],
        )
    )
    return eligible[0] if eligible else None
