/* At-a-glance strip: a compact headline row under the hero mirroring the visible model's
 * first KPIs (label · value · delta) so the panel reads at a glance. Reflects full-data
 * values; re-renders when the active model changes (dm:modelchange). Generalized: reads the
 * existing .kpi-card / .metric-card the panel already renders. */
(function () {
  "use strict";
  var strip;

  function cleanLabel(el) {
    if (!el) return "";
    var c = el.cloneNode(true);
    c.querySelectorAll(".info-icon, .kpi-ci").forEach(function (n) { n.remove(); });
    return (c.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(el) { return el.offsetParent !== null || el.getClientRects().length > 0; }

  function readMetrics() {
    // First few currently-visible headline cards (skips hidden model tabs; works whether or
    // not the panel uses model sections).
    var cards = Array.prototype.slice.call(document.querySelectorAll(".kpi-card, .metric-card"))
      .filter(isVisible).slice(0, 4);
    return cards.map(function (c) {
      var value = c.querySelector(".kpi-value, .metric-value");
      var delta = c.querySelector(".kpi-detail.good, .kpi-detail.bad, .metric-subtitle.good, .metric-subtitle.bad");
      return {
        label: cleanLabel(c.querySelector(".kpi-label, .metric-title")),
        value: value ? (value.textContent || "").trim() : "",
        deltaClass: delta ? (delta.classList.contains("good") ? "good" : "bad") : "",
        delta: delta ? (delta.textContent || "").replace(/\s+/g, " ").trim() : ""
      };
    }).filter(function (m) { return m.value; });
  }

  function modelName() {
    var h = document.querySelector(".model-section:not(.model-hidden) h2, .model-overview:not(.model-hidden) h2");
    return h ? (h.textContent || "").trim() : "";
  }

  function esc(s) { return String(s).replace(/[&<>]/g, function (m) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]; }); }

  function render() {
    var metrics = readMetrics();
    if (metrics.length < 2) { strip.hidden = true; return; }
    strip.hidden = false;
    var name = modelName();
    var html = name ? '<span class="aag-model">' + esc(name) + "</span>" : "";
    html += '<div class="aag-items">';
    metrics.forEach(function (m) {
      html += '<div class="aag-item"><span class="aag-label">' + esc(m.label) + "</span>" +
              '<span class="aag-value">' + esc(m.value) + "</span>" +
              (m.delta ? '<span class="aag-delta ' + m.deltaClass + '">' + esc(m.delta) + "</span>" : "") +
              "</div>";
    });
    html += "</div>";
    strip.innerHTML = html;
  }

  function boot() {
    var hero = document.querySelector(".hero");
    if (!hero) return;
    // Multi-model reports already lead with the full comparison matrix. Repeating
    // only the first model here would create a misleading visual preference.
    if (document.querySelector(".model-comparison-table") || document.querySelectorAll("[data-model-id]").length > 1) return;
    strip = document.createElement("section");
    strip.className = "at-a-glance";
    strip.setAttribute("aria-label", window.DM_I18N ? DM_I18N.t("common.at_a_glance") : "");
    strip.setAttribute("data-i18n-attr", "aria-label:common.at_a_glance");
    hero.parentNode.insertBefore(strip, hero.nextSibling);
    render();
    window.addEventListener("dm:modelchange", function () { setTimeout(render, 60); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
