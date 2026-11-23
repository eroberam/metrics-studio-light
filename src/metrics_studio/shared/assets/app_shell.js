/* Standalone Metrics Studio shell. It deliberately contains no links to other tasks:
 * each generated report is an independent product surface backed by shared utilities. */
(function () {
  "use strict";
  function tt(key, args) { return window.DM_I18N ? window.DM_I18N.t(key, args) : key; }
  function task() {
    var match = (location.pathname || "").match(/dashboard_(binary|multiclass|regression|age_estimation|ocr|object_detection|segmentation|eye_evaluation|eye_tracking)\.html$/);
    return match ? match[1] : "dashboard";
  }
  function icon(name) { return window.DM_ICONS ? window.DM_ICONS.get(name) : ""; }
  function identity(hero, id) {
    if (hero.querySelector(".studio-identity")) return;
    var title = hero.querySelector("h1");
    if (!title) return;
    var titleKey = "shell.title." + id;
    var canonicalTitle = window.DM_I18N && window.DM_I18N.get ? window.DM_I18N.get(titleKey, "en") : titleKey;
    if (title.textContent.trim() === canonicalTitle) {
      if (document.title.trim() === canonicalTitle) document.documentElement.setAttribute("data-document-title-i18n", titleKey);
      title.setAttribute("data-i18n", titleKey);
      title.textContent = tt(titleKey);
      if (document.documentElement.getAttribute("data-document-title-i18n") === titleKey) document.title = tt(titleKey);
    }
    var row = document.createElement("div");
    row.className = "studio-identity";
    var iconId = id === "eye_tracking" ? "eye_evaluation" : id;
    row.innerHTML = '<div class="studio-brand"><span class="studio-mark">' + icon(iconId) + '</span>' +
      '<span><strong>Metrics Studio</strong><small data-i18n="shell.task.' + id + '">' + tt("shell.task." + id) + '</small></span></div>' +
      '<span class="analysis-status">' + icon("check") + '<span data-i18n="shell.ready">' + tt("shell.ready") + "</span></span>";
    hero.insertBefore(row, title);
    hero.classList.add("studio-hero");
    hero.setAttribute("data-panel", id);
  }
  function contextChips(hero) {
    if (hero.querySelector(".config-strip")) return;
    var runtime = {};
    try { runtime = JSON.parse(document.getElementById("dm-ui-config").textContent) || {}; } catch (_error) { /* defaults */ }
    var experiments = runtime.experiments || [];
    var ci = runtime.statistics && runtime.statistics.confidence_intervals;
    var strip = document.createElement("div");
    strip.className = "config-strip";
    var countKey = experiments.length === 1 ? "shell.model_count" : "shell.models_count";
    var labels = [
      { key: countKey, args: { n: experiments.length } },
      { key: "shell.interactive_report", args: null }
    ];
    if (ci && ci.enabled) labels.push({ key: "ci.label", args: { pct: Math.round((ci.level || .95) * 100) } });
    strip.innerHTML = labels.map(function (item) {
      var args = item.args ? ' data-i18n-args=\'' + JSON.stringify(item.args) + '\'' : "";
      return '<span class="pill" data-i18n="' + item.key + '"' + args + '>' + tt(item.key, item.args) + "</span>";
    }).join("");
    var controls = hero.querySelector(".dm-controls");
    hero.insertBefore(strip, controls || null);
  }
  function accessibility(main) {
    main.id = "dashboard-content";
    main.setAttribute("tabindex", "-1");
    document.querySelectorAll("table thead th").forEach(function (th) { if (!th.hasAttribute("scope")) th.scope = "col"; });
    document.querySelectorAll(".plot-target, .js-plotly-plot").forEach(function (plot, index) {
      var card = plot.closest(".chart-card, .dynamic-chart-card, .plot-section, section");
      var heading = card && card.querySelector("h2, h3, h4, .section-title");
      var interactive = plot.classList.contains("js-plotly-plot") || !!plot.querySelector("button,input,select,a[href]");
      plot.setAttribute("role", interactive ? "region" : "img");
      if (!plot.hasAttribute("aria-label") || plot.getAttribute("data-dm-auto-label") === "1") {
        plot.setAttribute("aria-label", heading ? heading.textContent.trim() : tt("shell.chart") + " " + (index + 1));
        plot.setAttribute("data-dm-auto-label", "1");
      }
    });
    document.querySelectorAll(".info-icon").forEach(function (el) {
      el.setAttribute("role", "button");
      if (!el.hasAttribute("aria-label")) el.setAttribute("aria-label", el.getAttribute("data-tooltip") || tt("shell.more_info"));
    });
  }
  function boot() {
    var main = document.querySelector("main");
    if (!main) return;
    var id = task();
    document.documentElement.setAttribute("data-dashboard", id);
    var skip = document.createElement("a");
    skip.className = "skip-link";
    skip.href = "#dashboard-content";
    skip.setAttribute("data-i18n", "shell.skip");
    skip.textContent = tt("shell.skip");
    document.body.insertBefore(skip, document.body.firstChild);
    var hero = main.querySelector(".hero");
    if (hero) { identity(hero, id); contextChips(hero); }
    accessibility(main);
    setTimeout(function () { accessibility(main); }, 1200);
    document.addEventListener("dm:langchange", function () {
      var titleKey = document.documentElement.getAttribute("data-document-title-i18n");
      if (titleKey) document.title = tt(titleKey);
      accessibility(main);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
