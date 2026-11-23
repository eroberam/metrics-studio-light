/* Section navigation wraps on wide screens and becomes a compact select on narrow ones. */
(function () {
  "use strict";
  var SEL = ".section-title, .section-h, .subsection-title, .plot-title h2, .chart-card-head h3, .chart-head h4, .panel-head h2, .metric-group-head h2, details.collapsible > summary, details.model-detail-card > summary";
  var nav, links = [], targets = [], picker, io;
  function label(el) {
    var copy = el.cloneNode(true);
    copy.querySelectorAll(".info-icon, [data-threshold-label]").forEach(function (n) { n.remove(); });
    var value = (copy.textContent || "").replace(/\s+/g, " ").trim();
    return value.length > 42 ? value.slice(0, 40).trim() + "…" : value;
  }
  function visible(el) { return el.offsetParent !== null || el.getClientRects().length > 0; }
  function slug(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28); }
  function go(index) {
    var target = targets[index];
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    try { history.replaceState(null, "", "#" + target.id); } catch (e) { /* ignore */ }
  }
  function active(index) {
    links.forEach(function (link, i) {
      link.classList.toggle("active", i === index);
      if (i === index) link.setAttribute("aria-current", "true"); else link.removeAttribute("aria-current");
    });
    if (picker) picker.value = String(index);
  }
  function observe() {
    if (io) io.disconnect();
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { if (entry.isIntersecting) active(targets.indexOf(entry.target)); });
    }, { rootMargin: "-15% 0px -75% 0px", threshold: 0 });
    targets.forEach(function (target) { io.observe(target); });
  }
  function build() {
    var seen = {};
    var declared = Array.prototype.slice.call(document.querySelectorAll("[data-nav-section]"));
    var candidates = declared.length ? declared : Array.prototype.slice.call(document.querySelectorAll(SEL));
    targets = candidates.filter(visible).filter(function (el) {
      var value = label(el); if (!value || seen[value]) return false; seen[value] = true; return true;
    }).slice(0, 10);
    if (targets.length < 3) return false;
    nav = document.createElement("nav");
    nav.className = "section-nav";
    nav.setAttribute("aria-label", window.DM_I18N ? DM_I18N.t("common.report_sections") : "");
    nav.setAttribute("data-i18n-attr", "aria-label:common.report_sections");
    var linksWrap = document.createElement("div");
    linksWrap.className = "section-nav-links";
    picker = document.createElement("select");
    picker.className = "section-nav-select";
    picker.setAttribute("aria-label", window.DM_I18N ? DM_I18N.t("common.go_to_report_section") : "");
    picker.setAttribute("data-i18n-attr", "aria-label:common.go_to_report_section");
    links = [];
    targets.forEach(function (target, index) {
      if (!target.id) target.id = "sec-" + index + "-" + slug(label(target) || "section");
      target.classList.add("nav-anchor");
      var link = document.createElement("a");
      link.className = "section-nav-link";
      link.href = "#" + target.id;
      link.textContent = label(target);
      link.addEventListener("click", function (event) { event.preventDefault(); go(index); });
      linksWrap.appendChild(link); links.push(link);
      var option = document.createElement("option");
      option.value = String(index); option.textContent = label(target); picker.appendChild(option);
    });
    picker.addEventListener("change", function () { go(Number(picker.value)); });
    nav.appendChild(linksWrap); nav.appendChild(picker);
    observe(); active(0); return true;
  }
  function refreshLabels() {
    targets.forEach(function (target, index) {
      var value = label(target);
      if (links[index]) links[index].textContent = value;
      if (picker && picker.options[index]) picker.options[index].textContent = value;
    });
  }
  function boot() {
    if (!build()) return;
    var hero = document.querySelector(".hero"); if (!hero) return;
    var glance = document.querySelector(".at-a-glance");
    hero.parentNode.insertBefore(nav, glance ? glance.nextSibling : hero.nextSibling);
  }
  document.addEventListener("dm:langchange", refreshLabels);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
