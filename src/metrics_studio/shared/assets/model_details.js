/* Progressive disclosure for task-specific diagnostics after the all-model comparison. */
(function () {
  "use strict";
  function tt(key) {
    return window.DM_I18N ? window.DM_I18N.t(key) : key;
  }
  function boot() {
    var sections = Array.prototype.slice.call(document.querySelectorAll(
      ".model-overview[data-model-id], .model-section[data-model-id]"
    )).filter(function (section) { return !section.closest(".models-workspace"); });
    if (sections.length < 2) return;
    sections.forEach(function (section, index) {
      var heading = section.querySelector("h2");
      var name = heading ? heading.textContent.trim() : tt("common.model") + " " + (index + 1);
      var details = document.createElement("details");
      details.className = "model-detail-card";
      details.open = index === 0;
      var summary = document.createElement("summary");
      summary.innerHTML = (window.DM_ICONS ? window.DM_ICONS.get("chart") : "") +
        '<span class="model-detail-label"><small data-i18n="common.model_diagnostics">' + tt("common.model_diagnostics") + '</small><strong></strong></span>' +
        '<span class="model-detail-state" aria-hidden="true">＋</span>';
      summary.querySelector("strong").textContent = name;
      section.parentNode.insertBefore(details, section);
      details.appendChild(summary);
      details.appendChild(section);
      details.addEventListener("toggle", function () {
        if (!details.open || !window.Plotly) return;
        setTimeout(function () {
          details.querySelectorAll(".js-plotly-plot").forEach(function (plot) {
            try { window.DM_COMPARISON.resize(plot); } catch (e) { /* ignore */ }
          });
        }, 30);
      });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
