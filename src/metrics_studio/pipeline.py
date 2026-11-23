"""Top-level pipeline: evaluate every model, write reports, render dashboard."""
from __future__ import annotations

import dataclasses
import io
import os
import tempfile
from contextlib import redirect_stdout
from pathlib import Path
from typing import Dict, Sequence

import pandas as pd

from metrics_studio.config import EvaluationConfig
from metrics_studio.report import ExportResult


def _resolve_baseline(config: EvaluationConfig) -> EvaluationConfig:
    """Map a ``role: baseline`` experiment onto the per-model baseline machinery.

    Reuse the baseline prediction column when a candidate shares its input file
    and ground-truth column. The baseline remains a separate experiment.
    """
    baseline = next((s for s in config.input_sources if s.role == "baseline"), None)
    if baseline is None:
        return config
    new_sources = []
    for src in config.input_sources:
        if src.role == "candidate" and src.path == baseline.path and src.variable_gt == baseline.variable_gt:
            if baseline.variable_pred and not src.variable_baseline_pred:
                src = dataclasses.replace(src, variable_baseline_pred=baseline.variable_pred)
        new_sources.append(src)
    return dataclasses.replace(config, input_sources=tuple(new_sources))


def _ensure_output_dirs(config: EvaluationConfig) -> Dict[str, Path]:
    root = config.output_root_dir
    html_dir = root / "html"
    reports_dir = root / "reports"
    html_dir.mkdir(parents=True, exist_ok=True)
    reports_dir.mkdir(parents=True, exist_ok=True)
    return {"html": html_dir, "reports": reports_dir}


def _validate_staged_outputs(root: Path) -> None:
    html = list((root / "html").glob("*.html"))
    reports = list((root / "reports").glob("*.xlsx"))
    if len(html) != 1 or len(reports) != 1:
        raise RuntimeError(
            "Generation did not produce exactly one HTML dashboard and one XLSX report "
            f"(html={len(html)}, reports={len(reports)})."
        )
    for path in (*html, *reports):
        if path.stat().st_size < 1000:
            raise RuntimeError(f"Generated output is unexpectedly small: {path}")
    html_mb = html[0].stat().st_size / (1024 * 1024)
    if html_mb > 20:
        print(
            f"[warn] Dashboard size is {html_mb:.1f} MB. Browser startup and filtering may be slow; "
            "consider reducing row-level data or splitting the evaluation."
        )


def _apply_output_names(root: Path, config: EvaluationConfig) -> None:
    """Rename staged artifacts according to the v2 output contract."""

    names = config.output_name_files.resolved(config.task_type)
    for directory, pattern, target_name in (
        ("html", "*.html", names.html),
        ("reports", "*.xlsx", names.xlsx),
    ):
        matches = list((root / directory).glob(pattern))
        if len(matches) != 1:
            raise RuntimeError(
                f"Expected one staged {pattern} artifact before naming, found {len(matches)}."
            )
        target = root / directory / target_name
        if matches[0] != target:
            matches[0].replace(target)


def _publish_staged_outputs(staged_root: Path, output_root: Path, backup_root: Path) -> None:
    """Publish a complete staged run while preserving unrelated output files.

    Existing generated files are moved to a temporary backup before replacement.
    If any replacement fails, every file already touched is restored.
    """
    files = sorted(path for path in staged_root.rglob("*") if path.is_file())
    records: list[tuple[Path, Path, Path]] = []
    try:
        for source in files:
            relative = source.relative_to(staged_root)
            destination = output_root / relative
            backup = backup_root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            backup.parent.mkdir(parents=True, exist_ok=True)
            records.append((source, destination, backup))
            if destination.exists():
                os.replace(destination, backup)
            os.replace(source, destination)
    except Exception:
        for _source, destination, backup in reversed(records):
            if destination.exists():
                destination.unlink()
            if backup.exists():
                destination.parent.mkdir(parents=True, exist_ok=True)
                os.replace(backup, destination)
        raise


def _print_binary_console_summary(artifacts: Sequence[object]) -> None:
    rows = []
    for art in artifacts:
        tr = {x.name: x for x in art.threshold_results}
        rows.append({
            "model": art.model_name,
            "n_samples": art.global_metrics["n_samples"],
            "ROC-AUC": round(art.global_metrics["roc_auc"], 4),
            "AvgPrec": round(art.global_metrics["average_precision"], 4),
            "EER_thr": round(tr["eer"].threshold_original, 4),
            "EER_FAR": round(tr["eer"].far, 4),
            "EER_FRR": round(tr["eer"].frr, 4),
            "F1max_F1": round(tr["f1_max"].f1_pos, 4),
            "Brier": round(art.global_metrics.get("brier_score", float("nan")), 4),
            "ECE": round(art.global_metrics.get("ece", float("nan")), 4),
        })
    print("\n=== BINARY GLOBAL SUMMARY ===")
    print(pd.DataFrame(rows).to_string(index=False))


def _run_binary(config: EvaluationConfig, dirs: Dict[str, Path]) -> Sequence[object]:
    from metrics_studio.binary_dashboard import save_dashboard
    from metrics_studio.binary_metrics import evaluate_one_model
    from metrics_studio.binary_reports import save_reports

    artifacts = [evaluate_one_model(src, config) for src in config.input_sources]
    save_reports(artifacts, dirs["reports"], config)
    dashboard_path = save_dashboard(artifacts, dirs["html"], config)
    _print_binary_console_summary(artifacts)
    print(f"\n[success] Output saved to: {config.output_root_dir}")
    print(f"Dashboard available at: file://{dashboard_path.absolute()}")
    return artifacts


def _print_age_estimation_console_summary(artifacts: Sequence[object]) -> None:
    rows = []
    for art in artifacts:
        gm = art.global_metrics
        row = {
            "model": art.model_name,
            "n_samples": gm.get("n_samples"),
            "MAE": round(gm.get("mae", float("nan")), 4),
            "RMSE": round(gm.get("rmse", float("nan")), 4),
            "Bias": round(gm.get("bias", float("nan")), 4),
            "MedianAE": round(gm.get("mdae", float("nan")), 4),
            "P90AE": round(gm.get("p90_ae", float("nan")), 4),
        }
        for k, v in gm.items():
            if k.startswith("acc_at_"):
                row[k] = round(float(v), 4)
        rows.append(row)
    print("\n=== AGE ESTIMATION GLOBAL SUMMARY ===")
    print(pd.DataFrame(rows).to_string(index=False))
    if artifacts:
        art = artifacts[0]
        if not art.compliance_df.empty:
            print("\n--- Compliance metrics (first model) ---")
            cols = ["threshold", "tpr", "fpr", "fnr", "n_true_adults", "n_true_minors"]
            print(art.compliance_df[[c for c in cols if c in art.compliance_df.columns]].to_string(index=False))


def _run_age_estimation(config: EvaluationConfig, dirs: Dict[str, Path]) -> Sequence[object]:
    from metrics_studio.age_estimation_dashboard import save_age_estimation_dashboard
    from metrics_studio.age_estimation_metrics import evaluate_one_age_estimation_model
    from metrics_studio.age_estimation_reports import save_age_estimation_reports

    artifacts = [evaluate_one_age_estimation_model(src, config) for src in config.input_sources]
    save_age_estimation_reports(artifacts, dirs["reports"], config)
    dashboard_path = save_age_estimation_dashboard(artifacts, dirs["html"], config)
    _print_age_estimation_console_summary(artifacts)
    print(f"\n[success] Output saved to: {config.output_root_dir}")
    print(f"Age estimation dashboard available at: file://{dashboard_path.absolute()}")
    return artifacts


def _dispatch(config: EvaluationConfig, dirs: Dict[str, Path]) -> Sequence[object]:
    if config.task_type == "age_estimation":
        return _run_age_estimation(config, dirs)
    return _run_binary(config, dirs)


def run_evaluation(config: EvaluationConfig) -> ExportResult:
    """Evaluate a configuration and publish a complete dashboard/report pair.

    Generation happens in a temporary sibling directory. Final output files are
    replaced only after both artifacts have been produced and sanity-checked.
    """
    config.validate()
    config = _resolve_baseline(config)
    output_root = config.output_root_dir.expanduser().resolve()
    output_root.parent.mkdir(parents=True, exist_ok=True)

    warnings: list[str] = []
    with tempfile.TemporaryDirectory(prefix=f".{output_root.name}.staging-", dir=output_root.parent) as tmp:
        temp_root = Path(tmp)
        staged_root = temp_root / "generated"
        staged_config = dataclasses.replace(config, output_root_dir=staged_root)
        from metrics_studio.shared.provenance import (
            attach_run_manifest,
            build_run_manifest,
        )

        attach_run_manifest(
            staged_config,
            build_run_manifest(staged_config, staged_config.task_type),
        )
        dirs = _ensure_output_dirs(staged_config)
        captured = io.StringIO()
        with redirect_stdout(captured):
            artifacts = _dispatch(staged_config, dirs)
            from metrics_studio.shared.xlsx_evidence import (
                append_scientific_evidence,
            )

            append_scientific_evidence(
                artifacts,
                dirs["reports"],
                staged_config,
            )
        _apply_output_names(staged_root, staged_config)
        names = staged_config.output_name_files.resolved(staged_config.task_type)
        _validate_staged_outputs(staged_root)
        _publish_staged_outputs(staged_root, output_root, temp_root / "backup")

        staged_path = str(staged_root.resolve())
        final_path = str(output_root)
        print(captured.getvalue().replace(staged_path, final_path), end="")
        for warning in warnings:
            print(f"[warn] {warning}")
    return ExportResult(
        root_dir=output_root,
        html_path=output_root / "html" / names.html,
        xlsx_path=output_root / "reports" / names.xlsx,
        warnings=tuple(warnings),
    )
