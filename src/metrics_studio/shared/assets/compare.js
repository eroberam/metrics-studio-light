/* Opt-in cross-model deltas with a user-selectable comparison reference. */
(function () {
  "use strict";
  function tt(key) {
    return window.DM_I18N ? window.DM_I18N.t(key) : key;
  }
  function finite(node) {
    var value = Number(node.getAttribute("data-compare-raw"));
    return Number.isFinite(value) ? value : null;
  }
  function clear(section) {
    section.querySelectorAll(".compare-delta,.compare-reference").forEach(function (node) { node.remove(); });
  }
  function runtimeExperiments() {
    try { return JSON.parse(document.getElementById("dm-ui-config").textContent).experiments || []; }
    catch (_error) { return []; }
  }
  function render(section, referenceIndex) {
    clear(section);
    var cells = Array.prototype.slice.call(section.querySelectorAll("[data-compare-metric][data-model-index]"));
    var groups = {};
    cells.forEach(function (cell) { (groups[cell.dataset.compareMetric] ||= []).push(cell); });
    Object.keys(groups).forEach(function (key) {
      var items = groups[key];
      var reference = items.find(function (cell) { return cell.dataset.modelIndex === String(referenceIndex); });
      var ref = reference && finite(reference);
      if (ref === null || ref === undefined) return;
      var badge = document.createElement("span");
      badge.className = "compare-reference";
      badge.textContent = tt("common.reference");
      reference.appendChild(badge);
      items.forEach(function (cell) {
        if (cell === reference) return;
        var value = finite(cell); if (value === null) return;
        var delta = ref === 0 ? value - ref : (value - ref) / Math.abs(ref);
        var better = cell.dataset.better || "neutral";
        var good = better === "lower" ? delta < 0 : better === "higher" ? delta > 0 : null;
        var mark = document.createElement("span");
        mark.className = "compare-delta " + (good === null || Math.abs(delta) < 1e-12 ? "neutral" : good ? "good" : "bad");
        var amount = ref === 0 ? Math.abs(delta).toPrecision(3) : (Math.abs(delta) * 100).toFixed(1) + "%";
        mark.textContent = (delta > 0 ? "▲ " : delta < 0 ? "▼ " : "● ") + amount;
        mark.title = tt("common.vs_reference");
        cell.appendChild(mark);
      });
    });
  }
  function enhance(table) {
    if (table.dataset.compareReady === "1") return;
    var models = new Set(Array.prototype.map.call(table.querySelectorAll("[data-model-index]"), function (node) { return node.dataset.modelIndex; }));
    if (models.size < 2) return;
    table.dataset.compareReady = "1";
    var section = table.closest("section,.models-workspace,.dash-section") || table.parentElement;
    var previous = section.querySelector(".compare-controls");
    if (previous) { previous.remove(); clear(section); section.classList.remove("compare-active"); }
    var anchor = section.querySelector(".section-title,.workspace-title,.panel-head,h2");
    var experiments = runtimeExperiments();
    var indexes = Array.from(models).sort(function (a, b) { return Number(a) - Number(b); });
    var baseline = experiments.findIndex(function (experiment) { return experiment.role === "baseline"; });
    var defaultReference = baseline >= 0 && models.has(String(baseline)) ? String(baseline) : indexes[1];
    var controls = document.createElement("span"); controls.className = "compare-controls";
    var select = document.createElement("select");
    select.className = "compare-reference-select";
    select.setAttribute("aria-label", tt("common.reference_model"));
    indexes.forEach(function (index) {
      var option = document.createElement("option");
      option.value = index;
      option.textContent = experiments[Number(index)]?.name || (tt("common.model") + " " + (Number(index) + 1));
      option.selected = index === defaultReference;
      select.appendChild(option);
    });
    var button = document.createElement("button");
    button.type = "button"; button.className = "compare-toggle"; button.setAttribute("aria-pressed", "false");
    button.innerHTML = (window.DM_ICONS ? window.DM_ICONS.get("compare") : "") + '<span data-i18n="common.compare">' + tt("common.compare") + "</span>";
    button.addEventListener("click", function () {
      var on = button.getAttribute("aria-pressed") !== "true";
      button.setAttribute("aria-pressed", on ? "true" : "false");
      section.classList.toggle("compare-active", on);
      if (on) render(section, select.value); else clear(section);
    });
    select.addEventListener("change", function () {
      if (button.getAttribute("aria-pressed") === "true") render(section, select.value);
    });
    controls.appendChild(select); controls.appendChild(button);
    if (section.classList.contains("models-workspace") && section.querySelector(".workspace-head")) {
      controls.classList.add("workspace-compare");
      section.querySelector(".workspace-head").appendChild(controls);
    } else if (anchor) anchor.insertAdjacentElement("afterend", controls); else section.insertBefore(controls, section.firstChild);
  }
  function scan(root) { (root || document).querySelectorAll("table").forEach(enhance); }
  function boot() {
    scan(document);
    new MutationObserver(function () { scan(document); }).observe(document.body, { childList:true, subtree:true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
