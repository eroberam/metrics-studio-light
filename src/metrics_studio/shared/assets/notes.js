/* Research Notes (spec §7): researcher-authored notes with auto-captured
 * experimental context, persisted INSIDE the exported HTML.
 *
 * - Seed: <script type="application/json" id="research-notes-data">.
 * - Draft: localStorage "dm-notes:<task>:<generated_at>" (merged by id +
 *   updated_at); a dot marks the workspace as modified until Export HTML.
 * - Artifact: "Export HTML" writes the notes into the script island of a
 *   cleaned DOM clone (injected controls stripped so the copy re-boots
 *   cleanly) and downloads the self-contained file.
 * - All user text is set via textContent — never innerHTML. No pre-written
 *   interpretations: every conclusion is typed by the researcher.
 */
(function () {
  "use strict";

  function tt(key, args) { return window.DM_I18N ? window.DM_I18N.t(key, args) : key; }

  function uiConfig() {
    var el = document.getElementById("dm-ui-config");
    try { return el ? JSON.parse(el.textContent) : {}; } catch (e) { return {}; }
  }

  function controlBar() {
    var hero = document.querySelector(".hero");
    if (!hero) return document.body;
    var bar = hero.querySelector(".dm-controls");
    if (!bar) { bar = document.createElement("div"); bar.className = "dm-controls"; hero.appendChild(bar); }
    return bar;
  }

  var seedEl = document.getElementById("research-notes-data");
  if (!seedEl) return;

  var CFG = uiConfig();
  var DOC_ID = "dm-notes:" + (CFG.task || "task") + ":" + (CFG.generated_at || "0");

  var embedded = [];
  try { embedded = (JSON.parse(seedEl.textContent) || {}).notes || []; } catch (e) { embedded = []; }

  var notes = embedded.slice();
  try {
    var draft = JSON.parse(localStorage.getItem(DOC_ID) || "null");
    if (draft && Array.isArray(draft.notes)) {
      var byId = {};
      notes.forEach(function (n) { byId[n.id] = n; });
      draft.notes.forEach(function (n) {
        if (!byId[n.id] || (n.updated_at || "") >= (byId[n.id].updated_at || "")) byId[n.id] = n;
      });
      var deleted = draft.deleted || [];
      notes = Object.keys(byId).map(function (k) { return byId[k]; })
        .filter(function (n) { return deleted.indexOf(n.id) === -1; });
    }
  } catch (e) { /* ignore */ }
  var deletedIds = [];
  try { deletedIds = (JSON.parse(localStorage.getItem(DOC_ID) || "null") || {}).deleted || []; } catch (e) { /* ignore */ }

  function isDirty() {
    try { return JSON.stringify(notes) !== JSON.stringify(embedded); } catch (e) { return true; }
  }

  function persistDraft() {
    try { localStorage.setItem(DOC_ID, JSON.stringify({ notes: notes, deleted: deletedIds })); } catch (e) { /* ignore */ }
    updateDirty();
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "n-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
  }

  // ---- Automatic context capture (spec §7.2; kept separate from the body) ----
  function activeFilters() {
    var out = {};
    document.querySelectorAll(".filter-selector:checked").forEach(function (cb) {
      var v = cb.getAttribute("data-filter-var");
      (out[v] = out[v] || []).push(cb.value);
    });
    return out;
  }

  function captureContext(opts) {
    var ctx = {
      task: CFG.task || null,
      language: window.DM_I18N ? window.DM_I18N.lang() : null,
      decimals: window.DM_FMT ? window.DM_FMT.decimals() : null,
      confidence_intervals: (CFG.statistics || {}).confidence_intervals || null,
      package_version: CFG.package_version || null,
      generated_at: CFG.generated_at || null,
      timestamp: new Date().toISOString(),
    };
    if (opts.experiment) {
      ctx.experiments = CFG.experiments || [];
      ctx.baseline_experiment_id = CFG.baseline_id || null;
    }
    if (opts.filters) ctx.active_filters = activeFilters();
    if (opts.threshold) {
      var th = document.querySelector("[data-threshold-input]");
      if (th) ctx.threshold = th.value;
    }
    if (opts.profile) ctx.case_study_profile = document.documentElement.getAttribute("data-case-study") || null;
    return ctx;
  }

  // ---- UI ------------------------------------------------------------------
  var drawer, listEl, editorEl, searchEl, sortEl, countEl, toggleBtn;
  var editing = null;   // note being edited (null = new)
  var editorTags = [];

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function labelled(i18nKey, fallback) {
    var s = el("span", null, tt(i18nKey, fallback));
    s.setAttribute("data-i18n", i18nKey);
    return s;
  }

  function updateDirty() {
    var dirty = isDirty();
    if (toggleBtn) toggleBtn.classList.toggle("dirty", dirty);
    if (drawer) drawer.classList.toggle("dirty", dirty);
  }

  function contextSummary(ctx) {
    if (!ctx) return "";
    var bits = [];
    if (ctx.case_study_profile) bits.push("profile=" + ctx.case_study_profile);
    if (ctx.threshold !== undefined) bits.push("threshold=" + ctx.threshold);
    if (ctx.active_filters) {
      var vars = Object.keys(ctx.active_filters);
      if (vars.length) bits.push("filters: " + vars.map(function (v) {
        return v + "=[" + ctx.active_filters[v].join(",") + "]";
      }).join(" "));
    }
    if (ctx.timestamp) bits.push(ctx.timestamp.replace("T", " ").slice(0, 16));
    if (ctx.package_version) bits.push("v" + ctx.package_version);
    return bits.join(" · ");
  }

  function renderList() {
    listEl.textContent = "";
    var q = (searchEl.value || "").toLowerCase();
    var sort = sortEl.value;
    var shown = notes.filter(function (n) {
      if (!q) return true;
      return (n.title || "").toLowerCase().indexOf(q) !== -1
        || (n.body || "").toLowerCase().indexOf(q) !== -1
        || (n.tags || []).some(function (t) { return t.toLowerCase().indexOf(q) !== -1; });
    });
    shown.sort(function (a, b) {
      if (sort === "title") return (a.title || "").localeCompare(b.title || "");
      if (sort === "fav" && !!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
      return (b.updated_at || "").localeCompare(a.updated_at || "");
    });
    if (!shown.length) {
      var empty = el("div", "notes-empty", tt("notes.empty"));
      empty.setAttribute("data-i18n", "notes.empty");
      listEl.appendChild(empty);
    }
    shown.forEach(function (n) {
      var card = el("div", "note-card" + (n.favorite ? " fav" : ""));
      var head = el("div", "note-card-head");
      var fav = el("button", "note-fav" + (n.favorite ? " on" : ""), n.favorite ? "★" : "☆");
      fav.type = "button";
      fav.title = tt("notes.favorite");
      fav.addEventListener("click", function () {
        n.favorite = !n.favorite;
        n.updated_at = new Date().toISOString();
        persistDraft(); renderList();
      });
      head.appendChild(fav);
      head.appendChild(el("h4", null, n.title || "—"));
      card.appendChild(head);
      if (n.body) card.appendChild(el("div", "note-body", n.body));
      if (n.tags && n.tags.length) {
        var tagsEl = el("div", "note-tags");
        n.tags.forEach(function (t) { tagsEl.appendChild(el("span", null, t)); });
        card.appendChild(tagsEl);
      }
      var ctxLine = contextSummary(n.context);
      if (ctxLine) card.appendChild(el("div", "note-context", ctxLine));
      var actions = el("div", "note-actions");
      var editBtn = el("button", null, tt("notes.edit"));
      editBtn.type = "button";
      editBtn.addEventListener("click", function () { openEditor(n); });
      var delBtn = el("button", null, tt("notes.delete"));
      delBtn.type = "button";
      delBtn.addEventListener("click", function () {
        if (!window.confirm(tt("notes.delete_confirm"))) return;
        notes = notes.filter(function (x) { return x.id !== n.id; });
        deletedIds.push(n.id);
        persistDraft(); renderList();
      });
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      card.appendChild(actions);
      listEl.appendChild(card);
    });
    countEl.textContent = tt("notes.count", { n: notes.length });
  }

  function renderEditorTags(row) {
    row.querySelectorAll(".tag-chip").forEach(function (c) { c.remove(); });
    editorTags.forEach(function (t, i) {
      var chip = el("span", "tag-chip", t);
      var x = el("button", null, "×");
      x.type = "button";
      x.addEventListener("click", function () { editorTags.splice(i, 1); renderEditorTags(row); });
      chip.appendChild(x);
      row.insertBefore(chip, row.firstChild);
    });
  }

  function openEditor(note) {
    editing = note || null;
    editorTags = note ? (note.tags || []).slice() : [];
    editorEl.querySelector(".notes-title-input").value = note ? (note.title || "") : "";
    editorEl.querySelector(".notes-body-input").value = note ? (note.body || "") : "";
    editorEl.querySelector(".notes-fav-input").checked = note ? !!note.favorite : false;
    renderEditorTags(editorEl.querySelector(".tag-row"));
    editorEl.classList.add("open");
    editorEl.querySelector(".notes-title-input").focus();
  }

  function closeEditor() { editing = null; editorEl.classList.remove("open"); }

  function saveFromEditor() {
    var title = editorEl.querySelector(".notes-title-input").value.trim();
    var body = editorEl.querySelector(".notes-body-input").value;
    if (!title && !body.trim()) { closeEditor(); return; }
    var opts = {
      experiment: editorEl.querySelector(".ctx-experiment").checked,
      filters: editorEl.querySelector(".ctx-filters").checked,
      threshold: editorEl.querySelector(".ctx-threshold").checked,
      profile: editorEl.querySelector(".ctx-profile").checked,
    };
    var now = new Date().toISOString();
    if (editing) {
      editing.title = title; editing.body = body;
      editing.tags = editorTags.slice();
      editing.favorite = editorEl.querySelector(".notes-fav-input").checked;
      editing.updated_at = now;
      editing.context = captureContext(opts);
    } else {
      notes.push({
        id: uuid(), title: title, body: body, tags: editorTags.slice(),
        favorite: editorEl.querySelector(".notes-fav-input").checked,
        created_at: now, updated_at: now, context: captureContext(opts),
      });
    }
    persistDraft(); closeEditor(); renderList();
  }

  // ---- Export --------------------------------------------------------------
  function notesJson() {
    return JSON.stringify({ notes: notes }, null, 0).replace(/<\//g, "<\\/");
  }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 500);
  }

  function exportHTML() {
    var clone = document.documentElement.cloneNode(true);
    // Strip injected controls so the exported copy re-boots cleanly (idempotent).
    clone.querySelectorAll(
      ".dm-controls, .domain-select-wrap, .notes-toggle, .notes-drawer"
    ).forEach(function (n) { n.remove(); });
    // Serialized Plotly internals confuse a fresh Plotly.newPlot/react — empty
    // the plot containers; the page scripts re-render every chart on load.
    clone.querySelectorAll(".js-plotly-plot").forEach(function (n) {
      n.classList.remove("js-plotly-plot");
      n.textContent = "";
    });
    var island = clone.querySelector("#research-notes-data");
    if (island) island.textContent = notesJson();
    var name = "dashboard_" + (CFG.task || "panel") + "_notes.html";
    download(name, "<!DOCTYPE html>\n" + clone.outerHTML, "text/html;charset=utf-8");
    // The exported artifact now carries the notes — mark the workspace clean.
    embedded = JSON.parse(JSON.stringify(notes));
    seedEl.textContent = notesJson();
    updateDirty();
  }

  function exportJSON() {
    download("research_notes_" + (CFG.task || "panel") + ".json",
      JSON.stringify({ notes: notes }, null, 2), "application/json;charset=utf-8");
  }

  // ---- Build the drawer ------------------------------------------------------
  function buildUI() {
    // Idempotency guard: remove stale copies (e.g. a reopened exported file).
    document.querySelectorAll(".notes-drawer, .notes-toggle").forEach(function (n) { n.remove(); });

    toggleBtn = el("button", "notes-toggle");
    toggleBtn.type = "button";
    toggleBtn.appendChild(el("span", "notes-dirty"));
    toggleBtn.appendChild(labelled("notes.title", "Research Notes"));
    toggleBtn.addEventListener("click", function () { drawer.classList.toggle("open"); });
    controlBar().appendChild(toggleBtn);

    drawer = el("aside", "notes-drawer");
    var head = el("div", "notes-head");
    var h3 = el("h3", null, tt("notes.title"));
    h3.setAttribute("data-i18n", "notes.title");
    var close = el("button", "notes-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", tt("notes.close"));
    close.setAttribute("data-i18n-attr", "aria-label:notes.close");
    close.addEventListener("click", function () { drawer.classList.remove("open"); });
    head.appendChild(h3); head.appendChild(close);
    drawer.appendChild(head);

    var toolbar = el("div", "notes-toolbar");
    searchEl = document.createElement("input");
    searchEl.type = "search";
    searchEl.placeholder = tt("notes.search");
    searchEl.setAttribute("aria-label", tt("notes.search"));
    searchEl.setAttribute("data-i18n-attr", "placeholder:notes.search;aria-label:notes.search");
    searchEl.addEventListener("input", renderList);
    sortEl = document.createElement("select");
    sortEl.setAttribute("aria-label", tt("notes.sort_date"));
    sortEl.setAttribute("data-i18n-attr", "aria-label:notes.sort_date");
    [["date", "notes.sort_date"], ["title", "notes.sort_title"], ["fav", "notes.sort_fav"]].forEach(function (pair) {
      var o = document.createElement("option");
      o.value = pair[0];
      o.setAttribute("data-i18n", pair[1]);
      o.textContent = tt(pair[1]);
      sortEl.appendChild(o);
    });
    sortEl.addEventListener("change", renderList);
    var newBtn = el("button", "notes-new", tt("notes.new"));
    newBtn.type = "button";
    newBtn.setAttribute("data-i18n", "notes.new");
    newBtn.addEventListener("click", function () { openEditor(null); });
    toolbar.appendChild(searchEl); toolbar.appendChild(sortEl); toolbar.appendChild(newBtn);
    drawer.appendChild(toolbar);

    listEl = el("div", "notes-list");
    drawer.appendChild(listEl);

    editorEl = el("div", "notes-editor");
    var lt = el("label"); lt.appendChild(labelled("notes.note_title", "Title"));
    var ti = document.createElement("input"); ti.type = "text"; ti.className = "notes-title-input";
    var lb = el("label"); lb.appendChild(labelled("notes.note_body", "Note"));
    var ta = document.createElement("textarea"); ta.className = "notes-body-input";
    var ltag = el("label"); ltag.appendChild(labelled("notes.tags", "Tags"));
    var tagRow = el("div", "tag-row");
    var tagInput = document.createElement("input");
    tagInput.type = "text"; tagInput.placeholder = tt("notes.add_tag"); tagInput.style.maxWidth = "180px";
    tagInput.setAttribute("data-i18n-attr", "placeholder:notes.add_tag");
    tagInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        var v = tagInput.value.trim();
        if (v && editorTags.indexOf(v) === -1) { editorTags.push(v); renderEditorTags(tagRow); }
        tagInput.value = "";
      }
    });
    tagRow.appendChild(tagInput);
    var favLabel = el("label");
    var favInput = document.createElement("input"); favInput.type = "checkbox"; favInput.className = "notes-fav-input";
    favLabel.appendChild(favInput); favLabel.appendChild(labelled("notes.favorite", "Favorite"));
    var ctxTitle = el("label"); ctxTitle.appendChild(labelled("notes.attach", "Attach current context"));
    var ctxOpts = el("div", "notes-ctx-opts");
    [["ctx-experiment", "notes.ctx_experiment"], ["ctx-filters", "notes.ctx_filters"],
     ["ctx-threshold", "notes.ctx_threshold"], ["ctx-profile", "notes.ctx_profile"]].forEach(function (pair) {
      var l = el("label");
      var c = document.createElement("input");
      c.type = "checkbox"; c.className = pair[0]; c.checked = true;
      l.appendChild(c); l.appendChild(labelled(pair[1], pair[1]));
      ctxOpts.appendChild(l);
    });
    var actions = el("div", "notes-editor-actions");
    var cancel = el("button", "notes-cancel", tt("notes.cancel"));
    cancel.type = "button"; cancel.setAttribute("data-i18n", "notes.cancel");
    cancel.addEventListener("click", closeEditor);
    var save = el("button", "notes-save", tt("notes.save"));
    save.type = "button"; save.setAttribute("data-i18n", "notes.save");
    save.addEventListener("click", saveFromEditor);
    actions.appendChild(cancel); actions.appendChild(save);
    [lt, ti, lb, ta, ltag, tagRow, favLabel, ctxTitle, ctxOpts, actions].forEach(function (x) { editorEl.appendChild(x); });
    drawer.appendChild(editorEl);

    var foot = el("div", "notes-foot");
    var expHtml = el("button", "notes-export-html", tt("notes.export_html"));
    expHtml.type = "button"; expHtml.setAttribute("data-i18n", "notes.export_html");
    expHtml.addEventListener("click", exportHTML);
    var expJson = el("button", "notes-export-json", tt("notes.export_json"));
    expJson.type = "button"; expJson.setAttribute("data-i18n", "notes.export_json");
    expJson.addEventListener("click", exportJSON);
    countEl = el("span", "notes-count");
    foot.appendChild(expHtml); foot.appendChild(expJson); foot.appendChild(countEl);
    var unsaved = el("div", "notes-unsaved", tt("notes.unsaved"));
    unsaved.setAttribute("data-i18n", "notes.unsaved");
    foot.appendChild(unsaved);
    drawer.appendChild(foot);

    document.body.appendChild(drawer);
    renderList();
    updateDirty();
    document.addEventListener("dm:langchange", renderList);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildUI);
  else buildUI();
})();
