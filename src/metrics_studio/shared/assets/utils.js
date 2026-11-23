const mean = arr => arr.length ? arr.reduce((a,b) => a+b, 0) / arr.length : NaN;
function median(arr) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a,b) => a-b);
  const m = Math.floor(s.length/2);
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2;
}
function stdev(arr) {
  if (arr.length<2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a,b) => a+(b-m)**2, 0) / (arr.length-1));
}
// Default digit counts follow the global decimal preference (DM_FMT) when the
// caller does not pass an explicit precision.
const num = (x, d) => Number.isFinite(x)
  ? x.toFixed(d === undefined ? (window.DM_FMT ? DM_FMT.decimals() : 2) : d) : "—";
const pct = (x, d) => Number.isFinite(x)
  ? (100 * x).toFixed(d === undefined ? (window.DM_FMT ? DM_FMT.decimals() : 1) : d) + "%" : "—";

// Central glossary lookup for client-rendered tooltips. If `key` matches an
// entry embedded in <script id="glossary-data">, use its description in the
// active language; otherwise treat the argument as literal tooltip text
// (backward compatible). Entries may be plain strings or {en, es} objects.
let __GLOSSARY = null;
function glossaryText(key) {
  if (__GLOSSARY === null) {
    const el = document.getElementById('glossary-data');
    try { __GLOSSARY = el ? JSON.parse(el.textContent) : {}; } catch (e) { __GLOSSARY = {}; }
  }
  if (!Object.prototype.hasOwnProperty.call(__GLOSSARY, key)) return key;
  const entry = __GLOSSARY[key];
  if (entry && typeof entry === 'object') {
    const lang = window.DM_I18N ? window.DM_I18N.lang() : 'en';
    return entry[lang] || entry.en || key;
  }
  return entry;
}
// Icons carry data-tooltip-key so tooltip.js resolves the text AT HOVER TIME in
// the active language; data-tooltip stays as a no-JS/legacy fallback.
const ii  = t => ' <span class="info-icon" tabindex="0" data-tooltip-key="'+t+'" data-tooltip="'+glossaryText(t)+'">i</span>';
