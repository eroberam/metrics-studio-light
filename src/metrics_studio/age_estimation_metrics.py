"""Age estimation metric computation: regression + NIST accuracy + ACCS compliance + fairness."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, median_absolute_error

from metrics_studio.config import AgeEstimationConfig, EvaluationConfig, InputSourceConfig
from metrics_studio.filters import explicit_filter_variables, metadata_filter_columns, normalize_metadata_columns
from metrics_studio.shared.stats import bootstrap_ci

EPS = 1e-12


@dataclass
class AgeEstimationArtifacts:
    model_name: str
    df: pd.DataFrame
    y_true: np.ndarray
    y_pred: np.ndarray
    residuals: np.ndarray
    abs_error: np.ndarray
    n_original: int = 0              # records in source file (before NaN drop)
    n_ftp: int = 0                   # records dropped (no valid prediction)
    global_metrics: Dict[str, float] = field(default_factory=dict)
    # ACCS compliance: one row per threshold  →  tpr, fpr, fnr, counts
    compliance_df: pd.DataFrame = field(default_factory=pd.DataFrame)
    # Challenge subgroup metrics: one row per challenge threshold
    challenge_df: pd.DataFrame = field(default_factory=pd.DataFrame)
    # Per (challenge, actual_age): FPR for minors below each challenge threshold
    fpr_by_age_df: pd.DataFrame = field(default_factory=pd.DataFrame)
    # Per actual_age in fpr_application_ages: FPR using fpr_application_threshold
    fpr_application_df: pd.DataFrame = field(default_factory=pd.DataFrame)
    # Per (group_var, group, age_band): MAE, FTP
    age_band_group_df: pd.DataFrame = field(default_factory=pd.DataFrame)
    # Balanced Accuracy @ fixed FAR: threshold, far_target, operating_Y, actual_far, frr, ba
    balanced_accuracy_df: pd.DataFrame = field(default_factory=pd.DataFrame)
    # Binary sweep: for each (age_threshold, decision_Y) → TP/TN/FP/FN/accuracy/FAR/FRR/BA
    binary_sweep_df: pd.DataFrame = field(default_factory=pd.DataFrame)
    # Long-format demographic MAE: group_type, group, n, mae, rmse, bias
    fairness_df: pd.DataFrame = field(default_factory=pd.DataFrame)
    predictions_df: pd.DataFrame = field(default_factory=pd.DataFrame)
    error_bins_true_df: pd.DataFrame = field(default_factory=pd.DataFrame)
    worst_predictions_df: pd.DataFrame = field(default_factory=pd.DataFrame)
    # Bootstrap CIs as {metric: (lo, hi)} for mae/rmse/bias and each acc_at_N.
    ci: Dict[str, Tuple[float, float]] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------
def _load_raw(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(path)
    if suffix == ".json":
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, list):
            raise ValueError(f"JSON '{path}' must be a list of objects.")
        return pd.DataFrame(payload)
    raise ValueError(f"Unsupported format '{suffix}' in '{path}'.")


def _load_age_dataframe(
    source: InputSourceConfig,
    config: EvaluationConfig,
) -> Tuple[pd.DataFrame, int, int]:
    """Returns (df_clean, n_original, n_ftp)."""
    path = source.path
    df_raw = _load_raw(path)
    n_original = len(df_raw)

    if source.variable_pred is None:
        raise ValueError(f"'{source.display_name}' must define variable_pred.")
    for col, fname in [(source.variable_gt, "variable_gt"), (source.variable_pred, "variable_pred")]:
        if col not in df_raw.columns:
            raise ValueError(f"Column '{col}' (as '{fname}') not found in '{path}'. Available: {', '.join(map(str, df_raw.columns))}")

    path_col = source.variable_path if (source.variable_path and source.variable_path in df_raw.columns) else None
    rid_col = source.variable_record_id if (source.variable_record_id and source.variable_record_id in df_raw.columns) else None

    out = pd.DataFrame({
        "record_id": df_raw[rid_col] if rid_col else np.arange(n_original, dtype=int),
        "path": df_raw[path_col].astype(str) if path_col else [f"{path.stem}_{i}" for i in range(n_original)],
        "y_true": pd.to_numeric(df_raw[source.variable_gt], errors="coerce"),
        "y_pred": pd.to_numeric(df_raw[source.variable_pred], errors="coerce"),
    })

    reserved = {source.variable_gt, source.variable_pred, path_col, rid_col} - {None}
    reserved -= explicit_filter_variables(config, "age_estimation")
    for c in df_raw.columns:
        if c not in reserved and c not in out.columns:
            out[c] = df_raw[c].values

    before = len(out)
    out = out.dropna(subset=["y_true", "y_pred"]).reset_index(drop=True)
    n_ftp = before - len(out)
    if n_ftp:
        print(f"[warn] '{path.name}': {n_ftp} rows dropped (non-numeric y_true/y_pred).")
    if len(out) == 0:
        raise ValueError(f"'{path}' has no valid numeric rows.")

    filter_columns = metadata_filter_columns(out, source, config, "age_estimation")
    out = normalize_metadata_columns(out, filter_columns)
    return out, n_original, n_ftp


# ---------------------------------------------------------------------------
# General regression metrics
# ---------------------------------------------------------------------------
def _global_metrics(y_true: np.ndarray, y_pred: np.ndarray, accuracy_windows: Tuple[float, ...]) -> Dict[str, float]:
    residuals = y_pred - y_true
    abs_error = np.abs(residuals)
    metrics: Dict[str, float] = {
        "n_samples": int(len(y_true)),
        "y_true_mean": float(np.mean(y_true)),
        "y_true_std": float(np.std(y_true, ddof=1)) if len(y_true) > 1 else 0.0,
        "y_pred_mean": float(np.mean(y_pred)),
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "mdae": float(median_absolute_error(y_true, y_pred)),
        "rmse": float(np.sqrt(np.mean(residuals ** 2))),
        "bias": float(np.mean(residuals)),
        "sd": float(np.std(residuals, ddof=1)) if len(residuals) > 1 else 0.0,
        "p90_ae": float(np.percentile(abs_error, 90)),
        "p95_ae": float(np.percentile(abs_error, 95)),
        "max_ae": float(np.max(abs_error)),
    }
    for w in accuracy_windows:
        key = f"acc_at_{int(w)}" if float(w) == float(int(w)) else f"acc_at_{w}"
        metrics[key] = float(np.mean(abs_error <= w))
    return metrics


# ---------------------------------------------------------------------------
# ACCS compliance (TPR, FPR, FNR per threshold)
# ---------------------------------------------------------------------------
def _compliance_metrics(y_true: np.ndarray, y_pred: np.ndarray, thresholds: Tuple[int, ...]) -> pd.DataFrame:
    rows: List[Dict] = []
    for t in sorted(thresholds):
        adult = y_true >= t
        minor = ~adult
        pred_adult = y_pred >= t
        n_adults = int(np.sum(adult))
        n_minors = int(np.sum(minor))
        tp = int(np.sum(adult & pred_adult))
        fn = int(np.sum(adult & ~pred_adult))
        fp = int(np.sum(minor & pred_adult))
        tn = int(np.sum(minor & ~pred_adult))
        rows.append({
            "threshold": int(t),
            "n_true_adults": n_adults,
            "n_true_minors": n_minors,
            "tp": tp, "fp": fp, "tn": tn, "fn": fn,
            "tpr": tp / n_adults if n_adults > 0 else float("nan"),
            "fpr": fp / n_minors if n_minors > 0 else float("nan"),
            "fnr": fn / n_adults if n_adults > 0 else float("nan"),
        })
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Challenge subgroup metrics: MAE, MDAE, SD, N for minors under each threshold
# ---------------------------------------------------------------------------
def _challenge_metrics(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    challenge_thresholds: Tuple[int, ...],
    challenge_min_age: int,
) -> pd.DataFrame:
    """For each challenge threshold T, compute metrics on records with challenge_min_age <= gt < T."""
    rows: List[Dict] = []
    for t in sorted(challenge_thresholds):
        mask = (y_true >= challenge_min_age) & (y_true < t)
        yt = y_true[mask]
        yp = y_pred[mask]
        n = int(len(yt))
        if n == 0:
            rows.append({"challenge": int(t), "n_images": 0, "mae": float("nan"), "mdae": float("nan"), "sd": float("nan")})
            continue
        res = yp - yt
        ae = np.abs(res)
        rows.append({
            "challenge": int(t),
            "n_images": n,
            "mae": float(np.mean(ae)),
            "mdae": float(np.median(ae)),
            "sd": float(np.std(res, ddof=1)) if n > 1 else 0.0,
        })
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# FPR by actual age (per challenge threshold)
# ---------------------------------------------------------------------------
def _fpr_by_age(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    challenge_thresholds: Tuple[int, ...],
    challenge_min_age: int,
) -> pd.DataFrame:
    """For each (challenge, actual_age): FPR = P(pred >= challenge | gt == actual_age)."""
    rows: List[Dict] = []
    for t in sorted(challenge_thresholds):
        ages_below = np.arange(challenge_min_age, t)
        for age in ages_below:
            mask = np.floor(y_true).astype(int) == int(age)
            n = int(np.sum(mask))
            fpr = float(np.mean(y_pred[mask] >= t)) if n > 0 else float("nan")
            rows.append({"challenge": int(t), "actual_age": int(age), "n": n, "fpr": fpr})
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# FPR application table: per actual_age × fpr_application_threshold
# ---------------------------------------------------------------------------
def _fpr_application(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    fpr_application_ages: Tuple[int, ...],
    fpr_application_threshold: int,
) -> pd.DataFrame:
    """For each application age A: P(pred >= threshold | gt == A)."""
    rows: List[Dict] = []
    for age in fpr_application_ages:
        mask = np.floor(y_true).astype(int) == int(age)
        n = int(np.sum(mask))
        val = float(np.mean(y_pred[mask] >= fpr_application_threshold)) if n > 0 else float("nan")
        rows.append({
            "actual_age": int(age),
            "n": n,
            "fpr": val,
            "is_minor": int(age) < fpr_application_threshold,
        })
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Age band × group table
# ---------------------------------------------------------------------------
_AGE_BANDS = [
    ("< 18", 0, 17),
    ("18–30", 18, 30),
    ("31–50", 31, 50),
    ("51–80", 51, 80),
    ("> 80", 81, 999),
]


def _age_band_group(
    df: pd.DataFrame,
    filter_columns: List[str],
    n_ftp_total: int,
    n_original: int,
) -> pd.DataFrame:
    if not filter_columns or df.empty:
        return pd.DataFrame()

    y_true = df["y_true"].to_numpy(float)
    y_pred = df["y_pred"].to_numpy(float)
    residuals = y_pred - y_true
    abs_err = np.abs(residuals)

    df_work = df.copy()
    df_work["_ae"] = abs_err
    df_work["_res"] = residuals

    rows: List[Dict] = []
    for col in filter_columns:
        if col not in df_work.columns:
            continue
        for group_val in sorted(df_work[col].astype(str).unique()):
            g_mask = df_work[col].astype(str) == group_val
            g = df_work[g_mask]
            for band_name, band_min, band_max in _AGE_BANDS:
                b_mask = (g["y_true"] >= band_min) & (g["y_true"] <= band_max)
                b = g[b_mask]
                n = len(b)
                if n == 0:
                    continue
                # FTP = fraction of original records that had no prediction in this stratum.
                # We approximate as n_ftp / n_original (overall rate) when per-group FTP is unavailable.
                ftp_approx = n_ftp_total / n_original if n_original > 0 else 0.0
                rows.append({
                    "group_var": col,
                    "group": group_val,
                    "age_band": band_name,
                    "age_band_min": band_min,
                    "age_band_max": band_max,
                    "n": n,
                    "mae": float(b["_ae"].mean()),
                    "mdae": float(b["_ae"].median()),
                    "ftp": round(ftp_approx, 4),
                })
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Fairness (MAE by demographic group + intersections)
# ---------------------------------------------------------------------------
def _fairness_metrics(df: pd.DataFrame, filter_columns: List[str]) -> pd.DataFrame:
    if not filter_columns or df.empty:
        return pd.DataFrame()
    residuals = df["y_pred"].to_numpy(float) - df["y_true"].to_numpy(float)
    abs_err = np.abs(residuals)
    df_work = df.copy()
    df_work["_ae"] = abs_err
    df_work["_res"] = residuals
    rows: List[Dict] = []

    def _add(group_type: str, group: str, mask: pd.Series) -> None:
        g = df_work[mask]
        if len(g) < 3:
            return
        rows.append({
            "group_type": group_type, "group": group, "n_samples": len(g),
            "mae": float(g["_ae"].mean()),
            "rmse": float(np.sqrt((g["_res"] ** 2).mean())),
            "bias": float(g["_res"].mean()),
        })

    for col in filter_columns:
        if col not in df_work.columns:
            continue
        for val in sorted(df_work[col].astype(str).unique()):
            _add(col, str(val), df_work[col].astype(str) == val)

    if len(filter_columns) >= 2:
        c1, c2 = filter_columns[0], filter_columns[1]
        if c1 in df_work.columns and c2 in df_work.columns:
            ix = f"{c1} × {c2}"
            for (v1, v2), _ in df_work.groupby([c1, c2]):
                _add(ix, f"{v1} × {v2}", (df_work[c1] == v1) & (df_work[c2] == v2))
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Error bins by true age
# ---------------------------------------------------------------------------
def _error_bins(y_true: np.ndarray, y_pred: np.ndarray, bins: int = 10) -> pd.DataFrame:
    """Error metrics in 5-year age bands (bins parameter kept for API compat.)."""
    if len(y_true) == 0:
        return pd.DataFrame()
    residuals = y_pred - y_true
    abs_error = np.abs(residuals)

    start = (int(np.min(y_true)) // 5) * 5
    end   = ((int(np.max(y_true)) + 5) // 5) * 5

    result: List[Dict] = []
    for b in range(start, end, 5):
        mask = (y_true >= b) & (y_true < b + 5)
        n = int(np.sum(mask))
        if n == 0:
            continue
        ae  = abs_error[mask]
        res = residuals[mask]
        result.append({
            "bin":       f"{b}–{b+4}",
            "bin_min":   float(b),
            "bin_max":   float(b + 4),
            "n_samples": n,
            "mae":       float(np.mean(ae)),
            "rmse":      float(np.sqrt(np.mean(res ** 2))),
            "bias":      float(np.mean(res)),
            "p90_ae":    float(np.percentile(ae, 90)),
        })
    return pd.DataFrame(result)


# ---------------------------------------------------------------------------
# Balanced Accuracy @ fixed FAR
# ---------------------------------------------------------------------------
def _balanced_accuracy_metrics(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    thresholds: Tuple[int, ...],
    far_target: float,
) -> pd.DataFrame:
    """For each age threshold T, find operating decision Y* where FAR(Y*) <= far_target,
    then compute BA = 1 - (FAR + FRR) / 2."""
    rows: List[Dict] = []
    for T in sorted(thresholds):
        adult = y_true >= T
        minor = ~adult
        n_adults = int(np.sum(adult))
        n_minors = int(np.sum(minor))

        if n_adults == 0 or n_minors == 0:
            rows.append({"threshold": int(T), "far_target": far_target, "operating_Y": None,
                         "actual_far": float("nan"), "frr": float("nan"),
                         "balanced_accuracy": float("nan"),
                         "n_adults": n_adults, "n_minors": n_minors})
            continue

        minor_preds = y_pred[minor]
        adult_preds = y_pred[adult]
        Y_star = None

        for Y in range(1, 121):
            far_at_Y = float(np.mean(minor_preds >= Y))
            if far_at_Y <= far_target:
                frr = float(np.mean(adult_preds < Y))
                ba  = 1.0 - (far_at_Y + frr) / 2.0
                rows.append({"threshold": int(T), "far_target": far_target,
                              "operating_Y": int(Y), "actual_far": far_at_Y,
                              "frr": frr, "balanced_accuracy": ba,
                              "n_adults": n_adults, "n_minors": n_minors})
                Y_star = Y
                break

        if Y_star is None:
            rows.append({"threshold": int(T), "far_target": far_target, "operating_Y": None,
                         "actual_far": float("nan"), "frr": float("nan"),
                         "balanced_accuracy": float("nan"),
                         "n_adults": n_adults, "n_minors": n_minors})
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Binary sweep: sweep decision threshold Y for each age_threshold T
# ---------------------------------------------------------------------------
def _binary_sweep_metrics(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    thresholds: Tuple[int, ...],
) -> pd.DataFrame:
    """For each (age_threshold T, decision_Y), classify as adult if pred_age >= Y.
    Reports TP, TN, FP, FN, accuracy, FAR, FRR, BA for every integer Y from 1 to 100."""
    rows: List[Dict] = []
    max_Y = max(100, int(np.max(y_pred)) + 2)

    for T in sorted(thresholds):
        adult = y_true >= T
        minor = ~adult
        n_adults = int(np.sum(adult))
        n_minors = int(np.sum(minor))
        n = len(y_true)
        adult_preds = y_pred[adult]
        minor_preds = y_pred[minor]

        for Y in range(1, max_Y + 1):
            tp = int(np.sum(adult_preds >= Y))
            fn = n_adults - tp
            fp = int(np.sum(minor_preds >= Y))
            tn = n_minors - fp
            acc = (tp + tn) / n if n > 0 else float("nan")
            far = fp / n_minors if n_minors > 0 else float("nan")
            frr = fn / n_adults if n_adults > 0 else float("nan")
            ba  = 1.0 - (far + frr) / 2.0 if (np.isfinite(far) and np.isfinite(frr)) else float("nan")
            rows.append({
                "age_threshold": int(T),
                "decision_Y":    int(Y),
                "n_adults": n_adults,
                "n_minors": n_minors,
                "tp": tp, "tn": tn, "fp": fp, "fn": fn,
                "accuracy": acc,
                "far":      far,
                "frr":      frr,
                "balanced_accuracy": ba,
            })
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Main evaluator
# ---------------------------------------------------------------------------
def evaluate_one_age_estimation_model(source: InputSourceConfig, config: EvaluationConfig) -> AgeEstimationArtifacts:
    cfg: AgeEstimationConfig = config.age_estimation
    df, n_original, n_ftp = _load_age_dataframe(source, config)
    y_true = df["y_true"].to_numpy(dtype=float)
    y_pred = df["y_pred"].to_numpy(dtype=float)
    residuals = y_pred - y_true
    abs_error = np.abs(residuals)
    filter_columns: List[str] = list(df.attrs.get("filter_columns", []))

    predictions = df.copy()
    predictions["residual"] = residuals
    predictions["abs_error"] = abs_error
    predictions.attrs["filter_columns"] = filter_columns

    worst = predictions.sort_values("abs_error", ascending=False).head(cfg.worst_cases).reset_index(drop=True)

    return AgeEstimationArtifacts(
        model_name=source.display_name,
        df=df,
        y_true=y_true,
        y_pred=y_pred,
        residuals=residuals,
        abs_error=abs_error,
        n_original=n_original,
        n_ftp=n_ftp,
        global_metrics=_global_metrics(y_true, y_pred, cfg.accuracy_windows),
        compliance_df=_compliance_metrics(y_true, y_pred, cfg.thresholds),
        balanced_accuracy_df=_balanced_accuracy_metrics(y_true, y_pred, cfg.thresholds, cfg.balanced_accuracy_far_target),
        binary_sweep_df=_binary_sweep_metrics(y_true, y_pred, cfg.thresholds),
        challenge_df=_challenge_metrics(y_true, y_pred, cfg.challenge_thresholds, cfg.challenge_min_age),
        fpr_by_age_df=_fpr_by_age(y_true, y_pred, cfg.challenge_thresholds, cfg.challenge_min_age),
        fpr_application_df=_fpr_application(y_true, y_pred, cfg.fpr_application_ages, cfg.fpr_application_threshold),
        age_band_group_df=_age_band_group(df, filter_columns, n_ftp, n_original),
        fairness_df=_fairness_metrics(df, filter_columns),
        predictions_df=predictions,
        error_bins_true_df=_error_bins(y_true, y_pred, cfg.bins),
        worst_predictions_df=worst,
        ci=_bootstrap_ci(y_true, y_pred, cfg.accuracy_windows, config),
    )


def _bootstrap_ci(
    y_true: np.ndarray, y_pred: np.ndarray, accuracy_windows: Tuple[float, ...], config: EvaluationConfig
) -> Dict[str, Tuple[float, float]]:
    """Bootstrap CIs for MAE, RMSE, Bias and each Acc@N window."""
    residuals = y_pred - y_true
    abs_error = np.abs(residuals)

    stat_fns = {
        "mae": lambda idx: float(np.mean(abs_error[idx])),
        "rmse": lambda idx: float(np.sqrt(np.mean(residuals[idx] ** 2))),
        "bias": lambda idx: float(np.mean(residuals[idx])),
    }
    for w in accuracy_windows:
        key = f"acc_at_{int(w)}" if float(w) == float(int(w)) else f"acc_at_{w}"
        stat_fns[key] = (lambda idx, w=float(w): float(np.mean(abs_error[idx] <= w)))

    return bootstrap_ci(len(y_true), stat_fns, config.statistics.confidence_intervals)
