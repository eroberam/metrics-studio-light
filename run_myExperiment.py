#!/usr/bin/env python3
"""Genera informes de Metrics Studio para los proyectos de ``configs/``."""

import sys
from pathlib import Path

ROOT_FOLDER = Path(__file__).resolve().parent
CONFIG_FOLDER = ROOT_FOLDER / "configs"
OUTPUT_FOLDER = ROOT_FOLDER / "output"

sys.path.insert(0, str(ROOT_FOLDER / "src"))

from metrics_studio import EvaluationReport  # noqa: E402


class ProjectFiles:
    """Rutas de los tres ficheros que forman un proyecto científico."""

    def __init__(self, project_name: str) -> None:
        self.folder = CONFIG_FOLDER / project_name
        self.settings = self.folder / "settings.yaml"
        self.data = self.folder / "data.yaml"
        self.filter = self.folder / "filter.yaml"


def find_projects() -> list[str]:
    """Descubre proyectos válidos sin mantener una lista manual."""

    return sorted(
        path.name
        for path in CONFIG_FOLDER.iterdir()
        if path.is_dir()
        and (path / "settings.yaml").is_file()
        and (path / "data.yaml").is_file()
    )


ALL_PROJECTS = find_projects()

# Déjalo así para ejecutar todos los proyectos o escribe, por ejemplo, ["binary"].
PROJECTS_TO_RUN = ALL_PROJECTS


def generate_report(project_name: str) -> None:
    files = ProjectFiles(project_name)
    report = EvaluationReport(
        settings=files.settings,
        data=files.data,
        filter=files.filter if files.filter.is_file() else None,
    ).export()
    print(f"\n{project_name}")
    print(f"  HTML: {report.html_path}")
    print(f"  XLSX: {report.xlsx_path}")
    for warning in report.warnings:
        print(f"  Aviso: {warning}")


def main() -> None:
    if not PROJECTS_TO_RUN:
        raise RuntimeError(f"No se encontraron proyectos válidos en {CONFIG_FOLDER}")
    for project_name in PROJECTS_TO_RUN:
        generate_report(project_name)
    print(f"\nInformes disponibles en: {OUTPUT_FOLDER}")


if __name__ == "__main__":
    main()
