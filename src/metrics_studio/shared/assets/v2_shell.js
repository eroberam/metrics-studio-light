/* Shared v2 shell: three views, common model/filter state, tables and statistics. */
(function () {
  "use strict";
  const island = document.getElementById("dm-v2-report-data");
  if (!island) return;
  let DATA = {};
  try { DATA = JSON.parse(island.textContent) || {}; } catch (_error) { window.DM_COMPARISON.showError(); return; }
  const runtimeEl = document.getElementById("dm-ui-config");
  let CFG = {};
  try { CFG = runtimeEl ? JSON.parse(runtimeEl.textContent) || {} : {}; } catch (_error) { /* defaults */ }
  const experiments = DATA.experiments || [];
  if (!experiments.length) return;
  const comparisonConfig=CFG.ui?.comparison||{};
  const manager=window.DM_COMPARISON.create(experiments,comparisonConfig);
  window.DM_V2_MODELS=manager;
  const singleModelTask = experiments.length === 1;
  const cohortDimensions = DATA.worst_case?.dimensions || DATA.filter_variables || [];

  const state = {
    view: "evaluation",
    get primary() { return manager.getDetailId(); },
    tableModel: null,
    search: "",
    sort: null,
    desc: false,
    page: 0,
    worstMetric: DATA.worst_case.metric,
    worstVariables: new Set(cohortDimensions.slice(0,5)),
    cohortSearchMode: "target",
    cohortRiskTarget: .8,
    cohortOperator: ">=",
    cohortRankBy: "observed",
    cohortMinOrder: 1,
    cohortMaxOrder: Math.min(5,Math.max(1,cohortDimensions.length)),
    cohortMinimumSupport: Number(DATA.worst_case.min_samples)||20,
    cohortMinimumErrors: Number(DATA.worst_case.minimum_error_events)||3,
    cohortRemoveRedundant: true,
    cohortTolerance: Number(DATA.worst_case.redundancy_tolerance)||.01,
    cohortSortKey: "rank",
    cohortSortDirection: "asc",
    cohortExpandedKey: null,
    cohortShowAllModels: new Set(),
    cohortThresholds: new Map(),
    treeQuery: "",
    statisticsTab: "dataMap",
  };
  state.tableModel = state.primary;

  function lang() { return document.documentElement.lang === "es" ? "es" : "en"; }
  function tr(key,args) { return window.DM_I18N?.t?.("v2." + key,args) || key; }
  function esc(value) {
    return value == null ? "" : String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
  function experiment(id) { return experiments.find(item => item.id === id) || experiments[0]; }
  function activeIds() { return manager.getActiveIds(); }
  function activeExperiments() { return activeIds().map(experiment); }
  function isMissing(value) {
    const tokens=DATA.statistics_schema?.missing_tokens||["UNKNOWN"];
    return window.DM_V2_AGG?.isMissing
      ? DM_V2_AGG.isMissing(value,tokens)
      : value==null||value===""||value==="UNKNOWN"||(typeof value==="number"&&!Number.isFinite(value));
  }
  function format(value, kind) {
    if (value==null || value==="" || !Number.isFinite(Number(value))) return tr("notAvailable");
    if (window.DM_FMT) return DM_FMT.fmt(Number(value), kind || "num");
    return kind === "pct" ? (100 * Number(value)).toFixed(2) + "%" : Number(value).toFixed(2);
  }
  const SECTION_BLUEPRINTS = {
    binary: [
      ["overview","sectionOverview",".models-workspace"],
      ["curves","sectionCurves",'[data-i18n="panel.binary.section.curves.title"]',".plot-section"],
      ["threshold","sectionThreshold",'[data-i18n="panel.binary.section.threshold.title"]',".plot-section"],
      ["diagnostics","sectionDiagnostics",'[data-i18n="panel.binary.section.diag.title"]',".plot-section"],
      ["calibration","sectionCalibration",'[data-i18n="panel.binary.section.calib.title"]',".plot-section"],
      ["cases","sectionCases",".dm-v2-worst"],
    ],
    multiclass: [
      ["overview","sectionOverview",".multiclass-workspace .workspace-head"],
      ["performance","sectionPerformance",".multiclass-workspace .model-metrics-table"],
      ["diagnostics","sectionDiagnostics",".multiclass-workspace .workspace-subhead"],
      ["classes","sectionClasses",".multiclass-model-panel .diagnostics-grid"],
      ["calibration","sectionCalibration",".multiclass-model-panel details.collapsible"],
      ["cases","sectionCases",".dm-v2-worst"],
    ],
    regression: [
      ["overview","sectionOverview",".regression-workspace .workspace-head"],
      ["performance","sectionPerformance",".regression-workspace .model-metrics-table"],
      ["diagnostics","sectionDiagnostics",".regression-workspace .workspace-subhead"],
      ["visuals","sectionVisuals",".regression-workspace .diagnostics-grid"],
      ["cases","sectionCases",".dm-v2-worst"],
    ],
    age_estimation: [
      ["overview","sectionOverview","#summary-table",".dash-section"],
      ["performance","sectionPerformance","#compliance-table",".dash-section"],
      ["segments","sectionSegments","#challenge-table",".dash-section"],
      ["diagnostics","sectionDiagnostics","#fig-fpr-heatmaps",".dash-section"],
      ["threshold","sectionThreshold","#fig-age-sweep",".dash-section"],
      ["visuals","sectionVisuals","#fig-scatter",".dash-section"],
      ["cases","sectionCases",".dm-v2-worst"],
    ],
    ocr: [
      ["overview","sectionOverview",".ocr-model-header"],
      ["performance","sectionPerformance",".ocr-primary-metrics"],
      ["segments","sectionSegments",".tables-grid-section"],
      ["diagnostics","sectionDiagnostics",".chart-stack"],
      ["cases","sectionCases",".dm-v2-worst"],
    ],
    object_detection: [
      ["overview","sectionOverview","#overview"],
      ["classes","sectionClasses","#classes"],
      ["dataset","sectionDataset","#dataset"],
      ["errors","sectionErrors","#errors"],
      ["gallery","sectionGallery","#cases"],
    ],
    segmentation: [
      ["overview","sectionOverview","#seg-overview"],
      ["boundaries","sectionBoundaries","#seg-boundaries"],
      ["calibration","sectionCalibration","#seg-calibration"],
      ["evidence","sectionEvidence","#seg-evidence"],
      ["dataset","sectionDatasetContext","#seg-dataset"],
    ],
  };
  const EYE_SECTION_BLUEPRINTS = {
    evaluation: [
      ["overview","sectionOverview",'[data-eye-eval-section="overview"]'],
      ["regions","sectionRegions",'[data-eye-eval-section="regions"]'],
      ["screen","sectionScreen",'[data-eye-eval-section="screen"]'],
    ],
    tracking: [
      ["summary","sectionEvaluationSummary","#eye-tracking-summary-section"],
      ["replay","sectionSynchronizedReplay","#eye-synchronized-replay"],
      ["frame","sectionFrameInspector","#eye-frame-analysis"],
      ["spatial","sectionSpatialError","#eye-spatial-error"],
      ["robustness","sectionRobustness","#eye-robustness"],
      ["events","sectionEventsAoi","#eye-events-aoi"],
    ],
  };
  function queuePlot(node,request) {
    if(!node||typeof Plotly==="undefined")return;
    node._dmV2PlotRequest=request;
    if(node._dmV2PlotBusy)return;
    const run=()=>{
      const next=node._dmV2PlotRequest;if(!next)return;
      node._dmV2PlotRequest=null;node._dmV2PlotBusy=true;
      Promise.resolve().then(()=>{
        if(next.empty){
          Plotly.purge(node);node.classList.add("dm-v2-empty");node.innerHTML=next.empty;
          return null;
        }
        node.classList.remove("dm-v2-empty");
        const responsiveLayout={...(next.layout||{}),autosize:true};
        delete responsiveLayout.width;
        return Plotly.react(node,next.traces,responsiveLayout,next.config).then(()=>{
          if(node.getClientRects().length)window.DM_COMPARISON.resize(node);
          window.DM_I18N?.localizePlot?.(node);
        });
      }).catch(()=>{/* a newer render request will restore the plot */}).finally(()=>{
        node._dmV2PlotBusy=false;
        if(node._dmV2PlotRequest)run();
      });
    };
    run();
  }
  function selectedFilters() {
    const result = {};
    document.querySelectorAll(".v2-filter[data-filter-var]:checked").forEach(input => {
      (result[input.dataset.filterVar] = result[input.dataset.filterVar] || new Set()).add(input.value);
    });
    return result;
  }
  function filteredRows(exp, cases) {
    const selected = selectedFilters();
    const vars = DATA.filter_variables || [];
    return (cases ? exp.cases : exp.rows).filter(row => vars.every(variable => {
      const values = selected[variable] || new Set();
      const cell = isMissing(row[variable]) ? "UNKNOWN" : String(row[variable]);
      return values.size > 0 && values.has(cell);
    }));
  }
  function dispatchLegacyFilters() {
    const selected = selectedFilters();
    document.querySelectorAll(".filter-selector[data-filter-var]").forEach(input => {
      const values = selected[input.dataset.filterVar];
      if (!values) return;
      const checked = values.has(input.value);
      if (input.checked !== checked) {
        input.checked = checked;
        input.dispatchEvent(new Event("change", { bubbles:true }));
      }
    });
  }

  let shell, views = {}, renderModelSelectors=()=>{}, comparisonReflow=()=>{}, tableBody, tableHead, pager, tableTabs;
  let searchInput, statTree, statTreeSearch, sampleExplorer;
  let statisticalSummary,relationshipExplorer,statisticsTabs,statisticsPanels,treeInitialized=false,statisticsFrame=0;
  let customPlots = {};
  const treePages=new Map();
  let worstMetricSelect, worstDimensions, worstBody, cohortDetailDrawer, cohortRiskMain;
  let cohortRiskEmpty=null;
  let cohortRiskTimer=0,cohortRiskGeneration=0;
  const cohortRiskCache=new Map();
  const cohortResultsByKey=new Map();
  let evaluationIndex = null;
  let editorialPolishFrame = 0;
  let plotReflowFrame = 0;
  let plotReflowTimers = [];
  let plotResizeObserver = null;
  function sectionBlueprint() {
    if(DATA.task==="eye_evaluation")return EYE_SECTION_BLUEPRINTS[DATA.panel_mode||"evaluation"]||[];
    return SECTION_BLUEPRINTS[DATA.task]||[];
  }
  function sectionTarget(root, definition) {
    const node=root.querySelector(definition[2]);
    return node&&definition[3] ? node.closest(definition[3]) : node;
  }
  function openSectionContext(target) {
    const details=target.matches?.("details")?target:target.closest?.("details");
    if(details)details.open=true;
  }
  function scrollToSection(target) {
    if(!target)return;
    openSectionContext(target);
    const reduce=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    target.scrollIntoView({behavior:reduce?"auto":"smooth",block:"start"});
    target.focus({preventScroll:true});
  }
  function setActiveEvaluationSection(key) {
    if(!evaluationIndex)return;
    evaluationIndex.querySelectorAll("[data-v2-section-link]").forEach(link=>{
      if(link.dataset.v2SectionLink===key)link.setAttribute("aria-current","location");
      else link.removeAttribute("aria-current");
    });
    const select=evaluationIndex.querySelector("select");
    if(select&&select.value!==key)select.value=key;
  }
  function localizeEvaluationIndex() {
    if(!evaluationIndex)return;
    evaluationIndex.querySelectorAll('[data-v2-section-label="1"]').forEach(node=>{
      node.textContent=tr(node.dataset.v2SectionLabelKey);
    });
    evaluationIndex.querySelector(".dm-v2-eval-index nav")?.setAttribute("aria-label",tr("contents"));
    evaluationIndex.querySelector(".dm-v2-eval-index-mobile select")?.setAttribute("aria-label",tr("contents"));
  }
  function buildEvaluationIndex(view) {
    const definitions=sectionBlueprint().slice(0,8);
    const seen=new Set();
    const entries=definitions.map(definition=>{
      const target=sectionTarget(view,definition);
      if(!target||seen.has(target))return null;
      seen.add(target);
      const [key,labelKey]=definition;
      const id=target.id||"dm-v2-section-"+key;
      target.id=id;
      target.dataset.v2Section=key;
      target.dataset.v2SectionLabelKey=labelKey;
      target.tabIndex=-1;
      return {key,labelKey,id,target};
    }).filter(Boolean);
    if(!entries.length)return;
    const mobile=document.createElement("label");
    mobile.className="dm-v2-eval-index-mobile";
    mobile.innerHTML='<span data-v2-section-label="1" data-v2-section-label-key="contents">'+esc(tr("contents"))+"</span>";
    const select=document.createElement("select");
    select.setAttribute("aria-label",tr("contents"));
    entries.forEach(entry=>select.appendChild(new Option(tr(entry.labelKey),entry.key)));
    select.addEventListener("change",()=>scrollToSection(entries.find(entry=>entry.key===select.value)?.target));
    mobile.appendChild(select);

    const aside=document.createElement("aside");
    aside.className="dm-v2-eval-index";
    const nav=document.createElement("nav");
    nav.setAttribute("aria-label",tr("contents"));
    nav.innerHTML='<p data-v2-section-label="1" data-v2-section-label-key="contents">'+esc(tr("contents"))+"</p>";
    const list=document.createElement("ol");
    entries.forEach((entry,index)=>{
      const item=document.createElement("li");
      const link=document.createElement("a");
      link.href="#"+entry.id;
      link.dataset.v2SectionLink=entry.key;
      link.innerHTML='<span aria-hidden="true">'+String(index+1).padStart(2,"0")+
        '</span><strong data-v2-section-label="1" data-v2-section-label-key="'+esc(entry.labelKey)+'">'+esc(tr(entry.labelKey))+"</strong>";
      link.addEventListener("click",event=>{
        event.preventDefault();setActiveEvaluationSection(entry.key);scrollToSection(entry.target);
      });
      item.appendChild(link);list.appendChild(item);
    });
    nav.appendChild(list);aside.appendChild(nav);

    const content=document.createElement("div");
    content.className="dm-v2-evaluation-content";
    while(view.firstChild)content.appendChild(view.firstChild);
    const viewHead=content.querySelector(":scope > .dm-v2-view-head");
    content.insertBefore(aside,viewHead?.nextSibling||content.firstChild);
    const layout=document.createElement("div");
    layout.className="dm-v2-evaluation-layout";
    layout.append(content);
    view.append(mobile,layout);
    evaluationIndex=view;
    setActiveEvaluationSection(entries[0].key);

    if("IntersectionObserver" in window){
      const visible=new Set();
      const observer=new IntersectionObserver(changes=>{
        changes.forEach(change=>change.isIntersecting?visible.add(change.target):visible.delete(change.target));
        const candidates=entries.filter(entry=>visible.has(entry.target));
        const active=(candidates.length?candidates:entries.slice())
          .sort((a,b)=>Math.abs(a.target.getBoundingClientRect().top-120)-Math.abs(b.target.getBoundingClientRect().top-120))[0];
        if(active)setActiveEvaluationSection(active.key);
      },{rootMargin:"-12% 0px -70% 0px",threshold:[0,.1,.5]});
      entries.forEach(entry=>observer.observe(entry.target));
    }
  }
  function decorateState(node) {
    if(node.dataset.v2StateReady)return;
    node.dataset.v2StateReady="1";
    node.classList.add("dm-v2-state");
    node.dataset.v2State=node.id?.includes("empty")?"filtered":"unavailable";
    node.setAttribute("role","status");
    node.setAttribute("aria-live","polite");
  }
  function syncPlotState(plot) {
    const fullData=Array.isArray(plot._fullData)?plot._fullData:[];
    const hasConfiguredTraces=Array.isArray(plot.data)&&plot.data.length>0;
    const noVisibleData=hasConfiguredTraces&&fullData.length>0&&fullData.every(
      trace=>trace.visible===false||trace.visible==="legendonly"
    );
    let stateNode=plot.querySelector(":scope > .dm-v2-plot-state");
    if(!noVisibleData){
      stateNode?.remove();
      delete plot.dataset.v2PlotState;
      return;
    }
    plot.dataset.v2PlotState="filtered";
    if(!stateNode){
      stateNode=document.createElement("div");
      stateNode.className="dm-v2-plot-state";
      stateNode.setAttribute("role","status");
      stateNode.setAttribute("aria-live","polite");
      stateNode.innerHTML='<strong aria-hidden="true">∅</strong><span data-v2-text="noPlotData">'+
        esc(tr("noPlotData"))+"</span>";
      plot.appendChild(stateNode);
    }
  }
  function reflowVisiblePlots() {
    if(!window.Plotly?.Plots?.resize)return;
    document.querySelectorAll(".js-plotly-plot").forEach(plot=>{
      const rect=plot.getBoundingClientRect();
      if(plot.hidden||rect.width<1||rect.height<1||!plot.getClientRects().length)return;
      try{window.DM_COMPARISON.resize(plot);}catch(_error){/* Non-Plotly diagnostic. */}
      syncPlotState(plot);
    });
  }
  function schedulePlotlyReflow() {
    cancelAnimationFrame(plotReflowFrame);
    plotReflowTimers.forEach(timer=>clearTimeout(timer));
    plotReflowFrame=requestAnimationFrame(()=>requestAnimationFrame(()=>{
      plotReflowFrame=0;
      reflowVisiblePlots();
    }));
    plotReflowTimers=[
      setTimeout(reflowVisiblePlots,120),
      setTimeout(reflowVisiblePlots,360),
    ];
  }
  function decoratePlot(plot) {
    if(!plot.dataset.v2PlotReady){
      plot.dataset.v2PlotReady="1";
      plot.tabIndex=0;
      plot.addEventListener("focusin",()=>plot.classList.add("dm-v2-chart-active"));
      plot.addEventListener("focusout",()=>setTimeout(()=>{
        if(!plot.contains(document.activeElement))plot.classList.remove("dm-v2-chart-active");
      },0));
      plot.addEventListener("pointerdown",event=>{
        if(event.pointerType==="touch"||event.pointerType==="pen")plot.classList.add("dm-v2-chart-active");
      });
      plot.addEventListener("keydown",event=>{
        if(event.key==="Escape"){plot.classList.remove("dm-v2-chart-active");plot.focus();}
      });
      if("ResizeObserver" in window){
        plotResizeObserver ||= new ResizeObserver(()=>schedulePlotlyReflow());
        plotResizeObserver.observe(plot);
      }
    }
    plot.querySelectorAll(".modebar-btn").forEach(button=>{
      button.tabIndex=0;
      if(!button.getAttribute("aria-label")&&button.getAttribute("data-title")){
        button.setAttribute("aria-label",button.getAttribute("data-title"));
      }
    });
    syncPlotState(plot);
  }
  function enforceTextFloor(root) {
    root.querySelectorAll("*").forEach(node=>{
      if(node.matches("script,style,noscript,.dm-v2-sr-only")||node.closest(".dm-v2-sr-only"))return;
      const directText=Array.from(node.childNodes).some(child=>child.nodeType===Node.TEXT_NODE&&child.textContent.trim());
      if(!directText&&node.tagName.toLowerCase()!=="text")return;
      const size=parseFloat(getComputedStyle(node).fontSize);
      if(Number.isFinite(size)&&size<11)node.style.fontSize="11px";
    });
  }
  function decorateScrollableRegions(root=document) {
    root.querySelectorAll?.(
      ".dm-v2-table-wrap,.dm-v2-worst-table-wrap,.table-scroll,.summary-table-wrap,"+
      ".challenge-table-wrap,.age-band-wrap,.fpr-table-wrap,.fpr-app-wrap"
    ).forEach(region=>{
      if(region.dataset.v2ScrollRegion==="1")return;
      const owner=region.closest("section,article,[role='region']");
      const heading=owner?.querySelector("h2,h3,h4,.section-title")?.textContent?.trim();
      region.tabIndex=0;
      region.setAttribute("aria-label",heading||tr("table"));
      region.dataset.v2ScrollRegion="1";
    });
  }
  function editorialPolish(root=document) {
    root.querySelectorAll?.(".empty-state,.dm-v2-empty").forEach(decorateState);
    root.querySelectorAll?.(".js-plotly-plot").forEach(decoratePlot);
    decorateScrollableRegions(root);
    enforceTextFloor(root);
    schedulePlotlyReflow();
  }
  function scheduleEditorialPolish(root=document) {
    cancelAnimationFrame(editorialPolishFrame);
    editorialPolishFrame=requestAnimationFrame(()=>editorialPolish(root));
  }
  function viewHeader(titleKey, helpKey) {
    const node = document.createElement("header");
    node.className = "dm-v2-view-head";
    node.innerHTML = '<h2 data-v2-text="' + esc(titleKey) + '">' + esc(tr(titleKey)) + "</h2>";
    if (helpKey) {
      node.insertAdjacentHTML(
        "beforeend",
        '<p data-v2-text="' + esc(helpKey) + '">' + esc(tr(helpKey)) + "</p>",
      );
    }
    return node;
  }
  function icon(name) { return window.DM_ICONS ? window.DM_ICONS.get(name) : ""; }
  function tool(titleKey, iconName) {
    const section = document.createElement("section");
    section.className = "dm-v2-tool";
    section.innerHTML = '<header class="dm-v2-tool-head"><span class="dm-v2-tool-icon">' +
      icon(iconName) + '</span><h2 data-v2-text="' + esc(titleKey) + '">' +
      esc(tr(titleKey)) + '</h2></header><div class="dm-v2-tool-body"></div>';
    return section;
  }
  function settingControl(node, iconName, labelKey) {
    if(!node||node.closest(".dm-v2-setting-item"))return;
    const wrapper=document.createElement("div");wrapper.className="dm-v2-setting-item";
    const badge=document.createElement("span");badge.className="dm-v2-setting-icon";badge.innerHTML=icon(iconName);
    const content=document.createElement("div");content.className="dm-v2-setting-content";
    node.parentNode.insertBefore(wrapper,node);wrapper.append(badge,content);
    if(labelKey){
      const label=document.createElement("span");label.className="dm-v2-setting-label";
      label.dataset.v2Text=labelKey;label.textContent=tr(labelKey);content.appendChild(label);
    }
    content.appendChild(node);
  }
  function actionIcon(button, iconName) {
    if(!button||button.querySelector(".dm-v2-action-icon"))return;
    const badge=document.createElement("span");badge.className="dm-v2-action-icon";
    badge.innerHTML=icon(iconName);button.insertBefore(badge,button.firstChild);
    button.classList.add("dm-v2-icon-action");
  }
  function buildTools(hero) {
    const tools=document.createElement("section");tools.className="dm-v2-tools";
    tools.setAttribute("aria-label",tr("settings"));
    const controls=hero.querySelector(".dm-controls");
    if(controls){
      controls.querySelectorAll(".case-study-wrap").forEach(node=>node.remove());
      tools.append(controls);
      settingControl(controls.querySelector(".decimals-ctl"),"decimals");
      const notes=controls.querySelector(".notes-toggle");
      if(notes){actionIcon(notes,"notes");tools.append(notes);}
    }
    return tools;
  }
  function buildFilters(legacy) {
    const section = document.createElement("section");
    section.className = "dm-v2-global-filters";
    section.hidden=!(DATA.filter_variables||[]).length;
    section.innerHTML = '<header><div><h2 data-v2-text="filters">' + esc(tr("filters")) +
      '</h2></div><button type="button" class="dm-v2-clear-filters"><span data-v2-text="clearAll">' +
      esc(tr("clearAll")) + '</span><span aria-hidden="true">×</span></button></header>';
    const grid = document.createElement("div");
    grid.className = "dm-v2-filter-grid";
    (DATA.filter_variables || []).forEach(variable => {
      const values = new Set();
      experiments.forEach(exp => exp.rows.forEach(row => values.add(isMissing(row[variable]) ? "UNKNOWN" : String(row[variable]))));
      const details = document.createElement("details");
      details.className = "dm-v2-filter-group";
      details.innerHTML = "<summary><span>" + esc(variable) + "</span><small>" + values.size + "</small></summary>";
      const valueWrap = document.createElement("div");
      valueWrap.className = "dm-v2-filter-values";
      Array.from(values).sort().forEach(value => {
        const label = document.createElement("label");
        label.innerHTML = '<input type="checkbox" class="v2-filter" data-filter-var="' + esc(variable) + '" value="' + esc(value) + '" checked><span>' + esc(value) + "</span>";
        valueWrap.appendChild(label);
      });
      details.appendChild(valueWrap); grid.appendChild(details);
    });
    if (!(DATA.filter_variables || []).length) grid.innerHTML = '<small data-v2-text="noCommonFilters">'+esc(tr("noCommonFilters"))+"</small>";
    section.appendChild(grid);
    if (legacy) {
      const holder = document.createElement("div");
      holder.className = "dm-v2-legacy-filters";
      holder.appendChild(legacy);
      section.appendChild(holder);
    }
    section.querySelector(".dm-v2-clear-filters")?.addEventListener("click",()=>{
      grid.querySelectorAll(".v2-filter").forEach(input=>{input.checked=true;});
      dispatchLegacyFilters();
      state.page=0;
      renderTable();renderStatistics();renderWorst();
      document.dispatchEvent(new CustomEvent("dm:v2filterschange"));
    });
    grid.addEventListener("change", event => {
      if (!event.target.matches(".v2-filter")) return;
      const variable=event.target.dataset.filterVar;
      const peers=Array.from(grid.querySelectorAll(
        '.v2-filter[data-filter-var="'+CSS.escape(variable)+'"]'
      ));
      if(!peers.some(input=>input.checked)){
        event.target.checked=true;
        return;
      }
      dispatchLegacyFilters();
      state.page = 0;
      renderTable(); renderStatistics(); renderWorst();
      document.dispatchEvent(new CustomEvent("dm:v2filterschange"));
    });
    return section;
  }
  function switchView(name) {
    if(!Object.prototype.hasOwnProperty.call(views,name))return;
    state.view = name;
    Object.entries(views).forEach(([key, view]) => view.hidden = key !== name);
    shell.querySelectorAll("[data-v2-view]").forEach(button => {
      button.setAttribute("aria-selected", button.dataset.v2View === name ? "true" : "false");
    });
    if (name === "table") renderTable();
    if (name === "statistics") renderStatistics();
    renderModelSelectors();
    window.dispatchEvent(new Event("resize"));
    schedulePlotlyReflow();
    scheduleEditorialPolish(views[name]||shell);
  }
  function buildNav() {
    const nav = document.createElement("nav");
    nav.className = "dm-v2-view-nav";
    nav.setAttribute("role", "tablist");
    nav.dataset.v2AriaLabel="navigation";
    nav.setAttribute("aria-label", tr("navigation"));
    ["evaluation","table","statistics"].forEach(name => {
      const button = document.createElement("button");
      button.type = "button"; button.dataset.v2View = name;
      button.setAttribute("role", "tab");
      button.innerHTML='<span class="dm-v2-nav-icon">'+icon(
        name==="evaluation"?(DATA.panel_mode==="tracking"?"tracking":DATA.task):name
      )+'</span><span data-v2-nav-label>'+esc(tr(name))+"</span>";
      button.setAttribute("aria-selected", name === state.view ? "true" : "false");
      button.addEventListener("click", () => switchView(name));
      nav.appendChild(button);
    });
    return nav;
  }
  function buildTableView() {
    if(DATA.task==="binary"){
      sampleExplorer=window.DM_BINARY_SAMPLES.mount({data:DATA,manager,getRows:exp=>filteredRows(exp,false)});
      return sampleExplorer.view;
    }
    const view = document.createElement("section");
    view.className = "dm-v2-view dm-v2-table-view";
    view.dataset.view = "table"; view.hidden = true;
    view.appendChild(viewHeader("table"));
    tableTabs = document.createElement("div"); tableTabs.className = "dm-v2-table-models";
    tableTabs.hidden=singleModelTask;
    const section = document.createElement("section");
    section.className = "dm-v2-table-section dm-v2-errors-section";
    const heading=document.createElement("header");heading.className="dm-v2-table-heading";
    heading.innerHTML='<div><h3 id="dm-v2-table-title">'+esc(tr("errors"))+
      '</h3><span id="dm-v2-table-badge">'+esc(tr("originalRanking"))+"</span></div>";
    const tools = document.createElement("div"); tools.className = "dm-v2-table-tools";
    searchInput = document.createElement("input"); searchInput.type = "search"; searchInput.dataset.v2Placeholder="search";searchInput.placeholder = tr("search");
    searchInput.addEventListener("input", () => { state.search = searchInput.value.toLowerCase(); state.page = 0; renderTable(); });
    const exportButton = document.createElement("button"); exportButton.type = "button";exportButton.dataset.v2Text="export"; exportButton.textContent = tr("export");
    exportButton.addEventListener("click", exportTable);
    tools.append(searchInput, exportButton);
    const wrap = document.createElement("div"); wrap.className = "dm-v2-table-wrap";
    const table = document.createElement("table"); table.className = "dm-v2-table";
    tableHead = document.createElement("thead"); tableBody = document.createElement("tbody");
    table.append(tableHead, tableBody); wrap.appendChild(table);
    pager = document.createElement("div"); pager.className = "dm-v2-pager";
    section.append(heading,tools,wrap,pager);
    view.append(tableTabs,section);
    return view;
  }
  function sourceRows() {
    return filteredRows(experiment(state.tableModel),true);
  }
  function tableRows() {
    let rows=sourceRows().slice();
    if (state.search) {
      const terms=state.search.split(/\s+/).filter(Boolean);
      rows=rows.filter(row=>terms.every(term=>Object.values(row).some(value=>
        String(value==null?"":value).toLowerCase().includes(term)
      )));
    }
    if (state.sort) rows.sort((a,b) => {
      const x=a[state.sort], y=b[state.sort];
      const nx=Number(x), ny=Number(y);
      const cmp=Number.isFinite(nx)&&Number.isFinite(ny) ? nx-ny : String(x||"").localeCompare(String(y||""));
      return state.desc ? -cmp : cmp;
    });
    return rows;
  }
  function tableColumns(rows) {
    if(DATA.task==="ocr"){
      const ocrPreferred=[
        "record_id","field_name","gt_norm","pred_norm","cer","char_errors",
        "type_id","missing","hallucination","normalization_delta_cer",
      ];
      const available=new Set();
      rows.slice(0,100).forEach(row=>Object.keys(row).forEach(key=>available.add(key)));
      return ocrPreferred.filter(key=>available.has(key));
    }
    if(DATA.task==="eye_evaluation"&&DATA.panel_mode==="evaluation"){
      const eyeCasePreferred=[
        "sample_id","subject_id","target_type","eye_side","match_status",
        "primary_error","angular_error","error_2d","quality_band","device_id","lighting",
      ];
      const available=new Set();
      rows.slice(0,100).forEach(row=>Object.keys(row).forEach(key=>available.add(key)));
      return eyeCasePreferred.filter(key=>available.has(key));
    }
    const preferred = [
      "record_id","sample_id","image_id","path","ground_truth","prediction",
      "label_original","predicted_label","y_true","y_pred","gt_norm","pred_norm",
      "absolute_error","abs_error","residual","cer","error_type","class_name",
      "score","confidence","error_margin","database","records","metric","metric_name",
    ];
    const keys = new Set();
    rows.slice(0,100).forEach(row => Object.keys(row).forEach(key => { if (!key.startsWith("_")) keys.add(key); }));
    return preferred.filter(key => keys.has(key)).concat(Array.from(keys).filter(key => !preferred.includes(key))).slice(0,10);
  }
  function tableColumnLabel(column) {
    if(singleModelTask){
      if(column==="gt_norm")return "GT";
      if(column==="pred_norm")return "Pred";
    }
    if(DATA.task==="eye_evaluation"&&DATA.panel_mode==="evaluation"){
      const labels={
        sample_id:"Sample",subject_id:"Subject",target_type:"Target",eye_side:"Eye",
        match_status:"Status",primary_error:"Primary error",angular_error:"Angular error",
        error_2d:"2D error",quality_band:"Quality",device_id:"Device",lighting:"Lighting",
      };
      if(labels[column])return labels[column];
    }
    return column;
  }
  function renderOcrTableDiffs() {
    const table=tableBody?.closest("table"),enabled=DATA.task==="ocr";
    if(!table)return;
    table.classList.toggle("ocr-diff-table",enabled);
    if(!enabled||typeof window.diffPairHTML!=="function")return;
    tableBody.querySelectorAll("tr").forEach(row=>{
      const gtCell=row.querySelector('[data-column="gt"]'),predCell=row.querySelector('[data-column="pred"]');
      if(!gtCell||!predCell)return;
      const diff=window.diffPairHTML(gtCell.textContent||"",predCell.textContent||"");
      gtCell.classList.add("ocr-text");predCell.classList.add("ocr-text");
      gtCell.innerHTML=diff.gt;predCell.innerHTML=diff.pred;
    });
  }
  function renderTable() {
    if(sampleExplorer){sampleExplorer.render();return;}
    if (!tableBody) return;
    if (!activeIds().includes(state.tableModel)) state.tableModel = state.primary;
    const restoreTableFocus=tableTabs.contains(document.activeElement);
    tableTabs.setAttribute("role","tablist");tableTabs.setAttribute("aria-label",tr("model"));
    tableTabs.textContent = "";
    activeExperiments().forEach(exp => {
      const button=document.createElement("button"); button.type="button"; button.setAttribute("role","tab"); button.textContent=exp.name;
      button.setAttribute("aria-selected", exp.id === state.tableModel ? "true" : "false");
      button.tabIndex=exp.id===state.tableModel?0:-1;
      button.addEventListener("click",()=>{state.tableModel=exp.id;state.page=0;renderTable();});
      tableTabs.appendChild(button);
    });
    tableTabs.onkeydown=event=>{
      if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
      event.preventDefault();const buttons=Array.from(tableTabs.children),index=buttons.indexOf(event.target);
      const next=event.key==="Home"?0:event.key==="End"?buttons.length-1:(index+(event.key==="ArrowRight"?1:-1)+buttons.length)%buttons.length;
      buttons[next]?.click();tableTabs.children[next]?.focus();
    };
    if(restoreTableFocus)tableTabs.querySelector('[aria-selected="true"]')?.focus({preventScroll:true});
    document.getElementById("dm-v2-table-title").textContent=tr("errors");
    document.getElementById("dm-v2-table-badge").textContent=tr("originalRanking");
    if(searchInput.value!==state.search)searchInput.value=state.search;
    const pageSize=10;
    const rows=tableRows(), columns=tableColumns(rows), pages=Math.max(1,Math.ceil(rows.length/pageSize));
    state.page=Math.min(state.page,pages-1);
    tableHead.innerHTML="<tr>"+columns.map(column=>'<th><button type="button" data-sort="'+esc(column)+'">'+
      esc(tableColumnLabel(column))+(state.sort===column?(state.desc?" ↓":" ↑"):"")+"</button></th>").join("")+"</tr>";
    tableHead.querySelectorAll("[data-sort]").forEach(button=>button.addEventListener("click",()=>{
      if(state.sort===button.dataset.sort)state.desc=!state.desc;else{state.sort=button.dataset.sort;state.desc=false;}renderTable();
    }));
    const pageRows=rows.slice(state.page*pageSize,state.page*pageSize+pageSize);
    tableBody.innerHTML=pageRows.map(row=>"<tr>"+columns.map(column=>{
      const value=row[column];
      if((column==="path"||column==="image_path")&&row._image)return '<td><button type="button" data-v2-image="'+esc(row._image)+'" title="'+esc(value)+'">◉</button></td>';
      const display=typeof value==="number"&&!Number.isInteger(value)
        ?value.toLocaleString(undefined,{maximumFractionDigits:6}):value;
      const diffColumn=DATA.task==="ocr"
        ?(column==="gt_norm"?"gt":column==="pred_norm"?"pred":null):null;
      return "<td"+(diffColumn?' data-column="'+diffColumn+'"':"")+">"+esc(display)+"</td>";
    }).join("")+"</tr>").join("")||'<tr><td colspan="'+Math.max(1,columns.length)+'">'+esc(tr("noRows"))+"</td></tr>";
    renderOcrTableDiffs();
    tableBody.querySelectorAll("[data-v2-image]").forEach(button=>button.addEventListener("click",()=>openImage(button.dataset.v2Image)));
    pager.innerHTML='<button type="button" data-page="-1" '+(state.page===0?"disabled":"")+'>‹</button><span>'+(state.page+1)+" / "+pages+" · "+rows.length+" "+esc(tr("rows"))+'</span><button type="button" data-page="1" '+(state.page===pages-1?"disabled":"")+">›</button>";
    pager.querySelectorAll("[data-page]").forEach(button=>button.addEventListener("click",()=>{state.page+=Number(button.dataset.page);renderTable();}));
  }
  function exportTable() {
    const rows=tableRows(), columns=tableColumns(rows);
    const cell=value=>{const s=value==null?"":String(value);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
    const csv=[columns.map(cell).join(",")].concat(rows.map(row=>columns.map(column=>cell(row[column])).join(","))).join("\n");
    download("errors_"+DATA.task+"_"+state.tableModel+".csv",csv,"text/csv;charset=utf-8");
  }
  function buildStatisticsView() {
    const view=document.createElement("section");view.className="dm-v2-view dm-v2-statistics-view";view.dataset.view="statistics";view.hidden=true;
    view.appendChild(viewHeader("statistics"));
    const index=document.createElement("nav");index.className="dm-v2-stat-index";
    index.dataset.v2AriaLabel="statisticsSections";
    index.setAttribute("aria-label",tr("statisticsSections"));
    index.setAttribute("role","tablist");statisticsTabs=index;
    statisticsPanels={};
    [
      ["dataMap","dm-v2-data-map"],
      ["relationship","dm-v2-relationship"],
    ].forEach(([label,target])=>{
      const button=document.createElement("button");button.type="button";button.dataset.v2Text=label;button.textContent=tr(label);
      button.dataset.statTab=label;button.id="dm-stat-tab-"+label;button.setAttribute("role","tab");
      button.setAttribute("aria-controls","dm-stat-pane-"+label);
      button.addEventListener("click",()=>selectStatisticsTab(label));
      index.appendChild(button);
    });
    view.appendChild(index);
    index.addEventListener("keydown",event=>{
      if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
      event.preventDefault();const buttons=[...index.children],current=buttons.indexOf(document.activeElement);
      const next=event.key==="Home"?0:event.key==="End"?buttons.length-1:(current+(event.key==="ArrowRight"?1:-1)+buttons.length)%buttons.length;
      buttons[next].focus();buttons[next].click();
    });
    const treeSection=document.createElement("section");treeSection.className="dm-v2-stat-section dm-v2-data-map";
    treeSection.id="dm-v2-data-map";
    treeSection.innerHTML='<header><span>'+icon("database")+'</span><h2 data-v2-text="dataMap">'+esc(tr("dataMap"))+"</h2></header>";
    const treeTools=document.createElement("div");treeTools.className="dm-v2-tree-tools";
    statTreeSearch=document.createElement("input");statTreeSearch.type="search";statTreeSearch.dataset.v2Placeholder="searchData";
    statTreeSearch.placeholder=tr("searchData");statTreeSearch.addEventListener("input",()=>{
      state.treeQuery=statTreeSearch.value.trim().toLowerCase();renderDataTree();
    });
    statTreeSearch.setAttribute("aria-label",tr("searchData"));
    const expand=document.createElement("button");expand.type="button";expand.dataset.v2Text="expandAll";expand.textContent=tr("expandAll");
    expand.addEventListener("click",()=>statTree?.querySelectorAll("details").forEach(node=>node.open=true));
    const collapse=document.createElement("button");collapse.type="button";collapse.dataset.v2Text="collapseAll";collapse.textContent=tr("collapseAll");
    collapse.addEventListener("click",()=>statTree?.querySelectorAll("details").forEach(node=>node.open=false));
    treeTools.append(statTreeSearch,expand,collapse);treeSection.appendChild(treeTools);
    statTree=document.createElement("div");statTree.id="dm-v2-stat-tree";treeSection.appendChild(statTree);
    statisticalSummary=window.DM_STATISTICS.mountSummary({data:DATA,manager,getRows:statisticsRows,icon});
    relationshipExplorer=window.DM_RELATIONSHIP.mount({data:DATA,manager,getRows:statisticsRows,icon});
    for(const [key,children]of [
      ["dataMap",[treeSection,statisticalSummary.section]],
      ["relationship",[relationshipExplorer.root]],
    ]){
      const pane=document.createElement("div");pane.id="dm-stat-pane-"+key;pane.setAttribute("role","tabpanel");
      pane.setAttribute("aria-labelledby","dm-stat-tab-"+key);pane.tabIndex=0;pane.append(...children);
      statisticsPanels[key]=pane;view.append(pane);
    }
    selectStatisticsTab(state.statisticsTab,false);
    manager.subscribeThresholds(()=>{
      if(!statisticsFrame)statisticsFrame=requestAnimationFrame(()=>{statisticsFrame=0;renderStatistics();});
    });
    return view;
  }
  function selectStatisticsTab(key,render=true){
    state.statisticsTab=key;
    for(const button of statisticsTabs.children){const selected=button.dataset.statTab===key;button.setAttribute("aria-selected",String(selected));button.tabIndex=selected?0:-1;}
    for(const [name,pane]of Object.entries(statisticsPanels))pane.hidden=name!==key;
    if(render){renderStatistics();schedulePlotlyReflow();}
  }
  function statisticsRows(exp){return window.DM_STATISTICS.liveRows(exp,DATA,manager,filteredRows(exp,false));}
  function allVariables() {
    const schema=(DATA.statistics_schema?.variables||[]).map(item=>item.key);
    if(schema.length)return schema;
    const keys=new Set();
    experiments.forEach(exp=>(exp.rows||[]).forEach(row=>
      Object.keys(row).forEach(key=>{if(!key.startsWith("_"))keys.add(key);})));
    return Array.from(keys).sort((a,b)=>a.localeCompare(b));
  }
  function variableRole(variable) {
    return DATA.statistics_schema?.variables?.find(item=>item.key===variable)?.role||"metadata";
  }
  function missingTokens(){return DATA.statistics_schema?.missing_tokens||["UNKNOWN"];}
  function dataMapProfile(rows,variable) {
    const values=rows.map(row=>row[variable]);
    const validValues=values.filter(value=>!isMissing(value));
    return {
      role:variableRole(variable),type:DM_V2_AGG.measurementType(values,missingTokens()),
      valid:validValues.length,missing:values.length-validValues.length,
      unique:new Set(validValues.map(value=>String(value))).size,
    };
  }
  function selectField(labelKey,values,selected) {
    const label=document.createElement("label");
    const span=document.createElement("span");span.dataset.v2Text=labelKey;span.textContent=tr(labelKey);
    const select=document.createElement("select");
    values.forEach(value=>select.appendChild(new Option(value,value)));select.value=selected||values[0]||"";
    label.append(span,select);return {label,select};
  }
  function choiceField(labelKey,choices,selected) {
    const label=document.createElement("label");
    const span=document.createElement("span");span.dataset.v2Text=labelKey;span.textContent=tr(labelKey);
    const select=document.createElement("select");
    choices.forEach(([value,optionKey])=>{
      const option=new Option(tr(optionKey),value);option.dataset.v2OptionText=optionKey;select.appendChild(option);
    });
    select.value=selected||choices[0]?.[0]||"";label.append(span,select);return {label,select};
  }
  function buildCustomPanel(key,count) {
    const section=document.createElement("section");section.className="dm-v2-stat-section dm-v2-custom";
    section.id="dm-v2-"+key;
    section.innerHTML='<header><span>'+icon("chart")+'</span><h2 data-v2-text="'+key+'">'+esc(tr(key))+
      '</h2><strong class="dm-v2-chart-kind"></strong></header>';
    const variables=allVariables();
    // Metadata categories make useful initial axes; IDs and paths remain
    // available in the controls but never displace meaningful defaults.
    const categorical=variables.filter(variable=>variableRole(variable)==="metadata"&&experiments.some(exp=>
      DM_V2_AGG.measurementType((exp.rows||[]).map(row=>row[variable]),missingTokens())==="categorical"));
    const cardinality=variable=>new Set(experiments.flatMap(exp=>(exp.rows||[]).map(row=>row[variable])).filter(value=>!isMissing(value))).size;
    const candidates=categorical.filter(variable=>cardinality(variable)>1&&cardinality(variable)<=30);
    const preferred=[...candidates,...variables.filter(variable=>!["identifier","path"].includes(variableRole(variable))&&!candidates.includes(variable))];
    const xDefault=preferred[0]||variables[0];
    const yDefault=preferred.find(variable=>variable!==xDefault)||variables.find(variable=>variable!==xDefault)||xDefault;
    const zDefault=preferred.find(variable=>variable!==xDefault&&variable!==yDefault)||
      variables.find(variable=>variable!==xDefault&&variable!==yDefault)||xDefault;
    const defaults=[xDefault,yDefault,zDefault];
    if(count===3&&defaults.every(variable=>candidates.includes(variable))){
      const facet=defaults.reduce((a,b)=>cardinality(a)<=cardinality(b)?a:b);
      defaults.splice(0,3,...defaults.filter(variable=>variable!==facet),facet);
    }
    const controls=document.createElement("div");controls.className="dm-v2-stats-controls";
    const fields=[
      selectField("xVariable",variables,defaults[0]),
      selectField("yVariable",variables,defaults[1]),
    ];
    if(count===3)fields.push(selectField("zVariable",variables,defaults[2]));
    fields.forEach((field,index)=>{
      field.label.classList.add("dm-v2-axis-control");
      field.select.dataset.v2Axis=["x","y","group"][index];
      field.select.dataset.v2Previous=field.select.value;
      controls.appendChild(field.label);
    });
    const valueField=choiceField("valueMode",[
      ["count","countValue"],["row_pct","rowPercent"],
      ["column_pct","columnPercent"],["total_pct","totalPercent"],
    ],"count");
    valueField.label.classList.add("dm-v2-value-control");
    valueField.select.dataset.v2ValueMode="1";
    controls.appendChild(valueField.label);
    const facetField=selectField("facetCategory",[""],"");
    facetField.label.classList.add("dm-v2-facet-control");
    facetField.label.hidden=true;facetField.select.dataset.v2FacetCategory="1";
    if(count===3)controls.appendChild(facetField.label);
    const plot=document.createElement("div");plot.className="dm-v2-custom-plot";plot.id="dm-v2-"+key+"-plot";
    const notice=document.createElement("p");notice.className="dm-stat-summary-note";notice.hidden=true;
    customPlots[key]={
      count,fields:fields.map(field=>field.select),plot,badge:section.querySelector(".dm-v2-chart-kind"),
      xSelect:fields[0].select,ySelect:fields[1].select,groupSelect:fields[2]?.select||null,
      valueSelect:valueField.select,valueLabel:valueField.label,
      facetSelect:count===3?facetField.select:null,facetLabel:count===3?facetField.label:null,
      facetSignature:"",notice,
    };
    fields.forEach(field=>field.select.addEventListener("change",event=>{
      const duplicate=fields.find(item=>item.select!==event.target&&item.select.value===event.target.value);
      if(duplicate){
        const previous=event.target.dataset.v2Previous;
        const used=new Set(fields.filter(item=>item!==duplicate&&item.select!==event.target).map(item=>item.select.value));
        duplicate.select.value=previous&&!used.has(previous)
          ?previous:(variables.find(variable=>variable!==event.target.value&&!used.has(variable))||duplicate.select.value);
        duplicate.select.dataset.v2Previous=duplicate.select.value;
      }
      event.target.dataset.v2Previous=event.target.value;
      renderCustom(key);
    }));
    valueField.select.addEventListener("change",()=>renderCustom(key));
    facetField.select.addEventListener("change",()=>renderCustom(key));
    section.append(controls,notice,plot);return section;
  }
  function renderStatistics() {
    if(!statTree||views.statistics?.hidden!==false)return;
    if(state.statisticsTab==="dataMap"){renderDataTree();statisticalSummary.render();}
    else relationshipExplorer.render();
  }
  function valueCounts(rows,variable) {
    const counts=new Map();
    rows.forEach(row=>{const value=isMissing(row[variable])?"UNKNOWN":String(row[variable]);counts.set(value,(counts.get(value)||0)+1);});
    return Array.from(counts.entries()).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  }
  function renderDataTree() {
    if(!statTree)return;
    const expanded=new Set(Array.from(statTree.querySelectorAll('.dm-v2-tree-model[open]')).map(node=>node.dataset.treeModel));
    const expandedValues=new Set(Array.from(statTree.querySelectorAll('.dm-v2-tree-values-details[open]')).map(node=>node.dataset.treeValue));
    statTree.textContent="";
    if(statTreeSearch&&statTreeSearch.value!==state.treeQuery)statTreeSearch.value=state.treeQuery;
    const variables=allVariables(),query=state.treeQuery;
    activeExperiments().forEach((exp,index)=>{
      const rows=statisticsRows(exp),root=document.createElement("details");
      const modelVariables=variables.filter(variable=>DATA.statistics_schema?.variables?.find(item=>item.key===variable)?.available_in.includes(exp.id)??(exp.rows||[]).some(row=>Object.hasOwn(row,variable)));
      root.className="dm-v2-tree-model";root.dataset.treeModel=exp.id;root.open=!!query||expanded.has(exp.id)||(!treeInitialized&&index===0);
      root.innerHTML="<summary><strong>"+esc(exp.name)+"</strong><span>"+rows.length.toLocaleString()+" "+
        esc(tr("recordsCount"))+" · "+modelVariables.length+" "+esc(tr("fields"))+"</span></summary>";
      const fields=document.createElement("div");fields.className="dm-v2-tree-fields";
      modelVariables.forEach(variable=>{
        const allCounts=valueCounts(rows,variable);
        const variableMatch=variable.toLowerCase().includes(query);
        const valueMatches=query?allCounts.filter(item=>item[0].toLowerCase().includes(query)):allCounts;
        if(query&&!variableMatch&&!valueMatches.length)return;
        const counts=query&&!variableMatch?valueMatches:allCounts;
        const variableProfile=dataMapProfile(rows,variable);
        const field=document.createElement("article");field.className="dm-v2-tree-field";
        field.innerHTML='<header><div><code>'+esc(variable)+'</code><span class="dm-v2-tree-role">'+
          esc(window.DM_I18N.t("statistics.role."+variableProfile.role))+'</span><span class="dm-v2-tree-type">'+esc(window.DM_I18N.t("statistics.type."+variableProfile.type))+
          '</span></div><small>'+esc(tr("valid"))+" "+variableProfile.valid.toLocaleString()+" · "+
          esc(tr("missing"))+" "+variableProfile.missing.toLocaleString()+" · "+esc(tr("unique"))+" "+
          variableProfile.unique.toLocaleString()+"</small></header>";
        const values=document.createElement("details");values.className="dm-v2-tree-values-details";
        values.dataset.treeValue=JSON.stringify([exp.id,variable]);
        values.open=(!!query&&!variableMatch)||(!query&&expandedValues.has(values.dataset.treeValue));
        const summary=document.createElement("summary");summary.innerHTML=
          '<span class="dm-v2-tree-values-label"><span data-v2-text="values">'+esc(tr("values"))+
          '</span><small><span class="dm-v2-tree-expand-label" data-v2-text="expandValues">'+
          esc(tr("expandValues"))+'</span><span class="dm-v2-tree-collapse-label" data-v2-text="collapseValues">'+
          esc(tr("collapseValues"))+'</span></small></span><strong class="dm-v2-tree-values-count">'+
          counts.length.toLocaleString()+'</strong><span class="dm-v2-tree-values-chevron" aria-hidden="true"></span>';
        values.appendChild(summary);
        const list=document.createElement("ol");list.className="dm-v2-tree-values";values.appendChild(list);
        const pageKey=exp.id+"\u0000"+variable+"\u0000"+query;
        const renderPage=()=>{
          const limit=treePages.get(pageKey)||25;list.textContent="";
          counts.slice(0,limit).forEach(([value,count])=>{
            const item=document.createElement("li");item.innerHTML="<span>"+esc(value)+"</span><strong>"+
              count.toLocaleString()+"</strong>";list.appendChild(item);
          });
          if(counts.length>limit){
            const item=document.createElement("li");item.className="dm-v2-tree-more";
            const button=document.createElement("button");button.type="button";button.textContent=tr("showMore");
            button.addEventListener("click",event=>{
              event.preventDefault();treePages.set(pageKey,limit+25);renderPage();
            });
            item.appendChild(button);list.appendChild(item);
          }
        };
        renderPage();field.appendChild(values);fields.appendChild(field);
      });
      if(fields.children.length){root.appendChild(fields);statTree.appendChild(root);}
    });
    treeInitialized=true;
    if(!statTree.children.length){const empty=document.createElement("p");empty.className="dm-v2-empty";empty.textContent=tr("noRows");statTree.append(empty);}
  }
  function variableType(series,variable) {
    return DM_V2_AGG.measurementType(
      series.flatMap(item=>item.rows.map(row=>row[variable])),missingTokens(),
    );
  }
  function customCategorySpec(series,variable,limit=10) {
    const values=series.flatMap(item=>item.rows.map(row=>row[variable]));
    const map=DM_V2_AGG.topCategoryMap(values,limit,missingTokens());
    const counts=new Map();
    values.forEach(value=>{
      const category=map(value);counts.set(category,(counts.get(category)||0)+1);
    });
    return {
      map,
      values:Array.from(counts.entries())
        .sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))
        .map(item=>item[0]),
    };
  }
  function customFacetSelection(panel,values) {
    if(!panel.facetSelect||!panel.facetLabel)return values;
    const needsSelector=values.length>6;
    panel.facetLabel.hidden=!needsSelector;
    if(!needsSelector)return values;
    const signature=values.join("\u0000");
    if(signature!==panel.facetSignature){
      const previous=panel.facetSelect.value;
      panel.facetSelect.replaceChildren(...values.map(value=>new Option(value,value)));
      panel.facetSelect.value=values.includes(previous)?previous:(values[0]||"");
      panel.facetSignature=signature;
    }
    return panel.facetSelect.value?[panel.facetSelect.value]:values.slice(0,1);
  }
  function customHeatmapValue(count,rowTotal,columnTotal,panelTotal,mode) {
    if(mode==="row_pct")return rowTotal?100*count/rowTotal:0;
    if(mode==="column_pct")return columnTotal?100*count/columnTotal:0;
    if(mode==="total_pct")return panelTotal?100*count/panelTotal:0;
    return count;
  }
  function renderCustomHeatmaps(panel,series,xVar,yVar,groupVar,valueMode) {
    if(!series.some(item=>item.rows.length)){
      queuePlot(panel.plot,{empty:'<strong>'+esc(tr("noPlotData"))+"</strong>"});return;
    }
    const xSpec=customCategorySpec(series,xVar,10);
    const ySpec=customCategorySpec(series,yVar,10);
    const groupSpec=groupVar?customCategorySpec(series,groupVar,12):null;
    const lowSupport=Math.max(1,Number(DATA.group_audit_min_samples||20));
    const allFacets=groupSpec?groupSpec.values:[null];
    const facets=customFacetSelection(panel,allFacets);
    const yRows=series.flatMap(item=>ySpec.values.map(value=>({
      item,value,label:series.length>1?item.exp.name+" · "+value:value,
    })));
    const facetPanels=facets.map(facet=>{
      const counts=new Map();
      series.forEach(item=>item.rows.forEach(row=>{
        if(groupSpec&&groupSpec.map(row[groupVar])!==facet)return;
        const x=xSpec.map(row[xVar]),y=ySpec.map(row[yVar]);
        const token=item.exp.id+"\u0000"+x+"\u0000"+y;
        counts.set(token,(counts.get(token)||0)+1);
      }));
      const raw=yRows.map(entry=>xSpec.values.map(x=>
        counts.get(entry.item.exp.id+"\u0000"+x+"\u0000"+entry.value)||0
      ));
      const rowTotals=raw.map(row=>row.reduce((sum,value)=>sum+value,0));
      const columnTotals=new Map(),panelTotals=new Map();
      raw.forEach((row,rowIndex)=>{
        const expId=yRows[rowIndex].item.exp.id;
        row.forEach((value,columnIndex)=>{
          const columnKey=expId+"\u0000"+columnIndex;
          columnTotals.set(columnKey,(columnTotals.get(columnKey)||0)+value);
          panelTotals.set(expId,(panelTotals.get(expId)||0)+value);
        });
      });
      const display=raw.map((row,rowIndex)=>row.map((count,columnIndex)=>{
        const expId=yRows[rowIndex].item.exp.id;
        return customHeatmapValue(
          count,rowTotals[rowIndex],columnTotals.get(expId+"\u0000"+columnIndex)||0,
          panelTotals.get(expId)||0,valueMode,
        );
      }));
      const percentage=raw.map((row,rowIndex)=>row.map((count,columnIndex)=>{
        const expId=yRows[rowIndex].item.exp.id;
        return valueMode==="count"
          ?customHeatmapValue(count,0,0,panelTotals.get(expId)||0,"total_pct")
          :display[rowIndex][columnIndex];
      }));
      return {facet,raw,display,percentage};
    });
    const displayed=facetPanels.flatMap(item=>item.display.flat()).filter(Number.isFinite);
    const mean=displayed.length?displayed.reduce((sum,value)=>sum+value,0)/displayed.length:0;
    const maximum=valueMode==="count"?Math.max(1,...displayed):100;
    const verticalFacets=Boolean(groupVar&&facets.length>1);
    const columns=verticalFacets?1:(facets.length===1?1:2),rows=Math.ceil(facets.length/columns);
    // Allocate pixels per matrix row, not a fixed total height split by facets.
    // The latter compressed multi-model labels and hid alternating tick labels.
    const facetPixels=Math.max(90,yRows.length*30),facetGap=64;
    const innerPixels=rows*facetPixels+(rows-1)*facetGap+88;
    const left=verticalFacets?.055:.07,right=verticalFacets?.925:.92,bottom=verticalFacets?44/innerPixels:.08;
    const top=verticalFacets?1-44/innerPixels:(facets.length>1?.84:.93);
    const hGap=columns>1?.08:0,vGap=rows>1?(verticalFacets?facetGap/innerPixels:.18):0;
    const panelWidth=(right-left-hGap*(columns-1))/columns;
    const panelHeight=(top-bottom-vGap*(rows-1))/rows;
    const traces=[],annotations=[];
    const chartText=getComputedStyle(document.documentElement).getPropertyValue("--wb-ink").trim()||"#334155";
    facetPanels.forEach((item,index)=>{
      const column=index%columns,row=Math.floor(index/columns);
      const x0=left+column*(panelWidth+hGap),x1=x0+panelWidth;
      const y1=top-row*(panelHeight+vGap),y0=y1-panelHeight;
      const suffix=index?String(index+1):"";
      const xRef="x"+suffix,yRef="y"+suffix;
      const xAxisKey="xaxis"+suffix,yAxisKey="yaxis"+suffix;
      traces.push({
        type:"heatmap",x:xSpec.values,y:yRows.map(entry=>entry.label),z:item.display,
        customdata:item.raw.map((rawRow,rowIndex)=>rawRow.map((count,columnIndex)=>[
          count,item.percentage[rowIndex][columnIndex],item.display[rowIndex][columnIndex]-mean,
          count>0&&count<lowSupport?tr("lowSupport"):"",
        ])),
        xaxis:xRef,yaxis:yRef,coloraxis:"coloraxis",hoverongaps:false,
        hovertemplate:"<b>"+esc(xVar)+": %{x}</b><br>"+esc(yVar)+": %{y}<br>"+
          esc(tr("count"))+": %{customdata[0]:,}<br>"+esc(tr("percentage"))+
          ": %{customdata[1]:.1f}%<br>"+esc(tr("differenceMean"))+
          (valueMode==="count"?": %{customdata[2]:+.1f}":": %{customdata[2]:+.1f} pp")+
          "<br><b>%{customdata[3]}</b>"+
          "<extra>"+esc(item.facet==null?tr("heatmap"):groupVar+" = "+item.facet)+"</extra>",
      });
      item.display.forEach((displayRow,rowIndex)=>displayRow.forEach((value,columnIndex)=>{
        const count=item.raw[rowIndex][columnIndex];
        const low=count>0&&count<lowSupport;
        annotations.push({
          x:xSpec.values[columnIndex],y:yRows[rowIndex].label,xref:xRef,yref:yRef,
          text:valueMode==="count"?count.toLocaleString():
            value.toFixed(value>=10?0:1)+"%",
          showarrow:false,font:{size:11,color:"#24364f"},
          bordercolor:low?"#fb7185":"rgba(0,0,0,0)",borderwidth:low?1.5:0,borderpad:low?2:0,
        });
      }));
      if(item.facet!=null)annotations.push({
        x:(x0+x1)/2,y:Math.min(.985,y1+(verticalFacets?24/innerPixels:.065)),xref:"paper",yref:"paper",
        text:"<b>"+esc(groupVar)+": "+esc(item.facet)+"</b>",showarrow:false,
        font:{size:verticalFacets?13:12,color:chartText},
      });
      panel._layout=panel._layout||{};
      panel._layout[xAxisKey]={
        domain:[x0,x1],anchor:yRef,title:{text:row===rows-1?xVar:""},
        categoryorder:"array",categoryarray:xSpec.values,
        tickangle:xSpec.values.length<=8?0:-28,automargin:true,
        showticklabels:!verticalFacets||row===rows-1,tickfont:{size:verticalFacets?12:11},
      };
      panel._layout[yAxisKey]={
        domain:[y0,y1],anchor:xRef,title:{text:verticalFacets?(row===Math.floor(rows/2)?yVar:""):(column===0?yVar:"")},
        categoryorder:"array",categoryarray:yRows.map(entry=>entry.label),
        tickmode:"array",tickvals:yRows.map(entry=>entry.label),
        autorange:"reversed",automargin:true,tickfont:{size:verticalFacets?12:11},
      };
    });
    const valueLabel=valueMode==="count"?tr("countValue"):
      valueMode==="row_pct"?tr("rowPercent"):
      valueMode==="column_pct"?tr("columnPercent"):tr("totalPercent");
    const layout={
      ...(panel._layout||{}),
      height:verticalFacets?innerPixels+96:
        (facets.length===1?Math.max(360,180+yRows.length*55):Math.max(520,rows*310)),
      margin:{l:verticalFacets?155:75,r:verticalFacets?90:100,t:verticalFacets?38:55,b:verticalFacets?58:75},annotations,
      coloraxis:{
        colorscale:[[0,"#e8f5e9"],[.25,"#b9ded0"],[.5,"#fff3c4"],[.75,"#f3bd8a"],[1,"#cf5b4d"]],
        cmin:0,cmax:maximum,
        colorbar:{title:{text:valueLabel},ticksuffix:valueMode==="count"?"":"%"},
      },
      showlegend:false,
    };
    panel._layout=null;
    panel.plot.dataset.v2ChartKind=groupVar?"faceted_heatmap":"heatmap";
    panel.plot.dataset.v2XAxis=xVar;panel.plot.dataset.v2YAxis=yVar;
    panel.plot.dataset.v2Group=groupVar||"";panel.plot.dataset.v2ValueMode=valueMode;
    panel.plot.dataset.v2FacetCount=String(facets.length);
    panel.plot.dataset.v2FacetColumns=String(columns);
    panel.plot.dataset.v2FacetLayout=verticalFacets?"vertical-readable":"grid";
    panel.plot.dataset.v2PlotHeight=String(layout.height);
    if(verticalFacets){
      panel.plot.style.setProperty("--dm-v2-facet-height",layout.height+"px");
      panel.plot.style.height=layout.height+"px";
    }else{
      panel.plot.style.removeProperty("--dm-v2-facet-height");
      panel.plot.style.removeProperty("height");
    }
    panel.plot.dataset.v2SharedColorScale="true";
    panel.plot.dataset.v2ColorScale="pastel-audit";
    queuePlot(panel.plot,{traces,layout,config:{responsive:true,displayModeBar:true}});
  }
  function renderCustom(key) {
    const panel=customPlots[key];if(!panel||typeof Plotly==="undefined")return;
    const variables=panel.fields.map(select=>select.value),active=activeExperiments();
    const available=exp=>variables.every(variable=>DATA.statistics_schema?.variables?.find(item=>item.key===variable)?.available_in.includes(exp.id)??(exp.rows||[]).some(row=>Object.hasOwn(row,variable)));
    const unavailable=active.filter(exp=>!available(exp));
    panel.notice.hidden=!unavailable.length;panel.notice.textContent=unavailable.length?window.DM_I18N.t("statistics.unavailableModels",{models:unavailable.map(exp=>exp.name).join(", ")}):"";
    const series=active.filter(available).map(exp=>({exp,rows:statisticsRows(exp)}));
    if(variables.some(variable=>!variable)||new Set(variables).size!==variables.length){queuePlot(panel.plot,{empty:'<strong>'+esc(tr("noPlotData"))+"</strong>"});return;}
    const types=variables.map(variable=>variableType(series,variable));
    const kind=DM_V2_AGG.resolveAxesChart(types[0],types[1],types[2]);
    const numericTypes=new Set(["continuous_numeric","discrete_numeric"]);
    const kindLabel=kind==="scatter"?tr("scatter"):kind==="heatmap"?tr("heatmap"):
      kind==="faceted_heatmap"?tr("facetedHeatmap"):
      kind.includes("box")?tr("box"):tr("bar");
    const heatmapKind=kind==="heatmap"||kind==="faceted_heatmap";
    panel.valueLabel.hidden=!heatmapKind;panel.valueSelect.disabled=!heatmapKind;
    if(!heatmapKind&&panel.facetLabel)panel.facetLabel.hidden=true;
    panel.badge.textContent=tr("automaticChart")+" · "+kindLabel+
      (heatmapKind?" · "+tr("sharedScale"):"");
    const traces=[],publicValue=(row,variable)=>isMissing(row[variable])?"UNKNOWN":row[variable];
    const fullHover=variables.map((variable,index)=>esc(variable)+": %{customdata["+index+"]}").join("<br>");
    const sample=rows=>{
      if(rows.length<=2000)return rows;
      return Array.from({length:2000},(_item,index)=>rows[Math.floor(index*rows.length/2000)]);
    };
    const mapper=variable=>DM_V2_AGG.topCategoryMap(
      series.flatMap(item=>item.rows.map(row=>row[variable])),20,missingTokens(),
    );
    let xTitle=variables[0],yTitle=variables[1];
    if(kind==="scatter"){
      const [xVar,yVar,third]=variables;
      xTitle=xVar;yTitle=yVar;
      const thirdType=third?types[2]:null,thirdMap=third&&!numericTypes.has(thirdType)?mapper(third):null;
      series.forEach(item=>{
        const valid=sample(item.rows.filter(row=>window.DM_STATISTICS.numeric(row[xVar])&&window.DM_STATISTICS.numeric(row[yVar])&&(!third||thirdMap||window.DM_STATISTICS.numeric(row[third]))));
        if(third&&thirdMap){
          const groups=new Map();
          valid.forEach(row=>{
            const group=thirdMap(row[third]),bucket=groups.get(group)||[];bucket.push(row);groups.set(group,bucket);
          });
          groups.forEach((rows,group)=>traces.push({
            type:"scatter",mode:"markers",name:item.exp.name+" · "+group,
            x:rows.map(row=>Number(row[xVar])),y:rows.map(row=>Number(row[yVar])),
            customdata:rows.map(row=>variables.map(variable=>publicValue(row,variable))),
            marker:{size:8,opacity:.68},hovertemplate:fullHover+"<extra>%{fullData.name}</extra>",
          }));
        }else{
          const thirdValues=third?valid.map(row=>Number(row[third])):[];
          const finiteThird=thirdValues.filter(Number.isFinite),minimum=Math.min(...finiteThird),maximum=Math.max(...finiteThird);
          traces.push({
            type:"scatter",mode:"markers",name:item.exp.name,
            x:valid.map(row=>Number(row[xVar])),y:valid.map(row=>Number(row[yVar])),
            customdata:valid.map(row=>variables.map(variable=>publicValue(row,variable))),
            marker:{
              size:third?thirdValues.map(value=>Number.isFinite(value)&&maximum>minimum?7+11*(value-minimum)/(maximum-minimum):8):8,
              color:third?thirdValues:manager.getColor(item.exp.id),colorscale:"Viridis",showscale:!!third,opacity:.68,
            },
            hovertemplate:fullHover+"<extra>"+esc(item.exp.name)+"</extra>",
          });
        }
      });
    }else if(kind==="box"||kind==="grouped_box"){
      const [xVar,yVar,groupVar]=variables;
      const xNumeric=numericTypes.has(types[0]),numeric=xNumeric?xVar:yVar,category=xNumeric?yVar:xVar;
      const categoryMap=mapper(category),groupMap=groupVar?mapper(groupVar):null;
      xTitle=xVar;yTitle=yVar;
      series.forEach(item=>{
        const valid=item.rows.filter(row=>window.DM_STATISTICS.numeric(row[numeric]));
        const traceFor=(rows,name)=>({
          type:"box",name,marker:{color:manager.getColor(item.exp.id)},
          orientation:xNumeric?"h":"v",
          x:xNumeric?rows.map(row=>Number(row[numeric])):rows.map(row=>categoryMap(row[category])),
          y:xNumeric?rows.map(row=>categoryMap(row[category])):rows.map(row=>Number(row[numeric])),
          customdata:rows.map(row=>variables.map(variable=>publicValue(row,variable))),
          boxpoints:"outliers",hovertemplate:fullHover+"<extra>%{fullData.name}</extra>",
        });
        if(groupVar){
          const groups=new Map();
          valid.forEach(row=>{const group=groupMap(row[groupVar]),bucket=groups.get(group)||[];bucket.push(row);groups.set(group,bucket);});
          groups.forEach((rows,group)=>traces.push(traceFor(rows,item.exp.name+" · "+group)));
        }else{
          traces.push(traceFor(valid,item.exp.name));
        }
      });
    }else if(kind==="heatmap"||kind==="faceted_heatmap"){
      renderCustomHeatmaps(
        panel,series,variables[0],variables[1],kind==="faceted_heatmap"?variables[2]:null,
        panel.valueSelect.value,
      );
      return;
    }else{
      queuePlot(panel.plot,{empty:'<strong>'+esc(tr("noPlotData"))+"</strong>"});return;
    }
    panel.plot.dataset.v2ChartKind=kind;
    panel.plot.dataset.v2XAxis=variables[0];panel.plot.dataset.v2YAxis=variables[1];
    panel.plot.dataset.v2Group=variables[2]||"";panel.plot.dataset.v2ValueMode="";
    panel.plot.dataset.v2FacetCount="0";panel.plot.dataset.v2SharedColorScale="false";
    panel.plot.style.removeProperty("--dm-v2-facet-height");panel.plot.style.removeProperty("height");
    if(!traces.length){
      queuePlot(panel.plot,{empty:'<strong>'+esc(tr("noPlotData"))+"</strong>"});return;
    }
    queuePlot(panel.plot,{traces,layout:{
      height:460,barmode:"group",margin:{l:65,r:35,t:35,b:105},
      legend:{orientation:"h"},
      xaxis:{title:xTitle,tickangle:numericTypes.has(types[0])?0:-28,automargin:true},
      yaxis:{title:yTitle,automargin:true},
    },config:{responsive:true,displayModeBar:true}});
  }
  function compactLegacyIntervals(root) {
    (root||document).querySelectorAll(".kpi-ci").forEach(node=>{
      const range=node.querySelector(".kpi-ci-range");
      if(range&&node.childNodes.length!==1)node.replaceChildren(range);
    });
    if(window.DM_FMT)DM_FMT.applyStatic(root||document);
  }
  function binaryCohortRiskEnabled(){
    return DATA.task==="binary"&&DATA.worst_case.dynamic_intersections&&window.DM_COHORT_RISK;
  }
  function cohortMetricLabel(metric){
    const labels={
      far:["FAR","FAR"],frr:["FRR","FRR"],accuracy:["Accuracy","Exactitud"],
      precision:["Precision","Precisión"],recall:["Recall","Recall"],f1:["F1","F1"],
      tar:["TAR","TAR"],error_rate:["Error rate","Tasa de error"],
    };
    if(labels[metric])return labels[metric][lang()==="es"?1:0];
    const definition=(DATA.metric_definitions||[]).find(item=>item.key===metric)||{};
    return lang()==="es"
      ?definition.label_es||definition.label||metric
      :definition.label||metric;
  }
  function cohortMetricPresentation(metric){
    const definition=(DATA.metric_definitions||[]).find(item=>item.key===metric)||{};
    return {
      ...definition,
      format:definition.format||"num",
      riskDirection:definition.direction==="higher"?"lower":"higher",
    };
  }
  function cohortDecisionThreshold(exp){
    const stored=state.cohortThresholds.get(exp.id);
    if(Number.isFinite(stored))return stored;
    const index=experiments.findIndex(item=>item.id===exp.id);
    const globalInput=document.querySelector("[data-global-threshold-input]");
    const owner=document.querySelector(
      '.model-operating-panel[data-experiment-id="'+CSS.escape(exp.id)+'"]'
    )||document.querySelector('.model-operating-panel[data-model-id="model-'+index+'"]')
      ||document.querySelector('[data-threshold-owner="model-'+index+'"]');
    const input=owner?.querySelector("[data-threshold-input]")||globalInput;
    const value=Number(String(input?.value??DATA.worst_case.decision_threshold??.5).replace(",","."));
    return Number.isFinite(value)?value:Number(DATA.worst_case.decision_threshold)||.5;
  }
  function updateCohortThreshold(modelId,value,applyToAll=false){
    const threshold=Number(String(value??"").replace(",","."));
    return DM_COHORT_RISK.updateThresholdRegistry(
      state.cohortThresholds,applyToAll?activeExperiments():experiments,modelId,threshold,applyToAll
    );
  }
  function thresholdControlValue(control){
    if(control.matches("[data-threshold-slider]")){
      const scope=control.closest("[data-threshold-owner],.model-operating-panel");
      return scope?.querySelector("[data-threshold-input]")?.value??control.value;
    }
    return control.value;
  }
  function cohortModelConfig(){
    return {
      positiveLabel:Number(DATA.worst_case.positive_label??1),
      negativeLabel:Number(DATA.worst_case.negative_label??0),
      positiveIfHigherScore:DATA.worst_case.positive_if_higher_score!==false,
    };
  }
  function filteredCohortRows(exp){
    const selected=selectedFilters(),variables=DATA.filter_variables||[];
    return (exp.cohort_rows||exp.rows||[]).filter(row=>variables.every(variable=>{
      const values=selected[variable]||new Set();
      const value=isMissing(row[variable])?"UNKNOWN":String(row[variable]);
      return values.size>0&&values.has(value);
    }));
  }
  function cohortFilterSignature(){
    const selected=selectedFilters();
    return (DATA.filter_variables||[]).map(variable=>
      variable+"="+Array.from(selected[variable]||[]).sort().join("|")
    ).join(";");
  }
  function cohortRiskAnalysis(exp,metric,overrides={}){
    const dimensions=Array.from(state.worstVariables);
    const maximum=Math.min(dimensions.length,Math.max(state.cohortMinOrder,state.cohortMaxOrder));
    const threshold=cohortDecisionThreshold(exp);
    const key=[
      exp.id,threshold,cohortFilterSignature(),dimensions.join("|"),state.cohortMinOrder,maximum,
      metric,state.cohortMinimumSupport,state.cohortMinimumErrors,state.cohortRemoveRedundant,
      state.cohortTolerance,
    ].join("::");
    if(cohortRiskCache.has(key))return cohortRiskCache.get(key);
    const analysis=DM_COHORT_RISK.analyzeCohortRisk({
      records:filteredCohortRows(exp),model:cohortModelConfig(),modelId:exp.id,modelName:exp.name,
      metric,decisionThreshold:threshold,dimensions,minOrder:state.cohortMinOrder,maxOrder:maximum,
      minimumEligibleSupport:state.cohortMinimumSupport,minimumErrorEvents:state.cohortMinimumErrors,
      searchMode:"worst",riskTarget:null,operator:">=",rankBy:"observed",
      removeRedundant:state.cohortRemoveRedundant,redundancyTolerance:state.cohortTolerance,
    });
    cohortRiskCache.set(key,analysis);
    if(cohortRiskCache.size>120)cohortRiskCache.delete(cohortRiskCache.keys().next().value);
    return analysis;
  }
  function cohortInterval(interval){
    return interval?.length===2?format(interval[0],"pct")+" - "+format(interval[1],"pct"):"—";
  }
  function cohortShort(result){
    return (result?.definition||[]).map(item=>String(item.value)).join(" · ");
  }
  function cohortFull(result){
    return (result?.definition||[]).map(item=>item.dimension+"="+item.value).join("\n");
  }
  function cohortResultKey(result){ return result.modelId+"::"+result.key; }
  function genericCohortRiskAnalysis(exp,spec,presentation){
    const dimensions=Array.from(state.worstVariables);
    const maximum=Math.min(dimensions.length,Math.max(state.cohortMinOrder,state.cohortMaxOrder));
    const rows=filteredCohortRows(exp);
    const cacheKey=["aggregate",exp.id,cohortFilterSignature(),dimensions.join("|"),state.cohortMinOrder,
      maximum,spec.key,state.cohortMinimumSupport,state.cohortRemoveRedundant,state.cohortTolerance].join("::");
    if(cohortRiskCache.has(cacheKey))return cohortRiskCache.get(cacheKey);
    const analysis=DM_COHORT_RISK.analyzeAggregatedCohortRisk({
      records:rows,spec,metricDirection:presentation.riskDirection,dimensions,
      minOrder:state.cohortMinOrder,maxOrder:maximum,minimumSupport:state.cohortMinimumSupport,
      removeRedundant:state.cohortRemoveRedundant,redundancyTolerance:state.cohortTolerance,
      rankBy:state.cohortRankBy,modelId:exp.id,modelName:exp.name,
    });
    cohortRiskCache.set(cacheKey,analysis);
    if(cohortRiskCache.size>120)cohortRiskCache.delete(cohortRiskCache.keys().next().value);
    return analysis;
  }
  function cohortMetricValueText(value,presentation){
    if(!Number.isFinite(value))return "N/A";
    return format(value,presentation.format)+(presentation.unit?" "+presentation.unit:"");
  }
  function cohortDifferenceFromGlobal(result){
    return Number.isFinite(result?.value)&&Number.isFinite(result?.overallValue)
      ?result.value-result.overallValue:null;
  }
  function cohortSignedDifferenceText(value,presentation){
    if(!Number.isFinite(value))return "N/A";
    const sign=value>0?"+":value<0?"−":"";
    if(presentation.format==="pct")return sign+format(Math.abs(value),"pct").replace("%"," pp");
    return sign+format(Math.abs(value),presentation.format)+(presentation.unit?" "+presentation.unit:"");
  }
  function cohortHistogramValues(result,spec,binary){
    return (result?.rows||[]).map(row=>{
      if(binary)return Number(row.score);
      if(spec?.kind==="f1"){
        const tp=Number(row._tp)||0,fp=Number(row._fp)||0,fn=Number(row._fn)||0;
        return 2*tp+fp+fn>0?2*tp/(2*tp+fp+fn):NaN;
      }
      const numerator=Number(row[spec?.numerator]),denominator=Number(row[spec?.denominator]);
      if(!(denominator>0)||!Number.isFinite(numerator))return NaN;
      const ratio=numerator/denominator;
      return spec?.kind==="rmse"?Math.sqrt(Math.max(0,ratio)):ratio;
    }).filter(Number.isFinite);
  }
  function cohortHistogram(result,spec,binary){
    const values=cohortHistogramValues(result,spec,binary);
    if(!values.length)return '<p class="dm-cohort-detail-empty">'+esc(tr("noPlotData"))+'</p>';
    let lower=Math.min(...values),upper=Math.max(...values);
    if(binary){lower=0;upper=1;}else if(lower===upper){lower-=.5;upper+=.5;}
    const count=Math.max(8,Math.min(20,Math.ceil(Math.sqrt(values.length))));
    const bins=Array(count).fill(0),span=upper-lower||1;
    values.forEach(value=>bins[Math.min(count-1,Math.max(0,Math.floor((value-lower)/span*count)))]+=1);
    const maximum=Math.max(...bins,1),width=340,height=92,gap=2,barWidth=(width-(count-1)*gap)/count;
    const bars=bins.map((value,index)=>{
      const barHeight=Math.max(value?2:0,(value/maximum)*(height-13));
      return '<rect x="'+(index*(barWidth+gap)).toFixed(2)+'" y="'+(height-barHeight).toFixed(2)+
        '" width="'+barWidth.toFixed(2)+'" height="'+barHeight.toFixed(2)+'" rx="1.5"></rect>';
    }).join("");
    return '<svg class="dm-cohort-detail-histogram" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="'+
      esc(tr("distribution"))+'">'+bars+'<line x1="0" y1="91" x2="340" y2="91"></line></svg>'+
      '<div class="dm-cohort-detail-range"><span>'+esc(format(lower,"num"))+'</span><span>'+esc(format(upper,"num"))+'</span></div>';
  }
  function cohortConfusionTable(result){
    const counts=result?.counts;if(!counts)return "";
    return '<section class="dm-cohort-detail-section"><h4>'+esc(tr("confusionMatrix"))+'</h4>'+
      '<div class="dm-cohort-detail-table-wrap"><table class="dm-cohort-detail-matrix"><thead><tr><th></th><th>'+esc(tr("predictedNegative"))+
      '</th><th>'+esc(tr("predictedPositive"))+'</th></tr></thead><tbody><tr><th>'+esc(tr("actualNegative"))+
      '</th><td>'+counts.tn.toLocaleString()+'</td><td>'+counts.fp.toLocaleString()+'</td></tr><tr><th>'+esc(tr("actualPositive"))+
      '</th><td>'+counts.fn.toLocaleString()+'</td><td>'+counts.tp.toLocaleString()+'</td></tr></tbody></table></div></section>';
  }
  function closeCohortDetail(restoreFocus=true){
    const key=state.cohortExpandedKey;
    state.cohortExpandedKey=null;
    cohortRiskMain?.closest(".dm-cohort-risk")?.classList.remove("is-detail-open");
    if(cohortDetailDrawer)cohortDetailDrawer.hidden=true;
    renderCohortRiskTable();
    if(restoreFocus&&key)requestAnimationFrame(()=>{
      worstBody?.querySelector('[data-cohort-result="'+CSS.escape(key)+'"] .dm-cohort-detail-toggle')?.focus();
    });
  }
  function renderCohortDetail(meta,focus=false){
    if(!cohortDetailDrawer||!meta){
      if(cohortDetailDrawer)cohortDetailDrawer.hidden=true;
      cohortRiskMain?.closest(".dm-cohort-risk")?.classList.remove("is-detail-open");
      return;
    }
    const {exp,result,spec,presentation,binary,populationLabel}=meta;
    const observed=cohortMetricValueText(result.value,presentation);
    const overall=cohortMetricValueText(result.overallValue,presentation);
    const difference=cohortSignedDifferenceText(cohortDifferenceFromGlobal(result),presentation);
    const events=Number(result.evidence?.events)||0,eligible=Number(result.evidence?.eligible)||0;
    const progress=Math.max(0,Math.min(100,Number.isFinite(result.value)&&presentation.format==="pct"?result.value*100:
      (eligible?events/eligible*100:0)));
    const dimensions=(result.definition||[]).map(item=>'<span><b>'+esc(item.dimension)+'</b> = '+esc(item.value)+'</span>').join("");
    const operating=binary
      ?'<section class="dm-cohort-detail-section"><h4>'+esc(tr("operatingPoint"))+'</h4><dl class="dm-cohort-detail-list">'+
        '<div><dt>'+esc(tr("thresholdShort"))+'</dt><dd>'+esc(format(cohortDecisionThreshold(exp),"threshold"))+'</dd></div>'+
        '<div><dt>'+esc(tr("metric"))+'</dt><dd>'+esc(cohortMetricLabel(spec.key))+'</dd></div></dl></section>'
      :'<section class="dm-cohort-detail-section"><h4>'+esc(tr("analysisContext"))+'</h4><dl class="dm-cohort-detail-list">'+
        '<div><dt>'+esc(tr("metric"))+'</dt><dd>'+esc(cohortMetricLabel(spec.key))+'</dd></div><div><dt>'+esc(tr("population"))+
        '</dt><dd>'+esc(populationLabel)+'</dd></div></dl></section>';
    cohortDetailDrawer.innerHTML='<header class="dm-cohort-detail-head"><div><h3>'+esc(tr("cohortDetail"))+'</h3><span>'+esc(exp.name)+
      '</span></div><button type="button" data-risk-detail-close aria-label="'+esc(tr("close"))+'">×</button></header>'+
      '<div class="dm-cohort-detail-body"><h4 class="dm-cohort-detail-name">'+esc(cohortShort(result))+'</h4>'+
      '<div class="dm-cohort-detail-definition">'+dimensions+'</div><section class="dm-cohort-detail-section"><h4>'+esc(tr("metric"))+
      '</h4><dl class="dm-cohort-detail-list"><div><dt>'+esc(tr("observedValue"))+'</dt><dd>'+esc(observed)+'</dd></div>'+
      '<div><dt>'+esc(tr("globalValue"))+'</dt><dd>'+esc(overall)+'</dd></div><div><dt>'+esc(tr("difference"))+'</dt><dd class="is-accent">'+
      esc(difference)+'</dd></div><div><dt>'+esc(tr("confidenceInterval"))+'</dt><dd>'+esc(cohortInterval(result.interval))+
      '</dd></div></dl></section><section class="dm-cohort-detail-section"><h4>'+esc(tr("data"))+'</h4><dl class="dm-cohort-detail-list">'+
      '<div><dt>'+esc(tr("eventCount"))+'</dt><dd>'+events.toLocaleString()+'</dd></div><div><dt>'+esc(tr("samples"))+'</dt><dd>'+
      eligible.toLocaleString()+'</dd></div></dl><div class="dm-cohort-detail-evidence"><strong>'+events.toLocaleString()+' / '+
      eligible.toLocaleString()+'</strong><span><i style="width:'+progress.toFixed(2)+'%"></i></span><b>'+esc(observed)+'</b></div></section>'+operating+
      '<section class="dm-cohort-detail-section"><h4>'+esc(tr("distribution"))+'</h4>'+cohortHistogram(result,spec,binary)+'</section>'+
      (binary?cohortConfusionTable(result):"")+'<button type="button" class="dm-cohort-view-samples" data-risk-view-samples="'+esc(exp.id)+'">'+
      esc(tr("viewCohortSamples"))+'<span aria-hidden="true">›</span></button></div>';
    cohortDetailDrawer.hidden=false;
    cohortRiskMain?.closest(".dm-cohort-risk")?.classList.add("is-detail-open");
    if(focus)requestAnimationFrame(()=>cohortDetailDrawer.querySelector("[data-risk-detail-close]")?.focus());
  }
  function renderCohortRiskTable(){
    const metrics=DATA.worst_case.available_metrics||[];
    const spec=metrics.find(item=>item.key===state.worstMetric)||metrics[0];
    if(!spec||!worstBody)return;
    const metric=spec.key,binary=binaryCohortRiskEnabled();
    if(worstMetricSelect){
      worstMetricSelect.replaceChildren(...metrics.map(item=>new Option(cohortMetricLabel(item.key),item.key)));
      worstMetricSelect.value=metric;
    }
    const presentation=binary
      ?{...cohortMetricPresentation(metric),format:"pct",
        riskDirection:DM_COHORT_RISK.metricDefinition(metric).direction}
      :cohortMetricPresentation(metric);
    const analyses=activeExperiments().map(exp=>({exp,analysis:binary
      ?cohortRiskAnalysis(exp,metric):genericCohortRiskAnalysis(exp,spec,presentation)}));
    worstBody.textContent="";cohortRiskEmpty.hidden=true;cohortResultsByKey.clear();
    worstBody.classList.toggle("is-single-model",analyses.length===1);
    analyses.forEach(({exp,analysis})=>{
      let ranked=DM_COHORT_RISK.rankCohorts(
        analysis.results,"worst",null,">=",state.cohortRankBy,presentation.riskDirection
      );
      const baseRanks=new Map(ranked.map((result,index)=>[cohortResultKey(result),index+1]));
      const sorters={rank:(a,b)=>baseRanks.get(cohortResultKey(a))-baseRanks.get(cohortResultKey(b)),
        cohort:(a,b)=>cohortShort(a).localeCompare(cohortShort(b)),observed:(a,b)=>a.value-b.value,
        gap:(a,b)=>cohortDifferenceFromGlobal(a)-cohortDifferenceFromGlobal(b),
        evidence:(a,b)=>a.evidence.eligible-b.evidence.eligible};
      if(sorters[state.cohortSortKey]){
        const direction=state.cohortSortDirection==="desc"?-1:1,sorter=sorters[state.cohortSortKey];
        ranked.sort((a,b)=>direction*sorter(a,b)||baseRanks.get(cohortResultKey(a))-baseRanks.get(cohortResultKey(b)));
      }
      const availableRows=ranked.slice(0,100),showAll=state.cohortShowAllModels.has(exp.id);
      const visibleRows=showAll?availableRows:availableRows.slice(0,6);
      const panel=document.createElement("article");
      panel.className="dm-cohort-model-table-panel is-"+metric+(binary?"":" is-aggregated");
      panel.dataset.cohortModel=exp.id;
      const populationLabel=tr(spec.population||"recordsCount");
      const populationSupport=analysis.overallEvidence?.eligible??analysis.filteredCount??0;
      const sampleSupport=filteredCohortRows(exp).length;
      availableRows.forEach(result=>cohortResultsByKey.set(cohortResultKey(result),{
        exp,analysis,result,spec,presentation,binary,populationLabel,
      }));
      const secondSummary=binary
        ?'<div><dt>'+esc(tr("thresholdShort"))+'</dt><dd>'+esc(format(cohortDecisionThreshold(exp),"threshold"))+'</dd></div>'
        :'<div><dt>'+esc(populationLabel)+'</dt><dd>'+Number(populationSupport).toLocaleString()+'</dd></div>';
      panel.innerHTML='<header><div><small>'+esc(tr("model"))+'</small><h3>'+esc(exp.name)+'</h3></div></header>'+
        '<dl class="dm-cohort-model-summary"><div><dt>'+esc(tr("metricGlobal",{metric:cohortMetricLabel(metric)}))+'</dt><dd>'+
        esc(cohortMetricValueText(analysis.overallValue,presentation))+'</dd></div>'+secondSummary+'<div><dt>'+esc(tr("cohorts"))+'</dt><dd>'+
        analysis.eligibleCount.toLocaleString()+'</dd></div><div><dt>'+esc(tr("sampleCount"))+'</dt><dd>'+sampleSupport.toLocaleString()+'</dd></div></dl>'+
        '<div class="dm-cohort-model-order"><span aria-hidden="true">⇅</span>'+esc(tr("sortedByObserved",{metric:cohortMetricLabel(metric)}))+'</div>';
      const wrap=document.createElement("div");wrap.className="dm-cohort-model-table-wrap";wrap.tabIndex=0;
      wrap.setAttribute("aria-label",exp.name+" · "+cohortMetricLabel(metric));
      const table=document.createElement("table");table.className="dm-cohort-model-table";
      const sortable=(key,label)=>'<th><button type="button" data-risk-sort="'+key+'">'+esc(label)+'</button></th>';
      const differenceHeader='<th><button type="button" data-risk-sort="gap">'+esc(tr("difference"))+
        '<small>'+esc(tr("vsOverall"))+'</small></button></th>';
      table.innerHTML='<thead><tr>'+sortable("rank",tr("rank"))+sortable("cohort",tr("cohort"))+
        sortable("observed",cohortMetricLabel(metric))+differenceHeader+
        sortable("evidence",tr("eventsSamples"))+'<th data-v2-text="details">'+esc(tr("details"))+'</th></tr></thead>';
      const body=document.createElement("tbody");
      if(!availableRows.length){
        const empty=document.createElement("tr");empty.className="dm-cohort-model-empty-row";
        empty.innerHTML='<td colspan="6">'+esc(tr("noEvidenceRequirements"))+'</td>';body.appendChild(empty);
      }
      visibleRows.forEach(result=>{
        const resultKey=cohortResultKey(result);
        const row=document.createElement("tr");row.className="dm-cohort-risk-result-row is-"+metric+(binary?"":" is-aggregated");
        row.tabIndex=0;row.dataset.cohortResult=resultKey;row.title=cohortFull(result);
        row.setAttribute("aria-selected",String(state.cohortExpandedKey===resultKey));
        const evidence=binary
          ?result.evidence.events.toLocaleString()+" / "+result.evidence.eligible.toLocaleString()
          :"n = "+result.evidence.eligible.toLocaleString();
        row.innerHTML='<td><strong>#'+baseRanks.get(resultKey)+'</strong></td><th scope="row"><span class="dm-cohort-risk-short">'+
          esc(cohortShort(result))+'</span></th><td data-risk-metric-value><strong>'+esc(cohortMetricValueText(result.value,presentation))+
          '</strong></td><td class="dm-cohort-table-difference">'+esc(cohortSignedDifferenceText(cohortDifferenceFromGlobal(result),presentation))+'</td>'+
          '<td class="dm-cohort-table-evidence"><strong>'+evidence+'</strong></td><td><button type="button" class="dm-cohort-detail-toggle" aria-expanded="'+
          (state.cohortExpandedKey===resultKey)+'" aria-controls="dm-cohort-detail-drawer" aria-label="'+esc(tr("openCohortDetail"))+'">›</button></td>';
        body.appendChild(row);
      });
      table.appendChild(body);wrap.appendChild(table);panel.appendChild(wrap);
      if(availableRows.length>6){
        const more=document.createElement("button");more.type="button";more.className="dm-cohort-risk-more-results";
        more.dataset.riskMoreModel=exp.id;more.setAttribute("aria-expanded",String(showAll));
        more.innerHTML='<span>'+esc(tr(showAll?"showFewerResults":"viewMoreResults"))+'</span><b aria-hidden="true">›</b>';
        panel.appendChild(more);
      }
      worstBody.appendChild(panel);
    });
    worstBody.querySelectorAll("[data-risk-sort]").forEach(button=>{
      const active=button.dataset.riskSort===state.cohortSortKey;
      button.closest("th").setAttribute("aria-sort",active?(state.cohortSortDirection==="desc"?"descending":"ascending"):"none");
    });
    const detailMeta=cohortResultsByKey.get(state.cohortExpandedKey);
    if(state.cohortExpandedKey&&!detailMeta)state.cohortExpandedKey=null;
    renderCohortDetail(detailMeta,false);
  }
  function renderCohortRisk(){ if(worstBody)renderCohortRiskTable(); }
  function scheduleCohortRisk(delay=0){
    window.clearTimeout(cohortRiskTimer);const generation=++cohortRiskGeneration;
    cohortRiskTimer=window.setTimeout(()=>{
      if(generation!==cohortRiskGeneration)return;renderCohortRisk();
    },delay);
  }
  function renderWorst(){
    if(!DATA.worst_case.enabled)return;
    scheduleCohortRisk(0);
  }
  function buildCompactCohortRisk(){
    const binary=binaryCohortRiskEnabled();
    const section=document.createElement("section");section.className="dm-v2-worst dm-cohort-risk";
    section.dataset.v2CohortRisk=binary?"dynamic":"aggregated";
    const head=document.createElement("header");head.className="dm-v2-worst-head dm-cohort-risk-head";
    head.innerHTML='<span class="dm-v2-worst-icon">'+icon("cohort")+'</span><div class="dm-cohort-risk-heading">'+
      '<div class="dm-cohort-risk-title"><h2 data-v2-text="worst">'+esc(tr("worst"))+'</h2>'+icon("info")+
      '</div><p data-v2-text="cohortRiskHelp">'+esc(tr("cohortRiskHelp"))+'</p></div>'+
      '<div class="dm-cohort-risk-head-actions dm-cohort-risk-controls"><label><span data-v2-text="metric">'+esc(tr("metric"))+
      '</span><select data-risk-control="metric"></select></label><button type="button" class="dm-cohort-more" '+
      'data-risk-popover-trigger aria-haspopup="dialog" aria-expanded="false" aria-controls="dm-cohort-risk-options" '+
      'data-v2-aria-label="advancedOptions" aria-label="'+esc(tr("advancedOptions"))+'">'+icon("settings")+'</button></div>';

    const advanced=document.createElement("div");advanced.className="dm-cohort-risk-popover";
    advanced.id="dm-cohort-risk-options";advanced.hidden=true;advanced.setAttribute("role","dialog");
    advanced.dataset.v2AriaLabel="advancedOptions";advanced.setAttribute("aria-label",tr("advancedOptions"));
    const binaryEvidenceControls=binary?'<label><span data-v2-text="minimumErrorEvents">'+
      esc(tr("minimumErrorEvents"))+'</span><input data-risk-control="errors" type="number" min="0" step="1" value="'+
      state.cohortMinimumErrors+'"></label>':'';
    const binaryConfidenceControl=binary?'<label><span data-v2-text="confidenceSettings">'+
      esc(tr("confidenceSettings"))+'</span><select disabled><option>'+esc(tr("wilson95"))+'</option></select></label>':'';
    const toleranceValue=binary?state.cohortTolerance*100:state.cohortTolerance;
    const toleranceUnit=binary?'<b>pp</b>':'';
    advanced.innerHTML='<header><strong data-v2-text="advancedOptions">'+esc(tr("advancedOptions"))+
      '</strong><button type="button" data-risk-popover-close data-v2-aria-label="close" aria-label="'+esc(tr("close"))+'">×</button></header>'+
      '<fieldset class="dm-cohort-risk-dimensions"><legend data-v2-text="cohortDimensions">'+
      esc(tr("cohortDimensions"))+'</legend><div data-risk-dimensions></div></fieldset>'+
      '<div class="dm-cohort-risk-control-grid is-evidence"><label><span data-v2-text="minimumSupport">'+
      esc(tr("minimumSupport"))+'</span><input data-risk-control="support" type="number" min="1" step="1" value="'+
      state.cohortMinimumSupport+'"></label>'+binaryEvidenceControls+'<label><span data-v2-text="minimumOrder">'+esc(tr("minimumOrder"))+
      '</span><input data-risk-control="min-order" type="number" min="1" max="5" step="1" value="'+
      state.cohortMinOrder+'"></label><label><span data-v2-text="maximumOrder">'+esc(tr("maximumOrder"))+
      '</span><input data-risk-control="max-order" type="number" min="1" max="5" step="1" value="'+
      state.cohortMaxOrder+'"></label><label><span data-v2-text="rankBy">'+esc(tr("rankBy"))+
      '</span><select data-risk-control="rank-by"><option value="adverse_difference">'+
      esc(tr("adverseDifference"))+'</option><option value="observed">'+esc(tr("observed"))+
      '</option></select></label><label><span data-v2-text="redundancyTolerance">'+esc(tr("redundancyTolerance"))+
      '</span><span class="dm-cohort-input-unit"><input data-risk-control="tolerance" type="number" min="0" max="100" step="0.01" value="'+
      toleranceValue+'">'+toleranceUnit+'</span></label>'+binaryConfidenceControl+
      '</div><div class="dm-cohort-risk-switches"><label><input type="checkbox" checked disabled>'+
      '<span data-v2-text="observedOnly">'+esc(tr("observedOnly"))+'</span></label>'+
      '<label><input data-risk-control="redundant" type="checkbox" checked><span data-v2-text="removeRedundant">'+
      esc(tr("removeRedundant"))+'</span></label></div>';
    const dimensions=advanced.querySelector("[data-risk-dimensions]");
    cohortDimensions.slice(0,5).forEach(variable=>{
      const label=document.createElement("label");label.innerHTML='<input type="checkbox" value="'+esc(variable)+
        '" checked><span>'+esc(variable)+"</span>";dimensions.appendChild(label);
    });
    worstDimensions=dimensions;

    const controls=head.querySelector(".dm-cohort-risk-head-actions");
    const tableArea=document.createElement("div");tableArea.className="dm-cohort-risk-table-area";
    worstMetricSelect=controls.querySelector('[data-risk-control="metric"]');
    (DATA.worst_case.available_metrics||[]).forEach(item=>worstMetricSelect.appendChild(
      new Option(cohortMetricLabel(item.key),item.key)
    ));
    worstMetricSelect.value=state.worstMetric||"far";
    advanced.querySelector('[data-risk-control="rank-by"]').value=state.cohortRankBy;

    cohortRiskEmpty=document.createElement("p");cohortRiskEmpty.className="dm-cohort-risk-empty";
    cohortRiskEmpty.hidden=true;cohortRiskEmpty.setAttribute("role","status");
    worstBody=document.createElement("div");worstBody.className="dm-cohort-model-tables";worstBody.dataset.comparison="per_model";
    tableArea.append(cohortRiskEmpty,worstBody);

    const placePopover=trigger=>{
      const rect=trigger.getBoundingClientRect(),width=Math.min(420,window.innerWidth-24);
      advanced.style.width=width+"px";
      advanced.style.left=Math.max(12,Math.min(window.innerWidth-width-12,rect.right-width))+"px";
      advanced.style.top=Math.min(window.innerHeight-120,rect.bottom+8)+"px";
    };
    const togglePopover=(trigger,force)=>{
      const open=force??advanced.hidden;
      advanced.hidden=!open;
      section.querySelectorAll("[data-risk-popover-trigger]").forEach(button=>button.setAttribute("aria-expanded",String(open)));
      if(open){placePopover(trigger);advanced.querySelector("input,select,button")?.focus();}
    };
    section.addEventListener("click",event=>{
      const trigger=event.target.closest("[data-risk-popover-trigger]");
      if(trigger){event.preventDefault();togglePopover(trigger);return;}
      if(event.target.closest("[data-risk-popover-close]"))togglePopover(event.target,false);
    });
    document.addEventListener("pointerdown",event=>{
      if(advanced.hidden||advanced.contains(event.target)||event.target.closest?.("[data-risk-popover-trigger]"))return;
      togglePopover(event.target,false);
    });
    document.addEventListener("keydown",event=>{if(event.key==="Escape"&&!advanced.hidden)togglePopover(event.target,false);});
    const updateRiskState=(control,value)=>{
      let engineChanged=false;
      if(control==="metric"){
        state.worstMetric=value;engineChanged=true;
        const direction=binary?DM_COHORT_RISK.metricDefinition(value).direction:
          cohortMetricPresentation(value).riskDirection;
        state.cohortOperator=direction==="lower"?"<=":">=";
        state.cohortSortKey="rank";state.cohortSortDirection="asc";
      }else if(control==="rank-by"){
        state.cohortRankBy=value;state.cohortSortKey=value==="observed"?"observed":"gap";
        state.cohortSortDirection="desc";
      }else if(control==="min-order"){
        state.cohortMinOrder=Math.max(1,Math.min(state.cohortMaxOrder,Number(value)||1));engineChanged=true;
      }else if(control==="max-order"){
        state.cohortMaxOrder=Math.max(state.cohortMinOrder,Math.min(state.worstVariables.size,Number(value)||1));engineChanged=true;
      }else if(control==="support"){
        state.cohortMinimumSupport=Math.max(1,Math.round(Number(value)||1));engineChanged=true;
      }else if(control==="errors"){
        state.cohortMinimumErrors=Math.max(0,Math.round(Number(value)||0));engineChanged=true;
      }else if(control==="tolerance"){
        state.cohortTolerance=Math.max(0,Number(value)||0)/(binary?100:1);engineChanged=true;
      }else if(control==="redundant"){
        state.cohortRemoveRedundant=Boolean(value);engineChanged=true;
      }
      state.cohortExpandedKey=null;state.cohortShowAllModels.clear();
      if(engineChanged)cohortRiskCache.clear();
      scheduleCohortRisk(engineChanged?90:0);
    };
    section.addEventListener("change",event=>{
      const target=event.target;
      if(target.closest("[data-risk-dimensions]")){
        const selected=Array.from(dimensions.querySelectorAll("input:checked"));
        if(!selected.length){target.checked=true;return;}
        state.worstVariables=new Set(selected.map(input=>input.value));
        state.cohortMaxOrder=Math.min(state.cohortMaxOrder,state.worstVariables.size);
        state.cohortMinOrder=Math.min(state.cohortMinOrder,state.cohortMaxOrder);
        advanced.querySelector('[data-risk-control="min-order"]').value=state.cohortMinOrder;
        advanced.querySelector('[data-risk-control="max-order"]').value=state.cohortMaxOrder;
        state.cohortExpandedKey=null;state.cohortShowAllModels.clear();
        cohortRiskCache.clear();scheduleCohortRisk(90);return;
      }
      const key=target.dataset.riskControl;if(!key)return;
      updateRiskState(key,target.type==="checkbox"?target.checked:target.value);
    });
    section.addEventListener("input",event=>{
      const key=event.target.dataset.riskControl;
      if(!key||!["min-order","max-order","support","errors","tolerance"].includes(key))return;
      updateRiskState(key,event.target.value);
    });
    const toggleResult=target=>{
      const row=target.closest(".dm-cohort-risk-result-row");if(!row)return;
      const opening=state.cohortExpandedKey!==row.dataset.cohortResult;
      state.cohortExpandedKey=opening?row.dataset.cohortResult:null;
      renderCohortRiskTable();
      if(opening)renderCohortDetail(cohortResultsByKey.get(state.cohortExpandedKey),true);
    };
    worstBody.addEventListener("click",event=>{
      const sort=event.target.closest("[data-risk-sort]");
      if(sort){
        const key=sort.dataset.riskSort;
        if(state.cohortSortKey===key)state.cohortSortDirection=state.cohortSortDirection==="asc"?"desc":"asc";
        else{state.cohortSortKey=key;state.cohortSortDirection=["cohort","rank"].includes(key)?"asc":"desc";}
        state.cohortExpandedKey=null;renderCohortRiskTable();return;
      }
      const more=event.target.closest("[data-risk-more-model]");
      if(more){
        const modelId=more.dataset.riskMoreModel;
        if(state.cohortShowAllModels.has(modelId))state.cohortShowAllModels.delete(modelId);
        else state.cohortShowAllModels.add(modelId);
        state.cohortExpandedKey=null;renderCohortRiskTable();return;
      }
      toggleResult(event.target);
    });
    worstBody.addEventListener("keydown",event=>{
      if((event.key==="Enter"||event.key===" ")&&event.target.closest(".dm-cohort-risk-result-row")){
        event.preventDefault();toggleResult(event.target);
      }
    });
    section.addEventListener("click",event=>{
      if(event.target===section&&state.cohortExpandedKey){closeCohortDetail();return;}
      if(event.target.closest("[data-risk-detail-close]")){closeCohortDetail();return;}
      const samples=event.target.closest("[data-risk-view-samples]");if(!samples)return;
      const detail=cohortResultsByKey.get(state.cohortExpandedKey);
      if(sampleExplorer){sampleExplorer.openCohort(samples.dataset.riskViewSamples,detail?.result.definition);closeCohortDetail(false);switchView("table");return;}
      state.tableModel=samples.dataset.riskViewSamples;state.page=0;
      state.search=(detail?.result.definition||[]).map(item=>String(item.value).toLowerCase()).join(" ");
      closeCohortDetail(false);renderTable();switchView("table");
    });
    document.addEventListener("keydown",event=>{
      if(event.key==="Escape"&&state.cohortExpandedKey)closeCohortDetail();
    });
    if(binary){
      document.addEventListener("input",event=>{
        if(!event.target.matches(
          "[data-threshold-input],[data-threshold-slider],[data-global-threshold-input],[data-global-threshold-slider]"
        ))return;
        const globalControl=event.target.matches("[data-global-threshold-input],[data-global-threshold-slider]");
        const owner=event.target.closest("[data-threshold-owner],.model-operating-panel[data-model-id]");
        const modelId=owner?.dataset.thresholdOwner||owner?.dataset.modelId;
        updateCohortThreshold(modelId,thresholdControlValue(event.target),globalControl);
        cohortRiskCache.clear();scheduleCohortRisk(220);
      });
      document.addEventListener("dm:thresholdchange",event=>{
        updateCohortThreshold(event.detail?.modelId,event.detail?.threshold);
        cohortRiskCache.clear();scheduleCohortRisk(220);
      });
    }

    cohortRiskMain=document.createElement("div");cohortRiskMain.className="dm-cohort-risk-main";
    cohortRiskMain.append(head,tableArea);
    cohortDetailDrawer=document.createElement("aside");cohortDetailDrawer.className="dm-cohort-detail-drawer";
    cohortDetailDrawer.id="dm-cohort-detail-drawer";cohortDetailDrawer.hidden=true;
    cohortDetailDrawer.setAttribute("role","dialog");cohortDetailDrawer.setAttribute("aria-modal","false");
    cohortDetailDrawer.setAttribute("aria-label",tr("cohortDetail"));
    section.append(cohortRiskMain,cohortDetailDrawer,advanced);return section;
  }
  function buildWorst() {
    return buildCompactCohortRisk();
  }
  function experimentForLegacyId(value) {
    const match=String(value||"").match(/(\d+)$/);
    return match?experiments[Number(match[1])]:null;
  }
  function qualifyPlotLandmarks(root=document) {
    root.querySelectorAll?.(".plot-target[role='region'][aria-label],.js-plotly-plot[role='region'][aria-label]").forEach(plot=>{
      const containerOwner=plot.closest("[data-experiment-id]")?.dataset.experimentId;
      const owner=experiments.find(exp=>exp.id===containerOwner);
      if(!owner)return;
      const base=plot.dataset.dmBaseAria||plot.getAttribute("aria-label");
      plot.dataset.dmBaseAria=base;
      const qualified=base+" · "+owner.name;
      if(plot.getAttribute("aria-label")!==qualified)plot.setAttribute("aria-label",qualified);
    });
    scheduleEditorialPolish(root);
  }
  function applyModelVisibility() {
    const active=activeIds();
    document.querySelectorAll('.ocr-model-workspace,.eye-tracking-document,#case-gallery,#seg-case-gallery').forEach(node=>node.dataset.comparison="detail");
    document.querySelectorAll('.model-matrix-wrap').forEach(node=>{node.dataset.comparison="table";node.tabIndex=0;});
    shell?.querySelectorAll('[data-comparison-count] strong').forEach(node=>node.textContent=String(active.length));
    const eyeModelSelect=document.getElementById("eye-model-select");
    if(eyeModelSelect){
      const primaryIndex=Math.max(0,experiments.findIndex(exp=>exp.id===state.primary));
      if(eyeModelSelect.selectedIndex!==primaryIndex){
        eyeModelSelect.selectedIndex=primaryIndex;
        eyeModelSelect.dispatchEvent(new Event("change",{bubbles:true}));
      }
    }
    document.querySelectorAll("[data-experiment-id]").forEach(node=>{
      const visible=active.includes(node.dataset.experimentId);
      node.hidden=!visible;
      if(visible)node.removeAttribute("aria-hidden");
      else node.setAttribute("aria-hidden","true");
    });
    document.querySelectorAll("[data-model-id]").forEach(node=>{
      const exp=experimentForLegacyId(node.dataset.modelId),visible=!!exp&&active.includes(exp.id);
      node.hidden=!visible;
      if(visible)node.removeAttribute("aria-hidden");
      else node.setAttribute("aria-hidden","true");
    });
    document.querySelectorAll("[data-threshold-owner]").forEach(node=>{
      const exp=experimentForLegacyId(node.dataset.thresholdOwner);
      if(exp)node.hidden=!active.includes(exp.id);
    });
    document.querySelectorAll("[data-model-tab]").forEach(node=>{
      const exp=experimentForLegacyId(node.dataset.modelTab);
      if(exp)node.hidden=!active.includes(exp.id);
    });
    document.querySelectorAll("[data-model-index]").forEach(node=>{
      if(node.closest("table"))return;
      const exp=experiments[Number(node.dataset.modelIndex)];
      if(exp)node.hidden=!active.includes(exp.id);
    });
    document.querySelectorAll(".model-metrics-table,.dm-comparison-table,.dm-operating-table").forEach(table=>{
      window.DM_COMPARISON.tableSlots(table,experiments,manager.getSlots());
    });
    document.querySelectorAll(".dm-binary-matrix-grid").forEach(grid=>window.DM_COMPARISON.matrixSlots(grid,experiments,manager.getSlots()));
    document.querySelectorAll(".dm-binary-threshold-row [data-threshold-cell]").forEach(cell=>{
      const card=document.querySelector('.threshold-card[data-threshold-owner="'+cell.dataset.thresholdCell+'"]');
      if(card&&card.parentElement!==cell)cell.append(card);
    });
    document.querySelectorAll(".model-operating-grid").forEach(grid=>{grid.dataset.comparison="per_model";});
    document.querySelectorAll('[data-comparison="per_model"]').forEach(grid=>{
      const children=Array.from(grid.children),owner=node=>node.dataset.experimentId||experimentForLegacyId(node.dataset.thresholdOwner||node.dataset.modelId)?.id;
      if(!children.every(node=>owner(node)))return;
      const position=node=>{const index=active.indexOf(owner(node));return index<0?active.length:index;};
      const ordered=children.slice().sort((a,b)=>position(a)-position(b));
      if(ordered.some((node,index)=>node!==children[index]))ordered.forEach(node=>grid.append(node));
    });
    document.querySelectorAll(".js-plotly-plot").forEach(plot=>{
      if(plot.dataset.comparison==="managed")return;
      const containerOwner=plot.closest("[data-experiment-id]")?.dataset.experimentId;
      if(!plot.data)return;
      const visibility=plot.data.map(trace=>{
        const explicitMany=trace.meta?.experiment_ids||trace.meta?.experimentIds;
        if(Array.isArray(explicitMany)&&explicitMany.length){
          return explicitMany.every(id=>active.includes(String(id)));
        }
        const explicit=trace.meta?.experiment_id||trace.meta?.experimentId||trace.experiment_id;
        if(explicit)return active.includes(String(explicit));
        if(containerOwner)return active.includes(containerOwner);
        return true;
      });
      try{Plotly.restyle(plot,{visible:visibility});}catch(_error){/* task plot may be rebuilding */}
    });
    document.dispatchEvent(new CustomEvent("dm:modelschange",{
      detail:{...manager.getState(),experiments:activeExperiments()},
    }));
    qualifyPlotLandmarks();
    schedulePlotlyReflow();
  }
  function labelAggregates() {
    if(typeof Plotly==="undefined")return;
    document.querySelectorAll(".js-plotly-plot").forEach(plot=>{
      if(plot.dataset.comparison==="managed")return;
      if(!plot.data)return;plot.data.forEach((trace,index)=>{
        const size=(trace.y||trace.x||[]).length;
        if(size>40||!(trace.type==="bar"||(trace.type==="scatter"&&String(trace.mode||"").includes("markers"))))return;
        if(trace.type==="scatter"&&size>20)return;
        const values=trace.y||trace.x;
        try{Plotly.restyle(plot,{text:[values.map(value=>Number.isFinite(Number(value))?format(Number(value),"num"):"")],textposition:"top center"},[index]);}catch(_error){/* no-op */}
      });
    });
  }
  function renderAggregateComparison() {
    if(!views.evaluation || !["ocr","eye_evaluation","segmentation","object_detection"].includes(DATA.task))return;
    let section=views.evaluation.querySelector(".dm-comparison-overview");
    if(!section){
      section=document.createElement("section");section.className="dm-comparison-overview";section.dataset.comparison="table";
      views.evaluation.insertBefore(section,views.evaluation.firstElementChild?.nextSibling||null);
    }
    section.hidden=false;
    const preferred={ocr:["cer","word_recall","document_exact_match_rate"],eye_evaluation:["mean_angular_error","median_angular_error","p95_angular_error","mean_error_2d","missing_rate"],segmentation:["macro_dice","mean_iou","pixel_accuracy","mean_boundary_f1","mean_hd95"],object_detection:["map_50","map_50_95","precision","recall","f1"]}[DATA.task];
    if(DATA.panel_mode==='tracking')preferred.push('tracking_valid_rate','tracking_sampling_rate_hz','tracking_longest_gap_seconds');
    const definitions=DATA.metric_definitions||[];
    const models=experiments;
    const live=new Map(models.map(exp=>[exp.id,window.DM_TASK_METRICS?.(exp.id)]));
    section.innerHTML='<div class="dm-comparison-table-wrap" tabindex="0" role="region" aria-label="'+esc(tr("aggregateComparison"))+'"><table class="dm-comparison-table"><thead><tr><th scope="col">'+esc(tr("metric"))+'</th>'+models.map((exp,index)=>'<th scope="col" data-model-index="'+index+'">'+esc(exp.name)+'</th>').join('')+'</tr></thead><tbody>'+preferred.map(key=>{
      // These live task metrics already exist in the scientific engines, but
      // are not all included in the optional methodology registry projection.
      const extraLabels={precision:'panel.object_detection.dynamic.precision',recall:'panel.object_detection.dynamic.recall',median_angular_error:'eye.term.cap_median_angular_error'};
      const label=extraLabels[key]?window.DM_I18N.t(extraLabels[key]):null;
      const def=definitions.find(item=>item.key===key)||(label?{label,label_es:label,direction:key==='median_angular_error'?'lower':'higher',format:key==='median_angular_error'?'num':'pct'}:null);if(!def)return '';
      return '<tr><th scope="row">'+esc(lang()==="es"?def.label_es:def.label)+'</th>'+models.map((exp,index)=>{
        const metric=(exp.metrics||[]).find(item=>item.key===key);
        const values=live.get(exp.id);const value=values&&Object.hasOwn(values,key)?values[key]:metric?.value;
        return '<td data-model-index="'+index+'"><strong data-compare-metric="'+esc(key)+'" data-compare-raw="'+esc(value??'')+'" data-better="'+esc(def.direction||'neutral')+'">'+esc(format(value,def.format))+'</strong></td>';
      }).join('')+'</tr>';
    }).join('')+'</tbody></table></div>';
    window.DM_COMPARISON.tableSlots(section.querySelector('table'),experiments,manager.getSlots());
    let caption=views.evaluation.querySelector(".dm-comparison-detail-caption");
    if(!caption){caption=document.createElement("p");caption.className="dm-comparison-detail-caption";section.after(caption);}
    caption.textContent=tr("detailScope",{model:experiment(manager.getDetailId()).name});caption.hidden=section.hidden;
  }
  function refreshAll(){
    const focused=document.activeElement?.dataset.comparisonFocus;
    applyModelVisibility();renderTable();renderStatistics();renderWorst();renderAggregateComparison();renderModelSelectors();
    if(focused)document.querySelector('[data-comparison-focus="'+CSS.escape(focused)+'"]')?.focus({preventScroll:true});
    window.DM_COMPARISON.presentation(shell,manager);setTimeout(labelAggregates,50);schedulePlotlyReflow();comparisonReflow();
  }
  function download(name,content,type){const blob=new Blob([content],{type:type||"text/plain;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500);}
  function openImage(src){
    const modal=document.querySelector(".dm-v2-image-modal"),image=modal.querySelector("img");
    modal.querySelector("[data-image-unavailable]")?.remove();image.hidden=false;
    image.onerror=()=>{image.hidden=true;const message=document.createElement("p");message.dataset.imageUnavailable="1";message.textContent=window.DM_I18N.t("sampleExplorer.noImage");modal.append(message);};
    const reference=window.DM_PATH_IMAGES.imageSource(src);
    if(reference)image.src=reference;else image.onerror();modal.hidden=false;
  }
  function buildModal(){const modal=document.createElement("div");modal.className="dm-v2-image-modal";modal.hidden=true;modal.innerHTML='<button type="button" data-v2-aria-label="close" aria-label="'+esc(tr("close"))+'">×</button><img data-v2-alt="casePreview" alt="'+esc(tr("casePreview"))+'">';modal.querySelector("button").addEventListener("click",()=>modal.hidden=true);modal.addEventListener("click",event=>{if(event.target===modal)modal.hidden=true;});document.body.appendChild(modal);}
  function composeEyeTrackingWorkspace(studio) {
    const trackingPane=studio.querySelector("#eye-tracking-pane");
    const sceneSource=studio.querySelector('[data-eye-modality-pane="b"]');
    const sceneContent=sceneSource?.querySelector(".eye-context-content");
    if(!trackingPane||!sceneContent||trackingPane.querySelector(".eye-tracking-document"))return;

    const appText=key=>window.DM_I18N?.t?.("eye_app."+key)||key;
    const appNode=(tag,key)=>'<'+tag+' data-eye-app-text="'+esc(key)+'">'+esc(appText(key))+'</'+tag+'>';
    const plotCard=(kickerKey,titleKey,id,extraClass="")=>{
      const card=document.createElement("article");
      card.className=("eye-chart-card "+extraClass).trim();
      card.innerHTML='<header><div>'+appNode("span",kickerKey)+appNode("h3",titleKey)+
        '</div><button type="button" class="eye-evidence-capture" data-eye-app-label="saveEvidence" aria-label="'+esc(appText("saveEvidence"))+'">+</button></header>'+
        '<div id="'+esc(id)+'" class="plot-target"></div>';
      return card;
    };
    const section=(id,index,titleKey,copyKey,key)=>{
      const node=document.createElement("section");
      node.id=id;
      node.className="dash-section eye-reference-section";
      node.dataset.v2Section=key;
      node.dataset.v2SectionI18n="panel.eye_tracking.section."+key;
      node.innerHTML='<header class="eye-reference-heading"><span aria-hidden="true">'+index+
        '</span><div>'+appNode("h2",titleKey)+(copyKey?appNode("p",copyKey):'')+'</div></header>';
      return node;
    };
    const trackingSections=Array.from(trackingPane.children).filter(node=>
      node.matches?.("section.dash-section")
    );
    studio.querySelector(".eye-control-dock")?.classList.add("eye-control-source");
    const overview=trackingSections.find(node=>node.classList.contains("eye-tracking-overview"));
    const ocular=trackingSections.find(node=>node.classList.contains("eye-viewer-section"));
    const temporal=trackingSections.find(node=>node.querySelector('[data-eye-i18n="section.timeline"]'));
    const spatial=trackingPane.querySelector(".eye-retired-spatial-source");
    const eventAudit=trackingSections.find(node=>node.querySelector('[data-eye-i18n="section.events"]'));
    const sceneSections=Array.from(sceneContent.children).filter(node=>node.matches?.("section.dash-section"));
    const sceneOverview=sceneSections.find(node=>node.classList.contains("eye-scene-overview"));
    const sceneReplay=sceneSections.find(node=>node.classList.contains("eye-scene-replay-section"));
    const interaction=sceneContent.querySelector(".eye-retired-interaction-source");
    if(!overview||!ocular||!temporal||!spatial||!eventAudit||!sceneReplay||!interaction)return;

    const toolbar=overview.querySelector(".eye-tracking-toolbar");
    const context=overview.querySelector("#eye-recording-context");
    const summary=overview.querySelector("#eye-tracking-summary");
    const sceneControls=sceneOverview?.querySelector(".eye-scene-control-ribbon");
    const sceneSummary=sceneOverview?.querySelector("#eye-scene-summary");
    const sceneHead=sceneReplay.querySelector(".eye-replay-head");
    const sceneStage=sceneReplay.querySelector("#eye-scene-stage");
    const sceneTransport=sceneReplay.querySelector(".eye-scene-transport");
    const eyeStage=ocular.querySelector("#eye-visual-stage");
    const eyeTransport=ocular.querySelector(".eye-transport");
    const frameInspector=ocular.querySelector("#eye-frame-inspector");
    const leftCamera=ocular.querySelector('[data-eye-camera="left"]');
    const rightCamera=ocular.querySelector('[data-eye-camera="right"]');
    const directionDock=ocular.querySelector("#eye-direction-dock");
    const timelineTarget=temporal.querySelector("#eye-chart-timeline");
    const stabilityTarget=temporal.querySelector("#eye-chart-stability");
    const timelineSummary=temporal.querySelector("#eye-timeline-summary");
    const eventActions=eventAudit.querySelector(".eye-table-actions");
    const eventTable=eventAudit.querySelector("#eye-events-table");
    if(!summary||!sceneStage||!sceneTransport||!frameInspector||!leftCamera||!rightCamera||
      !directionDock||!timelineTarget||!stabilityTarget||!eventTable)return;

    const summarySection=section(
      "eye-tracking-summary-section","1","section1","section1Help","summary"
    );
    summarySection.classList.add("eye-reference-summary");
    if(context)summarySection.appendChild(context);
    summarySection.appendChild(summary);

    const replaySection=section(
      "eye-synchronized-replay","2","section2","section2Help","replay"
    );
    replaySection.classList.add("eye-reference-replay");
    const replayOptions=document.createElement("details");
    replayOptions.className="eye-reference-options";
    replayOptions.innerHTML=appNode("summary","replayOptions");
    const replayOptionBody=document.createElement("div");
    replayOptionBody.className="eye-reference-options-body";
    if(toolbar)replayOptionBody.appendChild(toolbar);
    if(sceneControls)replayOptionBody.appendChild(sceneControls);
    replayOptions.appendChild(replayOptionBody);
    replaySection.appendChild(replayOptions);
    const replayGrid=document.createElement("div");
    replayGrid.className="eye-reference-replay-grid";
    const sceneCard=document.createElement("article");
    sceneCard.className="eye-reference-media-card eye-reference-scene-card";
    if(sceneHead)sceneCard.appendChild(sceneHead);
    sceneCard.appendChild(sceneStage);
    const eyeStack=document.createElement("div");
    eyeStack.className="eye-reference-eye-stack";
    leftCamera.classList.add("eye-reference-eye-camera");
    rightCamera.classList.add("eye-reference-eye-camera");
    eyeStack.append(leftCamera,rightCamera);
    replayGrid.append(sceneCard,eyeStack);
    replaySection.append(replayGrid);
    sceneTransport.classList.add("eye-scene-transport-full","eye-reference-transport");
    replaySection.appendChild(sceneTransport);
    const timelineCard=document.createElement("article");
    timelineCard.className="eye-chart-card eye-reference-timeline-card";
    timelineCard.innerHTML='<header><div>'+appNode("span","synchronizedEvidence")+appNode("h3","recordingTimeline")+'</div><output id="eye-mini-time">0.000 s</output></header>';
    timelineCard.appendChild(timelineTarget);
    replaySection.append(timelineCard,frameInspector);

    const inspectorSection=section(
      "eye-frame-analysis","3","section3","section3Help","frame"
    );
    inspectorSection.classList.add("eye-reference-frame");
    const frameGrid=document.createElement("div");
    frameGrid.className="eye-reference-frame-grid";
    const orientationCard=plotCard("orientation","yawPitchComparison","eye-frame-orientation");
    const errorCard=plotCard("modelError","angularErrorConfidence","eye-frame-error-confidence");
    const eventCard=plotCard("signalValidity","blinksGapsEvents","eye-frame-events");
    frameGrid.append(orientationCard,errorCard,eventCard);
    inspectorSection.appendChild(frameGrid);

    const spatialSection=section(
      "eye-spatial-error","4","section4","section4Help","spatial"
    );
    spatialSection.classList.add("eye-reference-spatial");
    const spatialGrid=document.createElement("div");
    spatialGrid.className="eye-reference-spatial-grid";
    const cumulative=plotCard("angularError","cumulativeAngularError","eye-gaze-point-plot");
    const directionCard=document.createElement("article");
    directionCard.className="eye-chart-card eye-reference-direction-card";
    directionCard.appendChild(directionDock);
    const residual=plotCard("residualField","spatialVectorField","eye-binocular-consistency");
    const looked=plotCard("observedGaze","whereLooked","eye-recording-gaze-map");
    spatialGrid.append(cumulative,directionCard,residual,looked);
    spatialSection.appendChild(spatialGrid);

    const robustnessSection=section(
      "eye-robustness","5","section5","section5Help","robustness"
    );
    robustnessSection.classList.add("eye-reference-robustness");
    const robustnessGrid=document.createElement("div");
    robustnessGrid.className="eye-reference-robustness-grid";
    [
      ["qualityBand","eye-robust-quality"],["lighting","eye-robust-lighting"],
      ["scenario","eye-robust-scenario"],["eyeSide","eye-robust-eye"],
      ["trackingConfidence","eye-robust-confidence"],
    ].forEach(([titleKey,id])=>robustnessGrid.appendChild(plotCard("condition",titleKey,id,"eye-reference-mini-plot")));
    const robustnessTable=document.createElement("article");
    robustnessTable.className="eye-reference-table-card eye-reference-wide";
    robustnessTable.innerHTML='<header>'+appNode("h3","conditionSummary")+'</header><div id="eye-robustness-table"></div>';
    robustnessSection.append(robustnessGrid,robustnessTable);

    const eventsSection=section(
      "eye-events-aoi","6","section6","section6Help","events"
    );
    eventsSection.classList.add("eye-reference-events");
    const eventsGrid=document.createElement("div");
    eventsGrid.className="eye-reference-events-grid";
    const distributionCard=document.createElement("article");
    distributionCard.className="eye-reference-table-card";
    distributionCard.innerHTML='<header>'+appNode("h3","eventDistribution")+'</header><div id="eye-event-distribution-table"></div>';
    const shareCard=plotCard("eventComposition","eventShare","eye-aoi-visit-order");
    const aoiCard=document.createElement("article");
    aoiCard.className="eye-reference-table-card";
    aoiCard.innerHTML='<header>'+appNode("h3","aoiAttentionMetrics")+'</header><div id="eye-aoi-attention-table"></div>';
    eventsGrid.append(distributionCard,shareCard,aoiCard);
    eventsSection.appendChild(eventsGrid);
    if(eventActions){
      const showAll=document.createElement("button");
      showAll.type="button";showAll.id="eye-events-show-all";showAll.dataset.eyeAppText="viewAllEvents";showAll.textContent=appText("viewAllEvents");
      const saveEvent=document.createElement("button");
      saveEvent.type="button";saveEvent.className="eye-save-selected-event";
      saveEvent.dataset.eyeAppText="saveEvent";saveEvent.disabled=true;saveEvent.textContent=appText("saveEvent");
      eventActions.prepend(showAll,saveEvent);
    }
    const ledgerDetails=document.createElement("details");
    ledgerDetails.className="eye-reference-event-ledger";
    ledgerDetails.innerHTML=appNode("summary","inspectEventRecords");
    if(eventActions)ledgerDetails.appendChild(eventActions);
    ledgerDetails.appendChild(eventTable);
    eventsSection.appendChild(ledgerDetails);

    const compatibility=document.createElement("div");
    compatibility.className="eye-tracking-compatibility";
    compatibility.hidden=true;
    compatibility.setAttribute("aria-hidden","true");
    [eyeStage,eyeTransport,sceneSummary,timelineSummary,stabilityTarget,spatial,interaction].filter(Boolean).forEach(node=>compatibility.appendChild(node));
    compatibility.append(
      plotCard("velocity","gazeVelocity","eye-gaze-velocity"),
      plotCard("jitter","rollingJitter","eye-rolling-jitter"),
      document.createElement("div")
    );
    compatibility.lastElementChild.id="eye-structure-metrics";

    const documentRoot=document.createElement("div");
    documentRoot.className="eye-tracking-document eye-reference-dashboard";
    documentRoot.append(
      summarySection,replaySection,inspectorSection,spatialSection,robustnessSection,eventsSection,compatibility
    );
    trackingPane.appendChild(documentRoot);
    [overview,ocular,temporal,eventAudit,sceneOverview,sceneReplay].forEach(node=>node?.remove());
    sceneSource.classList.add("eye-tracking-source-pane");
    schedulePlotlyReflow();
  }
  function prepareEyePanel(main) {
    const mode=DATA.panel_mode;
    if(DATA.task!=="eye_evaluation"||!["evaluation","tracking"].includes(mode))return;
    const studio=main.matches(".eye-studio")?main:main.querySelector(".eye-studio");
    if(!studio)return;
    document.documentElement.dataset.panelMode=mode;
    studio.dataset.panelMode=mode;
    studio.dataset.initialMode=mode;
    const modeSelect=studio.querySelector("#eye-mode-select");
    if(modeSelect&&Array.from(modeSelect.options).some(option=>option.value===mode)){
      modeSelect.value=mode;
      modeSelect.dispatchEvent(new Event("change",{bubbles:true}));
    }else{
      studio.dataset.activeTask=mode;
      document.dispatchEvent(new CustomEvent("eye:taskchange",{detail:{mode}}));
    }
    studio.querySelector(".eye-mode-bar")?.remove();
    if(mode==="tracking")composeEyeTrackingWorkspace(studio);
    if(mode==="evaluation"){
      const sliceTable=studio.querySelector("#eye-slice-table");
      sliceTable?.previousElementSibling?.remove();
      sliceTable?.remove();
      ["#eye-temporal-table","#eye-cases-table"].forEach(selector=>{
        studio.querySelector(selector)?.closest(".dash-section")?.remove();
      });
      studio.querySelector("#eye-evidence-ledger")?.remove();
    }
  }
  function removeLegacyComparison(root=document) {
    root.querySelectorAll?.(".compare-controls,.compare-toggle,.compare-reference-select,.compare-delta,.compare-reference").forEach(node=>node.remove());
  }
  function panelTaskLabel() {
    const key=DATA.panel_mode||DATA.task;
    return tr("printTask."+key);
  }
  function composeResearchWorkbench(hero) {
    const nav=shell.querySelector(":scope > .dm-v2-view-nav");
    const tools=shell.querySelector(":scope > .dm-v2-tools");
    const filters=shell.querySelector(":scope > .dm-v2-global-filters");
    if(!hero||!nav||!tools||!filters)return;

    const frame=document.createElement("div");
    frame.className="dm-v2-workbench-frame";
    const rail=document.createElement("aside");
    rail.className="dm-v2-workbench-rail";
    rail.setAttribute("aria-label",tr("navigation"));
    const railBrand=document.createElement("div");
    railBrand.className="dm-v2-rail-brand";
    const task=(DATA.panel_mode||DATA.task||"report").replaceAll("_"," ");
    const taskIcon=DATA.panel_mode==="tracking"?"tracking":DATA.task;
    railBrand.innerHTML='<span class="dm-v2-brand-mark" aria-hidden="true">'+icon(taskIcon)+'</span>'+
      '<span class="dm-v2-brand-copy"><strong>Metrics Studio</strong><small>'+esc(task)+'</small></span>';
    rail.append(railBrand,nav);

    const canvas=document.createElement("div");
    canvas.className="dm-v2-workbench-canvas";
    const commandDeck=document.createElement("section");
    commandDeck.className="dm-v2-command-deck";
    const commandHead=document.createElement("header");
    commandHead.className="dm-v2-command-head";
    commandHead.innerHTML='<div><span class="dm-v2-command-signal" aria-hidden="true"></span>'+
      '<strong data-v2-text="workspace">'+esc(tr("workspace"))+'</strong></div>'+
      '<small data-v2-text="workspaceNote">'+esc(tr("workspaceNote"))+"</small>";
    commandDeck.append(commandHead,tools,filters);
    commandDeck.id="dm-v2-analysis-console";


    const content=Array.from(shell.children).filter(node=>
      node!==nav&&node!==tools&&node!==filters&&
      !node.classList.contains("dm-v2-sr-only")
    );
    canvas.append(hero,commandDeck,...content);
    frame.append(rail,canvas);
    shell.appendChild(frame);
    shell.dataset.v2Layout="research-workbench";

    if(DATA.task==="ocr"){
      const icons={cer:"chart",word_recall:"compare",document_exact_match_rate:"check"};
      shell.querySelectorAll(".ocr-primary-metrics [data-kpi-key]").forEach(card=>{
        const symbol=document.createElement("span");
        symbol.className="ocr-kpi-symbol";
        symbol.innerHTML=icon(icons[card.dataset.kpiKey]||"chart");
        card.prepend(symbol);
        const direction=document.createElement("span");
        direction.className="ocr-kpi-direction";
        const lower=card.dataset.kpiKey==="cer";
        direction.innerHTML='<span aria-hidden="true">'+(lower?"↓":"↑")+
          '</span> <span data-v2-text="'+(lower?"lower":"higher")+'">'+
          esc(tr(lower?"lower":"higher"))+"</span>";
        card.appendChild(direction);
      });
    }
  }
  function composeEyeTrackingApplication(hero) {
    if(DATA.task!=="eye_evaluation"||DATA.panel_mode!=="tracking")return;
    const eyeData=window.EYE_STUDIO_DATA;
    const canvas=shell.querySelector(".dm-v2-workbench-canvas");
    const trackingDocument=shell.querySelector(".eye-tracking-document");
    const ledger=shell.querySelector("#eye-evidence-ledger");
    if(!eyeData||!canvas||!trackingDocument||!ledger)return;

    const finite=value=>value!=null&&value!==""&&Number.isFinite(Number(value));
    const mean=values=>{const clean=values.map(Number).filter(Number.isFinite);return clean.length?clean.reduce((sum,value)=>sum+value,0)/clean.length:NaN;};
    const quantile=(values,q)=>{const clean=values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);if(!clean.length)return NaN;const position=(clean.length-1)*q,lower=Math.floor(position),upper=Math.ceil(position);return clean[lower]+(clean[upper]-clean[lower])*(position-lower);};
    const et=key=>window.DM_I18N?.t?.("eye_app."+key)||key;
    const eventLabel=value=>{const raw=String(value||"event"),key="eventType_"+raw.toLowerCase().replace(/[^a-z0-9]+/g,"_");const label=et(key);return label===key?raw:label;};
    const localize=()=>{
      shell.querySelectorAll("[data-eye-app-text]").forEach(node=>node.textContent=et(node.dataset.eyeAppText));
      shell.querySelectorAll("[data-eye-app-label]").forEach(node=>node.setAttribute("aria-label",et(node.dataset.eyeAppLabel)));
    };
    const currentRecording=()=>document.getElementById("eye-recording")?.value||eyeData.tracking.recordings[0]?.recording_id||"";
    const recordData=()=>{
      const recording=currentRecording();
      return {
        recording,
        record:eyeData.tracking.recordings.find(row=>String(row.recording_id)===String(recording))||{},
        summary:eyeData.tracking.summary.find(row=>String(row.recording_id)===String(recording))||{},
        coverage:eyeData.tracking.coverage.find(row=>String(row.recording_id)===String(recording))||{},
        points:eyeData.tracking.points.filter(row=>String(row.recording_id)===String(recording)).sort((a,b)=>+a.timestamp-+b.timestamp),
        events:eyeData.tracking.events.filter(row=>String(row.recording_id)===String(recording)).sort((a,b)=>+a.start_timestamp-+b.start_timestamp),
        frames:eyeData.scene.frames.filter(row=>String(row.recording_id)===String(recording)).sort((a,b)=>+(a.sync_timestamp??a.timestamp)-+(b.sync_timestamp??b.timestamp)),
        interactions:eyeData.scene.interactions.filter(row=>String(row.recording_id)===String(recording)),
      };
    };
    const chartLayout=extra=>Object.assign({
      paper_bgcolor:"rgba(0,0,0,0)",plot_bgcolor:"rgba(0,0,0,0)",
      font:{family:"Segoe UI,system-ui,sans-serif",color:getComputedStyle(document.documentElement).getPropertyValue("--wb-ink").trim(),size:11},
      margin:{l:46,r:22,t:20,b:42},hovermode:"closest",
      legend:{orientation:"h",x:0,y:1.14},
      xaxis:{gridcolor:getComputedStyle(document.documentElement).getPropertyValue("--chart-grid").trim(),automargin:true},
      yaxis:{gridcolor:getComputedStyle(document.documentElement).getPropertyValue("--chart-grid").trim(),automargin:true},
    },extra||{});
    const chartConfig={responsive:true,displaylogo:false,displayModeBar:true,scrollZoom:false,toImageButtonOptions:{format:"png",scale:2},modeBarButtonsToRemove:["lasso2d"]};
    const statePlot=(id,title,copy)=>{
      const node=document.getElementById(id);if(!node)return;
      if(window.Plotly)try{Plotly.purge(node);}catch(_error){/* no-op */}
      node.classList.add("dm-v2-empty");
      node.innerHTML='<div class="dm-v2-state dm-v2-state-unavailable"><span aria-hidden="true">—</span><strong>'+
        esc(title)+'</strong><p>'+esc(copy)+"</p></div>";
    };
    const plot=(id,traces,layout)=>{
      const node=document.getElementById(id);if(!node)return;
      if(!traces.length){statePlot(id,et("insufficient"),tr("noPlotData"));return;}
      node.classList.remove("dm-v2-empty");
      queuePlot(node,{traces,layout,config:chartConfig});
    };

    // Keep the same compact header, top view navigation and three-card command
    // deck used by every other report. Eye Tracking only extends the document
    // body; it no longer mutates the common shell into a sidebar application.

    const ledgerBackdrop=document.createElement("button");
    ledgerBackdrop.type="button";ledgerBackdrop.className="eye-ledger-backdrop";ledgerBackdrop.hidden=true;
    ledgerBackdrop.setAttribute("aria-label",et("close"));
    document.body.appendChild(ledgerBackdrop);
    ledger.classList.add("eye-ledger-drawer");
    const ledgerBody=ledger.querySelector(".eye-ledger-body");
    const savedPanel=document.createElement("section");
    savedPanel.className="eye-saved-evidence";
    savedPanel.innerHTML='<header><div><span data-eye-app-text="savedEvidence">'+esc(et("savedEvidence"))+
      '</span><h2 data-eye-app-text="evidenceCollection">'+esc(et("evidenceCollection"))+'</h2></div><div><button type="button" id="eye-export-ledger" data-eye-app-text="exportLedger">'+
      esc(et("exportLedger"))+'</button><button type="button" data-eye-close-ledger data-eye-app-text="close">'+
      esc(et("close"))+'</button></div></header><div id="eye-saved-evidence-list"></div>';
    ledgerBody?.insertBefore(savedPanel,ledgerBody.firstChild);
    const setLedgerOpen=open=>{
      ledger.open=open;ledger.classList.toggle("is-open",open);ledgerBackdrop.hidden=!open;
      ledger.toggleAttribute("inert",!open);
      ledger.setAttribute("aria-hidden",String(!open));
      document.documentElement.classList.toggle("eye-ledger-open",open);
      if(open)window.setTimeout(()=>schedulePlotlyReflow(),80);
    };
    ledgerBackdrop.addEventListener("click",()=>setLedgerOpen(false));
    ledger.querySelector("[data-eye-close-ledger]")?.addEventListener("click",()=>setLedgerOpen(false));
    shell.querySelectorAll("[data-eye-open-ledger],[data-eye-open-diagnostics]").forEach(button=>
      button.addEventListener("click",()=>setLedgerOpen(true))
    );
    setLedgerOpen(false);

    const evidence=[];
    const renderEvidence=()=>{
      const list=ledger.querySelector("#eye-saved-evidence-list");
      const count=evidence.length;
      const inlineCount=shell.querySelector("#eye-evidence-inline-count");
      if(inlineCount)inlineCount.textContent=count+" "+et("savedEvidence").toLocaleLowerCase();
      if(!list)return;
      if(!count){list.innerHTML='<p class="eye-empty">'+esc(et("noEvidence"))+"</p>";return;}
      const classifications=["observation","finding","exclusion","follow_up"].map(value=>[value,et("classification_"+value)]);
      list.innerHTML=evidence.map(item=>'<article data-evidence-id="'+esc(item.id)+'">'+
        (item.image?'<img src="'+item.image+'" alt="">':'')+'<div><span>'+esc(et("evidenceType_"+item.type))+'</span><h3>'+esc(item.title)+
        '</h3><dl><dt>'+esc(et("recording"))+'</dt><dd>'+esc(item.recording)+'</dd><dt>'+esc(et("time"))+'</dt><dd>'+esc(item.time)+
        '</dd><dt>'+esc(et("model"))+'</dt><dd>'+esc(item.model)+'</dd></dl><label>'+esc(et("annotation"))+
        '<textarea>'+esc(item.annotation||"")+'</textarea></label><label class="eye-evidence-classification">'+
        esc(et("classification"))+'<select data-eye-evidence-classification>'+
        classifications.map(([value,label])=>'<option value="'+value+'"'+(item.classification===value?" selected":"")+'>'+esc(label)+"</option>").join("")+
        '</select></label><label class="eye-evidence-include"><input type="checkbox" data-eye-evidence-include'+
        (item.includeInReport?" checked":"")+'> '+esc(et("includeReport"))+'</label><button type="button" data-eye-delete-evidence>'+
        esc(et("remove"))+"</button></div></article>").join("");
      list.querySelectorAll("[data-evidence-id]").forEach(article=>{
        const item=evidence.find(entry=>entry.id===article.dataset.evidenceId);
        article.querySelector("textarea")?.addEventListener("input",event=>{item.annotation=event.target.value;});
        article.querySelector("[data-eye-evidence-classification]")?.addEventListener("change",event=>{item.classification=event.target.value;});
        article.querySelector("[data-eye-evidence-include]")?.addEventListener("change",event=>{item.includeInReport=event.target.checked;});
        article.querySelector("[data-eye-delete-evidence]")?.addEventListener("click",()=>{
          evidence.splice(evidence.indexOf(item),1);renderEvidence();
        });
      });
    };
    const captureEvidence=async button=>{
      const container=button.closest(".eye-chart-card,.dash-section");
      const plotNode=container?.querySelector(".js-plotly-plot");
      let image="";
      if(plotNode&&window.Plotly?.toImage){
        try{image=await Plotly.toImage(plotNode,{format:"png",width:640,height:360,scale:1});}catch(_error){/* reference-only evidence */}
      }
      const data=recordData(),title=container?.querySelector("h2,h3")?.textContent.trim()||et("trackingEvidence");
      evidence.unshift({
        id:"evidence-"+Date.now()+"-"+Math.random().toString(36).slice(2,7),
        type:plotNode?"chart":"module",title,image,recording:data.recording,
        time:document.getElementById("eye-cursor-value")?.value||"N/A",
        model:experiment(state.primary)?.name||state.primary,
        classification:"finding",includeInReport:true,
        annotation:container?.dataset.eyeSelectedEvent?et("event")+" "+container.dataset.eyeSelectedEvent:"",
        createdAt:new Date().toISOString(),
      });
      renderEvidence();setLedgerOpen(true);
    };
    trackingDocument.querySelectorAll(".eye-chart-card header").forEach(header=>{
      if(header.querySelector(".eye-evidence-capture"))return;
      const button=document.createElement("button");
      button.type="button";button.className="eye-evidence-capture";button.textContent="+";
      button.setAttribute("aria-label",et("saveEvidence"));header.appendChild(button);
    });
    trackingDocument.querySelectorAll(".eye-evidence-capture").forEach(button=>
      button.addEventListener("click",()=>captureEvidence(button))
    );
    trackingDocument.querySelector(".eye-save-selected-event")?.addEventListener("click",event=>
      captureEvidence(event.currentTarget)
    );
    ledger.querySelector("#eye-export-ledger")?.addEventListener("click",()=>download(
      "eye-tracking-evidence-ledger.json",JSON.stringify(evidence,null,2),"application/json"
    ));

    const status=(value,thresholds)=>{
      if(!finite(value))return "insufficient";
      if(value>=thresholds.good)return "good";
      if(value>=thresholds.acceptable)return "acceptable";
      return "review";
    };
    const updateQuality=()=>{
      const data=recordData(),summary=data.summary,coverage=data.coverage;
      const thresholds=Object.assign({
        valid:{good:.95,acceptable:.8},stability:{good:.9,acceptable:.75},
        coverage:{good:.65,acceptable:.4},
      },window.EYE_TRACKING_QUALITY_THRESHOLDS||{});
      const coverageScore=mean([coverage.spatial_coverage,coverage.temporal_coverage]);
      const binocular=data.points.filter(row=>
        finite(row.left_x)&&finite(row.left_y)&&finite(row.right_x)&&finite(row.right_y)
      );
      const binocularError=mean(binocular.map(row=>
        Math.hypot(+row.left_x-(+row.right_x),+row.left_y-(+row.right_y))
      ));
      const binocularScore=finite(binocularError)?Math.max(0,1-binocularError/.05):NaN;
      const stability=finite(summary.stability)?+summary.stability:
        finite(summary.jitter_normalized)?Math.max(0,1-(+summary.jitter_normalized)/.05):NaN;
      const diagnostics=[
        [et("tracking"),summary.valid_rate,status(summary.valid_rate,thresholds.valid)],
        [et("stability"),stability,status(stability,thresholds.stability)],
        [et("coverage"),coverageScore,status(coverageScore,thresholds.coverage)],
        [et("binocularConsistency"),binocularScore,status(binocularScore,thresholds.stability)],
      ];
      const host=document.getElementById("eye-quality-diagnosis-grid");
      if(host)host.innerHTML=diagnostics.map(([label,value,level])=>'<article data-quality-state="'+level+'"><span>'+
        esc(label)+'</span><strong>'+esc(et(level))+'</strong><small>'+
        (finite(value)?esc(format(value,"pct")):esc(et("fusedStream")))+"</small></article>").join("");
    };
    const updateMetadata=()=>{
      const data=recordData(),record=data.record,first=data.frames[0]||{},last=data.frames.at(-1)||{};
      const source=(first.resolved_image_path||"").split("/").slice(-1)[0]||et("canonicalStream");
      const rows=[
        [et("start"),finite(first.timestamp)?format(first.timestamp)+" s":"0.000 s"],
        [et("end"),finite(last.timestamp)?format(last.timestamp)+" s":finite(record.duration)?format(record.duration)+" s":"N/A"],
        [et("resolution"),first.width&&first.height?first.width+" × "+first.height:"N/A"],
        [et("fps"),finite(record.sampling_rate_hz)?format(record.sampling_rate_hz)+" Hz":"N/A"],
        [et("device"),record.device||"N/A"],[et("date"),record.recorded_at||"N/A"],
        [et("distance"),finite(record.viewing_distance_cm)?format(record.viewing_distance_cm)+" cm":"N/A"],
        [et("source"),source],
      ];
      const host=document.getElementById("eye-recording-metadata-list");
      if(host)host.innerHTML=rows.map(([label,value])=>"<dt>"+esc(label)+"</dt><dd>"+esc(value)+"</dd>").join("");
    };
    const updateStructures=()=>{
      const data=recordData(),confidence=mean(data.points.map(row=>row.confidence));
      const binocular=data.points.filter(row=>
        finite(row.left_x)&&finite(row.left_y)&&finite(row.right_x)&&finite(row.right_y)
      );
      const divergence=binocular.map(row=>
        Math.hypot(+row.left_x-(+row.right_x),+row.left_y-(+row.right_y))
      );
      const pupilDifference=binocular.filter(row=>
        finite(row.left_pupil_diameter)&&finite(row.right_pupil_diameter)
      ).map(row=>Math.abs(+row.left_pupil_diameter-(+row.right_pupil_diameter)));
      const activeModel=eyeData.models.find(model=>model.experimentId===state.primary)||eyeData.models[0]||{};
      const evaluationRows=(activeModel.rows||[]).filter(row=>
        String(row.recording_id)===String(data.recording)&&row.match_status==="matched"
      );
      const angular=evaluationRows.filter(row=>
        row.target_type==="gaze_3d"&&finite(row.angular_error)
      ).map(row=>+row.angular_error);
      const rows=[
        [et("pupilCentroid"),finite(pupilDifference.length)?format(mean(pupilDifference))+" mm":"N/A",finite(quantile(pupilDifference,.95))?format(quantile(pupilDifference,.95))+" mm":"N/A",finite(data.summary.valid_rate)?format(data.summary.valid_rate,"pct"):"N/A",finite(confidence)?format(confidence,"pct"):"N/A"],
        [et("binocularGaze"),finite(divergence.length)?format(mean(divergence)):"N/A",finite(quantile(divergence,.95))?format(quantile(divergence,.95)):"N/A",binocular.length?format(binocular.length/data.points.length,"pct"):"N/A",finite(confidence)?format(confidence,"pct"):"N/A"],
        [et("gazeVector"),finite(angular.length)?format(mean(angular))+"°":"N/A",finite(quantile(angular,.95))?format(quantile(angular,.95))+"°":"N/A",angular.length?format(angular.length/evaluationRows.length,"pct"):"N/A",finite(confidence)?format(confidence,"pct"):"N/A"],
        [et("sceneProjection"),finite(data.summary.jitter_normalized)?format(data.summary.jitter_normalized):"N/A",finite(data.summary.peak_speed_normalized)?format(data.summary.peak_speed_normalized):"N/A",finite(data.coverage.spatial_coverage)?format(data.coverage.spatial_coverage,"pct"):"N/A",finite(confidence)?format(confidence,"pct"):"N/A"],
      ];
      const host=document.getElementById("eye-structure-metrics");
      if(host)host.innerHTML='<div class="eye-table-scroll" tabindex="0"><table><thead><tr>'+
        [et("structure"),et("precision"),et("error"),et("coverage"),et("confidence")].map(label=>"<th>"+esc(label)+"</th>").join("")+
        "</tr></thead><tbody>"+rows.map(row=>"<tr>"+row.map(value=>"<td>"+esc(value)+"</td>").join("")+"</tr>").join("")+"</tbody></table></div>";
    };
    const activeModel=()=>eyeData.models.find(model=>model.experimentId===state.primary)||eyeData.models[0]||{};
    const activeEvaluationRows=()=>{
      const recording=currentRecording();
      return (activeModel().rows||[]).filter(row=>
        String(row.recording_id)===String(recording)&&row.match_status==="matched"
      );
    };
    const angularRows=()=>activeEvaluationRows().filter(row=>
      row.target_type==="gaze_3d"&&finite(row.angular_error)
    );
    const compactTable=(id,columns,rows)=>{
      const host=document.getElementById(id);if(!host)return;
      if(!rows.length){host.innerHTML='<p class="eye-empty">'+esc(tr("noRows"))+"</p>";return;}
      host.innerHTML='<div class="eye-reference-table-scroll" tabindex="0"><table><thead><tr>'+
        columns.map(column=>"<th>"+esc(column.label)+"</th>").join("")+"</tr></thead><tbody>"+
        rows.map(row=>"<tr>"+columns.map(column=>"<td>"+esc(row[column.key]??"—")+"</td>").join("")+"</tr>").join("")+
        "</tbody></table></div>";
    };
    const updateReferenceSummary=()=>{
      const data=recordData(),angular=angularRows().map(row=>+row.angular_error),
        confidence=mean(data.points.map(row=>row.confidence)),valid=+data.summary.valid_rate,
        coverage=+data.coverage.spatial_coverage,rate=+data.summary.sampling_rate_hz;
      const items=[
        [et("meanAngularError"),finite(mean(angular))?format(mean(angular))+"°":"N/A","mean_angular_error"],
        [et("medianAngularError"),finite(quantile(angular,.5))?format(quantile(angular,.5))+"°":"N/A","median_angular_error"],
        [et("p95AngularError"),finite(quantile(angular,.95))?format(quantile(angular,.95))+"°":"N/A","p95_angular_error"],
        [et("gazeCoverage"),finite(coverage)?format(coverage,"pct"):"N/A",null],
        [et("meanConfidence"),finite(confidence)?format(confidence):"N/A",null],
        [et("validSamples"),finite(valid)?format(valid,"pct"):"N/A","tracking_valid_rate"],
        [et("gazeLoss"),finite(valid)?format(Math.max(0,1-valid),"pct"):"N/A",null],
        [et("estimatedFps"),finite(rate)?format(rate)+" fps":"N/A","tracking_sampling_rate_hz"],
      ];
      const host=document.getElementById("eye-tracking-summary");
      if(host)host.innerHTML=items.map(([label,value])=>'<article class="eye-stat"><span>'+esc(label)+
        '</span><strong>'+esc(value)+"</strong></article>").join("");
    };
    const updateReferenceTables=()=>{
      const data=recordData(),events=data.events,types=Array.from(new Set(events.map(row=>String(row.event_type||"event"))));
      const eventRows=types.map(type=>{
        const rows=events.filter(row=>String(row.event_type||"event")===type),durations=rows.map(row=>+row.duration).filter(Number.isFinite);
        return {type,count:rows.length,mean:durations.length?format(mean(durations)*1000)+" ms":"—",
          total:durations.length?format(durations.reduce((sum,value)=>sum+value,0))+" s":"—"};
      }).sort((left,right)=>right.count-left.count);
      compactTable("eye-event-distribution-table",[
        {key:"type",label:et("event")},{key:"count",label:et("count")},{key:"mean",label:et("meanDuration")},{key:"total",label:et("totalDuration")},
      ],eventRows);
      const interactions=data.interactions.map(row=>({
        aoi:row.aoi_name||row.aoi_id||"—",sample:finite(row.gaze_sample_dwell_seconds)?format(row.gaze_sample_dwell_seconds)+" s":"—",
        fixation:finite(row.fixation_dwell_seconds)?format(row.fixation_dwell_seconds)+" s":"—",
        visits:finite(row.visits)?format(row.visits,"int"):"—",first:finite(row.time_to_first_gaze_seconds)?format(row.time_to_first_gaze_seconds)+" s":"—",
      }));
      compactTable("eye-aoi-attention-table",[
        {key:"aoi",label:"AOI"},{key:"sample",label:et("sampleDwell")},{key:"fixation",label:et("fixationDwell")},
        {key:"visits",label:et("visits")},{key:"first",label:et("firstGaze")},
      ],interactions);
      const evaluation=angularRows(),conditions=[
        [et("quality"),row=>row.quality_band],[et("lighting"),row=>row.lighting],
        [et("scenario"),row=>row.scenario],[et("eye"),row=>row.eye_side],
      ],summary=[];
      conditions.forEach(([condition,getValue])=>{
        Array.from(new Set(evaluation.map(getValue).filter(Boolean))).forEach(value=>{
          const values=evaluation.filter(row=>getValue(row)===value).map(row=>+row.angular_error).filter(Number.isFinite);
          summary.push({condition,value,n:values.length,mean:format(mean(values))+"°",p95:format(quantile(values,.95))+"°"});
        });
      });
      compactTable("eye-robustness-table",[
        {key:"condition",label:et("condition")},{key:"value",label:et("observedGroup")},{key:"n",label:"N"},
        {key:"mean",label:et("meanError")},{key:"p95",label:"P95"},
      ],summary);
    };
    const updateFrameTelemetry=time=>{
      const data=recordData();if(!data.points.length)return;
      const nearest=data.points.reduce((best,row,index)=>{
        const distance=Math.abs(+(row.sync_timestamp??row.timestamp)-time);
        return distance<best.distance?{row,index,distance}:best;
      },{row:data.points[0],index:0,distance:Infinity}),point=nearest.row,
        evaluation=activeEvaluationRows().filter(row=>String(row.sample_id)===String(point.sample_id)),
        gaze=evaluation.find(row=>row.target_type==="gaze_3d")||{},screen=evaluation.find(row=>row.target_type==="gaze_2d")||{},
        event=data.events.find(row=>+row.start_timestamp<=time&&+(row.end_timestamp??row.start_timestamp)>=time),
        labels=["timestamp","frame","angularError","screenError","confidence","yawPitchResidual","aoi","status","event"].map(et),
        facts=[
          [labels[0],format(time)+" s"],[labels[1],String(nearest.index+1)],
          [labels[2],finite(gaze.angular_error)?format(gaze.angular_error)+"°":"N/A"],
          [labels[3],finite(screen.error_2d)?format(screen.error_2d)+" px":"N/A"],
          [labels[4],finite(point.confidence)?format(point.confidence):"N/A"],
          [labels[5],finite(gaze.yaw_error)&&finite(gaze.pitch_error)?format(gaze.yaw_error)+"° / "+format(gaze.pitch_error)+"°":"N/A"],
          [labels[6],gaze.aoi_id||screen.aoi_id||event?.aoi_id||"—"],
          [labels[7],point.valid?et("valid"):et("missing")],
          [labels[8],event?.event_type||"—"],
        ],host=document.getElementById("eye-frame-inspector");
      if(host)host.innerHTML='<div class="eye-telemetry-facts"><dl>'+facts.map(([label,value])=>
        "<div><dt>"+esc(label)+"</dt><dd>"+esc(value)+"</dd></div>").join("")+"</dl></div>";
    };
    const buildExtraPlots=()=>{
      if(typeof Plotly==="undefined")return;
      const data=recordData(),valid=data.points.filter(row=>row.valid&&finite(row.x_normalized)&&finite(row.y_normalized));
      const times=data.points.map(row=>+row.timestamp);
      const cursorTime=+(data.points[+document.getElementById("eye-cursor")?.value||0]?.timestamp||0);
      const eventColors={fixation:"#138a7e",saccade:"#ef8a32",blink:"#e1b93e",microsaccade:"#6d68c5"};
      const eventTraces=["fixation","saccade","blink","microsaccade"].map((kind,index)=>{
        const rows=data.events.filter(row=>String(row.event_type).toLowerCase()===kind);
        const label=eventLabel(kind);
        return {x:rows.map(row=>+row.start_timestamp),y:rows.map(()=>label),mode:"markers",name:label,
          marker:{color:eventColors[kind],size:8,symbol:index===1?"square":"circle"},
          hovertemplate:label+"<br>%{x:.3f} s<extra></extra>"};
      }).filter(trace=>trace.x.length);
      const pupil=data.points.map(row=>+row.pupil_diameter),pupilMin=Math.min(...pupil.filter(finite)),pupilMax=Math.max(...pupil.filter(finite));
      if(finite(pupilMin)&&finite(pupilMax)&&pupilMax>pupilMin)eventTraces.push({
        x:times,y:pupil.map(value=>(+value-pupilMin)/(pupilMax-pupilMin)),mode:"lines",name:et("pupil"),
        yaxis:"y2",line:{color:"#6d68c5",width:1.4},
      });
      eventTraces.push({x:times,y:data.points.map(row=>row.confidence),mode:"lines",name:et("confidence"),yaxis:"y2",line:{color:"#167f83",width:1.5}});
      plot("eye-chart-timeline",eventTraces,chartLayout({
        height:185,hovermode:"x unified",margin:{l:74,r:42,t:18,b:34},
        xaxis:{title:{text:et("timeSeconds")},gridcolor:"rgba(120,130,126,.16)"},
        yaxis:{type:"category",categoryorder:"array",categoryarray:["microsaccade","blink","saccade","fixation"].map(eventLabel),gridcolor:"rgba(120,130,126,.12)"},
        yaxis2:{overlaying:"y",side:"right",range:[0,1.05],showgrid:false},
        shapes:[{name:"shared_cursor",type:"line",x0:cursorTime,x1:cursorTime,y0:0,y1:1,yref:"paper",line:{color:"#ef5b69",width:2}}],
      }));
      const mini=document.getElementById("eye-chart-timeline");
      window.setTimeout(()=>{
        if(mini?.on){
          mini.removeAllListeners?.("plotly_click");
          mini.on("plotly_click",event=>setTime(+event.points?.[0]?.x||0));
        }
      },120);

      const angular=angularRows(),ecdf=rows=>{
        const values=rows.map(row=>+row.angular_error).filter(Number.isFinite).sort((left,right)=>left-right);
        return {x:values,y:values.map((_value,index)=>(index+1)/values.length)};
      },totalEcdf=ecdf(angular),leftEcdf=ecdf(angular.filter(row=>String(row.eye_side).toLowerCase()==="left")),
        rightEcdf=ecdf(angular.filter(row=>String(row.eye_side).toLowerCase()==="right"));
      plot("eye-gaze-point-plot",[
        totalEcdf.x.length?{...totalEcdf,mode:"lines",name:et("total"),line:{color:"#2563eb",width:2.5}}:null,
        leftEcdf.x.length?{...leftEcdf,mode:"lines",name:et("leftEye"),line:{color:"#14b8a6",width:1.8}}:null,
        rightEcdf.x.length?{...rightEcdf,mode:"lines",name:et("rightEye"),line:{color:"#f97316",width:1.8}}:null,
      ].filter(Boolean),chartLayout({height:235,margin:{l:46,r:16,t:18,b:40},
        xaxis:{title:{text:et("angularErrorDegrees")},type:"log",gridcolor:"rgba(120,130,126,.16)"},
        yaxis:{title:{text:et("cumulativeShare")},range:[0,1.02],tickformat:".0%",gridcolor:"rgba(120,130,126,.16)"}}));
      const recordingFixations=data.events.filter(row=>
        String(row.event_type).toLowerCase()==="fixation"&&finite(row.x)&&finite(row.y)
      );
      const recordingStride=Math.max(1,Math.ceil(valid.length/180));
      const recordingTrace=valid.filter((_row,index)=>index%recordingStride===0||index===valid.length-1);
      plot("eye-recording-gaze-map",[
        {
          x:valid.map(row=>+row.x_normalized),y:valid.map(row=>+row.y_normalized),
          type:"histogram2dcontour",name:et("sampleDensity"),ncontours:14,showscale:false,
          colorscale:[[0,"rgba(56,189,248,0)"],[.42,"rgba(56,189,248,.24)"],[.74,"rgba(99,102,241,.48)"],[1,"rgba(244,114,182,.78)"]],
          contours:{coloring:"heatmap"},hoverinfo:"skip",
        },
        {
          x:recordingTrace.map(row=>+row.x_normalized),y:recordingTrace.map(row=>+row.y_normalized),
          mode:"lines",name:et("recordedPath"),line:{color:"rgba(71,85,105,.48)",width:1.35},
          hoverinfo:"skip",
        },
        {
          x:recordingFixations.map(row=>+row.x),y:recordingFixations.map(row=>+row.y),
          mode:"markers+text",name:et("suppliedFixations"),
          text:recordingFixations.map((_row,index)=>String(index+1)),textposition:"top center",
          marker:{
            size:recordingFixations.map(row=>Math.max(9,Math.min(22,(+row.duration||.1)*30))),
            color:recordingFixations.map(row=>+row.start_timestamp),colorscale:"Turbo",
            line:{color:"#fff",width:1},colorbar:{title:et("timeSeconds"),thickness:10},
          },
          hovertemplate:et("fixation")+" %{text}<br>x %{x:.3f}<br>y %{y:.3f}<extra></extra>",
        },
      ],chartLayout({
        height:270,
        xaxis:{range:[0,1],constrain:"domain",title:{text:et("normalizedX")},gridcolor:"rgba(120,130,126,.16)"},
        yaxis:{range:[1,0],constrain:"domain",title:{text:et("normalizedY")},scaleanchor:"x",gridcolor:"rgba(120,130,126,.16)"},
      }));
      const gaze2d=activeEvaluationRows().filter(row=>row.target_type==="gaze_2d"&&
        [row.canonical_x_gt,row.canonical_y_gt,row.canonical_x_pred,row.canonical_y_pred].every(finite)),
        maxX=Math.max(1,...gaze2d.flatMap(row=>[+row.canonical_x_gt,+row.canonical_x_pred])),
        maxY=Math.max(1,...gaze2d.flatMap(row=>[+row.canonical_y_gt,+row.canonical_y_pred])),
        residualStride=Math.max(1,Math.ceil(gaze2d.length/70)),residualRows=gaze2d.filter((_row,index)=>index%residualStride===0),
        residualX=[],residualY=[];
      residualRows.forEach(row=>{
        residualX.push(+row.canonical_x_gt/maxX,+row.canonical_x_pred/maxX,null);
        residualY.push(+row.canonical_y_gt/maxY,+row.canonical_y_pred/maxY,null);
      });
      plot("eye-binocular-consistency",residualRows.length?[
        {x:residualX,y:residualY,mode:"lines",name:et("residual"),line:{color:"rgba(37,99,235,.62)",width:1.25},hoverinfo:"skip"},
        {x:residualRows.map(row=>+row.canonical_x_pred/maxX),y:residualRows.map(row=>+row.canonical_y_pred/maxY),
          mode:"markers",name:et("prediction"),marker:{color:"#2563eb",size:4,opacity:.8},
          customdata:residualRows.map(row=>[row.error_2d,row.sample_id]),hovertemplate:"%{customdata[1]}<br>"+et("error")+" %{customdata[0]:.2f}<extra></extra>"},
      ]:[],chartLayout({height:235,margin:{l:42,r:12,t:18,b:40},showlegend:false,
        xaxis:{title:{text:et("normalizedX")},range:[0,1],gridcolor:"rgba(120,130,126,.16)"},
        yaxis:{title:{text:et("normalizedY")},range:[1,0],scaleanchor:"x",gridcolor:"rgba(120,130,126,.16)"}}));

      const aoiEvents=data.events.filter(row=>row.aoi_id),eventTypes=Array.from(new Set(data.events.map(row=>String(row.event_type||"event")))),
        eventCounts=eventTypes.map(type=>data.events.filter(row=>String(row.event_type||"event")===type).length),
        eventDurations=eventTypes.map(type=>data.events.filter(row=>String(row.event_type||"event")===type).reduce((sum,row)=>sum+(+row.duration||0),0)),
        countTotal=eventCounts.reduce((sum,value)=>sum+value,0)||1,durationTotal=eventDurations.reduce((sum,value)=>sum+value,0)||1;
      plot("eye-aoi-visit-order",eventTypes.length?[
        {x:eventTypes.map(eventLabel),y:eventCounts.map(value=>value/countTotal),type:"bar",name:et("countShare"),marker:{color:"#2563eb"}},
        {x:eventTypes.map(eventLabel),y:eventDurations.map(value=>value/durationTotal),type:"bar",name:et("durationShare"),marker:{color:"#22a06b"}},
      ]:[],chartLayout({height:235,barmode:"group",margin:{l:46,r:12,t:18,b:58},
        xaxis:{tickangle:-18,gridcolor:"rgba(0,0,0,0)"},yaxis:{title:{text:et("share")},tickformat:".0%",rangemode:"tozero",gridcolor:"rgba(120,130,126,.16)"}}));

      const pointBySample=new Map(data.points.map(row=>[String(row.sample_id),row])),
        gazeRows=angularRows().map((row,index)=>{
          const point=pointBySample.get(String(row.sample_id))||{},vector=(suffix)=>{
            const x=+row["canonical_x_"+suffix],y=+row["canonical_y_"+suffix],z=+row["canonical_z_"+suffix];
            if(![x,y,z].every(Number.isFinite))return{};
            return {yaw:Math.atan2(x,z)*180/Math.PI,pitch:Math.atan2(y,z)*180/Math.PI};
          };
          return {...row,time:finite(point.timestamp)?+point.timestamp:index,confidence:+point.confidence,gt:vector("gt"),pred:vector("pred")};
        }).sort((left,right)=>left.time-right.time),
        frameTraces=[
          [et("yawGt"),"gt","yaw","#2563eb","solid"],[et("yawPrediction"),"pred","yaw","#22a06b","dash"],
          [et("pitchGt"),"gt","pitch","#8b5cf6","solid"],[et("pitchPrediction"),"pred","pitch","#ef4444","dash"],
        ].map(([name,side,axis,color,dash])=>({x:gazeRows.map(row=>row.time),y:gazeRows.map(row=>row[side][axis]),
          mode:"lines",name,line:{color,width:1.6,dash},connectgaps:false}));
      plot("eye-frame-orientation",frameTraces,chartLayout({height:225,hovermode:"x unified",margin:{l:48,r:14,t:20,b:40},
        xaxis:{title:{text:et("timeSeconds")},gridcolor:"rgba(120,130,126,.16)"},
        yaxis:{title:{text:et("angleDegrees")},gridcolor:"rgba(120,130,126,.16)"},legend:{orientation:"h",x:0,y:1.18,font:{size:9}}}));
      plot("eye-frame-error-confidence",gazeRows.length?[
        {x:gazeRows.map(row=>row.time),y:gazeRows.map(row=>+row.angular_error),mode:"lines",name:et("angularError"),line:{color:"#2563eb",width:2}},
        {x:gazeRows.map(row=>row.time),y:gazeRows.map(row=>row.confidence),mode:"lines",name:et("confidence"),yaxis:"y2",line:{color:"#ef4444",width:1.5}},
      ]:[],chartLayout({height:225,hovermode:"x unified",margin:{l:48,r:46,t:20,b:40},
        xaxis:{title:{text:et("timeSeconds")},gridcolor:"rgba(120,130,126,.16)"},
        yaxis:{title:{text:et("errorDegrees")},rangemode:"tozero",gridcolor:"rgba(120,130,126,.16)"},
        yaxis2:{title:{text:et("confidence")},overlaying:"y",side:"right",range:[0,1.05],showgrid:false},legend:{orientation:"h",x:0,y:1.16,font:{size:9}}}));
      const gapTimes=data.points.filter(row=>!row.valid).map(row=>+row.timestamp),eventPalette=["#8b5cf6","#64748b","#f97316","#14b8a6","#ef4444"];
      plot("eye-frame-events",[
        ...eventTypes.map((type,index)=>({x:data.events.filter(row=>String(row.event_type||"event")===type).map(row=>+row.start_timestamp),
          y:data.events.filter(row=>String(row.event_type||"event")===type).map(()=>eventLabel(type)),mode:"markers",name:eventLabel(type),
          marker:{color:eventPalette[index%eventPalette.length],size:7},hovertemplate:eventLabel(type)+"<br>%{x:.3f} s<extra></extra>"})),
        gapTimes.length?{x:gapTimes,y:gapTimes.map(()=>et("trackingGap")),mode:"markers",name:et("trackingGap"),marker:{color:"#94a3b8",size:6,symbol:"square"}}:null,
      ].filter(Boolean),chartLayout({height:225,showlegend:false,margin:{l:82,r:14,t:20,b:40},
        xaxis:{title:{text:et("timeSeconds")},gridcolor:"rgba(120,130,126,.16)"},yaxis:{type:"category",gridcolor:"rgba(120,130,126,.12)"}}));

      const boxPlot=(id,key,accessor,color)=>{
        const rows=gazeRows.map(row=>({...row,group:accessor(row)})).filter(row=>row.group&&finite(row.angular_error));
        plot(id,rows.length?[{x:rows.map(row=>row.group),y:rows.map(row=>+row.angular_error),type:"box",name:key,
          boxpoints:"outliers",jitter:.22,pointpos:0,marker:{color,size:3,opacity:.55},line:{color,width:1.4},fillcolor:color+"24",
          hovertemplate:"%{x}<br>%{y:.2f}°<extra></extra>"}]:[],chartLayout({height:205,showlegend:false,margin:{l:38,r:8,t:12,b:54},
          xaxis:{tickangle:-20,gridcolor:"rgba(0,0,0,0)"},yaxis:{title:{text:et("errorDegrees")},rangemode:"tozero",gridcolor:"rgba(120,130,126,.16)"}}));
      };
      boxPlot("eye-robust-quality",et("quality"),row=>row.quality_band,"#2563eb");
      boxPlot("eye-robust-lighting",et("lighting"),row=>row.lighting,"#14b8a6");
      boxPlot("eye-robust-scenario",et("scenario"),row=>row.scenario,"#f97316");
      boxPlot("eye-robust-eye",et("eye"),row=>row.eye_side,"#8b5cf6");
      boxPlot("eye-robust-confidence",et("confidence"),row=>finite(row.confidence)
        ? (row.confidence<.75?"< 0.75":row.confidence<.9?"0.75–0.90":"≥ 0.90") : "","#ef4444");

      const speed=data.points.map((row,index)=>{if(!index||!row.valid||!data.points[index-1].valid)return NaN;const previous=data.points[index-1],dt=+row.timestamp-(+previous.timestamp);return dt>0?Math.hypot(+row.x_normalized-(+previous.x_normalized),+row.y_normalized-(+previous.y_normalized))/dt:NaN;});
      const jitter=data.points.map((_row,index)=>{const sample=data.points.slice(Math.max(0,index-5),index+1).filter(row=>row.valid&&finite(row.x_normalized)&&finite(row.y_normalized));if(sample.length<3)return NaN;const cx=mean(sample.map(row=>row.x_normalized)),cy=mean(sample.map(row=>row.y_normalized));return Math.sqrt(mean(sample.map(row=>(+row.x_normalized-cx)**2+(+row.y_normalized-cy)**2)));});
      const saccadeShapes=data.events.filter(row=>String(row.event_type).toLowerCase()==="saccade").map(row=>({
        type:"rect",x0:+row.start_timestamp,x1:+(row.end_timestamp??(+row.start_timestamp+(+row.duration||0))),y0:0,y1:1,yref:"paper",
        fillcolor:"rgba(239,138,50,.14)",line:{width:0},layer:"below",
      }));
      plot("eye-gaze-velocity",[{x:times,y:speed,mode:"lines",name:et("velocity"),line:{color:"#ef8a32",width:2},fill:"tozeroy",fillcolor:"rgba(239,138,50,.08)"}],
        chartLayout({height:245,xaxis:{title:{text:et("timeSeconds")},gridcolor:"rgba(120,130,126,.16)"},
          yaxis:{title:{text:et("normalizedPerSecond")},rangemode:"tozero",gridcolor:"rgba(120,130,126,.16)"},shapes:saccadeShapes}));
      const jitterLimit=quantile(jitter,.9);
      plot("eye-rolling-jitter",[{x:times,y:jitter,mode:"lines",name:et("rollingJitter"),line:{color:"#536bb3",width:2}}],
        chartLayout({height:245,xaxis:{title:{text:et("timeSeconds")},gridcolor:"rgba(120,130,126,.16)"},
          yaxis:{title:{text:et("localRms")},rangemode:"tozero",gridcolor:"rgba(120,130,126,.16)"},
          shapes:finite(jitterLimit)?[{type:"line",x0:Math.min(...times),x1:Math.max(...times),y0:jitterLimit,y1:jitterLimit,line:{color:"#d16552",dash:"dot"}}]:[]}));

      const aoiSelect=document.getElementById("eye-aoi-filter"),activeAoi=aoiSelect?.value||"";
      const interactions=activeAoi?data.interactions.filter(row=>String(row.aoi_id)===activeAoi):data.interactions;
      plot("eye-aoi-donut",interactions.length?[{
        labels:interactions.map(row=>row.aoi_name||row.aoi_id),values:interactions.map(row=>+row.gaze_sample_dwell_seconds||0),
        type:"pie",hole:.64,textinfo:"label+percent",marker:{colors:["#138a7e","#ef8a32","#e1b93e","#6d68c5","#53a6cc"]},
        hovertemplate:"%{label}<br>%{value:.3f} s<extra></extra>",
      }]:[],chartLayout({height:250,margin:{l:18,r:18,t:24,b:20},showlegend:false}));
      const fixations=data.events.filter(row=>String(row.event_type).toLowerCase()==="fixation"&&finite(row.duration)&&(!activeAoi||String(row.aoi_id)===activeAoi));
      plot("eye-fixation-duration",fixations.length?[{x:fixations.map(row=>+row.duration),type:"histogram",name:et("fixations"),marker:{color:"#138a7e"},hovertemplate:"%{x:.3f} s<br>%{y} "+et("events").toLowerCase()+"<extra></extra>"}]:[],
        chartLayout({height:250,xaxis:{title:{text:et("durationSeconds")},gridcolor:"rgba(120,130,126,.16)"},yaxis:{title:{text:et("events")},gridcolor:"rgba(120,130,126,.16)"}}));
      const visits=aoiEvents.filter(row=>!activeAoi||String(row.aoi_id)===activeAoi);
      plot("eye-aoi-timeline",visits.length?[{
        x:visits.flatMap(row=>[+row.start_timestamp,+(row.end_timestamp??(+row.start_timestamp+(+row.duration||0))),null]),
        y:visits.flatMap(row=>[row.aoi_id,row.aoi_id,null]),mode:"lines",name:et("aoiInterval"),
        line:{color:"#138a7e",width:9},hovertemplate:"%{y}<br>%{x:.3f} s<extra></extra>",
      }]:[],chartLayout({height:250,xaxis:{title:{text:et("timeSeconds")},gridcolor:"rgba(120,130,126,.16)"},yaxis:{type:"category",gridcolor:"rgba(120,130,126,.12)"}}));
      const sequence=aoiEvents.map(row=>String(row.aoi_id)),nodes=Array.from(new Set(sequence)),links=new Map();
      for(let index=1;index<sequence.length;index+=1){if(sequence[index]===sequence[index-1])continue;const key=sequence[index-1]+"→"+sequence[index];links.set(key,(links.get(key)||0)+1);}
      plot("eye-aoi-transitions",links.size?[{
        type:"sankey",orientation:"h",node:{label:nodes,color:nodes.map((_node,index)=>["#138a7e","#ef8a32","#e1b93e","#6d68c5"][index%4]),pad:18,thickness:18},
        link:{source:Array.from(links.keys()).map(key=>nodes.indexOf(key.split("→")[0])),
          target:Array.from(links.keys()).map(key=>nodes.indexOf(key.split("→")[1])),value:Array.from(links.values()),color:"rgba(19,138,126,.22)"},
      }]:[],chartLayout({height:270,margin:{l:18,r:18,t:22,b:20}}));
      plot("eye-density-map",valid.length?[{
        x:valid.map(row=>row.x_normalized),y:valid.map(row=>row.y_normalized),type:"histogram2dcontour",
        ncontours:16,colorscale:[[0,"rgba(19,138,126,0)"],[.35,"rgba(19,138,126,.28)"],[.7,"rgba(225,185,62,.55)"],[1,"rgba(225,77,91,.82)"]],
        contours:{coloring:"heatmap"},colorbar:{title:et("density"),thickness:11},
      }]:[],chartLayout({height:250,xaxis:{range:[0,1],constrain:"domain",title:{text:et("normalizedX")},gridcolor:"rgba(120,130,126,.16)"},
        yaxis:{range:[1,0],constrain:"domain",title:{text:et("normalizedY")},scaleanchor:"x",gridcolor:"rgba(120,130,126,.16)"}}));
      const microsaccades=data.events.filter(row=>
        String(row.event_type).toLowerCase()==="microsaccade"&&finite(row.x)&&finite(row.y)
      );
      plot("eye-microsaccade-map",microsaccades.length?[{
        x:microsaccades.map(row=>+row.x),y:microsaccades.map(row=>+row.y),
        mode:"markers+text",name:et("suppliedMicrosaccades"),
        text:microsaccades.map((_row,index)=>"M"+(index+1)),textposition:"top center",
        marker:{
          size:microsaccades.map(row=>Math.max(10,Math.min(24,(+row.amplitude||.2)*34))),
          color:microsaccades.map(row=>+row.velocity||0),colorscale:"Viridis",showscale:true,
          colorbar:{title:et("velocity"),thickness:10},line:{color:"#fff",width:1},
        },
        customdata:microsaccades.map(row=>[row.amplitude,row.velocity,row.start_timestamp]),
        hovertemplate:"x %{x:.3f}<br>y %{y:.3f}<br>"+et("amplitude")+" %{customdata[0]:.3f}°<br>"+et("velocity")+" %{customdata[1]:.2f}°/s<br>"+et("time")+" %{customdata[2]:.3f} s<extra></extra>",
      }]:[],chartLayout({
        height:250,xaxis:{range:[0,1],constrain:"domain",title:{text:et("normalizedX")},gridcolor:"rgba(120,130,126,.16)"},
        yaxis:{range:[1,0],constrain:"domain",title:{text:et("normalizedY")},scaleanchor:"x",gridcolor:"rgba(120,130,126,.16)"},
      }));
    };
    const updateAoiOptions=()=>{
      const select=document.getElementById("eye-aoi-filter");if(!select)return;
      const previous=select.value,aois=Array.from(new Set(recordData().interactions.map(row=>String(row.aoi_id)).filter(Boolean)));
      select.innerHTML='<option value="">'+esc(et("allAoIs"))+"</option>";
      aois.forEach(aoi=>select.appendChild(new Option(aoi,aoi)));
      if(aois.includes(previous))select.value=previous;
      const output=document.getElementById("eye-aoi-state");if(output)output.value=select.value||et("allAoIs");
    };
    const updateAll=()=>{
      const sceneRecording=document.getElementById("eye-scene-recording");
      if(sceneRecording&&Array.from(sceneRecording.options).some(option=>option.value===currentRecording())
        &&sceneRecording.value!==currentRecording()){
        sceneRecording.value=currentRecording();
        sceneRecording.dispatchEvent(new Event("change",{bubbles:true}));
      }
      updateQuality();updateMetadata();updateStructures();updateAoiOptions();
      updateReferenceSummary();updateReferenceTables();
      const points=recordData().points,cursor=+document.getElementById("eye-cursor")?.value||0;
      updateFrameTelemetry(+(points[cursor]?.timestamp||0));
      window.setTimeout(buildExtraPlots,0);
    };
    const setTime=time=>{
      const data=recordData(),cursor=document.getElementById("eye-cursor");if(!cursor||!data.points.length)return;
      const nearest=data.points.reduce((best,row,index)=>{const distance=Math.abs(+(row.sync_timestamp??row.timestamp)-time);return distance<best.distance?{index,distance}:best;},{index:0,distance:Infinity});
      cursor.value=nearest.index;cursor.dispatchEvent(new Event("input",{bubbles:true}));
    };

    document.getElementById("eye-aoi-filter")?.addEventListener("change",event=>{
      const output=document.getElementById("eye-aoi-state");if(output)output.value=event.target.value||et("allAoIs");
      buildExtraPlots();
    });
    document.getElementById("eye-events-show-all")?.addEventListener("click",()=>{
      const select=document.querySelector("#eye-events-table .eye-table-size select");
      if(select){select.value="50";select.dispatchEvent(new Event("change",{bubbles:true}));}
      document.getElementById("eye-events-table")?.scrollIntoView({behavior:"smooth",block:"start"});
    });
    document.addEventListener("eye:tablerowselect",event=>{
      if(event.detail?.hostId!=="eye-events-table"||!event.detail.row)return;
      setTime(+(event.detail.row.start_timestamp??0));
      const section=document.getElementById("eye-events-aoi");
      let selection=section?.querySelector(".eye-selected-event");
      if(section&&!selection){selection=document.createElement("output");selection.className="eye-selected-event";section.querySelector(".eye-table-actions")?.appendChild(selection);}
      if(section)section.dataset.eyeSelectedEvent=event.detail.row.event_id||"Event";
      const saveEvent=section?.querySelector(".eye-save-selected-event");if(saveEvent)saveEvent.disabled=false;
      if(selection)selection.value=(event.detail.row.event_id||"Event")+" · "+format(event.detail.row.start_timestamp)+" s";
    });
    document.addEventListener("eye:cursor",event=>{
      const time=+event.detail?.time||0,output=document.getElementById("eye-mini-time");if(output)output.value=format(time)+" s";
      updateFrameTelemetry(time);
      ["eye-chart-timeline","eye-frame-orientation","eye-frame-error-confidence","eye-frame-events"].forEach(id=>{
        const node=document.getElementById(id);if(!node?.data)return;
        const shapes=(node.layout?.shapes||[]).filter(shape=>shape.name!=="shared_cursor");
        shapes.push({name:"shared_cursor",type:"line",x0:time,x1:time,y0:0,y1:1,yref:"paper",line:{color:"#ef5b69",width:2,dash:"dot"}});
        try{Plotly.relayout(node,{shapes});}catch(_error){/* chart may be re-rendering */}
      });
    });
    document.getElementById("eye-recording")?.addEventListener("change",()=>window.setTimeout(updateAll,0));
    document.addEventListener("dm:modelschange",()=>window.setTimeout(updateAll,0));
    document.addEventListener("dm:langchange",()=>window.setTimeout(()=>{localize();updateAll();renderEvidence();},0));
    ledger.addEventListener("toggle",()=>{ledger.classList.toggle("is-open",ledger.open);ledgerBackdrop.hidden=!ledger.open;});
    localize();renderEvidence();window.setTimeout(updateAll,80);
  }
  function boot(){
    const main=document.querySelector("main");if(!main||main.querySelector(".dm-v2-shell"))return;
    prepareEyePanel(main);
    const hero=main.querySelector(".hero")||main.querySelector("header")||main.firstElementChild;
    if(hero)hero.classList.add("dm-v2-compact-hero");
    shell=document.createElement("div");shell.className="dm-v2-shell";main.insertBefore(shell,hero?hero.nextSibling:main.firstChild);
    const documentHeading=document.createElement("h1");
    documentHeading.className="dm-v2-sr-only";
    documentHeading.dataset.v2PanelHeading="1";
    documentHeading.textContent=tr("panelHeading",{task:panelTaskLabel()});
    shell.appendChild(documentHeading);
    const legacyNav=main.querySelector(".section-nav");if(legacyNav)legacyNav.remove();
    const legacyFilter=main.querySelector(".filter-dock");
    shell.append(buildNav(),buildTools(hero),buildFilters(legacyFilter));
    removeLegacyComparison(main);
    if(singleModelTask)main.querySelectorAll(".comparison-section").forEach(node=>node.remove());
    if(DATA.task==="ocr"){
      main.querySelectorAll(".normalization-panel").forEach(node=>node.remove());
    }
    main.querySelectorAll(".compare-active").forEach(node=>node.classList.remove("compare-active"));
    main.querySelectorAll(".binary-cases-workspace,.age-cases-workspace,.ocr-cases-workspace").forEach(node=>node.remove());
    main.querySelectorAll(".model-case-table").forEach(node=>node.remove());
    main.querySelectorAll(".multiclass-error-pairs").forEach(node=>node.remove());
    const evaluation=document.createElement("section");evaluation.className="dm-v2-view dm-v2-evaluation-view";evaluation.dataset.view="evaluation";
    evaluation.append(viewHeader("evaluation"));
    Array.from(main.children).filter(node=>node!==hero&&node!==shell).forEach(node=>evaluation.appendChild(node));
    compactLegacyIntervals(evaluation);
    if(DATA.worst_case.enabled)evaluation.appendChild(buildWorst());
    buildEvaluationIndex(evaluation);
    views={evaluation,table:buildTableView(),statistics:buildStatisticsView()};
    new MutationObserver(()=>{
      removeLegacyComparison(evaluation);
      qualifyPlotLandmarks(evaluation);

      scheduleEditorialPolish(evaluation);
    }).observe(evaluation,{
      childList:true,
      subtree:true,
      attributes:true,
      attributeFilter:["aria-label","role"],
    });
    shell.append(views.evaluation,views.table,views.statistics);
    const footer=document.createElement("footer");footer.className="dm-v2-footer";footer.innerHTML=
      '<div><strong>Metrics Studio</strong><span>'+esc(tr("ready"))+'</span></div><div><span>'+
      esc(tr("version"))+"</span><strong>"+esc(CFG.package_version||"dev")+"</strong></div>";shell.appendChild(footer);
    composeResearchWorkbench(hero);
    composeEyeTrackingApplication(hero);
    const comparisonControls=document.createElement('section');
    const renderComparisonControls=window.DM_COMPARISON.mount(comparisonControls,manager,experiments,tr,()=>({
      table:state.view==='evaluation'?views.evaluation.querySelector('.model-metrics-table,.dm-comparison-table'):null,
      view:views[state.view],
    }));
    renderModelSelectors=()=>{renderComparisonControls();window.DM_COMPARISON.presentation(shell,manager);};
    comparisonReflow=window.DM_COMPARISON.layout(shell,manager,comparisonConfig);
    manager.subscribe((_state,kind)=>{if(kind==="preferences"){renderModelSelectors();window.DM_COMPARISON.presentation(shell,manager);return;}state.page=0;refreshAll();});
    buildModal();refreshAll();switchView("evaluation");
    window.DM_I18N?.apply?.();
    document.addEventListener("pointerdown",event=>{
      if(event.target.closest?.(".js-plotly-plot"))return;
      shell.querySelectorAll(".dm-v2-chart-active").forEach(plot=>plot.classList.remove("dm-v2-chart-active"));
    });
    setTimeout(()=>{
      compactLegacyIntervals(evaluation);applyModelVisibility();qualifyPlotLandmarks(evaluation);
      labelAggregates();scheduleEditorialPolish(shell);schedulePlotlyReflow();
    },1400);
    window.DM_V2_REPORT={
      switchView,
      getState:()=>({...state,activeIds:activeIds()}),
    };
    window.__DM_V2_READY__=true;
  }
  function localizeShell(){
    if(!shell)return;
    const panelHeading=shell.querySelector("[data-v2-panel-heading]");
    if(panelHeading)panelHeading.textContent=tr("panelHeading",{task:panelTaskLabel()});
    shell.querySelectorAll("[data-v2-view]").forEach(button=>{
      const label=button.querySelector("[data-v2-nav-label]");
      if(label)label.textContent=tr(button.dataset.v2View);
    });
    shell.querySelectorAll("[data-v2-text]").forEach(node=>node.textContent=tr(node.dataset.v2Text));
    shell.querySelectorAll("[data-v2-placeholder]").forEach(node=>node.placeholder=tr(node.dataset.v2Placeholder));
    shell.querySelectorAll("[data-v2-aria-label]").forEach(node=>node.setAttribute("aria-label",tr(node.dataset.v2AriaLabel)));
    shell.querySelectorAll("[data-v2-alt]").forEach(node=>node.setAttribute("alt",tr(node.dataset.v2Alt)));
    shell.querySelectorAll("option[data-v2-option-text]").forEach(option=>{
      option.textContent=tr(option.dataset.v2OptionText);
    });
    const footer=shell.querySelector(".dm-v2-footer");
    if(footer)footer.innerHTML='<div><strong>Metrics Studio</strong><span>'+esc(tr("ready"))+
      '</span></div><div><span>'+esc(tr("version"))+"</span><strong>"+
      esc(CFG.package_version||"dev")+"</strong></div>";
    localizeEvaluationIndex();
  }
  document.addEventListener("dm:langchange",()=>{renderModelSelectors();localizeShell();renderTable();renderStatistics();renderWorst();renderAggregateComparison();renderModelSelectors();setTimeout(()=>{applyModelVisibility();schedulePlotlyReflow();},0);});
  document.addEventListener("dm:decimalschange",()=>{compactLegacyIntervals(document);renderStatistics();setTimeout(()=>{applyModelVisibility();schedulePlotlyReflow();},0);});
  document.addEventListener("dm:v2filterschange",()=>setTimeout(()=>{applyModelVisibility();renderAggregateComparison();renderModelSelectors();labelAggregates();schedulePlotlyReflow();},0));
  document.addEventListener("dm:taskmetricschange",()=>{renderAggregateComparison();renderModelSelectors();window.DM_COMPARISON.presentation(shell,manager);});
  document.addEventListener("dm:comparisonready",()=>renderModelSelectors());
  document.addEventListener("dm:thresholdsupdated",()=>window.DM_COMPARISON.presentation(shell,manager));
  document.addEventListener("dm:cichange",()=>{if(shell)window.DM_COMPARISON.presentation(shell,manager);});
  document.addEventListener("dm:modelschange",schedulePlotlyReflow);
  window.addEventListener("resize",schedulePlotlyReflow);
  function safeBoot(){try{boot();}catch(error){window.DM_COMPARISON.showError();console.error(error);}}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",safeBoot);else safeBoot();
})();
