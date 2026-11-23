/* English-only interface backed by external locale resources.
 *
 * Locale tables are embedded in <script type="application/json" id="i18n-data">
 * as {"en": {key: text}, "es": {...}}. Server-rendered strings carry
 * data-i18n="key" (+ optional data-i18n-args JSON and data-i18n-attr
 * "attr:key;attr2:key2"); apply() swaps them in place. Dynamic renderers call
 * DM_I18N.t(key, args) and re-render on the "dm:langchange" event.
 * Standardized metric names (MAE, ROC-AUC, …) are literals — never translated. */
(function () {
  "use strict";
  var TABLES = null;

  function tables() {
    if (TABLES === null) {
      var el = document.getElementById("i18n-data");
      try { TABLES = el ? JSON.parse(el.textContent) : {}; } catch (e) { TABLES = {}; }
    }
    return TABLES;
  }

  // Ignore legacy saved/configured languages: reports are always English.
  function lang() { return "en"; }

  function subst(text, args) {
    if (!args) return text;
    return text.replace(/\{(\w+)\}/g, function (m, name) {
      return Object.prototype.hasOwnProperty.call(args, name) ? String(args[name]) : m;
    });
  }

  function get(key, language, args) {
    var table = tables()[language] || {};
    // Missing localized copy must remain visible as a missing key. Falling
    // back to English hides catalogue defects and creates mixed-language UI.
    var text = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key;
    return subst(text, args);
  }

  function t(key, args) { return get(key, lang(), args); }

  function nodeArgs(el) {
    var raw = el.getAttribute("data-i18n-args");
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function apply() {
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"), nodeArgs(el));
    });
    document.querySelectorAll("[data-i18n-attr]").forEach(function (el) {
      el.getAttribute("data-i18n-attr").split(";").forEach(function (pair) {
        var i = pair.indexOf(":");
        if (i > 0) el.setAttribute(pair.slice(0, i).trim(), t(pair.slice(i + 1).trim()));
      });
    });
    relayoutPlots();
  }

  var PLOT_VALUE_KEYS = null;
  function plotValueKeys() {
    if (PLOT_VALUE_KEYS) return PLOT_VALUE_KEYS;
    PLOT_VALUE_KEYS = {};
    Object.keys(tables()).forEach(function (language) {
      var table = tables()[language] || {};
      Object.keys(table).forEach(function (key) {
        if (key.indexOf("plot.") !== 0) return;
        PLOT_VALUE_KEYS[table[key]] = key;
      });
    });
    return PLOT_VALUE_KEYS;
  }

  function plotText(value) {
    if (typeof value !== "string" || !value) return value;
    var keys = plotValueKeys();
    if (keys[value]) return t(keys[value]);
    var translated = value;
    Object.keys(keys).sort(function (a, b) { return b.length - a.length; }).forEach(function (source) {
      if (source.length < 4 || translated.indexOf(source) === -1) return;
      translated = translated.split(source).join(t(keys[source]));
    });
    return translated;
  }

  function localizePlot(plot) {
    if (!plot || !plot.data || !plot.layout) return;
    var changed = false;
    plot.data.forEach(function (trace) {
      ["name", "hovertemplate", "texttemplate"].forEach(function (field) {
        if (typeof trace[field] !== "string") return;
        var next = plotText(trace[field]);
        if (next !== trace[field]) { trace[field] = next; changed = true; }
      });
      var colorbarTitle = trace.colorbar && trace.colorbar.title;
      if (colorbarTitle && typeof colorbarTitle.text === "string") {
        var nextColorbar = plotText(colorbarTitle.text);
        if (nextColorbar !== colorbarTitle.text) { colorbarTitle.text = nextColorbar; changed = true; }
      }
    });
    Object.keys(plot.layout).forEach(function (field) {
      if (!/^(?:xaxis|yaxis|coloraxis)/.test(field)) return;
      var axis = plot.layout[field];
      if (axis && axis.title && typeof axis.title.text === "string") {
        var nextTitle = plotText(axis.title.text);
        if (nextTitle !== axis.title.text) { axis.title.text = nextTitle; changed = true; }
      }
    });
    (plot.layout.annotations || []).forEach(function (annotation) {
      if (typeof annotation.text !== "string") return;
      var nextAnnotation = plotText(annotation.text);
      if (nextAnnotation !== annotation.text) { annotation.text = nextAnnotation; changed = true; }
    });
    (plot.layout.updatemenus || []).forEach(function (menu) {
      (menu.buttons || []).forEach(function (button) {
        if (typeof button.label !== "string") return;
        var nextLabel = plotText(button.label);
        if (nextLabel !== button.label) { button.label = nextLabel; changed = true; }
      });
    });
    function localizeChrome() {
      plot.querySelectorAll("[data-title],[aria-label],[title]").forEach(function (node) {
        ["data-title", "aria-label", "title"].forEach(function (attribute) {
          var value = node.getAttribute(attribute);
          if (value) node.setAttribute(attribute, plotText(value));
        });
      });
    }
    if (changed) {
      try { window.Plotly.redraw(plot); } catch (e) { /* non-Plotly diagnostic */ }
      window.setTimeout(localizeChrome, 0);
    } else localizeChrome();
  }

  // Figure-internal words that are genuinely translatable (axis words such as
  // "Count") are declared per chart as data-i18n-plot='{"yaxis.title.text":"key"}'
  // on the plot div itself or on a wrapper around a server-rendered figure.
  function relayoutPlots() {
    if (!window.Plotly) return;
    document.querySelectorAll("[data-i18n-plot]").forEach(function (el) {
      var plot = el.classList.contains("js-plotly-plot") ? el : el.querySelector(".js-plotly-plot");
      if (!plot) return;
      var map;
      try { map = JSON.parse(el.getAttribute("data-i18n-plot")); } catch (e) { return; }
      var patch = {};
      Object.keys(map).forEach(function (path) { patch[path] = t(map[path]); });
      try { window.Plotly.relayout(plot, patch); } catch (e) { /* ignore */ }
    });
    document.querySelectorAll(".js-plotly-plot").forEach(localizePlot);
  }

  // Compatibility entry point for integrations; language selection is retired.
  function setLang(l) {
    if (l !== "en") return false;
    document.documentElement.setAttribute("lang", "en");
    apply();
    return true;
  }

  function boot() {
    if (!document.getElementById("i18n-data")) return; // page has no locale data
    document.documentElement.setAttribute("lang", lang());
    apply();
  }

  window.DM_I18N = { t: t, get: get, lang: lang, setLang: setLang, apply: apply, localizePlot: localizePlot };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
