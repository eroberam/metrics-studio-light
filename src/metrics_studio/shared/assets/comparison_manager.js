/* Shared comparison state. Model identity never depends on a display label. */
(function (host) {
  "use strict";
  const palette = ["#0F766E", "#4059A7", "#B66B18", "#7755A6", "#C65345", "#16859A", "#18845E", "#9A5B78"];
  function create(models, config = {}) {
    const registry = new Map(models.map(model => [model.id, model]));
    const loaded = [...registry.keys()];
    if (!loaded.length) throw new Error("comparison.emptyRegistry");
    const limit = Math.min(5, loaded.length, config.max_active || 5);
    const baseline = models.find(model => model.role === "baseline")?.id || loaded[0];
    const count = config.initial_active === "all" ? limit : Math.min(limit, config.initial_active || 5);
    let slots = Array.from({length:5},(_,index)=>[baseline,...loaded.filter(id=>id!==baseline)][index<count?index:-1]||null);
    let active = slots.filter(Boolean);
    let reference = active[0], detail = active[0], explicitReference = false;
    const listeners = new Set();
    let confidenceIntervals=true, highlightBest=true, thresholdMode="independent", commonThreshold=null;
    const initialThresholds=new Map(), independentThresholds=new Map(), thresholdBounds=new Map(), thresholdListeners=new Set();
    const effectiveThreshold=id=>thresholdMode==="synchronized"&&active.includes(id)?commonThreshold:independentThresholds.get(id);
    const snapshot = () => ({slots:slots.slice(), active:active.slice(), reference, detail, loaded:loaded.slice(), limit,
      confidenceIntervals,highlightBest,thresholdMode,thresholds:Object.fromEntries(loaded.filter(id=>initialThresholds.has(id)).map(id=>[id,effectiveThreshold(id)]))});
    const thresholdSnapshot=()=>({mode:thresholdMode,thresholds:snapshot().thresholds});
    const notifyThresholds=()=>thresholdListeners.forEach(listener=>listener(thresholdSnapshot()));
    const notify = (kind="models") => listeners.forEach(listener => listener(snapshot(),kind));
    const api = {
      getState: snapshot,
      setConfidenceIntervals(value){confidenceIntervals=!!value;notify("preferences");},
      setHighlightBest(value){highlightBest=!!value;notify("preferences");},
      registerThreshold(id,value,bounds){
        if(!registry.has(id)||!Number.isFinite(value)||initialThresholds.has(id))return false;
        initialThresholds.set(id,value);independentThresholds.set(id,value);thresholdBounds.set(id,bounds);return true;
      },
      hasThresholds:()=>active.some(id=>initialThresholds.has(id)),
      getThreshold:effectiveThreshold,
      getThresholdBounds(id){
        const ids=thresholdMode==="synchronized"?active:[id];
        const ranges=ids.map(key=>thresholdBounds.get(key)).filter(Boolean);
        const values=ids.map(effectiveThreshold).filter(Number.isFinite);
        return {min:Math.min(...ranges.map(r=>r.min),...values),max:Math.max(...ranges.map(r=>r.max),...values)};
      },
      setThreshold(id,value){
        if(!initialThresholds.has(id)||!Number.isFinite(value))return false;
        if(thresholdMode==="synchronized"&&active.includes(id))commonThreshold=value;
        else independentThresholds.set(id,value);
        notifyThresholds();return true;
      },
      setThresholdMode(mode){
        if(!["independent","synchronized"].includes(mode)||!api.hasThresholds())return false;
        if(mode===thresholdMode)return true;
        if(mode==="synchronized")commonThreshold=effectiveThreshold(reference);
        thresholdMode=mode;notifyThresholds();notify("preferences");return true;
      },
      resetThresholds(){
        initialThresholds.forEach((value,id)=>independentThresholds.set(id,value));
        if(thresholdMode==="synchronized")commonThreshold=initialThresholds.get(reference);
        notifyThresholds();
      },
      subscribeThresholds(listener){thresholdListeners.add(listener);return()=>thresholdListeners.delete(listener);},
      getActiveIds: () => active.slice(),
      getSlots: () => slots.slice(),
      getActiveExperiments: () => active.map(id => ({...registry.get(id)})),
      getReferenceId: () => reference,
      getDetailId: () => detail,
      isActive: id => active.includes(id),
      getColor: id => palette[Math.max(0, loaded.indexOf(id)) % palette.length],
      getDash: id => ["solid", "dash", "dot", "dashdot"][Math.floor(Math.max(0, loaded.indexOf(id))/palette.length)%4],
      setSlots(next) {
        if (!Array.isArray(next) || next.length !== 5) return false;
        const occupied=next.filter(id=>id!==null);
        if (!occupied.length || occupied.length>limit || new Set(occupied).size!==occupied.length || occupied.some(id=>!registry.has(id))) return false;
        if(next.every((id,index)=>id===slots[index]))return true;
        slots=next.slice();active=occupied;
        if (!active.includes(reference)) explicitReference = false;
        if (!explicitReference) reference = active.includes(baseline) ? baseline : active[0];
        if (!active.includes(detail)) detail = reference;
        notify(); if(thresholdMode==="synchronized")notifyThresholds(); return true;
      },
      setSlot(index,id) {
        if(!Number.isInteger(index)||index<0||index>=5)return false;
        const next=slots.slice();next[index]=id;return api.setSlots(next);
      },
      setActiveIds(ids) {
        if(!Array.isArray(ids)||ids.length>5||new Set(ids).size!==ids.length)return false;
        return api.setSlots(Array.from({length:5},(_,index)=>ids[index]??null));
      },
      add: id => api.setSlot(slots.indexOf(null),id),
      remove: id => api.setSlot(slots.indexOf(id),null),
      replace(id, replacement) {
        if (active.includes(replacement) && replacement !== id) return false;
        return api.setSlot(slots.indexOf(id),replacement);
      },
      setReference(id) { if (!active.includes(id)) return false; explicitReference=true; if(reference===id)return true;reference=id; notify(); return true; },
      setDetail(id) { if (!active.includes(id)) return false; if(detail===id)return true;detail=id; notify(); return true; },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    };
    return api;
  }

  function intervalsAvailable(){return [...document.querySelectorAll('.model-metrics-table .kpi-ci-range,.model-metrics-table .kpi-ci[data-state="recomputing"],.dm-comparison-table [data-comparison-ci],.model-metrics-table [data-comparison-ci]')].some(node=>!node.closest("td")?.hidden);}

  function mount(container, manager, models, t, destination=()=>({})) {
    const field=(key,options,value,change)=>{
      const label=document.createElement("label");label.className="dm-comparison-field";
      const text=document.createElement("span");text.textContent=t(key);label.append(text);
      const select=document.createElement("select");select.className="dm-v2-model-select";
      options.forEach(model=>select.add(new Option(model.name,model.id)));
      select.value=value;select.addEventListener("change",()=>change(select.value));label.append(select);return label;
    };
    return function render(){
      const state=manager.getState();
      const focused=document.activeElement?.dataset.comparisonFocus;
      // Header controls can live outside the strip, inside the metric table.
      document.querySelectorAll('[data-comparison-header-control]').forEach(node=>node.remove());
      container.replaceChildren();container.className="dm-comparison-selector";
      const heading=document.createElement("div");heading.className="dm-comparison-heading";
      const title=document.createElement("h2");title.textContent=t("modelComparison");
      const status=document.createElement("p");status.className="dm-comparison-status";status.setAttribute("role","status");
      status.textContent=t("activeModels",{active:state.active.length,loaded:state.loaded.length});
      heading.append(title,status);container.append(heading);
      const toolbar=document.createElement("div");toolbar.className="dm-comparison-toolbar";
      const toggle=(key,value,change,available=true)=>{
        const label=document.createElement("label");label.className="dm-comparison-switch";
        const text=document.createElement("span");text.textContent=t(key);
        const button=document.createElement("button");button.type="button";button.setAttribute("role","switch");
        button.setAttribute("aria-checked",String(value));button.setAttribute("aria-label",t(key));
        button.textContent=t(value?"controlOn":"controlOff");button.dataset.comparisonFocus=key;
        button.disabled=!available;if(!available)label.title=t("intervalsUnavailable");
        button.addEventListener("click",()=>change(!value));label.append(text,button);toolbar.append(label);
      };
      const available=intervalsAvailable();
      toggle("confidenceIntervals",state.confidenceIntervals,value=>manager.setConfidenceIntervals(value),available);
      toggle("highlightBest",state.highlightBest,value=>manager.setHighlightBest(value));
      if(manager.hasThresholds()){
        const thresholds=field("thresholds",[{id:"independent",name:t("thresholdIndependent")},{id:"synchronized",name:t("thresholdSynchronized")}],state.thresholdMode,mode=>manager.setThresholdMode(mode));
        thresholds.querySelector("select").dataset.comparisonFocus="threshold-mode";toolbar.append(thresholds);
        const reset=document.createElement("button");reset.type="button";reset.className="dm-comparison-reset";
        reset.textContent="↺ "+t("resetThresholds");reset.title=t("resetThresholdsHelp");reset.dataset.comparisonFocus="reset-thresholds";
        reset.addEventListener("click",()=>manager.resetThresholds());toolbar.append(reset);
      }
      container.append(toolbar);
      const list=document.createElement("div");list.className="dm-comparison-selection";
      const metric=document.createElement("span");metric.className="dm-comparison-leading";metric.textContent=t("metric");list.append(metric);
      const {table,view}=destination();
      if(table){
        table.classList.add("dm-comparison-primary");
        table.parentNode.insertBefore(container,table);
      }else if(view)view.prepend(container);
      state.slots.forEach((id,index)=>{
        const label=field("model",[{id:"",name:t("emptySlot")},...models.filter(model=>model.id===id||!state.active.includes(model.id))],id||"",value=>manager.setSlot(index,value||null));
        label.classList.add("dm-comparison-slot");label.dataset.comparisonHeaderControl="1";
        label.style.setProperty("--model-color",id?manager.getColor(id):"var(--line)");
        const select=label.querySelector("select");select.dataset.comparisonFocus="slot-"+index;
        select.setAttribute("aria-label",t("modelSlot",{slot:index+1}));select.title=models.find(model=>model.id===id)?.name||t("emptySlot");
        select.options[0].disabled=state.active.length===1&&id!==null;
        select.disabled=id===null&&state.active.length>=state.limit;
        const header=table?.querySelector('thead tr:first-child > [data-comparison-slot="'+index+'"]');
        if(header){header.replaceChildren(label);}else list.append(label);
      });
      if(!table)container.append(list);
      if(focused)document.querySelector('[data-comparison-focus="'+CSS.escape(focused)+'"]')?.focus({preventScroll:true});
    };
  }

  // Preserve the actual cell nodes (and their listeners) while placing five
  // fixed slots. Inactive values remain hidden in the DOM for live updates.
  const tableRows=new WeakMap();
  function tableSlots(table,models,slots){
    table.classList.add("dm-fixed-table");
    const sourceColumns=[...table.querySelectorAll('thead tr:first-child > [data-model-index]')].map(header=>({index:header.dataset.modelIndex,column:[...header.parentElement.children].indexOf(header)}));
    table.querySelectorAll("tr").forEach(row=>{
      let record=tableRows.get(row);
      if(!record){
        const children=[...row.children];
        sourceColumns.forEach(({index,column})=>{
          if(children[column]&&!children[column].hasAttribute("data-model-index")&&table.classList.contains("model-metrics-table"))children[column].dataset.modelIndex=index;
        });
        const groups=new Map();
        children.filter(cell=>cell.hasAttribute("data-model-index")).forEach(cell=>{
          const id=models[Number(cell.dataset.modelIndex)]?.id;
          if(id){if(!groups.has(id))groups.set(id,[]);groups.get(id).push(cell);}
        });
        if(!groups.size)return;
        const example=[...groups.values()][0];
        record={groups,placeholders:Array.from({length:5},()=>example.map(cell=>{
          const blank=document.createElement(cell.tagName.toLowerCase());
          blank.colSpan=cell.colSpan;blank.className="dm-slot-empty";blank.setAttribute("aria-label",host.DM_I18N?.t("v2.emptySlot")||"");
          return blank;
        }))};tableRows.set(row,record);
      }
      const ordered=[];
      slots.forEach((id,index)=>{
        const cells=record.groups.get(id)||record.placeholders[index];
        cells.forEach((cell,part)=>{cell.hidden=false;cell.style.removeProperty("display");cell.dataset.comparisonSlot=String(index);cell.classList.toggle("dm-group-start",part===0);cell.classList.toggle("dm-group-end",part===cells.length-1);ordered.push(cell);});
      });
      record.groups.forEach((cells,id)=>{if(!slots.includes(id))cells.forEach(cell=>{cell.hidden=true;cell.style.display="none";delete cell.dataset.comparisonSlot;ordered.push(cell);});});
      record.placeholders.flat().forEach(cell=>{if(!ordered.includes(cell))cell.remove();});
      const existing=[...row.children].filter(cell=>cell.hasAttribute("data-model-index")||cell.classList.contains("dm-slot-empty"));
      if(ordered.some((cell,index)=>cell!==existing[index])||ordered.length!==existing.length)ordered.forEach(cell=>row.append(cell));
    });
  }

  function presentation(root,manager){
    if(!root)return;
    const state=manager.getState();
    root.querySelectorAll('[data-comparison-focus="confidenceIntervals"]').forEach(button=>{
      button.disabled=!intervalsAvailable();
      button.parentElement.title=button.disabled?host.DM_I18N.t("v2.intervalsUnavailable"):"";
    });
    root.querySelectorAll(".dm-comparison-primary").forEach(table=>{
      table.classList.toggle("dm-hide-intervals",!state.confidenceIntervals);
      table.querySelectorAll(".dm-metric-best").forEach(cell=>{cell.classList.remove("dm-metric-best");cell.removeAttribute("title");cell.removeAttribute("aria-label");});
      if(!state.highlightBest)return;
      table.querySelectorAll("tbody tr").forEach(row=>{
        const cells=[...row.querySelectorAll("td[data-comparison-slot]")].filter(cell=>!cell.hidden);
        const values=cells.flatMap(cell=>{
          const node=cell.matches("[data-compare-raw]")?cell:cell.querySelector("[data-compare-raw]");
          const raw=node?.getAttribute("data-compare-raw"),direction=node?.dataset.better;
          if(raw==null||raw.trim()===""||!Number.isFinite(Number(raw))||!["higher","lower"].includes(direction))return [];
          return [{cell,value:Number(raw),direction}];
        });
        if(values.length<2||new Set(values.map(item=>item.direction)).size!==1)return;
        const best=(values[0].direction==="higher"?Math.max:Math.min)(...values.map(item=>item.value));
        values.filter(item=>Math.abs(item.value-best)<=1e-12*Math.max(1,Math.abs(best))).forEach(({cell})=>{
          cell.classList.add("dm-metric-best");
          const label=host.DM_I18N.t("v2.bestObserved");cell.title=label;cell.setAttribute("aria-label",cell.innerText.trim()+". "+label);
        });
      });
    });
  }

  function matrixSlots(grid,models,slots){
    const cards=[...grid.children].filter(node=>node.dataset.modelId);
    grid.querySelectorAll(".dm-slot-empty").forEach(node=>node.remove());
    slots.forEach((id,index)=>{
      const modelIndex=models.findIndex(model=>model.id===id);
      const card=id?cards.find(node=>node.dataset.modelId==="model-"+modelIndex):null;
      if(card){card.hidden=false;card.dataset.comparisonSlot=String(index);grid.append(card);}
      else{const blank=document.createElement("div");blank.className="dm-slot-empty";blank.dataset.comparisonSlot=String(index);blank.setAttribute("role","group");blank.setAttribute("aria-label",host.DM_I18N?.t("v2.emptySlot")||"");grid.append(blank);}
    });
    cards.filter(card=>!slots.includes(models[Number(card.dataset.modelId.replace("model-",""))]?.id)).forEach(card=>{card.hidden=true;grid.append(card);});
  }

  function layout(root, manager) {
    let pending=0;
    const observed=new WeakSet();
    const reflow=()=>{
      pending=0;
      root.querySelectorAll('[data-comparison="per_model"]').forEach(grid=>{
        if(!observed.has(grid)){observer.observe(grid);observed.add(grid);}
        // Section contracts decide full-width diagnostics, never viewport or
        // active model count. Other independent diagnostics use two columns.
        const columns=Number(grid.dataset.comparisonMinWidth)>600?1:2;
        if(grid.style.getPropertyValue("--comparison-columns")!==String(columns))grid.style.setProperty("--comparison-columns",String(columns));
      });
      root.querySelectorAll(".js-plotly-plot").forEach(plot=>{
        if(!observed.has(plot)){observer.observe(plot);observed.add(plot);}
        if(plot.data&&!plot.closest(".dm-comparison-facets")&&!plot.closest("[data-experiment-id]")){
          if(plot.data.some(trace=>trace.meta?.experiment_id||trace.meta?.experiment_ids))
            plot.dataset.comparison=plot.data.some(trace=>trace.meta?.experiment_ids?.length>1)?"pairwise":"overlay";
        }
        if(plot.getBoundingClientRect().width&&plot.getBoundingClientRect().height&&host.Plotly&&!plot.closest("[hidden]")){
          const width=Math.round(plot.getBoundingClientRect().width);
          if(plot.dataset.comparisonWidth!==String(width)){plot.dataset.comparisonWidth=String(width);resize(plot).catch(()=>{});}
        }
      });
    };
    const schedule=()=>{if(!pending)pending=requestAnimationFrame(reflow);};
    const observer=new ResizeObserver(schedule);observer.observe(root);manager.subscribe(schedule);
    document.addEventListener("dm:comparisonlayout",schedule);schedule();return schedule;
  }

  const pendingPlots=new WeakMap();
  const operations=new WeakMap();
  function track(plot,operation){
    let active=operations.get(plot);if(!active){active=new Set();operations.set(plot,active);}
    const promise=Promise.resolve(operation);active.add(promise);
    promise.then(()=>active.delete(promise),()=>active.delete(promise));return promise;
  }
  let lifecycleInstalled=false;
  function installLifecycle(){
    if(lifecycleInstalled||!host.Plotly)return;lifecycleInstalled=true;
    // Track public Plotly jobs, including translations and restyles scheduled
    // by other shared modules, before releasing a retired comparison plot.
    for(const method of ['react','newPlot','restyle','relayout','redraw']){
      const original=host.Plotly[method];if(!original)continue;
      host.Plotly[method]=function(target,...args){
        const plot=typeof target==='string'?document.getElementById(target):target;
        const managed=plot?.classList?.contains('dm-comparison-plot')||plot?.parentElement?.classList.contains('dm-comparison-original-scroll');
        if(!managed)return original.call(this,target,...args);
        if(plot.dataset.comparisonDisposed)return Promise.resolve(plot);
        // ResizeObserver owns sizing; a second responsive window handler can
        // otherwise try to resize a plot after it has been hidden or retired.
        if(method==='react'||method==='newPlot')args[2]={...args[2],responsive:false};
        return track(plot,original.call(this,target,...args)).catch(error=>{
          if(plot.dataset.comparisonDisposed)return plot;
          throw error;
        });
      };
    }
  }
  function resize(plot){
    if(!plot?.isConnected||plot.dataset.comparisonDisposed||plot.closest('[hidden]')||!plot._fullLayout||!plot.getBoundingClientRect().width)return Promise.resolve();
    return track(plot,host.Plotly.Plots.resize(plot)).catch(error=>{
      if(!plot.isConnected||plot.dataset.comparisonDisposed||plot.closest('[hidden]')||!plot.getBoundingClientRect().width)return;
      throw error;
    });
  }
  let visibilityObserver;
  function renderVisible(target,render) {
    if(!visibilityObserver)visibilityObserver=new IntersectionObserver(entries=>{
      entries.filter(entry=>entry.isIntersecting).forEach(entry=>{
        const pending=pendingPlots.get(entry.target);if(!pending)return;
        pendingPlots.delete(entry.target);track(entry.target,pending()).catch(error=>console.error(error));
      });
    },{rootMargin:"200px"});
    pendingPlots.set(target,render);visibilityObserver.observe(target);
    const bounds=target.getBoundingClientRect();
    if(bounds.width && bounds.bottom>=-200 && bounds.top<=innerHeight+200 && !target.closest('[hidden]')){
      pendingPlots.delete(target);return track(target,render());
    }
  }
  function purgePlot(plot){
    visibilityObserver?.unobserve(plot);pendingPlots.delete(plot);plot.dataset.comparisonDisposed='1';
    Promise.allSettled([...(operations.get(plot)||[])]).then(()=>{
      // Plotly's internal hover/automargin timers run after its public promise.
      // Keep the retired node intact until that final browser task has drained.
      setTimeout(()=>host.Plotly?.purge(plot),200);
    });
  }
  function restorePlot(plot){
    plot.hidden=false;
    if(plot.parentElement?.classList.contains('dm-comparison-original-scroll'))plot.parentElement.hidden=false;
    const facets=document.getElementById(plot.id+"-models");
    if(facets){facets.querySelectorAll('.dm-comparison-plot').forEach(purgePlot);facets.remove();}
  }
  function perModel(baseId,models,render,options={}) {
    installLifecycle();
    const original=document.getElementById(baseId);if(!original)return;
    let originalScroll=original.parentElement;
    if(!originalScroll.classList.contains('dm-comparison-original-scroll')){
      originalScroll=document.createElement('div');originalScroll.className='dm-comparison-plot-scroll dm-comparison-original-scroll';
      originalScroll.tabIndex=0;originalScroll.setAttribute('role','region');
      original.after(originalScroll);originalScroll.append(original);
    }
    originalScroll.setAttribute('aria-label',original.getAttribute('aria-label')||models[0]?.name||baseId);
    original.style.setProperty('min-width',(options.minPlotWidth||440)+'px','important');
    original.style.setProperty('max-width','none','important');
    original.closest('.chart-card,.eye-eval-card,.seg-card')?.classList.toggle('has-model-facets',models.length>1);
    const stats=document.getElementById(baseId+'-stats');if(stats)stats.hidden=models.length>1;
    if(models.length<2){restorePlot(original);if(models[0])return renderVisible(original,()=>render(original,models[0]));return;}
    original.hidden=true;
    originalScroll.hidden=true;
    let grid=document.getElementById(baseId+"-models");
    if(!grid){grid=document.createElement("div");grid.id=baseId+"-models";grid.className="dm-comparison-facets";grid.dataset.comparison="per_model";originalScroll.after(grid);}
    if(options.minWidth)grid.dataset.comparisonMinWidth=options.minWidth;
    [...grid.children].forEach(article=>{if(!models.some(model=>model.id===article.dataset.experimentId)){article.querySelectorAll('.dm-comparison-plot').forEach(purgePlot);article.remove();}});
    models.forEach(model=>{
      let article=[...grid.children].find(node=>node.dataset.experimentId===model.id);
      if(!article){
        article=document.createElement("article");article.dataset.experimentId=model.id;
        const heading=document.createElement("h3");heading.textContent=model.name;
        const target=document.createElement("div");target.id=baseId+"-model-"+encodeURIComponent(model.id);target.className="dm-comparison-plot";target.style.minHeight="360px";target.tabIndex=0;target.setAttribute("role","region");target.setAttribute("aria-label",model.name);
        const scroll=document.createElement("div");scroll.className="dm-comparison-plot-scroll";
        scroll.tabIndex=0;scroll.setAttribute("role","region");scroll.setAttribute("aria-label",model.name);
        scroll.append(target);article.append(heading,scroll);
      }
      grid.append(article);article.hidden=false;
      const target=article.querySelector('.dm-comparison-plot');
      target.style.setProperty("min-width",(options.minPlotWidth||440)+"px","important");
      target.style.setProperty("max-width","none","important");
      renderVisible(target,()=>render(target,model));
    });
    document.dispatchEvent(new CustomEvent("dm:comparisonlayout"));
  }

  function showError() {
    const boot=()=>{
      const key="v2.initializationError";
      let message=host.DM_I18N?.t?.(key);
      if(!message||message===key){
        try{const dictionaries=JSON.parse(document.getElementById("i18n-data").textContent);message=dictionaries[document.documentElement.lang||"en"]?.[key];}catch(_error){/* language runtime will retry */}
      }
      const alert=document.createElement("div");alert.className="dm-comparison-error";alert.setAttribute("role","alert");alert.dataset.i18n=key;alert.textContent=message||key;
      document.body.prepend(alert);host.DM_I18N?.apply?.();
    };
    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
  }
  host.DM_COMPARISON= {create,mount,presentation,tableSlots,matrixSlots,layout,perModel,renderVisible,resize,showError};
})(typeof window === "undefined" ? globalThis : window);
