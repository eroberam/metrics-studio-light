/* Global decimal precision (spec §3.3).
 *
 * The server emits raw values as data-raw="0.03721" data-fmt="num|pct|count|…"
 * on display nodes; DM_FMT formats them with the active precision. A − / +
 * control (injected into the hero when ui.allow_runtime_decimal_change) changes
 * the precision live: applyStatic() reformats every [data-raw] node and the
 * "dm:decimalschange" event tells panels to re-render their dynamic parts.
 * Machine exports (CSV/JSON) never go through DM_FMT — full precision. */
(function () {
  "use strict";
  var KEY = "dm-decimals";

  function uiConfig() {
    var el = document.getElementById("dm-ui-config");
    try { return el ? (JSON.parse(el.textContent).ui || {}) : {}; } catch (e) { return {}; }
  }

  var UI = null;
  function ui() { if (UI === null) UI = uiConfig(); return UI; }

  var current = null;

  function bounds() {
    var u = ui();
    return {
      min: Number.isFinite(u.decimals_min) ? u.decimals_min : 0,
      max: Number.isFinite(u.decimals_max) ? u.decimals_max : 6,
      def: Number.isFinite(u.decimals) ? u.decimals : 2,
    };
  }

  function decimals() {
    if (current !== null) return current;
    var b = bounds();
    var saved = null;
    try { saved = parseInt(localStorage.getItem(KEY), 10); } catch (e) { /* ignore */ }
    current = Number.isFinite(saved) ? Math.min(b.max, Math.max(b.min, saved)) : b.def;
    return current;
  }

  function kindDecimals(kind) {
    var overrides = ui().metric_decimals || {};
    if (Object.prototype.hasOwnProperty.call(overrides, kind)) return overrides[kind];
    if (kind === "count") return 0;
    if (kind === "threshold" || kind === "logit" || kind === "p_value") return 4;
    return decimals();
  }

  function fmt(raw, kind) {
    var v = typeof raw === "number" ? raw : parseFloat(raw);
    if (kind === "logit" && (v === Infinity || v === -Infinity)) return v > 0 ? "+∞" : "−∞";
    if (!Number.isFinite(v)) return window.DM_I18N?.t?.("v2.notAvailable") || "N/A";
    kind = kind || "num";
    if (kind === "count") return Math.round(v).toLocaleString("en-US");
    if (kind === "raw") return String(v);
    var d = kindDecimals(kind);
    var scaled = kind === "pct" ? 100 * v : v;
    // Very small non-zero values would render as 0.00 — switch to scientific.
    if (scaled !== 0 && Math.abs(scaled) < Math.pow(10, -(d + 1))) {
      return scaled.toExponential(2) + (kind === "pct" ? "%" : "");
    }
    return scaled.toFixed(d) + (kind === "pct" ? "%" : "");
  }

  function applyStatic(root) {
    (root || document).querySelectorAll("[data-raw]").forEach(function (el) {
      el.textContent = fmt(el.getAttribute("data-raw"), el.getAttribute("data-fmt") || "num");
    });
    // CI ranges keep both bounds as raw attributes and use compact notation.
    (root || document).querySelectorAll("[data-ci-lo]").forEach(function (el) {
      var kind = el.getAttribute("data-fmt") || "num";
      if(!Number.isFinite(parseFloat(el.getAttribute("data-ci-lo"))) || !Number.isFinite(parseFloat(el.getAttribute("data-ci-hi")))) {
        el.textContent=window.DM_I18N?.t?.("v2.notAvailable") || "N/A";
        return;
      }
      var lo = fmt(el.getAttribute("data-ci-lo"), kind);
      var hi = fmt(el.getAttribute("data-ci-hi"), kind);
      el.textContent = "(" + lo + " - " + hi + ")";
    });
  }

  function setDecimals(d) {
    var b = bounds();
    current = Math.min(b.max, Math.max(b.min, d));
    try { localStorage.setItem(KEY, String(current)); } catch (e) { /* ignore */ }
    var label = document.querySelector(".decimals-value");
    if (label) label.textContent = String(current);
    applyStatic();
    document.dispatchEvent(new CustomEvent("dm:decimalschange", { detail: { decimals: current } }));
  }

  function tt(key, fallback) {
    return window.DM_I18N ? window.DM_I18N.t(key) : fallback;
  }

  function makeControl() {
    if (ui().allow_runtime_decimal_change === false) return;
    if (document.querySelector(".decimals-ctl")) return;
    var wrap = document.createElement("span");
    wrap.className = "domain-select-wrap decimals-ctl";
    var span = document.createElement("span");
    span.className = "domain-select-label";
    span.setAttribute("data-i18n", "settings.decimals");
    span.textContent = tt("settings.decimals", "Decimals");
    var minus = document.createElement("button");
    minus.type = "button";
    minus.className = "decimals-btn decimals-minus";
    minus.textContent = "−";
    minus.setAttribute("aria-label", tt("settings.decimals_dec", "Fewer decimals"));
    var value = document.createElement("span");
    value.className = "decimals-value";
    value.textContent = String(decimals());
    var plus = document.createElement("button");
    plus.type = "button";
    plus.className = "decimals-btn decimals-plus";
    plus.textContent = "+";
    plus.setAttribute("aria-label", tt("settings.decimals_inc", "More decimals"));
    minus.addEventListener("click", function () { setDecimals(decimals() - 1); });
    plus.addEventListener("click", function () { setDecimals(decimals() + 1); });
    wrap.appendChild(span);
    wrap.appendChild(minus);
    wrap.appendChild(value);
    wrap.appendChild(plus);
    controlBar().appendChild(wrap);
  }

  function controlBar() {
    var hero = document.querySelector(".hero");
    if (!hero) return document.body;
    var bar = hero.querySelector(".dm-controls");
    if (!bar) { bar = document.createElement("div"); bar.className = "dm-controls"; hero.appendChild(bar); }
    return bar;
  }

  function boot() {
    if (!document.getElementById("dm-ui-config")) return;
    makeControl();
    if (decimals() !== bounds().def) applyStatic();
  }

  window.DM_FMT = { decimals: decimals, setDecimals: setDecimals, fmt: fmt, applyStatic: applyStatic, kindDecimals: kindDecimals };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
