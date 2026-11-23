/* Dependency-free SVG icon registry shared by every standalone report. */
(function () {
  "use strict";
  var paths = {
    studio: '<path d="M4 19V9m6 10V5m6 14v-7m4 7V3"/>',
    binary: '<circle cx="7" cy="12" r="3"/><circle cx="17" cy="12" r="3"/><path d="M10 12h4"/>',
    multiclass: '<circle cx="6" cy="7" r="2.5"/><circle cx="18" cy="7" r="2.5"/><circle cx="12" cy="17" r="2.5"/><path d="m8 9 3 5m5-5-3 5"/>',
    regression: '<path d="M4 18 9 13l4 2 7-9"/><path d="M4 5v13h16"/>',
    age_estimation: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
    ocr: '<path d="M5 3H3v4m16-4h2v4M5 21H3v-4m16 4h2v-4M7 8h10M7 12h10M7 16h6"/>',
    object_detection: '<path d="M4 4h5v2H6v3H4V4Zm11 0h5v5h-2V6h-3V4ZM4 15h2v3h3v2H4v-5Zm14 0h2v5h-5v-2h3v-3Z"/><rect x="8" y="8" width="8" height="7" rx="1"/>',
    segmentation: '<path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z"/><path d="m6 8 2-2 2 3m5 6 2-3 2 5"/>',
    eye_evaluation: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="3.2"/><path d="M12 8.8V5m3.2 7H19m-7 3.2V19m-3.2-7H5"/>',
    filter: '<path d="M4 5h16M7 12h10m-7 7h4"/><circle cx="8" cy="5" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>',
    export: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14"/>',
    notes: '<path d="M5 3h14v18H5zM8 8h8m-8 4h8m-8 4h5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    chart: '<path d="M4 19V9m5 10V5m5 14v-7m5 7V8"/>'
    ,compare: '<path d="M7 7h12m0 0-3-3m3 3-3 3M17 17H5m0 0 3-3m-3 3 3 3"/>'
    ,domain: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>'
    ,threshold: '<path d="M4 7h10m4 0h2M4 17h2m4 0h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'
    ,decimals: '<path d="M5 7h14M5 12h14M5 17h14M9 4v16m6-16v16"/>'
    ,mode: '<path d="M20 15.2A8 8 0 1 1 8.8 4 6.5 6.5 0 0 0 20 15.2Z"/>'
    ,html: '<path d="m9 7-5 5 5 5m6-10 5 5-5 5M13 4l-2 16"/>'
    ,database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/>'
    ,alert: '<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5m0 3h.01"/>'
    ,table: '<path d="M4 5h16v14H4zM4 10h16M9 5v14"/>'
    ,statistics: '<path d="M4 19V9h4v10m4 0V5h4v14m4 0v-7h-4"/>'
    ,methodology: '<path d="M5 4h14v16H5zM8 8h8m-8 4h8m-8 4h5"/><path d="m15 16 2 2 3-4"/>'
    ,audit: '<path d="M12 3 5 6v5c0 4.5 2.8 8 7 10 4.2-2 7-5.5 7-10V6l-7-3Z"/><path d="M9 12h6m-3-3v6"/>'
    ,tracking: '<path d="M3 16c3-7 6 3 9-4s6 3 9-5"/><circle cx="3" cy="16" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="21" cy="7" r="1.2"/>'
    ,signal: '<path d="M2 12h4l2-6 4 12 3-9 2 3h5"/>'
    ,settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.96 19.36a1.7 1.7 0 0 0-1.87.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.04H3v-4h.04A1.7 1.7 0 0 0 4.6 8.92a1.7 1.7 0 0 0-.34-1.87L4.2 6.99l2.83-2.83.06.06a1.7 1.7 0 0 0 1.87.34A1.7 1.7 0 0 0 10 3V3h4v.08a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06 2.83 2.83-.06.06a1.7 1.7 0 0 0-.34 1.87 1.7 1.7 0 0 0 1.56 1.04H21v4h-.04A1.7 1.7 0 0 0 19.4 15Z"/>'
    ,search: '<circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/>'
    ,cohort: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="7" r="2"/><path d="M3.5 19c.4-4 2.2-6 5.5-6s5.1 2 5.5 6M14 13c3.8-.5 6 1.5 6.5 5"/>'
  };
  function icon(name, title) {
    var body = paths[name] || paths.chart;
    var label = title ? ' role="img" aria-label="' + String(title).replace(/"/g, "&quot;") + '"' : ' aria-hidden="true"';
    return '<svg class="dm-icon dm-icon-' + name + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"' + label + '>' + body + '</svg>';
  }
  function decorate(root) {
    (root || document).querySelectorAll("[data-dm-icon]").forEach(function (node) {
      if (node.dataset.iconReady === "1") return;
      node.innerHTML = icon(node.getAttribute("data-dm-icon"));
      node.dataset.iconReady = "1";
    });
  }
  window.DM_ICONS = { get: icon };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { decorate(document); }); else decorate(document);
  window.DM_ICONS.decorate = decorate;
})();
