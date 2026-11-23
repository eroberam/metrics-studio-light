/* Client-side bootstrap confidence intervals (spec §3.4 + §13).
 *
 * When filters change, panels hand DMStats the filtered arrays and a statFn per
 * [data-ci-metric] card; the CI is recomputed with a seeded PRNG (mulberry32,
 * seed from statistics.confidence_intervals) in chunks (~200 resamples per
 * tick) so the UI never blocks. While pending the card shows the previous
 * interval dimmed ("Recomputing…"); results are cached by filter signature so
 * re-selecting the same filters restores the identical interval.
 *
 * NOTE: client CIs are reproducible per seed but NOT numerically identical to
 * the Python (numpy PCG64) server CIs — different PRNGs by design. The server
 * value stays displayed until the first filter change.
 */
window.DMStats = (function () {
  "use strict";

  var CFG = null;
  function cfg() {
    if (CFG === null) {
      var el = document.getElementById("dm-ui-config");
      var parsed = {};
      try { parsed = el ? JSON.parse(el.textContent) : {}; } catch (e) { /* ignore */ }
      CFG = (parsed.statistics || {}).confidence_intervals || {};
    }
    return CFG;
  }

  var MIN_N = 20;             // spec §13 "Insufficient data"
  var CHUNK = 200;            // resamples per tick
  var DEBOUNCE_MS = 250;

  function tt(key, args) { return window.DM_I18N ? window.DM_I18N.t(key, args) : key; }
  function fmt(v, kind) { return window.DM_FMT ? window.DM_FMT.fmt(v, kind) : String(v); }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function percentile(sorted, p) {
    if (!sorted.length) return NaN;
    var idx = (sorted.length - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  var cache = {};       // cacheKey -> [lo, hi]
  var timers = {};      // elementKey -> debounce timer
  var tokens = {};      // elementKey -> run token (cancels stale runs)
  var elSeq = 0;

  function elKey(el) {
    if (!el.__dmStatsKey) el.__dmStatsKey = "e" + (++elSeq);
    return el.__dmStatsKey;
  }

  // Rebuild the .kpi-ci content in compact "value (lo - hi)" notation.
  function renderInterval(el, lo, hi, n, kind) {
    el.textContent = "";
    el.removeAttribute("data-state");
    el.removeAttribute("title");
    var range = document.createElement("span");
    range.className = "kpi-ci-range";
    range.setAttribute("data-ci-lo", lo);
    range.setAttribute("data-ci-hi", hi);
    range.setAttribute("data-fmt", kind || "num");
    range.textContent = "(" + fmt(lo, kind) + " - " + fmt(hi, kind) + ")";
    el.appendChild(range);
    document.dispatchEvent(new CustomEvent("dm:cichange"));
  }

  function renderMessage(el, state, text) {
    el.setAttribute("data-state", state);
    el.textContent = text;
    document.dispatchEvent(new CustomEvent("dm:cichange"));
  }

  // Chunked percentile bootstrap. statFn(idx: Int32Array) -> number.
  // opts.groups: array of index-arrays — resample whole groups (record unit).
  function runBootstrap(n, statFn, opts, done) {
    var B = cfg().n_resamples || 2000;
    var level = cfg().level || 0.95;
    var rng = mulberry32(cfg().seed || 42);
    var groups = opts && opts.groups;
    var values = [];
    var b = 0;
    var token = opts.token;

    function chunk() {
      if (opts.isCancelled && opts.isCancelled(token)) return;
      var stop = Math.min(B, b + CHUNK);
      for (; b < stop; b++) {
        var idx;
        if (groups) {
          var g = groups.length, parts = [];
          for (var k = 0; k < g; k++) parts.push(groups[(rng() * g) | 0]);
          idx = [].concat.apply([], parts);
        } else {
          idx = new Array(n);
          for (var i = 0; i < n; i++) idx[i] = (rng() * n) | 0;
        }
        var v = statFn(idx);
        if (Number.isFinite(v)) values.push(v);
      }
      if (b < B) { setTimeout(chunk, 0); return; }
      if (!values.length) { done(null); return; }
      values.sort(function (a, x) { return a - x; });
      var alpha = (1 - level) / 2;
      done([percentile(values, alpha), percentile(values, 1 - alpha)]);
    }
    chunk();
  }

  /* Schedule a CI update for one .kpi-ci element.
     spec = { n, statFn|null, signature, kind, groups? }
     statFn null => metric not recomputable client-side (marked stale). */
  function schedule(el, spec) {
    if (!el) return;
    if (cfg().enabled === false) { el.style.display = "none"; return; }
    var key = elKey(el);
    if (timers[key]) clearTimeout(timers[key]);
    tokens[key] = (tokens[key] || 0) + 1; // cancel an older run before the debounce
    el.setAttribute("data-state", "recomputing");
    el.setAttribute("title", tt("ci.recomputing"));
    el.textContent = tt("ci.recomputing");
    timers[key] = setTimeout(function () { start(el, key, spec); }, DEBOUNCE_MS);
  }

  function start(el, key, spec) {
    var metric = el.getAttribute("data-ci-metric") || "";
    tokens[key] = (tokens[key] || 0) + 1;
    var token = tokens[key];

    if (!spec.statFn) { renderMessage(el, "stale", tt("ci.stale_unfiltered")); return; }
    var nUnits = spec.groups ? spec.groups.length : spec.n;
    if (nUnits < MIN_N) { renderMessage(el, "unavailable", tt("ci.unavailable_min_n", { n: MIN_N })); return; }

    var cacheKey = metric + "|" + spec.signature + "|" + spec.n;
    if (cache[cacheKey]) {
      var c = cache[cacheKey];
      renderInterval(el, c[0], c[1], spec.n, spec.kind);
      return;
    }

    el.setAttribute("data-state", "recomputing");
    el.setAttribute("title", tt("ci.recomputing"));
    runBootstrap(spec.n, spec.statFn, {
      groups: spec.groups,
      token: token,
      isCancelled: function (t) { return tokens[key] !== t; },
    }, function (interval) {
      if (tokens[key] !== token) return; // superseded by a newer filter change
      el.removeAttribute("title");
      if (!interval) { renderMessage(el, "unavailable", tt("ci.unavailable_min_n", { n: MIN_N })); return; }
      cache[cacheKey] = interval;
      renderInterval(el, interval[0], interval[1], spec.n, spec.kind);
    });
  }

  // Stable signature for the current filter selection of a scope.
  function signature(root) {
    var parts = [];
    var scope = root || document;
    var id = scope !== document && scope.getAttribute ? scope.getAttribute("data-model-id") : null;
    if (id) scope = document.querySelector('.control-dock-card[data-filter-owner="' + id + '"]') || scope;
    scope.querySelectorAll(".filter-selector:checked").forEach(function (cb) {
      parts.push(cb.getAttribute("data-filter-var") + "=" + cb.value);
    });
    return parts.sort().join(";");
  }

  return { schedule: schedule, signature: signature, MIN_N: MIN_N };
})();
