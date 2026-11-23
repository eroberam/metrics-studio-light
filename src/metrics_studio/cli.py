"""Command line interface for metrics-studio.

Subcommands:
  run    Evaluate experiments and generate dashboards + reports.
  init   Print a commented YAML config template for a given task.

`run` accepts either a full config file (--config) or a quick shortcut
(--task/--data/--gt/--pred) that assembles a minimal config in memory, so a
casual user does not need to hand-write a YAML file to get started.
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import replace
from pathlib import Path

from metrics_studio._version import __version__
from metrics_studio.config import SUPPORTED_TASKS
from metrics_studio.templates import config_template, project_templates

def _config_from_shortcut(args: argparse.Namespace):
    from metrics_studio.config import config_from_dict

    if not args.data:
        raise ValueError("The shortcut form requires --data (CSV or JSON dataset).")
    source: dict = {"path": args.data}
    if args.model_name:
        source["model_name"] = args.model_name
    if args.gt:
        source["variable_gt"] = args.gt
    if args.pred:
        source["variable_pred"] = args.pred[0]
    raw = {
        "task_type": args.task,
        "output_root_dir": args.out,
        "input_sources": [source],
    }
    return config_from_dict(raw)


def _cmd_run(args: argparse.Namespace) -> int:
    from metrics_studio import load_config, run_evaluation

    if args.settings:
        if args.config:
            raise ValueError("Use --config or --settings/--data/--filter, not both.")
        if not args.data:
            raise ValueError("The split configuration form requires --settings and --data.")
        from metrics_studio import EvaluationReport

        report = EvaluationReport(
            settings=args.settings,
            data=args.data,
            filter=args.filter,
        )
        report.export(args.name)
        return 0
    if args.filter:
        raise ValueError("--filter requires --settings.")
    if args.config:
        config = load_config(Path(args.config))
    else:
        if not args.task:
            raise ValueError(
                "Provide --config <file>, or the shortcut --task <task> --data <file> "
                "--gt <col> --pred <col>."
            )
        config = _config_from_shortcut(args)
    if args.name:
        run_name = str(args.name).strip()
        if not run_name or Path(run_name).name != run_name or run_name in {".", ".."}:
            raise ValueError("--name must be a directory name, not a path.")
        config = replace(config, output_root_dir=config.output_root_dir / run_name)
    run_evaluation(config)
    return 0


def _cmd_init(args: argparse.Namespace) -> int:
    if args.output_dir:
        directory = Path(args.output_dir)
        if directory.exists() and any(directory.iterdir()) and not args.force:
            raise ValueError(f"{directory} is not empty. Use --force to overwrite project files.")
        directory.mkdir(parents=True, exist_ok=True)
        for name, text in project_templates(args.task).items():
            path = directory / name
            if path.exists() and not args.force:
                raise ValueError(f"{path} already exists. Use --force to overwrite.")
            path.write_text(text, encoding="utf-8")
            print(f"[ok] Wrote {path}")
        return 0
    text = config_template(args.task)
    if args.output:
        out = Path(args.output)
        if out.exists() and not args.force:
            raise ValueError(f"{out} already exists. Use --force to overwrite.")
        out.write_text(text, encoding="utf-8")
        print(f"[ok] Wrote config template to {out}")
    else:
        sys.stdout.write(text)
    return 0


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="metrics-studio",
        description="Generate HTML dashboards and Excel reports for Binary and Age Estimation.",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = parser.add_subparsers(dest="command")

    run = sub.add_parser("run", help="Evaluate experiments and generate dashboards + reports.")
    run.add_argument("--config", "-c", help="Path to a configuration file (.yaml or .json).")
    run.add_argument("--settings", help="Technical/output settings document.")
    run.add_argument("--filter", help="Evaluation/Statistics filter document.")
    run.add_argument("--name", help="Optional run directory below output_root_dir.")
    run.add_argument("--task", "-t", choices=SUPPORTED_TASKS, help="Task type (shortcut form, no YAML).")
    run.add_argument(
        "--data", "-d",
        help="Path to a CSV or JSON data file.",
    )
    run.add_argument("--gt", help="Ground-truth column name (shortcut form).")
    run.add_argument(
        "--pred",
        nargs="+",
        help="Prediction or score column.",
    )
    run.add_argument("--model-name", help="Display name for the model (shortcut form).")
    run.add_argument("--out", "-o", default="output", help="Output root directory. Default: output")
    run.set_defaults(func=_cmd_run)

    init = sub.add_parser("init", help="Print a commented YAML config template for a task.")
    init.add_argument("--task", "-t", default="binary", choices=SUPPORTED_TASKS, help="Task type. Default: binary")
    init.add_argument("--output", "-o", help="Write template to this file instead of stdout.")
    init.add_argument(
        "--output-dir",
        help="Create canonical settings.yaml, data.yaml and filter.yaml in this directory.",
    )
    init.add_argument("--force", action="store_true", help="Overwrite the output file if it exists.")
    init.set_defaults(func=_cmd_init)

    return parser


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    # Backward compatibility: `metrics-studio --config x.yaml` (no subcommand)
    # and the legacy `python run.py --config x.yaml` both default to `run`.
    if argv and argv[0].startswith("-") and argv[0] not in ("-h", "--help", "--version"):
        argv = ["run"] + argv

    parser = _build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        parser.print_help()
        return 0

    try:
        return args.func(args)
    except FileNotFoundError as e:
        print(f"[error] {e}", file=sys.stderr)
        return 2
    except (ValueError, ImportError) as e:
        print(f"[error] {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
