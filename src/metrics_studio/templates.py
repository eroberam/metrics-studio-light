"""Commented YAML config templates, one per task type.

Used by `metrics-studio init --task <task>` to give a new user a ready-to-edit
starting point instead of having to discover the schema by reading source code.
"""
from __future__ import annotations

_COMMON_HEADER = """\
# metrics-studio config for task_type: {task}
# Run with:  metrics-studio run --config this_file.yaml
task_type: {task}
strict_config: false              # true: reject unknown keys instead of warning
output_root_dir: output/{Task}
"""

_COMMON_FOOTER = """
# --- Common blocks (all tasks; every key optional) ---------------------------
ui:
  plotly_delivery: cdn             # cdn (small HTML) | inline (fully offline charts)
  decimals: 2                      # global display precision (0..6)
  allow_runtime_decimal_change: true
  # metric_decimals:               # per-kind overrides
  #   threshold: 4
  #   p_value: 4

statistics:
  confidence_intervals:
    enabled: true                  # 95% bootstrap CIs on summary metrics
    level: 0.95
    method: bootstrap
    n_resamples: 2000
    seed: 42
    display: secondary             # secondary | hidden
    resample_unit: sample          # sample | record (group resampling)

# case_study:                      # terminology profile (labels only, never math)
#   default: generic               # generic | clinical | presentation_attack_detection | biometric_verification
#   allow_runtime_change: true
"""

_BINARY_PROFILES = ""

_BINARY = _COMMON_HEADER + """
input_sources:
  - path: my_data/binary.json     # CSV or JSON (a list of objects)
    variable_gt: gt_label          # column with the ground-truth label
    variable_pred: pred_score      # column with the model score
    model_name: "Model A"
    experiment_id: model_a         # stable id (optional; defaults to a model_name slug)
    role: candidate                # candidate | baseline (at most one baseline)
  # Optional baseline experiment: candidates sharing the same file/gt show deltas vs it.
  # - path: my_data/binary.json
  #   variable_gt: gt_label
  #   variable_pred: pred_score_previous
  #   model_name: "Previous release"
  #   experiment_id: previous_release
  #   role: baseline

positive_if_higher_score: true     # true if a higher score means "positive"
positive_label: 1
negative_label: 0

# custom_threshold: 0.5            # optional fixed decision threshold
operational_reference_rates: [0.1, 0.01, 0.001]

threshold_grid:
  start: 0.00
  end: 1.00
  step: 0.05

binary:
  auto_detect_filter_variables: false
  filter_variables: []             # extra metadata columns to expose as filters
  exclude_filter_variables: []
""" + _COMMON_FOOTER

_AGE_ESTIMATION = _COMMON_HEADER + """
input_sources:
  - path: my_data/age_model_a.json
    variable_gt: real_age
    variable_pred: predicted_age
    model_name: "Model A"

age_estimation:
  thresholds: [18, 21, 25]                 # ACCS compliance thresholds
  accuracy_windows: [1, 3, 5]              # NIST Acc@N (years)
  challenge_thresholds: [16, 18, 21, 25, 28]
  challenge_min_age: 14
  fpr_targets: [0.10, 0.05, 0.01]
  fpr_application_ages: [16, 17, 18, 19, 20, 21, 22, 23, 24, 25]
  fpr_application_threshold: 18
  balanced_accuracy_far_target: 0.01
  worst_cases: 50
  auto_detect_filter_variables: true
  filter_variables: [gender, race]         # fairness subgroups
  exclude_filter_variables: [record_id, path, y_true, y_pred]
""" + _COMMON_FOOTER

_TEMPLATES = {
    "binary": _BINARY,
    "age_estimation": _AGE_ESTIMATION,
}


def config_template(task: str) -> str:
    task = task.lower().strip()
    if task not in _TEMPLATES:
        raise ValueError(f"Unknown task '{task}'. Choose one of: {', '.join(_TEMPLATES)}.")
    title = "".join(part.capitalize() for part in task.split("_"))
    binary_profiles = _BINARY_PROFILES if task == "binary" else ""
    rendered = _TEMPLATES[task].format(task=task, Task=title, binary_profiles=binary_profiles)
    return rendered


def project_templates(task: str) -> dict[str, str]:
    """Return the canonical settings/data/filter documents for a new project."""
    import yaml

    task = task.lower().strip()
    payload = yaml.safe_load(config_template(task))
    input_sources = payload.pop("input_sources")
    title = "".join(part.capitalize() for part in task.split("_"))
    payload["output_root_dir"] = f"../../output/{title}"

    engine = payload.get(task)
    filter_variables: list[str] = []
    auto_detect = True
    if isinstance(engine, dict):
        auto_detect = bool(engine.pop("auto_detect_filter_variables", True))
        filter_variables = list(engine.pop("filter_variables", []))
        engine.pop("exclude_filter_variables", None)

    settings = yaml.safe_dump(payload, sort_keys=False, allow_unicode=True)
    data = yaml.safe_dump({"input_sources": input_sources}, sort_keys=False, allow_unicode=True)
    filters = yaml.safe_dump(
        {
            "auto_detect_filter_variables": auto_detect,
            "to_include_evaluation": filter_variables,
            "to_include_audit": filter_variables,
        },
        sort_keys=False,
        allow_unicode=True,
    )
    return {"settings.yaml": settings, "data.yaml": data, "filter.yaml": filters}
