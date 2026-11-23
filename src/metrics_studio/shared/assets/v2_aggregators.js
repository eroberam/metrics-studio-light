/* Pure v2 aggregators. This file is browser- and Node-compatible for parity tests. */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DM_V2_AGG = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function finite(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function normalizedToken(value) {
    return typeof value === "string" ? value.trim().toUpperCase() : "";
  }

  function isMissing(value, missingTokens) {
    if (value === null || value === undefined) return true;
    if (typeof value === "number") return !Number.isFinite(value);
    if (typeof value !== "string") return false;
    var token = normalizedToken(value);
    if (!token || token === "NAN" || token === "INFINITY" ||
        token === "+INFINITY" || token === "-INFINITY" ||
        token === "INF" || token === "+INF" || token === "-INF") return true;
    return (missingTokens || ["UNKNOWN"]).some(function (candidate) {
      return token === normalizedToken(candidate);
    });
  }

  function measurementType(values, missingTokens) {
    var valid = (values || []).filter(function (value) {
      return !isMissing(value, missingTokens);
    });
    if (!valid.length) return "categorical";
    var numeric = valid.every(function (value) {
      return typeof value !== "boolean" && Number.isFinite(Number(value));
    });
    if (!numeric) return "categorical";
    var unique = new Set(valid.map(String)).size;
    return unique >= 10 && unique / valid.length >= 0.01
      ? "continuous_numeric" : "discrete_numeric";
  }

  function resolveAxesChart(xType, yType, groupType) {
    var numericTypes = new Set(["continuous_numeric", "discrete_numeric"]);
    var xNumeric = numericTypes.has(xType);
    var yNumeric = numericTypes.has(yType);
    if (xNumeric && yNumeric) return "scatter";
    if (xNumeric || yNumeric) return groupType ? "grouped_box" : "box";
    return groupType ? "faceted_heatmap" : "heatmap";
  }

  function resolveChart(types) {
    var values = types || [];
    return resolveAxesChart(values[0], values[1], values[2]);
  }

  function topCategoryMap(values, limit, missingTokens) {
    var counts = new Map();
    (values || []).forEach(function (value) {
      var key = isMissing(value, missingTokens) ? "UNKNOWN" : String(value);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    var top = Array.from(counts.entries()).sort(function (a, b) {
      return b[1] - a[1] || a[0].localeCompare(b[0]);
    }).slice(0, limit || 20).map(function (entry) { return entry[0]; });
    var allowed = new Set(top);
    return function (value) {
      var key = isMissing(value, missingTokens) ? "UNKNOWN" : String(value);
      return allowed.has(key) ? key : "Other";
    };
  }

  function groupKey(row, variables) {
    if (!variables.length) return "All active samples";
    return variables.map(function (variable) {
      var value = row[variable];
      var missing = isMissing(value);
      return variable + "=" + (missing ? "UNKNOWN" : String(value));
    }).join(", ");
  }

  function worstCase(rows, variables, minSamples, kind, direction) {
    var groups = {};
    (rows || []).forEach(function (row) {
      var key = groupKey(row, variables || []);
      var group = groups[key] || (groups[key] = {
        key: key, n: 0, num: 0, den: 0, tp: 0, fp: 0, fn: 0
      });
      group.n += 1;
      group.num += finite(row._worst_num);
      group.den += finite(row._worst_den);
      group.tp += finite(row._tp);
      group.fp += finite(row._fp);
      group.fn += finite(row._fn);
    });
    var eligible = Object.keys(groups).map(function (key) {
      var group = groups[key];
      var denominator = kind === "f1" ? 2 * group.tp + group.fp + group.fn : group.den;
      if (group.n < minSamples || denominator <= 0) return null;
      group.value = kind === "f1" ? 2 * group.tp / denominator : group.num / denominator;
      return Number.isFinite(group.value) ? group : null;
    }).filter(Boolean);
    eligible.sort(function (a, b) {
      var delta = direction === "higher" ? a.value - b.value : b.value - a.value;
      return delta || b.n - a.n || a.key.localeCompare(b.key);
    });
    return eligible.length ? eligible[0] : null;
  }

  return {
    isMissing: isMissing,
    measurementType: measurementType,
    resolveAxesChart: resolveAxesChart,
    resolveChart: resolveChart,
    topCategoryMap: topCategoryMap,
    groupKey: groupKey,
    worstCase: worstCase
  };
});
