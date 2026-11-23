from __future__ import annotations

import json
import re
import warnings
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Dict, Mapping, Optional, Tuple

SUPPORTED_TASKS = ("binary", "age_estimation")

_INPUT_SOURCE_KEYS = {
    "path", "variable_gt", "variable_pred", "experiment_id", "role", "model_name",
    "variable_path", "variable_record_id", "variable_baseline_pred",
}


def _check_unknown_keys(
    raw: Mapping[str, Any], known: set[str], context: str, *, strict: bool = False
) -> None:
    unknown = sorted(set(raw) - known)
    if not unknown:
        return
    message = f"Unknown config keys in {context} ignored: {unknown}"
    if strict:
        raise ValueError(message.replace(" ignored", ""))
    print(f"[warn] {message}")


def _slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", str(text).lower()).strip("_")
    return slug or "experiment"


@dataclass(frozen=True)
class InputSourceConfig:
    path: Path
    variable_gt: str = ""
    variable_pred: Optional[str] = None

    # Experiment identity (spec §3.6): stable id independent of the display name,
    # and a role within the comparison. At most one source may be the baseline.
    experiment_id: Optional[str] = None
    role: str = "candidate"  # candidate | baseline

    model_name: Optional[str] = None
    variable_path: Optional[str] = "path"
    variable_record_id: Optional[str] = None

    # Optional column with a baseline model's predictions. When set,
    # the dashboard shows each metric's improvement vs this baseline.
    variable_baseline_pred: Optional[str] = None

    @classmethod
    def from_dict(cls, payload: Dict[str, Any], *, strict: bool = False) -> "InputSourceConfig":
        _check_unknown_keys(payload, _INPUT_SOURCE_KEYS, "input_sources[]", strict=strict)
        required = {"path"}
        missing = sorted(required.difference(payload))
        if missing:
            raise ValueError(f"Missing required keys in input source: {missing}")

        role = str(payload.get("role", "candidate")).lower().strip()
        if role not in {"candidate", "baseline"}:
            raise ValueError(f"Input source role must be 'candidate' or 'baseline', got '{role}'.")

        return cls(
            path=Path(payload["path"]),
            experiment_id=str(payload["experiment_id"]) if payload.get("experiment_id") is not None else None,
            role=role,
            variable_gt=str(payload["variable_gt"]) if payload.get("variable_gt") is not None else "",
            variable_pred=str(payload["variable_pred"]) if payload.get("variable_pred") is not None else None,
            model_name=payload.get("model_name"),
            variable_path=payload.get("variable_path", "path"),
            variable_record_id=payload.get("variable_record_id"),
            variable_baseline_pred=(
                str(payload["variable_baseline_pred"])
                if payload.get("variable_baseline_pred") is not None else None
            ),
        )

    @property
    def display_name(self) -> str:
        return self.model_name or self.path.stem

    @property
    def resolved_experiment_id(self) -> str:
        return self.experiment_id or _slug(self.display_name)


@dataclass(frozen=True)
class ComparisonConfig:
    """Selection and readable layout, independent of the number of loaded models."""

    initial_active: int | str = 5
    max_active: Optional[int] = 5
    layout: str = "fixed"
    # Accepted only to load configurations written before the fixed desktop UI.
    max_columns: Optional[int] = None
    min_panel_width: Optional[int] = None

    def __post_init__(self) -> None:
        self.validate()
        if self.layout != "fixed" or self.max_columns is not None or self.min_panel_width is not None:
            warnings.warn(
                "Adaptive ui.comparison options are deprecated; using the fixed desktop layout.",
                FutureWarning, stacklevel=2,
            )
        if (type(self.initial_active) is int and self.initial_active > 5) or (
            self.max_active is not None and self.max_active > 5
        ):
            warnings.warn("ui.comparison supports at most five active models; limiting selection to five.", FutureWarning, stacklevel=2)
        object.__setattr__(self, "layout", "fixed")
        object.__setattr__(self, "max_active", min(5, self.max_active or 5))
        if type(self.initial_active) is int:
            object.__setattr__(self, "initial_active", min(self.initial_active, self.max_active))
        object.__setattr__(self, "max_columns", None)
        object.__setattr__(self, "min_panel_width", None)

    def validate(self) -> None:
        if self.initial_active != "all" and (
            type(self.initial_active) is not int or self.initial_active < 1
        ):
            raise ValueError("ui.comparison.initial_active must be a positive integer or 'all'.")
        if self.max_active is not None and (
            type(self.max_active) is not int or self.max_active < 1
        ):
            raise ValueError("ui.comparison.max_active must be null or a positive integer.")
        if self.layout not in {"fixed", "auto", "stacked"}:
            raise ValueError("ui.comparison.layout must be 'fixed'.")
        if self.max_columns is not None and (type(self.max_columns) is not int or self.max_columns not in {1, 2}):
            raise ValueError("ui.comparison.max_columns must be 1 or 2.")
        if self.min_panel_width is not None and (type(self.min_panel_width) is not int or self.min_panel_width < 320):
            raise ValueError("ui.comparison.min_panel_width must be an integer >= 320.")


@dataclass(frozen=True)
class UiConfig:
    """Global UI preferences (spec §3.1–3.5)."""
    language: str = "en"    # en | es
    decimals: int = 2
    decimals_min: int = 0
    decimals_max: int = 6
    allow_runtime_decimal_change: bool = True
    plotly_delivery: str = "cdn"  # cdn | inline
    # Per-kind overrides, e.g. {"threshold": 4, "p_value": 4, "count": 0}.
    metric_decimals: Dict[str, int] = field(default_factory=dict)
    comparison: ComparisonConfig = field(default_factory=ComparisonConfig)

    def validate(self) -> None:
        self.comparison.validate()
        if self.language not in {"en", "es"}:
            raise ValueError("ui.language must be 'en' or 'es'.")
        if self.plotly_delivery not in {"cdn", "inline"}:
            raise ValueError("ui.plotly_delivery must be 'cdn' or 'inline'.")
        if not (0 <= self.decimals_min <= self.decimals <= self.decimals_max <= 6):
            raise ValueError(
                "ui decimals must satisfy 0 <= decimals_min <= decimals <= decimals_max <= 6 "
                f"(got min={self.decimals_min}, decimals={self.decimals}, max={self.decimals_max})."
            )
        for key, value in self.metric_decimals.items():
            if not (0 <= int(value) <= 6):
                raise ValueError(f"ui.metric_decimals['{key}'] must be between 0 and 6.")


@dataclass(frozen=True)
class ConfidenceIntervalConfig:
    """Bootstrap confidence intervals for summary metrics (spec §3.4)."""
    enabled: bool = True
    level: float = 0.95
    method: str = "bca"
    n_resamples: int = 2000
    seed: int = 42
    display: str = "secondary"
    # sample | record | subject | <grouping column>. Non-"sample" units resample
    # whole groups (e.g. OCR fields grouped by document).
    resample_unit: str = "sample"

    def validate(self) -> None:
        if not (0.0 < self.level < 1.0):
            raise ValueError("statistics.confidence_intervals.level must be between 0 and 1.")
        if self.method not in {"bootstrap", "bca", "percentile"}:
            raise ValueError(
                "statistics.confidence_intervals.method must be 'bca' or 'percentile' "
                "('bootstrap' remains a legacy alias for 'percentile')."
            )
        if self.n_resamples < 50:
            raise ValueError("statistics.confidence_intervals.n_resamples must be >= 50.")
        if self.display not in {"secondary", "hidden"}:
            raise ValueError("statistics.confidence_intervals.display must be 'secondary' or 'hidden'.")


@dataclass(frozen=True)
class StatisticsConfig:
    confidence_intervals: ConfidenceIntervalConfig = field(default_factory=ConfidenceIntervalConfig)
    group_audit_min_samples: int = 20

    def validate(self) -> None:
        self.confidence_intervals.validate()
        if self.group_audit_min_samples < 1:
            raise ValueError("statistics.group_audit_min_samples must be >= 1.")


@dataclass(frozen=True)
class OutputNamesConfig:
    """Names of the artifacts published by the evaluation pipeline."""

    html: str = ""
    xlsx: str = ""

    def resolved(self, task_type: str) -> "OutputNamesConfig":
        task = task_type.lower().strip()
        return OutputNamesConfig(
            html=self.html or f"dashboard_{task}.html",
            xlsx=self.xlsx or f"report_{task}.xlsx",
        )

    def validate(self, task_type: str) -> None:
        names = self.resolved(task_type)
        for kind, value, suffix in (
            ("html", names.html, ".html"),
            ("xlsx", names.xlsx, ".xlsx"),
        ):
            path = Path(value)
            if path.name != value or value in {"", ".", ".."}:
                raise ValueError(f"output_name_files.{kind} must be a file name, not a path.")
            if path.suffix.lower() != suffix:
                raise ValueError(f"output_name_files.{kind} must end with '{suffix}'.")


@dataclass(frozen=True)
class FilterPolicyConfig:
    """Evaluation filters and cohort dimensions. Statistics discovers its schema."""

    auto_detect_filter_variables: bool = True
    to_include_evaluation: Tuple[str, ...] = ()
    to_include_audit: Tuple[str, ...] = ()
    evaluation_explicit: bool = False


@dataclass(frozen=True)
class WorstCaseConfig:
    enabled: bool = True
    metric: Optional[str] = None
    min_samples: int = 20

    def validate(self) -> None:
        if self.min_samples < 1:
            raise ValueError("worst_case.min_samples must be >= 1.")
        if self.metric is not None and not str(self.metric).strip():
            raise ValueError("worst_case.metric cannot be empty.")


# Built-in case-study terminology profiles (spec §3.7). Aliases only rename
# labels — internal metric keys and formulas never change.
CASE_STUDY_PROFILES: Tuple[str, ...] = (
    "generic", "clinical", "presentation_attack_detection", "biometric_verification",
)
# Legacy field-of-study ids kept for backward compatibility with dm-domain.
LEGACY_CASE_STUDY_PROFILES: Tuple[str, ...] = ("general", "security", "biometrics", "ir")
# Semantic class-role names with a fixed polarity, used to guard against
# APCER/BPCER or Sensitivity/Specificity inversions.
_POSITIVE_ROLES = {"attack", "condition_positive", "positive", "impostor"}
_NEGATIVE_ROLES = {"bona_fide", "negative", "genuine"}


@dataclass(frozen=True)
class CaseStudyConfig:
    default: str = "generic"
    # Empty => task-appropriate built-in list resolved by effective_selectable().
    selectable: Tuple[str, ...] = ()
    allow_runtime_change: bool = True
    # Semantic class roles -> dataset labels, e.g. {"bona_fide": 0, "attack": 1}.
    class_roles: Dict[str, int] = field(default_factory=dict)
    # {"id": ..., "labels": {metric_key: {"en": ..., "es": ...}}}
    custom_profile: Optional[Dict[str, Any]] = None

    def effective_selectable(self, task_type: str) -> Tuple[str, ...]:
        if self.selectable:
            profiles = self.selectable
        else:
            profiles = CASE_STUDY_PROFILES
        if self.custom_profile and self.custom_profile.get("id"):
            custom_id = str(self.custom_profile["id"])
            if custom_id not in profiles:
                profiles = tuple(profiles) + (custom_id,)
        return tuple(profiles)

    def validate(self, task_type: str, positive_label: int, negative_label: int) -> None:
        known = set(CASE_STUDY_PROFILES) | set(LEGACY_CASE_STUDY_PROFILES)
        if self.custom_profile is not None:
            if not isinstance(self.custom_profile, Mapping) or not self.custom_profile.get("id"):
                raise ValueError("case_study.custom_profile must be a mapping with an 'id' key.")
            labels = self.custom_profile.get("labels")
            if labels is not None and not isinstance(labels, Mapping):
                raise ValueError("case_study.custom_profile.labels must be a mapping {metric_key: {en, es}}.")
            known.add(str(self.custom_profile["id"]))
        selectable = self.effective_selectable(task_type)
        for profile in selectable:
            if profile not in known:
                raise ValueError(f"Unknown case_study profile '{profile}'. Known: {sorted(known)}.")
        if self.default not in selectable:
            raise ValueError(f"case_study.default='{self.default}' is not in the selectable profiles {list(selectable)}.")
        if self.class_roles:
            valid_labels = {positive_label, negative_label}
            for role, label in self.class_roles.items():
                if int(label) not in valid_labels:
                    raise ValueError(
                        f"case_study.class_roles['{role}']={label} does not match "
                        f"positive_label={positive_label} / negative_label={negative_label}."
                    )
                if role in _POSITIVE_ROLES and int(label) != positive_label:
                    raise ValueError(
                        f"case_study.class_roles['{role}'] must map to positive_label={positive_label}; "
                        "otherwise domain metrics (APCER/BPCER, Sensitivity/Specificity) would be inverted."
                    )
                if role in _NEGATIVE_ROLES and int(label) != negative_label:
                    raise ValueError(
                        f"case_study.class_roles['{role}'] must map to negative_label={negative_label}; "
                        "otherwise domain metrics (APCER/BPCER, Sensitivity/Specificity) would be inverted."
                    )


@dataclass(frozen=True)
class TitlesConfig:
    dashboard: str = "Binary Model Calibration Panel"
    roc: str = "ROC Curve"
    det: str = "DET Curve"
    pr: str = "Precision-Recall Curve"
    sweep: str = "FAR and FRR vs Threshold"
    dist: str = "Score Distribution"


@dataclass(frozen=True)
class AxisLabels:
    roc_x: str = "False Positive Rate (FPR)"
    roc_y: str = "True Positive Rate (TPR)"
    det_x: str = "FAR"
    det_y: str = "FRR"
    pr_x: str = "Recall"
    pr_y: str = "Precision"
    sweep_x: str = "Threshold"
    sweep_y: str = "Error Rate"
    dist_x: str = "Score"
    dist_y: str = "Count"


@dataclass(frozen=True)
class ThresholdGrid:
    start: float = 0.00
    end: float = 1.00
    step: float = 0.05

    def validate(self) -> None:
        if self.step <= 0:
            raise ValueError("threshold_grid.step must be greater than 0.")
        if self.end <= self.start:
            raise ValueError("threshold_grid.end must be greater than threshold_grid.start.")


@dataclass(frozen=True)
class FilterConfig:
    """Dynamic dashboard/report filters for root-level input metadata."""
    auto_detect_filter_variables: bool = True
    filter_variables: Tuple[str, ...] = ()
    exclude_filter_variables: Tuple[str, ...] = (
        "record_id", "path", "label", "score", "y_true", "y_pred",
        "variable_gt", "variable_pred",
    )


@dataclass(frozen=True)
class AgeEstimationConfig:
    """Configuration for the age estimation task (regression + compliance + fairness)."""
    # ACCS thresholds evaluated with TPR/FPR/FNR cards (compliance section).
    thresholds: Tuple[int, ...] = (18, 21, 25)
    # NIST accuracy windows (years): Acc@N = % predictions with |error| <= N.
    accuracy_windows: Tuple[float, ...] = (1.0, 3.0, 5.0)
    # Challenge thresholds for detailed FPR-by-age tables.
    challenge_thresholds: Tuple[int, ...] = (16, 18, 21, 25, 28)
    # Minimum actual age included in challenge FPR analysis.
    challenge_min_age: int = 14
    # FPR target levels for pass/fail coloring.
    fpr_targets: Tuple[float, ...] = (0.10, 0.05, 0.01)
    # Actual ages shown in the Application FPR table (one FPR per age per model).
    fpr_application_ages: Tuple[int, ...] = (16, 17, 18, 19, 20, 21, 22, 23, 24, 25)
    # Decision threshold used to compute FPR in the Application table.
    fpr_application_threshold: int = 18
    # FAR level at which Balanced Accuracy is evaluated (e.g. 0.01 = 1%).
    balanced_accuracy_far_target: float = 0.01
    bins: int = 10
    worst_cases: int = 50
    auto_detect_filter_variables: bool = True
    filter_variables: Tuple[str, ...] = ()
    exclude_filter_variables: Tuple[str, ...] = (
        "record_id", "path", "y_true", "y_pred",
        "variable_gt", "variable_pred",
    )

    def validate(self) -> None:
        if not self.thresholds:
            raise ValueError("age_estimation.thresholds must define at least one threshold.")
        for t in self.thresholds:
            if t <= 0:
                raise ValueError(f"Invalid age_estimation threshold={t}.")
        if not self.accuracy_windows:
            raise ValueError("age_estimation.accuracy_windows must define at least one window.")
        for w in self.accuracy_windows:
            if w <= 0:
                raise ValueError(f"Invalid age_estimation accuracy_window={w}.")
        if not self.challenge_thresholds:
            raise ValueError("age_estimation.challenge_thresholds must define at least one value.")
        if not self.fpr_targets:
            raise ValueError("age_estimation.fpr_targets must define at least one target.")
        if not self.fpr_application_ages:
            raise ValueError("age_estimation.fpr_application_ages must define at least one age.")
        if not (0.0 < self.balanced_accuracy_far_target < 1.0):
            raise ValueError("age_estimation.balanced_accuracy_far_target must be between 0 and 1.")
        if self.bins < 2:
            raise ValueError("age_estimation.bins must be >= 2.")
        if self.worst_cases < 1:
            raise ValueError("age_estimation.worst_cases must be >= 1.")


@dataclass
class EvaluationConfig:
    output_root_dir: Path
    input_sources: Tuple[InputSourceConfig, ...]

    task_type: str = "binary"
    strict_config: bool = False

    # Binary configuration.
    positive_if_higher_score: bool = True
    positive_label: int = 1
    negative_label: int = 0
    binary: FilterConfig = field(default_factory=FilterConfig)

    axes_scale: str = "linear"
    threshold_grid: ThresholdGrid = field(default_factory=ThresholdGrid)
    titles: TitlesConfig = field(default_factory=TitlesConfig)
    labels: AxisLabels = field(default_factory=AxisLabels)

    # Decision threshold over the binary score.
    custom_threshold: Optional[float] = None

    # Binary operational references. Also reused for charts where useful.
    operational_reference_rates: Tuple[float, ...] = (0.1, 0.01, 0.001)

    # Age estimation-specific options.
    age_estimation: AgeEstimationConfig = field(default_factory=AgeEstimationConfig)

    # Common blocks shared by every task (spec §19).
    ui: UiConfig = field(default_factory=UiConfig)
    statistics: StatisticsConfig = field(default_factory=StatisticsConfig)
    case_study: CaseStudyConfig = field(default_factory=CaseStudyConfig)
    output_name_files: OutputNamesConfig = field(default_factory=OutputNamesConfig)
    filter_policy: FilterPolicyConfig = field(default_factory=FilterPolicyConfig)
    worst_case: WorstCaseConfig = field(default_factory=WorstCaseConfig)

    def validate(self) -> None:
        self.task_type = self.task_type.lower().strip()
        if self.task_type not in SUPPORTED_TASKS:
            raise ValueError(f"task_type must be one of: {', '.join(SUPPORTED_TASKS)}.")

        if not self.input_sources:
            raise ValueError("No input_sources defined in config.")

        self.ui.validate()
        self.statistics.validate()
        self.case_study.validate(self.task_type, self.positive_label, self.negative_label)
        self.output_name_files.validate(self.task_type)
        self.worst_case.validate()
        if self.worst_case.metric is not None:
            from metrics_studio.metric_registry import METRIC_REGISTRY

            try:
                definition = METRIC_REGISTRY.resolve(self.worst_case.metric)
            except KeyError as exc:
                raise ValueError(
                    f"worst_case.metric='{self.worst_case.metric}' is not a registered metric."
                ) from exc
            if self.task_type not in definition.tasks:
                raise ValueError(
                    f"worst_case.metric='{self.worst_case.metric}' is not compatible "
                    f"with task_type='{self.task_type}'."
                )

        seen_ids = set()
        for src in self.input_sources:
            exp_id = src.resolved_experiment_id
            if exp_id in seen_ids:
                raise ValueError(
                    f"Duplicate experiment_id '{exp_id}'. Give each input source a unique "
                    "experiment_id (or distinct model_name)."
                )
            seen_ids.add(exp_id)
        baselines = [s for s in self.input_sources if s.role == "baseline"]
        if len(baselines) > 1:
            raise ValueError("At most one input source may have role='baseline'.")
        if baselines and any(s.variable_baseline_pred for s in self.input_sources):
            print(
                "[warn] Both a role='baseline' experiment and legacy variable_baseline_pred(s) "
                "are configured. The explicit baseline experiment takes precedence."
            )

        if self.task_type == "binary":
            self.threshold_grid.validate()
            if self.positive_label == self.negative_label:
                raise ValueError("positive_label and negative_label must be different.")
            if self.custom_threshold is not None and not (self.threshold_grid.start <= self.custom_threshold <= self.threshold_grid.end):
                print(
                    f"[warn] custom_threshold={self.custom_threshold} is outside "
                    f"the threshold grid [{self.threshold_grid.start}, {self.threshold_grid.end}]. "
                    "The dashboard will compute this threshold exactly."
                )
            if not self.operational_reference_rates:
                raise ValueError("operational_reference_rates must contain at least one value.")
            for rate in self.operational_reference_rates:
                if not (0.0 < rate < 1.0):
                    raise ValueError(
                        f"Invalid operational_reference_rate={rate}. Values must be between 0 and 1."
                    )

        if self.task_type == "age_estimation":
            self.age_estimation.validate()

        for src in self.input_sources:
            if not src.path.exists():
                raise FileNotFoundError(f"Data file not found: {src.path}")
            if not src.variable_gt:
                raise ValueError(f"{self.task_type.capitalize()} input source '{src.display_name}' must define variable_gt.")
            if not src.variable_pred:
                raise ValueError(f"{self.task_type.capitalize()} input source '{src.display_name}' must define variable_pred.")


def _parse_yaml(text: str) -> Dict[str, Any]:
    try:
        import yaml
    except ImportError as exc:
        raise ImportError("Install PyYAML to load .yaml configs: `pip install pyyaml`") from exc
    return yaml.safe_load(text) or {}


def _optional_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    return float(value)


def _float_tuple(value: Any, default: Tuple[float, ...]) -> Tuple[float, ...]:
    if value is None:
        return default
    if isinstance(value, (int, float, str)):
        return (float(value),)
    return tuple(float(x) for x in value)


def _str_tuple(value: Any, default: Tuple[str, ...] = ()) -> Tuple[str, ...]:
    if value is None:
        return default
    if isinstance(value, str):
        return (value,)
    return tuple(str(x) for x in value)


def _filter_config(
    raw: Dict[str, Any], default: FilterConfig | None = None, *, context: str, strict: bool
) -> FilterConfig:
    _check_unknown_keys(
        raw,
        {"auto_detect_filter_variables", "filter_variables", "exclude_filter_variables"},
        context,
        strict=strict,
    )
    base = default or FilterConfig()
    return FilterConfig(
        auto_detect_filter_variables=bool(raw.get("auto_detect_filter_variables", base.auto_detect_filter_variables)),
        filter_variables=_str_tuple(raw.get("filter_variables"), base.filter_variables),
        exclude_filter_variables=_str_tuple(raw.get("exclude_filter_variables"), base.exclude_filter_variables),
    )


def load_config(path: Path) -> EvaluationConfig:
    warnings.warn(
        "Single-file configuration is deprecated; migrate to settings.yaml + data.yaml "
        "+ filter.yaml and EvaluationReport.",
        FutureWarning,
        stacklevel=2,
    )
    path = Path(path).expanduser().resolve()
    text = path.read_text(encoding="utf-8")
    suffix = path.suffix.lower()
    if suffix in {".yaml", ".yml"}:
        raw = _parse_yaml(text)
    elif suffix == ".json":
        raw = json.loads(text)
    else:
        raise ValueError(f"Unsupported config format: '{suffix}'. Use .yaml or .json.")
    config = config_from_dict(raw)
    base_dir = path.parent
    def resolved(candidate: Path) -> Path:
        candidate = candidate.expanduser()
        return candidate.resolve() if candidate.is_absolute() else (base_dir / candidate).resolve()

    sources = tuple(replace(source, path=resolved(source.path)) for source in config.input_sources)
    output_root = config.output_root_dir.expanduser()
    if not output_root.is_absolute():
        output_root = (base_dir / output_root).resolve()
    else:
        output_root = output_root.resolve()
    return replace(config, input_sources=sources, output_root_dir=output_root)


def _read_config_mapping(path: Path) -> Dict[str, Any]:
    path = Path(path).expanduser().resolve()
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() in {".yaml", ".yml"}:
        payload = _parse_yaml(text)
    elif path.suffix.lower() == ".json":
        payload = json.loads(text)
    else:
        raise ValueError(f"Unsupported config format: '{path.suffix}'. Use .yaml or .json.")
    if not isinstance(payload, Mapping):
        raise ValueError(f"Configuration document '{path}' must contain a mapping.")
    return dict(payload)


def config_from_documents(
    settings: Mapping[str, Any],
    data: Mapping[str, Any],
    filters: Optional[Mapping[str, Any]] = None,
    *,
    settings_base: Optional[Path] = None,
    data_base: Optional[Path] = None,
) -> EvaluationConfig:
    """Normalize the v2 three-document contract into ``EvaluationConfig``.

    Technical/output paths belong to settings; input paths belong to data. The
    resulting object is deliberately the same object used by the legacy loader,
    CLI shortcut and evaluation pipeline.
    """

    settings_raw = dict(settings or {})
    data_raw = dict(data or {})
    filter_raw = dict(filters or {})

    data_unknown = sorted(set(data_raw) - {"input_sources"})
    if data_unknown:
        raise ValueError(f"Unknown data config keys: {data_unknown}. data.yaml only accepts input_sources.")
    filter_keys = {
        "auto_detect_filter_variables",
        "to_include_evaluation",
        "to_include_statistics",
        "to_include_audit",
    }
    filter_unknown = sorted(set(filter_raw) - filter_keys)
    if filter_unknown:
        raise ValueError(f"Unknown filter config keys: {filter_unknown}.")
    if "input_sources" in settings_raw:
        raise ValueError("settings.yaml must not contain input_sources; move them to data.yaml.")
    if "input_sources" not in data_raw:
        raise ValueError("data.yaml must define input_sources.")

    # The concise settings example keeps the most frequently edited UI/statistic
    # values flat. Normalize them to the mature nested internal contract.
    ui = dict(settings_raw.get("ui") or {})
    for key in ("language", "theme", "decimals"):
        if key in settings_raw:
            ui[key] = settings_raw.pop(key)
    if "mode" in settings_raw:
        ui["theme"] = settings_raw.pop("mode")
    if ui:
        settings_raw["ui"] = ui
    if "confidence_intervals" in settings_raw:
        statistics = dict(settings_raw.get("statistics") or {})
        statistics["confidence_intervals"] = settings_raw.pop("confidence_intervals")
        settings_raw["statistics"] = statistics
    if isinstance(settings_raw.get("case_study"), str):
        settings_raw["case_study"] = {"default": settings_raw["case_study"]}

    task = str(settings_raw.get("task_type", "binary")).lower().strip()
    evaluation_vars = _str_tuple(filter_raw.get("to_include_evaluation"))
    audit_vars = _str_tuple(filter_raw.get("to_include_audit"))
    auto_detect = bool(filter_raw.get("auto_detect_filter_variables", True))
    settings_raw["filter_policy"] = {
        "auto_detect_filter_variables": auto_detect,
        **({"to_include_evaluation": list(evaluation_vars)}
           if "to_include_evaluation" in filter_raw else {}),
        **({"to_include_statistics": filter_raw["to_include_statistics"]}
           if "to_include_statistics" in filter_raw else {}),
        "to_include_audit": list(audit_vars),
    }

    # Existing task engines consume their historical filter fields. Mirror only
    # Evaluation variables there; Statistics discovers all scalar fields itself.
    if task in SUPPORTED_TASKS:
        task_block = dict(settings_raw.get(task) or {})
        task_block["auto_detect_filter_variables"] = auto_detect and not evaluation_vars
        task_block["filter_variables"] = list(dict.fromkeys(evaluation_vars))
        settings_raw[task] = task_block

    settings_raw["input_sources"] = list(data_raw.get("input_sources") or [])
    config = config_from_dict(settings_raw)

    settings_base = Path(settings_base or Path.cwd()).expanduser().resolve()
    data_base = Path(data_base or Path.cwd()).expanduser().resolve()

    def resolve_from(base: Path, candidate: Path) -> Path:
        candidate = candidate.expanduser()
        return candidate.resolve() if candidate.is_absolute() else (base / candidate).resolve()

    sources = tuple(
        replace(source, path=resolve_from(data_base, source.path))
        for source in config.input_sources
    )
    output_root = resolve_from(settings_base, config.output_root_dir)
    return replace(config, input_sources=sources, output_root_dir=output_root)


def load_report_config(
    settings: Path,
    data: Path,
    filters: Optional[Path] = None,
) -> EvaluationConfig:
    """Load ``settings.yaml`` + ``data.yaml`` + optional ``filter.yaml``."""

    settings_path = Path(settings).expanduser().resolve()
    data_path = Path(data).expanduser().resolve()
    filter_path = None if filters is None else Path(filters).expanduser().resolve()
    return config_from_documents(
        _read_config_mapping(settings_path),
        _read_config_mapping(data_path),
        {} if filter_path is None else _read_config_mapping(filter_path),
        settings_base=settings_path.parent,
        data_base=data_path.parent,
    )


_KNOWN_TOP_LEVEL_KEYS = {
    "output_root_dir", "input_sources", "task_type",
    "strict_config",
    "positive_if_higher_score", "positive_label", "negative_label",
    "binary", "age_estimation",
    "axes_scale", "threshold_grid", "titles", "labels",
    "custom_threshold", "operational_reference_rates",
    "ui", "statistics", "case_study", "output_name_files", "filter_policy", "worst_case",
}


def _ui_config(raw: Dict[str, Any], *, strict: bool) -> UiConfig:
    _check_unknown_keys(
        raw,
        {"language", "decimals", "decimals_min", "decimals_max", "allow_runtime_decimal_change", "metric_decimals", "plotly_delivery", "comparison"},
        "ui",
        strict=strict,
    )
    default = UiConfig()
    comparison_raw = raw.get("comparison") or {}
    if not isinstance(comparison_raw, dict):
        raise ValueError("ui.comparison must be a mapping.")
    _check_unknown_keys(
        comparison_raw,
        {"initial_active", "max_active", "layout", "max_columns", "min_panel_width"},
        "ui.comparison", strict=True,
    )
    comparison = ComparisonConfig(**comparison_raw)
    metric_decimals = {
        str(k): int(v) for k, v in (raw.get("metric_decimals") or {}).items()
    }
    return UiConfig(
        language=str(raw.get("language", default.language)).lower().strip(),
        decimals=int(raw.get("decimals", default.decimals)),
        decimals_min=int(raw.get("decimals_min", default.decimals_min)),
        decimals_max=int(raw.get("decimals_max", default.decimals_max)),
        allow_runtime_decimal_change=bool(raw.get("allow_runtime_decimal_change", default.allow_runtime_decimal_change)),
        plotly_delivery=str(raw.get("plotly_delivery", default.plotly_delivery)).lower().strip(),
        metric_decimals=metric_decimals,
        comparison=comparison,
    )


def _statistics_config(raw: Dict[str, Any], *, strict: bool) -> StatisticsConfig:
    _check_unknown_keys(
        raw,
        {"confidence_intervals", "group_audit_min_samples"},
        "statistics",
        strict=strict,
    )
    ci_raw = raw.get("confidence_intervals") or {}
    _check_unknown_keys(
        ci_raw,
        {"enabled", "level", "method", "n_resamples", "seed", "display", "resample_unit"},
        "statistics.confidence_intervals",
        strict=strict,
    )
    default = ConfidenceIntervalConfig()
    ci = ConfidenceIntervalConfig(
        enabled=bool(ci_raw.get("enabled", default.enabled)),
        level=float(ci_raw.get("level", default.level)),
        method=str(ci_raw.get("method", default.method)).lower().strip(),
        n_resamples=int(ci_raw.get("n_resamples", default.n_resamples)),
        seed=int(ci_raw.get("seed", default.seed)),
        display=str(ci_raw.get("display", default.display)).lower().strip(),
        resample_unit=str(ci_raw.get("resample_unit", default.resample_unit)).strip(),
    )
    return StatisticsConfig(
        confidence_intervals=ci,
        group_audit_min_samples=int(raw.get("group_audit_min_samples", 20)),
    )



def _case_study_config(raw: Dict[str, Any], *, strict: bool) -> CaseStudyConfig:
    _check_unknown_keys(
        raw,
        {"default", "selectable", "allow_runtime_change", "class_roles", "custom_profile"},
        "case_study",
        strict=strict,
    )
    default = CaseStudyConfig()
    custom_profile = raw.get("custom_profile")
    if custom_profile is not None:
        custom_profile = dict(custom_profile)
    migrations = {
        "general": "generic", "security": "presentation_attack_detection",
        "biometrics": "biometric_verification", "ir": "generic",
    }
    default_id = migrations.get(str(raw.get("default", default.default)).lower().strip(),
                                str(raw.get("default", default.default)).lower().strip())
    selected = _str_tuple(raw.get("selectable"), default.selectable)
    selected = tuple(dict.fromkeys(migrations.get(x.lower().strip(), x.lower().strip()) for x in selected))
    return CaseStudyConfig(
        default=default_id,
        selectable=selected,
        allow_runtime_change=bool(raw.get("allow_runtime_change", default.allow_runtime_change)),
        class_roles={str(k): int(v) for k, v in (raw.get("class_roles") or {}).items()},
        custom_profile=custom_profile,
    )


def config_from_dict(raw: Dict[str, Any]) -> EvaluationConfig:
    """Build an EvaluationConfig from an already-parsed config mapping.

    Shared by load_config() (file-based) and the CLI shortcut that assembles a
    minimal config in memory, so both go through the exact same defaults.
    """
    raw = dict(raw or {})
    # Parse retired YAML keys only at the compatibility boundary.
    retired = []
    for key in ("theme", "mode", "pdf"):
        if key in raw:
            raw.pop(key)
            retired.append(key)
    for section, keys in (("ui", ("theme", "mode")), ("output_name_files", ("pdf",))):
        if isinstance(raw.get(section), dict):
            raw[section] = dict(raw[section])
            for key in keys:
                if key in raw[section]:
                    raw[section].pop(key)
                    retired.append(f"{section}.{key}")
    if retired:
        warnings.warn(
            "Removed settings ignored (reports now use light HTML/XLSX only): " + ", ".join(retired),
            FutureWarning, stacklevel=2,
        )
    strict = bool(raw.get("strict_config", False))
    unknown = sorted(set(raw) - _KNOWN_TOP_LEVEL_KEYS)
    if unknown:
        message = f"Unknown config keys ignored: {unknown}"
        if strict:
            raise ValueError(message.replace(" ignored", ""))
        print(f"[warn] {message}")
    sources_raw = raw.get("input_sources") or []
    sources = tuple(InputSourceConfig.from_dict(s, strict=strict) for s in sources_raw)

    grid_raw = raw.get("threshold_grid") or {}
    _check_unknown_keys(grid_raw, {"start", "end", "step"}, "threshold_grid", strict=strict)
    grid = ThresholdGrid(
        start=float(grid_raw.get("start", 0.00)),
        end=float(grid_raw.get("end", 1.00)),
        step=float(grid_raw.get("step", 0.05)),
    )

    t_raw = raw.get("titles") or {}
    _check_unknown_keys(t_raw, {"dashboard", "roc", "det", "pr", "sweep", "dist"}, "titles", strict=strict)
    titles = TitlesConfig(
        dashboard=t_raw.get("dashboard", TitlesConfig.dashboard),
        roc=t_raw.get("roc", TitlesConfig.roc),
        det=t_raw.get("det", TitlesConfig.det),
        pr=t_raw.get("pr", TitlesConfig.pr),
        sweep=t_raw.get("sweep", TitlesConfig.sweep),
        dist=t_raw.get("dist", TitlesConfig.dist),
    )

    l_raw = raw.get("labels") or {}
    _check_unknown_keys(
        l_raw,
        {"roc_x", "roc_y", "det_x", "det_y", "pr_x", "pr_y", "sweep_x", "sweep_y", "dist_x", "dist_y"},
        "labels",
        strict=strict,
    )
    labels = AxisLabels(
        roc_x=l_raw.get("roc_x", AxisLabels.roc_x),
        roc_y=l_raw.get("roc_y", AxisLabels.roc_y),
        det_x=l_raw.get("det_x", AxisLabels.det_x),
        det_y=l_raw.get("det_y", AxisLabels.det_y),
        pr_x=l_raw.get("pr_x", AxisLabels.pr_x),
        pr_y=l_raw.get("pr_y", AxisLabels.pr_y),
        sweep_x=l_raw.get("sweep_x", AxisLabels.sweep_x),
        sweep_y=l_raw.get("sweep_y", AxisLabels.sweep_y),
        dist_x=l_raw.get("dist_x", AxisLabels.dist_x),
        dist_y=l_raw.get("dist_y", AxisLabels.dist_y),
    )

    operational_reference_rates = _float_tuple(
        raw.get("operational_reference_rates"),
        EvaluationConfig.operational_reference_rates,
    )

    age_raw = raw.get("age_estimation") or {}
    _check_unknown_keys(
        age_raw,
        {"thresholds", "accuracy_windows", "challenge_thresholds", "challenge_min_age", "fpr_targets", "fpr_application_ages", "fpr_application_threshold", "balanced_accuracy_far_target", "bins", "worst_cases", "auto_detect_filter_variables", "filter_variables", "exclude_filter_variables"},
        "age_estimation",
        strict=strict,
    )
    age_default = AgeEstimationConfig()
    age_config = AgeEstimationConfig(
        thresholds=tuple(int(x) for x in (age_raw.get("thresholds") or age_default.thresholds)),
        accuracy_windows=_float_tuple(age_raw.get("accuracy_windows"), age_default.accuracy_windows),
        challenge_thresholds=tuple(int(x) for x in (age_raw.get("challenge_thresholds") or age_default.challenge_thresholds)),
        challenge_min_age=int(age_raw.get("challenge_min_age", age_default.challenge_min_age)),
        fpr_targets=_float_tuple(age_raw.get("fpr_targets"), age_default.fpr_targets),
        fpr_application_ages=tuple(int(x) for x in (age_raw.get("fpr_application_ages") or age_default.fpr_application_ages)),
        fpr_application_threshold=int(age_raw.get("fpr_application_threshold", age_default.fpr_application_threshold)),
        balanced_accuracy_far_target=float(age_raw.get("balanced_accuracy_far_target", age_default.balanced_accuracy_far_target)),
        bins=int(age_raw.get("bins", age_default.bins)),
        worst_cases=int(age_raw.get("worst_cases", age_default.worst_cases)),
        auto_detect_filter_variables=bool(age_raw.get("auto_detect_filter_variables", age_default.auto_detect_filter_variables)),
        filter_variables=_str_tuple(age_raw.get("filter_variables"), age_default.filter_variables),
        exclude_filter_variables=_str_tuple(age_raw.get("exclude_filter_variables"), age_default.exclude_filter_variables),
    )

    binary_config = _filter_config(raw.get("binary") or {}, context="binary", strict=strict)
    task_type = str(raw.get("task_type", "binary")).lower().strip()

    output_names_raw = raw.get("output_name_files") or {}
    _check_unknown_keys(
        output_names_raw, {"html", "xlsx"}, "output_name_files", strict=strict
    )
    output_names = OutputNamesConfig(
        html=str(output_names_raw.get("html", "")),
        xlsx=str(output_names_raw.get("xlsx", "")),
    )

    filter_policy_raw = raw.get("filter_policy") or {}
    _check_unknown_keys(
        filter_policy_raw,
        {
            "auto_detect_filter_variables",
            "to_include_evaluation",
            "to_include_statistics",
            "to_include_audit",
        },
        "filter_policy",
        strict=strict,
    )
    filter_policy = FilterPolicyConfig(
        evaluation_explicit="to_include_evaluation" in filter_policy_raw,
        auto_detect_filter_variables=bool(
            filter_policy_raw.get("auto_detect_filter_variables", True)
        ),
        to_include_evaluation=_str_tuple(
            filter_policy_raw.get("to_include_evaluation")
        ),
        to_include_audit=_str_tuple(
            filter_policy_raw.get("to_include_audit")
        ),
    )

    if "to_include_statistics" in filter_policy_raw:
        warnings.warn(
            "to_include_statistics is retired and ignored: Statistics automatically "
            "discovers all available variables. Remove this key from the config.",
            FutureWarning,
            stacklevel=2,
        )

    worst_case_raw = raw.get("worst_case") or {}
    _check_unknown_keys(
        worst_case_raw, {"enabled", "metric", "min_samples"}, "worst_case", strict=strict
    )
    worst_case = WorstCaseConfig(
        enabled=bool(worst_case_raw.get("enabled", True)),
        metric=(
            None
            if worst_case_raw.get("metric") is None
            else str(worst_case_raw.get("metric")).lower().strip()
        ),
        min_samples=int(worst_case_raw.get("min_samples", 20)),
    )

    if task_type == "age_estimation" and "titles" not in raw:
        titles = TitlesConfig(
            dashboard="Age Estimation Panel",
            roc="Prediction vs Actual Age",
            det="Error Distribution",
            pr="Error by Age Range",
            sweep="Fairness Analysis",
            dist="Compliance Metrics",
        )

    return EvaluationConfig(
        output_root_dir=Path(raw.get("output_root_dir", "outputs")),
        input_sources=sources,
        task_type=task_type,
        strict_config=strict,
        positive_if_higher_score=bool(raw.get("positive_if_higher_score", True)),
        positive_label=int(raw.get("positive_label", 1)),
        negative_label=int(raw.get("negative_label", 0)),
        binary=binary_config,
        axes_scale=str(raw.get("axes_scale", "linear")),
        threshold_grid=grid,
        titles=titles,
        labels=labels,
        custom_threshold=_optional_float(raw.get("custom_threshold")),
        operational_reference_rates=operational_reference_rates,
        age_estimation=age_config,
        ui=_ui_config(raw.get("ui") or {}, strict=strict),
        statistics=_statistics_config(raw.get("statistics") or {}, strict=strict),
        case_study=_case_study_config(raw.get("case_study") or {}, strict=strict),
        output_name_files=output_names,
        filter_policy=filter_policy,
        worst_case=worst_case,
    )
