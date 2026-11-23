# Metrics Studio Light

Genera paneles HTML interactivos e informes Excel para **Age** (estimación de edad) y
**Binary** (clasificación binaria). Incluye tres modelos de ejemplo por panel con
datos sintéticos.

## Ejecutar los ejemplos

Desde esta carpeta, con Python 3.10 o posterior:

**Linux, macOS o WSL**

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python run_myExperiment.py
```

**Windows (PowerShell)**

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe run_myExperiment.py
```

Abre los archivos HTML generados directamente en el navegador. Los ejemplos llevan
las gráficas integradas y funcionan sin servidor ni conexión después de generar los informes.

| Panel | HTML | Excel |
| --- | --- | --- |
| Age | output/AgeEstimation/html/dashboard_age_estimation.html | output/AgeEstimation/reports/report_age_estimation.xlsx |
| Binary | output/Binary/html/dashboard_binary.html | output/Binary/reports/report_binary.xlsx |

## Usar tus propios datos

Copia la carpeta correspondiente dentro de `configs/` y edita estos archivos:

- `data.yaml` contiene las rutas de los CSV o JSON (lista de registros) y las
  columnas de referencia (`variable_gt`) y predicción (`variable_pred`).
  Age espera edades numéricas. Binary espera etiquetas de dos clases y puntuaciones numéricas.
- `settings.yaml` controla las opciones del panel y la carpeta de salida.
- `filter.yaml` selecciona las columnas de metadatos para los filtros y el
  análisis por grupos. Si tus datos tienen otras columnas, ajusta las listas.

Resuelve las rutas de datos desde `data.yaml` y las de salida desde `settings.yaml`.
`python run_myExperiment.py` ejecuta todos los proyectos que tengan
`settings.yaml` y `data.yaml`. Para ejecutar solo uno, indica sus archivos al CLI con el Python del entorno virtual:

```sh
python run.py run --settings configs/binary/settings.yaml --data configs/binary/data.yaml --filter configs/binary/filter.yaml
```

La instalación también proporciona el comando `metrics-studio`.
`python run.py init --task binary --output-dir configs/mi_proyecto` crea una
plantilla editable. Para Age, usa `--task age_estimation`.

Los ejemplos incluyen rutas de imagen ilustrativas. Para ver miniaturas, configura
`variable_path` con una columna que apunte a imágenes accesibles desde el navegador.

Basado en Metrics Studio.
Licencia [MIT](LICENSE).
