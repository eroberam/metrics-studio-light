/* Shared light chart presentation and high-resolution PNG export. */
(function () {
  "use strict";
  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function plotColors() {
    return {
      ink: cssVar("--ink", "#172033"),
      grid: cssVar("--chart-grid", "rgba(148,163,184,.35)"),
      card: cssVar("--card", "#ffffff"),
      line: cssVar("--line", "#e5eaf1"),
    };
  }

  // Apply shared light colours to static and dynamic charts.
  function stylePlot(el) {
    if (!el || !el.layout || !window.Plotly) return;
    var c = plotColors();
    var patch = {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      "font.color": c.ink,
      "legend.font.color": c.ink,
      "legend.bgcolor": c.card,
      "legend.bordercolor": c.line,
      "title.font.color": c.ink,
    };
    Object.keys(el.layout).forEach(function (k) {
      if (/^(xaxis|yaxis)/.test(k)) {
        patch[k + ".gridcolor"] = c.grid;
        patch[k + ".zerolinecolor"] = c.grid;
        patch[k + ".linecolor"] = c.grid;
        patch[k + ".tickfont.color"] = c.ink;
        patch[k + ".title.font.color"] = c.ink;
      }
    });
    try { window.Plotly.relayout(el, patch); } catch (e) { /* ignore */ }
  }

  function styleAllPlots() {
    document.querySelectorAll(".js-plotly-plot").forEach(stylePlot);
  }

  // Shared display config: high-res PNG export, zoom/pan/selection and no logo. Mirrors
  // shared/plotly_config.py (used server-side for the static figures).
  var DM_PLOT_CONFIG = {
    displaylogo: false,
    displayModeBar: true,
    scrollZoom: false,
    doubleClick: "reset+autosize",
    toImageButtonOptions: { format: "png", filename: "metrics_studio_chart", scale: 2 },
  };

  function slug(value) {
    return String(value || "chart").toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "chart";
  }

  function exportFilename(el) {
    var node = typeof el === "string" ? document.getElementById(el) : el;
    var card = node && node.closest ? node.closest(".dm-binary-curve-card,.dm-binary-decision-card,.dm-binary-evidence-card,.chart-card,.plot-section,.dash-section,.figure-card") : null;
    var heading = card ? card.querySelector("h2,h3,h4,.section-title") : null;
    var task = document.body.getAttribute("data-dashboard-task") || document.title || "metrics_studio";
    return slug(task) + "__" + slug(heading ? heading.textContent : (node && node.id));
  }

  // Catch dynamically (re)rendered charts: merge the display config, then re-theme.
  function patchPlotly() {
    if (!window.Plotly || window.Plotly.__dmPresented) return;
    ["newPlot", "react"].forEach(function (fn) {
      var orig = window.Plotly[fn];
      if (typeof orig !== "function") return;
      window.Plotly[fn] = function (el, data, layout, config) {
        var args = Array.prototype.slice.call(arguments);
        var merged = Object.assign({}, DM_PLOT_CONFIG, config || {});
        merged.toImageButtonOptions = Object.assign({}, DM_PLOT_CONFIG.toImageButtonOptions,
          (config && config.toImageButtonOptions) || {}, { filename: exportFilename(el) });
        args[3] = merged;
        var res = orig.apply(this, args);
        var node = typeof el === "string" ? document.getElementById(el) : el;
        if (res && typeof res.then === "function") res.then(function () { stylePlot(node); });
        else stylePlot(node);
        return res;
      };
    });
    window.Plotly.__dmPresented = true;
  }

  function boot(){document.documentElement.dataset.theme="light";patchPlotly();styleAllPlots();setTimeout(styleAllPlots,250);setTimeout(styleAllPlots,1000);}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();
