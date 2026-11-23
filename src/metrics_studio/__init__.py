from metrics_studio._version import __version__
from metrics_studio.config import (
    EvaluationConfig,
    FilterPolicyConfig,
    OutputNamesConfig,
    WorstCaseConfig,
    load_config,
    load_report_config,
)
from metrics_studio.metric_registry import (
    METRIC_ENGINE,
    METRIC_REGISTRY,
    MetricDefinition,
    MetricEngine,
    MetricRegistry,
    MetricResult,
)
from metrics_studio.report import EvaluationReport, ExportResult

__all__ = [
    "METRIC_ENGINE",
    "METRIC_REGISTRY",
    "EvaluationConfig",
    "EvaluationReport",
    "ExportResult",
    "FilterPolicyConfig",
    "MetricDefinition",
    "MetricEngine",
    "MetricRegistry",
    "MetricResult",
    "OutputNamesConfig",
    "WorstCaseConfig",
    "__version__",
    "load_config",
    "load_report_config",
    "run_evaluation",
]


def run_evaluation(config: EvaluationConfig) -> ExportResult:
    """Run an evaluation and return the published artifact paths and warnings."""

    from metrics_studio.pipeline import run_evaluation as _run_evaluation

    return _run_evaluation(config)
