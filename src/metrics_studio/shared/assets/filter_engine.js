/* Unified reactive filter engine shared by every dashboard.
 *
 * Two scopes, one engine:
 *   - Per-model  (regression, multiclass, binary): each [data-model-id] section is
 *     its own filter scope; rows live in `model.rows` with a `row.metadata` map.
 *   - Global     (ocr, age_estimation): the whole document is one filter scope and
 *     rows are flat objects (value read as `row[var]`).
 *
 * Contract (both scopes): filter chips are `.filter-selector[data-filter-var=...]`;
 * per-group buttons are `.filter-select-all` / `.filter-clear-all`; global buttons
 * are `.select-all-filters` / `.clear-all-filters`.
 */
const GFP = (function () {
  function _scope(scope) {
    if (!scope || scope === document) return scope || document;
    var id = scope.getAttribute && scope.getAttribute("data-model-id");
    return id ? (document.querySelector('.control-dock-card[data-filter-owner="' + id + '"]') || scope) : scope;
  }
  // --- scope-agnostic primitives (scope = a model root or `document`) ---
  function _valuesIn(scope, variable) {
    scope = _scope(scope);
    return new Set(
      Array.from(scope.querySelectorAll('.filter-selector[data-filter-var="' + variable + '"]:checked'))
        .map(x => x.value)
    );
  }
  function _setGroupIn(scope, variable, checked) {
    scope = _scope(scope);
    scope.querySelectorAll('.filter-selector[data-filter-var="' + variable + '"]').forEach(cb => { cb.checked = checked; });
  }
  function _setAllIn(scope, checked) {
    scope = _scope(scope);
    scope.querySelectorAll('.filter-selector').forEach(cb => { cb.checked = checked; });
  }
  function _wireIn(scope, apply) {
    scope.querySelectorAll('.filter-selector').forEach(cb => cb.addEventListener('change', apply));
    scope.querySelectorAll('.filter-select-all').forEach(btn =>
      btn.addEventListener('click', () => { _setGroupIn(scope, btn.dataset.filterVar, true); apply(); })
    );
    scope.querySelectorAll('.filter-clear-all').forEach(btn =>
      btn.addEventListener('click', () => { _setGroupIn(scope, btn.dataset.filterVar, false); apply(); })
    );
    const selAll = scope.querySelector('.select-all-filters');
    if (selAll) selAll.addEventListener('click', () => { _setAllIn(scope, true); apply(); });
    const clrAll = scope.querySelector('.clear-all-filters');
    if (clrAll) clrAll.addEventListener('click', () => { _setAllIn(scope, false); apply(); });
  }

  // --- Per-model API ---
  function selectedValues(root, variable) { return _valuesIn(root, variable); }

  // Filter a model's rows by the currently-checked chips. `row.metadata[var]`,
  // missing -> "UNKNOWN"; an empty selection for a variable excludes every row.
  function selectRows(root, model) {
    const vars = model.filterVariables || [];
    const selected = {};
    for (const v of vars) selected[v] = _valuesIn(root, v);
    return model.rows.filter(row => {
      for (const v of vars) {
        const values = selected[v] || new Set();
        const cell = String((row.metadata || {})[v] != null ? (row.metadata || {})[v] : "UNKNOWN");
        if (!values.size || !values.has(cell)) return false;
      }
      return true;
    });
  }

  function setGroup(root, variable, checked) { _setGroupIn(root, variable, checked); }
  function setAll(root, checked) { _setAllIn(root, checked); }

  // Wire every [data-model-id] section to `refresh(root)` and run it once on load.
  function wire(refresh, selector) {
    document.querySelectorAll(selector || '[data-model-id]').forEach(root => {
      const apply = () => refresh(root);
      _wireIn(root, apply);
      apply();
    });
  }

  // --- Global-scope API (whole document is one filter scope; flat rows) ---
  // Read the checked chips document-wide as { variable: Set(values) }.
  function selectedSetsGlobal(vars) {
    const sel = {};
    for (const v of (vars || [])) sel[v] = _valuesIn(document, v);
    return sel;
  }

  // Filter flat rows by the document-wide selection. `accessor(row, var)` reads
  // the cell value (defaults to row[var]); empty selection excludes every row.
  function filterGlobal(rows, vars, accessor) {
    const get = accessor || ((r, v) => r[v]);
    const sel = selectedSetsGlobal(vars);
    return rows.filter(row => {
      for (const v of (vars || [])) {
        const values = sel[v] || new Set();
        const raw = get(row, v);
        const cell = String(raw != null ? raw : "UNKNOWN");
        if (!values.size || !values.has(cell)) return false;
      }
      return true;
    });
  }

  // Wire document-wide filter controls to `refresh()` and run it once on load.
  function wireGlobal(refresh) {
    _wireIn(document, refresh);
    refresh();
  }

  return {
    selectRows, selectedValues, setGroup, setAll, wire,
    selectedSetsGlobal, filterGlobal, wireGlobal,
  };
})();
