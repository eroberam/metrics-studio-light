"""Declarative metric catalogue and small calculation engine.

The registry owns semantics and presentation metadata. Task evaluators remain
responsible for domain-specific arrays/curves and publish results under stable
keys that this engine resolves.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Mapping, Optional, Sequence

import numpy as np

from .glossary import load_methodology

Calculator = Callable[[Mapping[str, Any]], float]


@dataclass(frozen=True)
class MetricDefinition:
    key: str
    tasks: tuple[str, ...]
    label: str
    label_es: str
    aliases: tuple[str, ...] = ()
    source_key: Optional[str] = None
    format: str = "num"  # num | pct
    direction: str = "higher"  # higher | lower
    formula: str = ""
    reading: str = ""
    interpretation: str = ""
    example: str = ""
    limitations: str = ""
    calculator: Optional[Calculator] = None
    requirements: tuple[str, ...] = ()
    requirements_es: tuple[str, ...] = ()
    ci: str = ""
    ci_es: str = ""
    question: str = ""
    question_es: str = ""
    unit: str = ""
    unit_es: str = ""
    formula_es: str = ""
    reading_es: str = ""
    interpretation_es: str = ""
    example_es: str = ""
    limitations_es: str = ""
    assumptions: tuple[str, ...] = ()
    assumptions_es: tuple[str, ...] = ()
    references: tuple[str, ...] = ()

    def public_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "tasks": list(self.tasks),
            "label": self.label,
            "label_es": self.label_es,
            "aliases": list(self.aliases),
            "format": self.format,
            "direction": self.direction,
            "formula": self.formula,
            "reading": self.reading,
            "interpretation": self.interpretation,
            "example": self.example,
            "limitations": self.limitations,
            "requirements": list(self.requirements),
            "requirements_es": list(self.requirements_es),
            "ci": self.ci,
            "ci_es": self.ci_es,
            "question": self.question,
            "question_es": self.question_es,
            "unit": self.unit,
            "unit_es": self.unit_es,
            "formula_es": self.formula_es,
            "reading_es": self.reading_es,
            "interpretation_es": self.interpretation_es,
            "example_es": self.example_es,
            "limitations_es": self.limitations_es,
            "assumptions": list(self.assumptions),
            "assumptions_es": list(self.assumptions_es),
            "references": list(self.references),
        }


@dataclass(frozen=True)
class MetricResult:
    key: str
    value: float
    ci: Optional[tuple[float, float]] = None
    n: Optional[int] = None


def _mean(field: str) -> Calculator:
    def calculate(context: Mapping[str, Any]) -> float:
        values = np.asarray(context[field], dtype=float)
        values = values[np.isfinite(values)]
        return float(np.mean(values)) if values.size else float("nan")
    return calculate


def _rmse(context: Mapping[str, Any]) -> float:
    residuals = np.asarray(context["residuals"], dtype=float)
    residuals = residuals[np.isfinite(residuals)]
    return float(np.sqrt(np.mean(residuals ** 2))) if residuals.size else float("nan")


class MetricRegistry:
    def __init__(self, definitions: Iterable[MetricDefinition] = ()) -> None:
        self._definitions: dict[str, MetricDefinition] = {}
        self._aliases: dict[str, str] = {}
        for definition in definitions:
            self.register(definition)

    def register(self, definition: MetricDefinition) -> None:
        key = definition.key.lower().strip()
        if not key or key in self._definitions or key in self._aliases:
            raise ValueError(f"Duplicate metric key or alias '{key}'.")
        aliases = tuple(alias.lower().strip() for alias in definition.aliases)
        collisions = [alias for alias in aliases if alias in self._definitions or alias in self._aliases]
        if collisions:
            raise ValueError(f"Duplicate metric aliases: {collisions}.")
        self._definitions[key] = definition
        for alias in aliases:
            self._aliases[alias] = key

    def resolve(self, key_or_alias: str) -> MetricDefinition:
        query = str(key_or_alias).lower().strip()
        key = self._aliases.get(query, query)
        try:
            return self._definitions[key]
        except KeyError as exc:
            raise KeyError(f"Unknown metric '{key_or_alias}'.") from exc

    def for_task(self, task: str) -> tuple[MetricDefinition, ...]:
        task = task.lower().strip()
        return tuple(item for item in self._definitions.values() if task in item.tasks)

    def payload(self, task: str) -> list[dict[str, Any]]:
        return [definition.public_dict() for definition in self.for_task(task)]

    def validate(self) -> None:
        for key, definition in self._definitions.items():
            if key != definition.key:
                raise ValueError(f"Metric key '{definition.key}' must be normalized lowercase.")
            if definition.direction not in {"higher", "lower"}:
                raise ValueError(f"Metric '{key}' has invalid direction '{definition.direction}'.")
            if definition.format not in {"num", "pct"}:
                raise ValueError(f"Metric '{key}' has invalid format '{definition.format}'.")
            for field_name in (
                "formula", "reading", "interpretation", "example", "limitations",
                "ci", "question",
            ):
                if not str(getattr(definition, field_name, "")).strip():
                    raise ValueError(f"Metric '{key}' is missing methodology field '{field_name}'.")
            for field_name in (
                "formula_es", "reading_es", "interpretation_es", "example_es",
                "limitations_es", "ci_es",
            ):
                if not str(getattr(definition, field_name, "")).strip():
                    raise ValueError(
                        f"Metric '{key}' is missing Spanish methodology field '{field_name}'."
                    )
            if not definition.requirements_es:
                raise ValueError(
                    f"Metric '{key}' is missing Spanish methodology requirements."
                )
            if not definition.requirements:
                raise ValueError(f"Metric '{key}' is missing methodology requirements.")


class MetricEngine:
    def __init__(self, registry: MetricRegistry) -> None:
        self.registry = registry

    def calculate(self, metric: str, context: Mapping[str, Any]) -> float:
        definition = self.registry.resolve(metric)
        if definition.calculator is None:
            raise ValueError(f"Metric '{definition.key}' has no generic calculator.")
        return float(definition.calculator(context))

    def collect(
        self,
        task: str,
        values: Mapping[str, Any],
        *,
        ci: Optional[Mapping[str, Sequence[float]]] = None,
        n: Optional[int] = None,
    ) -> tuple[MetricResult, ...]:
        results = []
        ci = ci or {}
        for definition in self.registry.for_task(task):
            candidates = (
                definition.source_key or definition.key,
                definition.key,
                *definition.aliases,
            )
            raw = next((values[key] for key in candidates if key in values), None)
            try:
                value = float(raw)
            except (TypeError, ValueError):
                continue
            if not math.isfinite(value):
                continue
            interval_raw = next((ci[key] for key in candidates if key in ci), None)
            interval = None
            if interval_raw is not None and len(interval_raw) == 2:
                interval = (float(interval_raw[0]), float(interval_raw[1]))
            results.append(MetricResult(definition.key, value, interval, n))
        return tuple(results)


def _d(
    key: str,
    tasks: tuple[str, ...],
    *,
    aliases: tuple[str, ...] = (),
    source_key: Optional[str] = None,
    format: str = "num",
    direction: str = "higher",
    calculator: Optional[Calculator] = None,
    unit: str = "",
    references: tuple[str, ...] = (),
) -> MetricDefinition:
    catalogues = {lang: load_methodology(lang) for lang in ("en", "es")}
    copies = {
        lang: dict(catalogues[lang].get("metrics", {}).get(key) or {})
        for lang in catalogues
    }
    defaults = {lang: dict(catalogues[lang].get("defaults") or {}) for lang in catalogues}
    if not copies["en"] or not copies["es"]:
        raise ValueError(f"Metric '{key}' is missing from a methodology catalogue.")
    required_copy = ("label", "formula", "reading", "interpretation")
    for lang, copy in copies.items():
        missing = [field for field in required_copy if not str(copy.get(field, "")).strip()]
        if missing:
            raise ValueError(f"Metric '{key}' is missing {lang} copy: {missing}")

    label = str(copies["en"]["label"])
    label_es = str(copies["es"]["label"])
    question = str(defaults["en"].get("question", "")).format(label=label)
    question_es = str(defaults["es"].get("question", "")).format(label=label_es)
    requirements = tuple(str(item) for item in (
        copies["en"].get("requirements") or defaults["en"].get("requirements") or ()
    ))
    requirements_es = tuple(str(item) for item in (
        copies["es"].get("requirements") or defaults["es"].get("requirements") or ()
    ))
    return MetricDefinition(
        key=key,
        tasks=tasks,
        label=label,
        label_es=label_es,
        aliases=aliases,
        source_key=source_key,
        format=format,
        direction=direction,
        formula=str(copies["en"]["formula"]),
        reading=str(copies["en"]["reading"]),
        interpretation=str(copies["en"]["interpretation"]),
        example=str(copies["en"].get("example") or defaults["en"].get("example") or ""),
        limitations=str(copies["en"].get("limitations") or defaults["en"].get("limitations") or ""),
        calculator=calculator,
        requirements=requirements,
        requirements_es=requirements_es,
        ci=str(copies["en"].get("ci") or defaults["en"].get("ci") or ""),
        ci_es=str(copies["es"].get("ci") or defaults["es"].get("ci") or ""),
        question=question,
        question_es=question_es,
        unit=str(copies["en"].get("unit") or unit),
        unit_es=str(copies["es"].get("unit") or unit),
        formula_es=str(copies["es"]["formula"]),
        reading_es=str(copies["es"]["reading"]),
        interpretation_es=str(copies["es"]["interpretation"]),
        example_es=str(copies["es"].get("example") or defaults["es"].get("example") or ""),
        limitations_es=str(copies["es"].get("limitations") or defaults["es"].get("limitations") or ""),
        references=references,
    )


DEFAULT_WORST_CASE_METRICS = {
    "binary": "far",
    "age_estimation": "mae",
}

_DEFINITIONS = (
    _d("roc_auc", ("binary",), aliases=("auc",)),
    _d("average_precision", ("binary",), aliases=("ap",)),
    _d("far", ("binary",), format="pct", direction="lower"),
    _d("frr", ("binary",), format="pct", direction="lower"),
    _d("accuracy", ("binary",), format="pct"),
    _d("balanced_accuracy", ("binary",), format="pct"),
    _d("mcc", ("binary",), references=("Matthews, 1975",)),
    _d("cohen_kappa", ("binary",)),
    _d("log_loss", ("binary",), direction="lower"),
    _d("brier_score", ("binary",), direction="lower"),
    _d("ece", ("binary",), format="pct", direction="lower"),
    _d("mae", ("age_estimation",), direction="lower", calculator=_mean("absolute_errors")),
    _d("rmse", ("age_estimation",), direction="lower", calculator=_rmse),
    _d("bias", ("age_estimation",), source_key="mean_error_bias", direction="lower"),
    _d("mdae", ("age_estimation",), direction="lower"),
    _d("p90_ae", ("age_estimation",), direction="lower"),
    _d("sd", ("age_estimation",), direction="lower", unit="years"),
    _d("acc_at_1", ("age_estimation",), format="pct"),
    _d("acc_at_3", ("age_estimation",), format="pct"),
    _d("acc_at_5", ("age_estimation",), format="pct"),
)

METRIC_REGISTRY = MetricRegistry(_DEFINITIONS)
METRIC_REGISTRY.validate()
METRIC_ENGINE = MetricEngine(METRIC_REGISTRY)
