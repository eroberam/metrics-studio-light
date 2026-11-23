/* Shared paginated table + CSV export.
 *
 * Any <section data-paginated-table="ID" data-page-size="10" [data-export-name="x"]>
 * that contains a <table>, a `.tpt-pager`, and two JSON scripts
 * (#cols-ID = [{key,label}], #rows-ID = [{key: value}]) is auto-wired: it renders
 * one page at a time with numbered pager controls and an optional "Export table"
 * button that downloads all rows as CSV. Used by the worst-cases sections of the
 * regression, OCR, binary and age dashboards.
 */
const TPT = (function () {
  function esc(v) {
    return v == null ? "" : String(v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function escAttr(v) {
    return esc(v).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function renderPage(table, cols, rows, page, pageSize) {
    const start = page * pageSize;
    const slice = rows.slice(start, start + pageSize);
    const body = slice.map(r =>
      "<tr>" + cols.map(c => '<td data-column="' + escAttr(c.key) + '">' + esc(r[c.key]) + "</td>").join("") + "</tr>"
    ).join("");
    const noRows = window.DM_I18N ? window.DM_I18N.t("common.no_rows") : "No rows";
    table.querySelector("tbody").innerHTML = body ||
      ('<tr><td colspan="' + cols.length + '" class="tpt-empty" data-i18n="common.no_rows">' + esc(noRows) + "</td></tr>");
    table.dispatchEvent(new CustomEvent("dm:tablepage", { bubbles: true }));
  }

  function pageWindow(nPages, page) {
    // First, last, and current ±2, with gaps marked as null (…).
    const keep = new Set([0, nPages - 1, page - 1, page, page + 1]);
    const out = [];
    let prev = -1;
    for (let i = 0; i < nPages; i++) {
      if (!keep.has(i)) continue;
      if (i - prev > 1) out.push(null);
      out.push(i);
      prev = i;
    }
    return out;
  }

  function renderPager(el, nPages, page, go) {
    if (nPages <= 1) { el.innerHTML = ""; return; }
    const btn = (label, target, opts) => {
      const disabled = opts && opts.disabled ? " disabled" : "";
      const active = opts && opts.active ? " active" : "";
      if (target === null) return '<span class="tpt-gap">…</span>';
      return '<button type="button" class="tpt-page' + active + '" data-goto="' + target + '"' + disabled + '>' + label + "</button>";
    };
    let html = btn("‹", page - 1, { disabled: page === 0 });
    for (const p of pageWindow(nPages, page)) {
      html += p === null ? btn("", null) : btn(String(p + 1), p, { active: p === page });
    }
    html += btn("›", page + 1, { disabled: page === nPages - 1 });
    el.innerHTML = html;
    el.querySelectorAll("[data-goto]").forEach(b =>
      b.addEventListener("click", () => go(parseInt(b.dataset.goto, 10)))
    );
  }

  function toCSV(cols, rows) {
    const cell = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    // Machine-readable export: stable English field keys, never display labels
    // (spec §3.1 — the visible table may be translated, the CSV schema is not).
    const header = cols.map(c => cell(c.key)).join(",");
    const lines = rows.map(r => cols.map(c => cell(r[c.key])).join(","));
    return [header].concat(lines).join("\n");
  }

  function download(name, text) {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function initOne(sec) {
    const id = sec.dataset.paginatedTable;
    const colsEl = document.getElementById("cols-" + id);
    const rowsEl = document.getElementById("rows-" + id);
    if (!colsEl || !rowsEl) return;
    let cols, rows;
    try { cols = JSON.parse(colsEl.textContent); rows = JSON.parse(rowsEl.textContent); }
    catch (e) { return; }
    const table = sec.querySelector("table");
    const pagerEl = sec.querySelector(".tpt-pager");
    const pageSize = parseInt(sec.dataset.pageSize || "10", 10);
    const nPages = Math.max(1, Math.ceil(rows.length / pageSize));
    let page = 0;
    function go(p) {
      page = Math.min(nPages - 1, Math.max(0, p));
      renderPage(table, cols, rows, page, pageSize);
      if (pagerEl) renderPager(pagerEl, nPages, page, go);
    }
    go(0);
    const exp = sec.querySelector(".tpt-export");
    if (exp) exp.addEventListener("click", () =>
      download((sec.dataset.exportName || "table") + ".csv", toCSV(cols, rows)));
  }

  function init(root) {
    (root || document).querySelectorAll("[data-paginated-table]").forEach(initOne);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => init(document));
  } else {
    init(document);
  }
  return { init };
})();
