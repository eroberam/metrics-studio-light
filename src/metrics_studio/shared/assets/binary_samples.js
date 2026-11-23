/* Complete, threshold-aware Binary sample explorer. Private HTML contract only. */
(function(host){
  "use strict";
  function classify(label,score,threshold,higher=true){
    if(![0,1].includes(label)||!Number.isFinite(score)||!Number.isFinite(threshold))return {prediction:null,result:null};
    const prediction=Number(higher?score>=threshold:score<=threshold);
    return {prediction,result:label?(prediction?"TP":"FN"):(prediction?"FP":"TN")};
  }
  function csvCell(value){
    let text=value==null?"":String(value);
    // Protect spreadsheet users from formulas embedded in record IDs/metadata.
    if(typeof value!=="number"&&/^[\s]*[=+@-]/.test(text))text="'"+text;
    return /[",\r\n]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;
  }
  function csv(rows,columns){return "\ufeff"+[columns.map(csvCell).join(","),...rows.map(row=>columns.map(key=>csvCell(row[key])).join(","))].join("\r\n");}
  const api={classify,csv};host.DM_BINARY_SAMPLES=api;
  api.mount=({data,manager,getRows})=>{
    const t=(key,args)=>host.DM_I18N.t("sampleExplorer."+key,args);
    const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
    const fmt=(v,kind="num")=>v==null?host.DM_I18N.t("v2.notAvailable"):host.DM_FMT.fmt(v,kind);
    const config=data.worst_case,selected=new Set(),failedImages=new Set();
    const state={model:manager.getDetailId(),query:"",result:"all",truth:"all",score:"all",min:"",max:"",sort:"score",desc:true,page:0,size:10,cohort:null};
    const defaultColumns=["preview","record","ground_truth","prediction","score","result"];
    let visible=new Set(defaultColumns),customColumns=false,frame=0,lastRows=[],lastPage=[],lastScope=[];
    const view=el("section","dm-v2-view dm-v2-table-view dm-sample-view");view.dataset.view="table";view.hidden=true;
    const section=el("section","dm-sample-explorer");section.id="binary-sample-explorer";
    const heading=el("header","dm-sample-heading"),title=el("h2",null,t("title"));title.id="sample-explorer-title";
    heading.append(title,el("p",null,t("subtitle")));section.setAttribute("aria-labelledby",title.id);
    const tabs=el("div","dm-sample-models");tabs.setAttribute("role","tablist");tabs.setAttribute("aria-label",t("models"));
    const summary=el("p","dm-sample-summary");summary.setAttribute("role","status");summary.setAttribute("aria-live","polite");
    const toolbar=el("div","dm-sample-toolbar"),search=el("input");search.type="search";search.placeholder=t("search");search.setAttribute("aria-label",t("search"));search.dataset.sampleControl="search";
    const searchWrap=el("label","dm-sample-search");const searchIcon=el("span");searchIcon.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>';searchWrap.append(searchIcon,search);toolbar.append(searchWrap);
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;if(!view.hidden)render();});};
    const resetPage=()=>{state.page=0;schedule();};
    search.addEventListener("input",()=>{state.query=search.value;resetPage();});
    function select(key,caption,options){
      const label=el("label","dm-sample-control"),select=el("select");select.dataset.sampleControl=key;
      label.append(el("span",null,caption),select);for(const [value,text]of options)select.add(new Option(text,value));
      select.value=String(state[key]);select.addEventListener("change",()=>{state[key]=select.value;resetPage();});toolbar.append(label);return select;
    }
    select("result",t("result"),[["all",t("all")],["errors",t("errors")],["correct",t("correct")],...['TP','FP','TN','FN'].map(key=>[key,t(key)])]);
    const truth=select("truth",t("trueClass"),[["all",t("all")]]);
    select("score",t("score"),[["all",t("all")],["below",t("below")],["above",t("above")],["range",t("range")]]);
    const range=el("div","dm-sample-range");range.hidden=true;
    for(const key of ["min","max"]){const input=el("input");input.type="number";input.step="any";input.placeholder=t(key);input.setAttribute("aria-label",t(key));input.dataset.sampleControl=key;
      input.addEventListener("input",()=>{state[key]=input.value;resetPage();});range.append(input);}toolbar.append(range);
    const sort=select("sort",t("sortBy"),["score","record","result","ground_truth","prediction","threshold","model"].map(key=>[key,t(key)]));
    const direction=el("button","dm-sample-direction","↓");direction.type="button";direction.dataset.sampleControl="direction";
    direction.addEventListener("click",()=>{state.desc=!state.desc;resetPage();});toolbar.append(direction);
    const columnControl=el("details","dm-sample-columns"),columnTitle=el("summary"),columnMenu=el("div","dm-sample-column-menu");
    columnControl.dataset.sampleControl="columns";columnControl.append(columnTitle,columnMenu);toolbar.append(columnControl);
    const exportButton=el("button","dm-sample-export",t("export"));exportButton.type="button";exportButton.dataset.sampleControl="export";toolbar.append(exportButton);
    const selection=el("div","dm-sample-selection");selection.hidden=true;
    const selectionText=el("span"),clearSelection=el("button",null,t("clearSelection"));clearSelection.type="button";clearSelection.dataset.sampleControl="clear-selection";
    clearSelection.addEventListener("click",()=>{selected.clear();renderSelection();});selection.append(selectionText,clearSelection);
    const cohort=el("div","dm-sample-cohort");cohort.hidden=true;
    const wrap=el("div","dm-v2-table-wrap dm-sample-table-wrap"),table=el("table","dm-sample-table"),thead=el("thead"),tbody=el("tbody");
    table.setAttribute("aria-labelledby",title.id);table.append(thead,tbody);wrap.append(table);
    const pager=el("footer","dm-sample-pager");pager.setAttribute("aria-label",t("pagination"));
    section.append(heading,tabs,summary,toolbar,cohort,selection,wrap,pager);view.append(section);
    const dialog=el("dialog","dm-sample-dialog"),dialogHead=el("header"),dialogTitle=el("h2",null,t("details")),close=el("button",null,"×"),dialogBody=el("div","dm-sample-detail-body");
    dialogTitle.id="sample-detail-title";dialog.setAttribute("aria-labelledby",dialogTitle.id);close.type="button";close.setAttribute("aria-label",t("close"));close.addEventListener("click",()=>dialog.close());
    dialogHead.append(dialogTitle,close);dialog.append(dialogHead,dialogBody);view.append(dialog);
    dialog.addEventListener("click",event=>{if(event.target===dialog)dialog.close();});let detailKey=null,opener=null;
    dialog.addEventListener("close",()=>{detailKey=null;opener?.focus({preventScroll:true});});
    function className(exp,label){
      return exp.sample_class_names?.[label]||t(label?"positive":"negative",{label:label?config.positive_label:config.negative_label});
    }
    function rows(){
      const models=manager.getActiveExperiments().filter(exp=>state.model==="all"||exp.id===state.model);
      return models.flatMap(exp=>{
        const threshold=manager.getThreshold(exp.id)??config.decision_threshold;
        return getRows(exp).map((source,index)=>{
          const label=source._binary_label,score=typeof source.score==="number"?source.score:null;
          const result=classify(label,score,threshold,config.positive_if_higher_score);
          const row={...source,_key:JSON.stringify([exp.id,source._sample_index??index]),model_id:exp.id,model:exp.name,
            record:String(source.record_id??source.sample_id??source._sample_index??index),ground_truth:className(exp,label),prediction:result.prediction==null?null:className(exp,result.prediction),
            score,threshold,result:result.result,ground_truth_label:label==null?null:(label?config.positive_label:config.negative_label),
            predicted_label:result.prediction==null?null:(result.prediction?config.positive_label:config.negative_label)};
          row._image=host.DM_PATH_IMAGES.imageSource(source._image);return row;
        });
      });
    }
    function filterRows(scope){
      const terms=state.query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
      return scope.filter(row=>{
        if(state.result==="errors"&&!['FP','FN'].includes(row.result))return false;
        if(state.result==="correct"&&!['TP','TN'].includes(row.result))return false;
        if(['TP','FP','TN','FN'].includes(state.result)&&row.result!==state.result)return false;
        if(state.truth!=="all"&&row._binary_label!==Number(state.truth))return false;
        if(state.score!=="all"&&row.score==null)return false;
        if(state.score==="below"&&row.score>=row.threshold)return false;
        if(state.score==="above"&&row.score<row.threshold)return false;
        if(state.score==="range"&&((state.min!==""&&row.score<Number(state.min))||(state.max!==""&&row.score>Number(state.max))))return false;
        if(state.cohort&&!state.cohort.every(item=>String(row[item.dimension]==null||row[item.dimension]===""?"UNKNOWN":row[item.dimension])===String(item.value)))return false;
        return terms.every(term=>Object.entries(row).some(([key,value])=>!key.startsWith("_")&&String(value??"").toLocaleLowerCase().includes(term)));
      }).sort((a,b)=>{
        const x=a[state.sort],y=b[state.sort];if(x==null||y==null)return x==null?(y==null?0:1):-1;
        const numeric=String(x).trim()!==""&&String(y).trim()!==""&&Number.isFinite(Number(x))&&Number.isFinite(Number(y));
        const order=numeric?Number(x)-Number(y):String(x).localeCompare(String(y),undefined,{numeric:true});
        return (state.desc?-order:order)||a._key.localeCompare(b._key);
      });
    }
    const labelFor=key=>defaultColumns.includes(key)||['model','threshold','path'].includes(key)?t(key):t("sourceColumn",{name:key});
    function columns(){
      const keys=new Set(lastScope.flatMap(row=>Object.keys(row).filter(key=>!key.startsWith("_")&&!['model_id','record_id','sample_id','label','ground_truth_label','predicted_label'].includes(key))));
      return [...new Set([...defaultColumns,"model","threshold",...keys])];
    }
    function shownColumns(){const names=columns();return names.filter(key=>visible.has(key)||(key==="model"&&state.model==="all"&&!customColumns));}
    function renderColumnMenu(){
      const open=columnControl.open,controlFocused=columnControl.contains(document.activeElement),focused=document.activeElement?.dataset.sampleColumn;
      columnTitle.textContent=t("columns")+" · "+t(customColumns?"custom":"default");columnMenu.replaceChildren();
      const presets=el("div","dm-sample-column-presets");
      for(const key of ["default","all"]){const button=el("button",null,t(key));button.type="button";button.addEventListener("click",()=>{visible=new Set(key==="all"?columns():defaultColumns);customColumns=key!=="default";render();});presets.append(button);}columnMenu.append(presets);
      columns().forEach(key=>{const label=el("label"),input=el("input");input.type="checkbox";input.checked=shownColumns().includes(key);input.disabled=key==="record";input.dataset.sampleColumn=key;
        input.addEventListener("change",()=>{visible=new Set(shownColumns());customColumns=true;if(input.checked)visible.add(key);else visible.delete(key);render();});label.append(input,document.createTextNode(labelFor(key)));columnMenu.append(label);});
      columnControl.open=open;if(focused)columnMenu.querySelector('[data-sample-column="'+CSS.escape(focused)+'"]')?.focus();else if(controlFocused)columnTitle.focus({preventScroll:true});
    }
    function renderTabs(){
      const focused=tabs.contains(document.activeElement),models=manager.getActiveExperiments();tabs.replaceChildren();
      for(const exp of [{id:"all",name:t("allModels")},...models]){
        const button=el("button",null,exp.name);button.type="button";button.dataset.sampleModel=exp.id;button.setAttribute("role","tab");button.setAttribute("aria-controls",section.id);
        button.setAttribute("aria-selected",String(exp.id===state.model));button.tabIndex=exp.id===state.model?0:-1;
        if(exp.id!=="all"){button.style.setProperty("--model-color",manager.getColor(exp.id));button.classList.add("dm-sample-model");button.title=t("modelThreshold",{model:exp.name,threshold:fmt(manager.getThreshold(exp.id)??config.decision_threshold,"threshold")});}
        button.addEventListener("click",()=>{state.model=exp.id;state.page=0;state.cohort=null;render();});tabs.append(button);
      }
      if(focused)tabs.querySelector('[aria-selected="true"]')?.focus({preventScroll:true});
    }
    tabs.addEventListener("keydown",event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
      const buttons=[...tabs.children],index=buttons.indexOf(event.target),next=event.key==="Home"?0:event.key==="End"?buttons.length-1:(index+(event.key==="ArrowRight"?1:-1)+buttons.length)%buttons.length;
      buttons[next].click();tabs.children[next].focus();
    });
    function noImage(){const missing=el("span","dm-sample-no-image","—");missing.setAttribute("aria-label",t("noImage"));missing.title=t("noImage");return missing;}
    function previewCell(row){
      if(!row._image||failedImages.has(row._image))return noImage();
      const button=el("button","dm-sample-preview"),image=el("img");button.type="button";button.setAttribute("aria-label",t("previewRecord",{record:row.record}));image.alt="";image.loading="lazy";image.decoding="async";button.append(image);
      image.addEventListener("error",()=>{failedImages.add(row._image);button.replaceWith(noImage());},{once:true});image.src=row._image;
      button.addEventListener("click",()=>openDetail(row,button));return button;
    }
    function valueNode(row,key){
      if(key==="preview")return previewCell(row);
      if(key==="record"){const display=/\.(jpe?g|png|tiff?|webp|bmp)$/i.test(row.record)?row.record.split(/[\\/]/).pop():row.record;const button=el("button","dm-sample-record",display);button.type="button";button.title=row.record;button.addEventListener("click",()=>openDetail(row,button));return button;}
      if(key==="result"){const badge=el("span","dm-sample-result "+(row.result||"unavailable"),row.result||host.DM_I18N.t("v2.notAvailable"));badge.title=row.result?t("meaning"+row.result):"";return badge;}
      return document.createTextNode(key==="score"||key==="threshold"?fmt(row[key],key==="threshold"?"threshold":"num"):String(row[key]??host.DM_I18N.t("v2.notAvailable")));
    }
    function renderSelection(){
      const matching=lastRows.filter(row=>selected.has(row._key));selection.hidden=!selected.size;
      selectionText.textContent=t("selectionCount",{n:matching.length,total:selected.size});exportButton.textContent=t(matching.length?"exportSelected":"export",{n:matching.length});exportButton.disabled=!lastRows.length;
      tbody.querySelectorAll("tr[data-sample-key]").forEach(tr=>{const checked=selected.has(tr.dataset.sampleKey);tr.classList.toggle("is-selected",checked);tr.querySelector('[data-sample-check]').checked=checked;});
      const all=thead.querySelector("input"),count=lastPage.filter(row=>selected.has(row._key)).length;if(all){all.checked=!!lastPage.length&&count===lastPage.length;all.indeterminate=count>0&&count<lastPage.length;all.disabled=!lastPage.length;}
    }
    function renderTable(){
      const cols=shownColumns();thead.replaceChildren();tbody.replaceChildren();
      const head=el("tr"),checkHead=el("th"),all=el("input");all.type="checkbox";all.setAttribute("aria-label",t("selectPage"));all.dataset.sampleControl="select-page";
      all.addEventListener("change",()=>{lastPage.forEach(row=>all.checked?selected.add(row._key):selected.delete(row._key));renderSelection();});checkHead.append(all);head.append(checkHead);
      cols.forEach(key=>{const cell=el("th");cell.scope="col";cell.dataset.sampleColumn=key;
        if(key==="preview")cell.textContent=labelFor(key);else {const button=el("button",null,labelFor(key));button.type="button";button.dataset.sampleSort=key;
          const arrow=el("span","dm-sample-sort-arrow",state.sort===key?(state.desc?"↓":"↑"):"↕");arrow.setAttribute("aria-hidden","true");button.append(arrow);
          cell.setAttribute("aria-sort",state.sort===key?(state.desc?"descending":"ascending"):"none");
          button.addEventListener("click",()=>{state.desc=state.sort===key?!state.desc:false;state.sort=key;state.page=0;render();thead.querySelector('[data-sample-sort="'+CSS.escape(key)+'"]')?.focus({preventScroll:true});});cell.append(button);}head.append(cell);});thead.append(head);
      lastPage.forEach(row=>{const tr=el("tr");tr.dataset.sampleKey=row._key;tr.dataset.sampleResult=row.result||"";
        const cell=el("td"),input=el("input");input.type="checkbox";input.dataset.sampleCheck="1";input.setAttribute("aria-label",t("selectRecord",{record:row.record,model:row.model}));
        input.addEventListener("change",()=>{if(input.checked)selected.add(row._key);else selected.delete(row._key);renderSelection();});cell.append(input);tr.append(cell);
        cols.forEach(key=>{const cell=el("td");cell.dataset.column=key;cell.append(valueNode(row,key));tr.append(cell);});tbody.append(tr);});
      if(!lastPage.length){const tr=el("tr"),cell=el("td","dm-sample-empty",t("noRows"));cell.colSpan=cols.length+1;tr.append(cell);tbody.append(tr);}renderSelection();
    }
    function openDetail(row,button){detailKey=row._key;opener=button;renderDetail(row);dialog.showModal();}
    function renderDetail(row){
      dialogBody.replaceChildren();if(!row){dialogBody.append(el("p",null,t("detailFiltered")));return;}
      const visual=el("div","dm-sample-detail-image");if(row._image&&!failedImages.has(row._image)){const image=el("img");image.alt=t("previewRecord",{record:row.record});image.addEventListener("error",()=>{failedImages.add(row._image);visual.replaceChildren(el("p",null,t("noImage")));},{once:true});image.src=row._image;visual.append(image,el("small",null,t("pathPreview")));}else visual.append(el("p",null,t("noImage")));
      const fields=el("dl");for(const key of ["record","model","ground_truth","prediction","score","threshold","result","path"]){fields.append(el("dt",null,labelFor(key)));const value=el("dd");value.append(valueNode(row,key==="record"?"path":key));if(key==="record")value.textContent=row.record;fields.append(value);}dialogBody.append(visual,fields);
    }
    exportButton.addEventListener("click",()=>{
      const matching=lastRows.filter(row=>selected.has(row._key)),rows=matching.length?matching:lastRows;
      const cols=[...new Set(["model_id","model","record","ground_truth_label","predicted_label","score","threshold","result",...shownColumns().filter(key=>key!=="preview")])];
      const blob=new Blob([csv(rows,cols)],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),link=el("a");link.href=url;link.download="samples_binary.csv";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    function render(){
      if(!manager.getActiveIds().includes(state.model)&&state.model!=="all")state.model=manager.getDetailId();
      renderTabs();lastScope=rows();lastRows=filterRows(lastScope);range.hidden=state.score!=="range";toolbar.classList.toggle("has-range",!range.hidden);if(![...sort.options].some(option=>option.value===state.sort))sort.add(new Option(labelFor(state.sort),state.sort));sort.value=state.sort;
      direction.textContent=state.desc?"↓":"↑";direction.setAttribute("aria-label",t(state.desc?"descending":"ascending"));
      truth.replaceChildren(new Option(t("all"),"all"));const exp=manager.getActiveExperiments().find(e=>e.id===state.model)||manager.getActiveExperiments()[0];
      [0,1].forEach(label=>truth.add(new Option(className(exp,label),String(label))));truth.value=state.truth;
      const counts=Object.fromEntries(['TP','FP','TN','FN'].map(key=>[key,lastRows.filter(row=>row.result===key).length]));
      const parts=[t(state.model==="all"?"predictionsCount":"samplesCount",{n:lastRows.length}),...(state.model==="all"?[t("recordsCount",{n:new Set(lastRows.map(row=>row.record)).size})]:[]),
        t("errorsCount",{n:counts.FP+counts.FN}),...['TP','FP','TN','FN'].map(key=>t(key)+" "+counts[key]),t("imagesCount",{n:lastRows.filter(row=>row._image).length})];
      if(state.model!=="all")parts.push(t("thresholdValue",{value:fmt(manager.getThreshold(state.model)??config.decision_threshold,"threshold")}));
      summary.textContent=parts.join(" · ");
      cohort.replaceChildren();cohort.hidden=!state.cohort;if(state.cohort){cohort.append(el("span",null,t("cohort")+": "+state.cohort.map(i=>i.dimension+" = "+i.value).join(" · ")));const clear=el("button",null,t("clearCohort"));clear.type="button";clear.addEventListener("click",()=>{state.cohort=null;resetPage();});cohort.append(clear);}
      const pages=Math.max(1,Math.ceil(lastRows.length/state.size));state.page=Math.min(state.page,pages-1);lastPage=lastRows.slice(state.page*state.size,(state.page+1)*state.size);
      renderColumnMenu();renderTable();pager.replaceChildren();
      const caption=el("span",null,t("pageSummary",{start:lastRows.length?state.page*state.size+1:0,end:Math.min(lastRows.length,(state.page+1)*state.size),n:lastRows.length,total:lastScope.length}));pager.append(caption);
      const sizeLabel=el("label",null,t("pageSize")),size=el("select");size.dataset.sampleControl="page-size";for(const count of [10,25,50,100])size.add(new Option(String(count),String(count)));size.value=String(state.size);
      size.addEventListener("change",()=>{state.size=Number(size.value);state.page=0;render();});sizeLabel.append(size);pager.append(sizeLabel);
      for(const [delta,key]of [[-1,"previous"],[1,"next"]]){const button=el("button",null,t(key));button.type="button";button.dataset.samplePage=String(delta);button.disabled=delta<0?state.page===0:state.page===pages-1;button.addEventListener("click",()=>{state.page+=delta;render();pager.querySelector('[data-sample-page="'+delta+'"]')?.focus();});pager.append(button);}
      if(detailKey)renderDetail(lastScope.find(row=>row._key===detailKey));
    }
    manager.subscribeThresholds(()=>{state.page=0;schedule();});
    document.addEventListener("dm:decimalschange",schedule);
    document.addEventListener("pointerdown",event=>{if(!columnControl.contains(event.target))columnControl.open=false;});
    columnControl.addEventListener("keydown",event=>{if(event.key==="Escape"){columnControl.open=false;columnTitle.focus();}});
    return {view,render,openCohort(model,definition){state.model=model;state.cohort=definition||null;state.query="";search.value="";state.result="all";state.truth="all";state.score="all";for(const key of ["result","truth","score"])section.querySelector('[data-sample-control="'+key+'"]').value="all";state.page=0;render();}};
  };
})(typeof window==="undefined"?globalThis:window);
