/* One diagnostic model at a time after the all-model comparison matrix. */
(function () {
  "use strict";
  function resize(root) {
    if (!window.Plotly) return;
    root.querySelectorAll(".js-plotly-plot").forEach(function (plot) {
      try { window.DM_COMPARISON.resize(plot); } catch (_error) { /* best effort */ }
    });
  }
  function boot() {
    document.querySelectorAll("[data-model-tabs]").forEach(function (grid) {
      var workspace = grid.closest(".models-workspace");
      var tabs = workspace && workspace.querySelector(".model-diagnostic-tabs");
      var panels = Array.prototype.slice.call(grid.querySelectorAll(":scope > [data-model-id]"));
      var buttons = tabs ? Array.prototype.slice.call(tabs.querySelectorAll("[data-model-tab]")) : [];
      if (!tabs || panels.length < 2 || buttons.length !== panels.length) {
        if (tabs) tabs.hidden = true;
        return;
      }
      function select(modelId) {
        panels.forEach(function (panel) {
          var active = panel.getAttribute("data-model-id") === modelId;
          panel.hidden = !active;
          panel.setAttribute("aria-hidden", active ? "false" : "true");
          if (active) setTimeout(function () { resize(panel); }, 30);
        });
        buttons.forEach(function (button) {
          var active = button.getAttribute("data-model-tab") === modelId;
          button.setAttribute("aria-selected", active ? "true" : "false");
          button.tabIndex = active ? 0 : -1;
        });
      }
      buttons.forEach(function (button, index) {
        button.addEventListener("click", function () { select(button.getAttribute("data-model-tab")); });
        button.addEventListener("keydown", function (event) {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          var next = (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next].focus(); buttons[next].click();
        });
      });
      select(buttons[0].getAttribute("data-model-tab"));
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
