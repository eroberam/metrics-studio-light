"""Shared bootstrap confidence-interval helper (spec §3.4).

Every task's metrics module builds its CIs through :func:`bootstrap_ci` so the
level, resample count, seed and resample unit all come from the YAML
``statistics.confidence_intervals`` block.
"""
from __future__ import annotations

import warnings
from typing import Callable, Dict, Mapping, Optional, Tuple

import numpy as np
from scipy.stats import DegenerateDataWarning
from scipy.stats import bootstrap as scipy_bootstrap

from metrics_studio.config import ConfidenceIntervalConfig

# Below this many samples a bootstrap CI is not reported (spec §13
# "Insufficient data"): the dashboard shows an objective message instead.
MIN_CI_SAMPLES = 20

StatFn = Callable[[np.ndarray], float]


def bootstrap_ci(
    n: int,
    stat_fns: Mapping[str, StatFn],
    ci: ConfidenceIntervalConfig,
    groups: Optional[np.ndarray] = None,
) -> Dict[str, Tuple[float, float]]:
    """Bootstrap CIs for statistics over indices ``0..n-1``.

    Each ``stat_fns[key]`` receives an index array into the original rows and
    returns the statistic for that resample. When ``groups`` is given (length
    ``n``), whole groups are resampled instead of individual rows — used when
    ``resample_unit`` is a record/document grouping (e.g. OCR fields grouped
    by document).

    Returns ``{}`` when CIs are disabled or there are too few samples/groups.
    """
    if not ci.enabled or not stat_fns:
        return {}
    n_units = n if groups is None else len(np.unique(groups))
    if n_units < MIN_CI_SAMPLES:
        return {}

    method = "percentile" if ci.method == "bootstrap" else ci.method
    if groups is not None:
        unique_groups = np.unique(groups)
        members: Dict[object, np.ndarray] = {
            g: np.flatnonzero(groups == g) for g in unique_groups
        }
        units = np.arange(len(unique_groups), dtype=int)
    else:
        units = np.arange(n, dtype=int)

    def row_indices(sampled_units: np.ndarray) -> np.ndarray:
        positions = np.asarray(sampled_units, dtype=int).reshape(-1)
        if groups is None:
            return positions
        return np.concatenate(
            [members[unique_groups[position]] for position in positions]
        )

    out: Dict[str, Tuple[float, float]] = {}
    for key, fn in stat_fns.items():
        def statistic(
            sampled_units: np.ndarray,
            statistic_fn: Callable[[np.ndarray], float] = fn,
        ) -> float:
            try:
                return float(statistic_fn(row_indices(sampled_units)))
            except Exception:
                return float("nan")

        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", DegenerateDataWarning)
                warnings.simplefilter("ignore", RuntimeWarning)
                result = scipy_bootstrap(
                    (units,),
                    statistic,
                    vectorized=False,
                    paired=False,
                    confidence_level=ci.level,
                    n_resamples=ci.n_resamples,
                    method=method,
                    random_state=np.random.RandomState(ci.seed),
                )
            low = float(result.confidence_interval.low)
            high = float(result.confidence_interval.high)
            out[key] = (low, high)
        except (ValueError, FloatingPointError):
            out[key] = (float("nan"), float("nan"))
    return out
