"""Age estimation Excel report generation."""
from __future__ import annotations

from pathlib import Path
from typing import Sequence

import numpy as np
import pandas as pd

from metrics_studio.age_estimation_metrics import AgeEstimationArtifacts
from metrics_studio.config import EvaluationConfig


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out.replace([np.inf, -np.inf], np.nan, inplace=True)
    return out


def _concat_with_model(artifacts: Sequence[AgeEstimationArtifacts], attr: str) -> pd.DataFrame:
    frames = []
    for art in artifacts:
        df = getattr(art, attr, pd.DataFrame()).copy()
        if df.empty:
            continue
        df.insert(0, "model_name", art.model_name)
        frames.append(df)
    return _clean(pd.concat(frames, ignore_index=True)) if frames else pd.DataFrame()


def _summary_df(artifacts: Sequence[AgeEstimationArtifacts]) -> pd.DataFrame:
    rows = []
    for art in artifacts:
        gm = art.global_metrics
        row = {
            "model_name": art.model_name,
            "task_type": "age_estimation",
            "n_images": gm.get("n_samples", np.nan),
            "n_original": art.n_original,
            "n_ftp": art.n_ftp,
            "gt_age_mean": gm.get("y_true_mean", np.nan),
            "gt_age_std": gm.get("y_true_std", np.nan),
            "pred_age_mean": gm.get("y_pred_mean", np.nan),
            "mae": gm.get("mae", np.nan),
            "mdae": gm.get("mdae", np.nan),
            "rmse": gm.get("rmse", np.nan),
            "bias": gm.get("bias", np.nan),
            "sd": gm.get("sd", np.nan),
            "p90_ae": gm.get("p90_ae", np.nan),
            "p95_ae": gm.get("p95_ae", np.nan),
            "max_ae": gm.get("max_ae", np.nan),
        }
        for k, v in gm.items():
            if k.startswith("acc_at_"):
                row[k] = v
        rows.append(row)
    return _clean(pd.DataFrame(rows))


def save_age_estimation_reports(
    artifacts: Sequence[AgeEstimationArtifacts],
    reports_dir: Path,
    config: EvaluationConfig,
) -> None:
    reports_dir.mkdir(parents=True, exist_ok=True)
    keep = "report_age_estimation.xlsx"

    sheets = [
        ("summary",              _summary_df(artifacts)),
        ("compliance_accs",      _concat_with_model(artifacts, "compliance_df")),
        ("balanced_accuracy",    _concat_with_model(artifacts, "balanced_accuracy_df")),
        ("binary_sweep",         _concat_with_model(artifacts, "binary_sweep_df")),
        ("challenge_metrics",    _concat_with_model(artifacts, "challenge_df")),
        ("fpr_by_age",           _concat_with_model(artifacts, "fpr_by_age_df")),
        ("fpr_application",      _concat_with_model(artifacts, "fpr_application_df")),
        ("age_band_group",       _concat_with_model(artifacts, "age_band_group_df")),
        ("fairness_by_group",    _concat_with_model(artifacts, "fairness_df")),
        ("error_by_age_bin",     _concat_with_model(artifacts, "error_bins_true_df")),
        ("worst_predictions",    _concat_with_model(artifacts, "worst_predictions_df")),
    ]

    try:
        out_path = reports_dir / keep
        with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
            for sheet_name, df in sheets:
                if not df.empty:
                    _clean(df).to_excel(writer, sheet_name=sheet_name[:31], index=False)
    except ImportError as err:
        raise ImportError("pip install openpyxl") from err

    print(f"[reports] Age estimation report → {reports_dir / keep}")
