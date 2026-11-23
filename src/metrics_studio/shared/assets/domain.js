/* Case-study terminology selector (spec §3.7) — rewrites metric NAMES to the
 * active profile's convention (e.g. Recall -> Sensitivity in clinical,
 * FAR -> APCER in presentation_attack_detection). Aliases never change the
 * underlying math: internal metric keys stay stable and in English.
 *
 * The alias map (window.DM_DOMAIN_LABELS) is bundled by scripts.py from
 * glossary/domains.yaml. The profile list comes from the embedded
 * case_study config (dm-ui-config); without it the legacy built-in list is
 * used. The selection persists in localStorage ("dm-case-study", migrating
 * the legacy "dm-domain" key) and is exposed as
 * document.documentElement.dataset.caseStudy for notes/export context. */
(function () {
  "use strict";
  var KEY = "dm-case-study";
  var LEGACY_KEY = "dm-domain";
  var LEGACY_PROFILES = ["generic", "clinical", "presentation_attack_detection", "biometric_verification"];
  var MIGRATIONS = {general:"generic", security:"presentation_attack_detection", biometrics:"biometric_verification", ir:"generic"};
  var MAP = window.DM_DOMAIN_LABELS || {};

  function caseStudyConfig() {
    var el = document.getElementById("dm-ui-config");
    try { return (JSON.parse(el.textContent) || {}).case_study || null; } catch (e) { return null; }
  }

  var CS = caseStudyConfig();

  function tt(key, fallback) {
    if (window.DM_I18N) {
      var txt = window.DM_I18N.t(key);
      if (txt !== key) return txt;
    }
    return fallback;
  }

  function profiles() {
    var ids = (CS && CS.selectable && CS.selectable.length) ? CS.selectable.slice() : LEGACY_PROFILES.slice();
    // Merge a custom profile's aliases into the map using the active language.
    if (CS && CS.custom_profile && CS.custom_profile.id) {
      var id = String(CS.custom_profile.id);
      if (ids.indexOf(id) === -1) ids.push(id);
      var labels = CS.custom_profile.labels || {};
      var lang = window.DM_I18N ? window.DM_I18N.lang() : "en";
      var aliases = {};
      Object.keys(labels).forEach(function (metric) {
        var v = labels[metric];
        aliases[metric] = (v && typeof v === "object") ? (v[lang] || v.en || "") : String(v);
      });
      MAP[id] = aliases;
    }
    return ids;
  }

  function profileLabel(id) {
    var canonical = {
      generic: "Generic / ML · FAR", clinical: "Clinical · Sensitivity",
      presentation_attack_detection: "Security / PAD · APCER",
      biometric_verification: "Biometric verification · FNMR"
    };
    var pretty = id.replace(/_/g, " ").replace(/^./, function (c) { return c.toUpperCase(); });
    return tt("case_study.profile." + id, canonical[id] || pretty);
  }

  function controlBar() {
    var hero = document.querySelector(".hero");
    if (!hero) return document.body;
    var bar = hero.querySelector(".dm-controls");
    if (!bar) { bar = document.createElement("div"); bar.className = "dm-controls"; hero.appendChild(bar); }
    return bar;
  }

  function targets() { return document.querySelectorAll("[data-metric-key]"); }

  function aliasableKeys() {
    var s = {};
    Object.keys(MAP).forEach(function (d) {
      Object.keys(MAP[d] || {}).forEach(function (k) { s[k] = 1; });
    });
    return s;
  }

  function hasAliasable() {
    var s = aliasableKeys(), found = false;
    targets().forEach(function (el) { if (s[el.getAttribute("data-metric-key")]) found = true; });
    return found;
  }

  function applyProfile(id) {
    var aliases = MAP[id] || {};
    targets().forEach(function (el) {
      if (!el.hasAttribute("data-canonical")) el.setAttribute("data-canonical", el.textContent);
      var key = el.getAttribute("data-metric-key");
      el.textContent = aliases[key] || el.getAttribute("data-canonical");
    });
    document.documentElement.setAttribute("data-case-study", id);
    try { localStorage.setItem(KEY, id); } catch (e) { /* ignore */ }
  }

  function initialProfile() {
    var ids = profiles();
    var saved = null;
    try {
      saved = localStorage.getItem(KEY);
      if (!saved) {
        // Migrate the legacy field-of-study preference.
        var legacy = localStorage.getItem(LEGACY_KEY);
        legacy = MIGRATIONS[legacy] || legacy;
        saved = legacy;
      }
    } catch (e) { /* ignore */ }
    if (saved && ids.indexOf(saved) !== -1) return saved;
    var def = CS && CS.default ? CS.default : "general";
    return ids.indexOf(def) !== -1 ? def : ids[0];
  }

  function makeSelect(current) {
    var wrap = document.createElement("label");
    wrap.className = "domain-select-wrap case-study-wrap";
    var icon = document.createElement("span");
    icon.className = "case-study-icon";
    icon.innerHTML = window.DM_ICONS ? window.DM_ICONS.get("domain") : "";
    var copy = document.createElement("span");
    copy.className = "case-study-copy";
    var span = document.createElement("span");
    span.className = "domain-select-label";
    span.setAttribute("data-i18n", "settings.case_study");
    span.textContent = tt("settings.case_study", "Field of study");
    var hint = document.createElement("small");
    hint.setAttribute("data-i18n", "settings.case_study_hint");
    hint.textContent = tt("settings.case_study_hint", "Metric terminology profile");
    var sel = document.createElement("select");
    sel.className = "domain-select case-study-select";
    sel.setAttribute("aria-label", tt("settings.case_study", "Field of study"));
    profiles().forEach(function (id) {
      var o = document.createElement("option");
      o.value = id;
      o.setAttribute("data-i18n", "case_study.profile." + id);
      o.textContent = profileLabel(id);
      if (id === current) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () { applyProfile(sel.value); });
    copy.appendChild(span);
    copy.appendChild(hint);
    wrap.appendChild(icon);
    wrap.appendChild(copy);
    wrap.appendChild(sel);
    return wrap;
  }

  function boot() {
    var cur = initialProfile();
    var allowChange = !CS || CS.allow_runtime_change !== false;
    if (allowChange && !document.querySelector(".case-study-select")) {
      controlBar().appendChild(makeSelect(cur));
    }
    applyProfile(cur);
    // Custom-profile aliases are language-dependent — refresh them on switch.
    document.addEventListener("dm:langchange", function () {
      CS = caseStudyConfig();
      applyProfile(document.documentElement.getAttribute("data-case-study") || cur);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
