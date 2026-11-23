/* Places legacy filter controls in the shared analysis scope. */
(function () {
  "use strict";
  function tt(key, fallback) {
    if (!window.DM_I18N) return fallback;
    var value = window.DM_I18N.t(key); return value && value !== key ? value : fallback;
  }
  function icon(name) { return window.DM_ICONS ? window.DM_ICONS.get(name) : ""; }
  function insertionPoint() {
    var nav = document.querySelector(".section-nav");
    if (nav) return { parent: nav.parentNode, before: nav.nextSibling };
    var hero = document.querySelector(".hero");
    var glance = document.querySelector(".at-a-glance:not([hidden])");
    var anchor = glance || hero;
    return anchor ? { parent: anchor.parentNode, before: anchor.nextSibling } : null;
  }
  function owner(gfp) {
    var root = gfp.closest("[data-model-id]");
    if (!root) return { id: "global", name: "" };
    var heading = root.querySelector("h2");
    return { id: root.getAttribute("data-model-id") || "global", name: heading ? heading.textContent.trim() : "" };
  }
  function filterDock(point) {
    var filters = Array.prototype.slice.call(document.querySelectorAll(".gfp"));
    if (!filters.length) return null;
    var dock = document.createElement("section");
    dock.className = "control-dock filter-dock";
    dock.innerHTML = '<div class="control-dock-head"><span class="control-dock-icon">' + icon("filter") + '</span><div><span data-i18n="panel.filters.title">' + tt("panel.filters.title", "Filters") + '</span><small data-i18n="common.filters_context">' + tt("common.filters_context", "Analysis scope") + "</small></div></div>";
    var grid = document.createElement("div"); grid.className = "control-dock-grid";
    filters.forEach(function (gfp) {
      var info = owner(gfp);
      gfp.setAttribute("data-filter-owner", info.id);
      var card = document.createElement("div"); card.className = "control-dock-card";
      card.setAttribute("data-filter-owner", info.id);
      if (info.name && filters.length > 1) {
        var label = document.createElement("strong"); label.className = "control-dock-model"; label.textContent = info.name; card.appendChild(label);
      }
      card.appendChild(gfp); grid.appendChild(card);
    });
    if (filters.length > 1) {
      var linked = false;
      var syncing = false;
      var linkButton = document.createElement("button");
      linkButton.type = "button";
      linkButton.className = "filter-link-toggle";
      linkButton.setAttribute("aria-pressed", "false");
      function updateLinkLabel() {
        var key = linked ? "common.unlink_filters" : "common.link_filters";
        linkButton.setAttribute("data-i18n", key);
        linkButton.textContent = tt(key, linked ? "Unlink filters" : "Link filters");
      }
      updateLinkLabel();
      linkButton.addEventListener("click", function () {
        linked = !linked;
        linkButton.setAttribute("aria-pressed", linked ? "true" : "false");
        updateLinkLabel();
      });
      dock.querySelector(".control-dock-head").appendChild(linkButton);
      function syncFrom(sourceCard) {
        if (!linked || syncing || !sourceCard) return;
        syncing = true;
        sourceCard.querySelectorAll(".filter-selector").forEach(function (source) {
          grid.querySelectorAll('.control-dock-card:not([data-filter-owner="' + sourceCard.getAttribute("data-filter-owner") + '"]) .filter-selector').forEach(function (target) {
            if (target.dataset.filterVar !== source.dataset.filterVar || target.value !== source.value || target.checked === source.checked) return;
            target.checked = source.checked;
            target.dispatchEvent(new Event("change", { bubbles: true }));
          });
        });
        syncing = false;
      }
      grid.addEventListener("change", function (event) {
        if (event.target.matches(".filter-selector")) syncFrom(event.target.closest(".control-dock-card"));
      });
      grid.addEventListener("click", function (event) {
        if (event.target.closest(".filter-select-all,.filter-clear-all,.select-all-filters,.clear-all-filters")) {
          var card = event.target.closest(".control-dock-card");
          setTimeout(function () { syncFrom(card); }, 0);
        }
      });
    }
    dock.appendChild(grid); point.parent.insertBefore(dock, point.before); return dock;
  }
  function boot() {
    var point = insertionPoint(); if (!point) return;
    filterDock(point);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
