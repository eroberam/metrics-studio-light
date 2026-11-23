/* Binary curve workbench. Inputs use the same score direction and counts as
 * the report; this module owns presentation, not model/threshold selection. */
(function (host) {
  "use strict";
  function bound(sorted, value, inclusive) {
    let lo=0,hi=sorted.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(sorted[mid]<value||(inclusive&&sorted[mid]===value))lo=mid+1;else hi=mid;}
    return lo;
  }
  function point(positive, negative, threshold, higher) {
    const p=bound(positive,threshold,!higher),n=bound(negative,threshold,!higher);
    const tp=higher?positive.length-p:p,fp=higher?negative.length-n:n;
    const fn=positive.length-tp,tn=negative.length-fp,total=positive.length+negative.length;
    const div=(a,b)=>b?a/b:null;
    return {threshold,tp,fp,fn,tn,far:div(fn,positive.length),frr:div(fp,negative.length),
      recall:div(tp,positive.length),precision:div(tp,tp+fp),accuracy:div(tp+tn,total)};
  }
  function sweep(rows, thresholds, higher) {
    const positive=rows.filter(row=>row.label===1).map(row=>row.score).sort((a,b)=>a-b);
    const negative=rows.filter(row=>row.label===0).map(row=>row.score).sort((a,b)=>a-b);
    // ROC/DET cover all empirical score transitions, including tied extrema.
    const exact=[-Infinity,...new Set([...positive,...negative].sort((a,b)=>a-b)),Infinity];
    return {positive,negative,points:thresholds.map(t=>point(positive,negative,t,higher)),
      rocPoints:exact.map(t=>point(positive,negative,t,higher))};
  }
  // Acklam's inverse-normal approximation; tested against scipy.special.ndtri.
  function probit(p) {
    if(p<=0)return -Infinity;if(p>=1)return Infinity;
    const a=[-39.69683028665376,220.9460984245205,-275.9285104469687,138.3577518672690,-30.66479806614716,2.506628277459239];
    const b=[-54.47609879822406,161.5858368580409,-155.6989798598866,66.80131188771972,-13.28068155288572];
    const c=[-0.007784894002430293,-0.3223964580411365,-2.400758277161838,-2.549732539343734,4.374664141464968,2.938163982698783];
    const d=[0.007784695709041462,0.3224671290700398,2.445134137142996,3.754408661907416];
    if(p<.02425||p>1-.02425){const q=Math.sqrt(-2*Math.log(p<.5?p:1-p));const v=(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);return p<.5?v:-v;}
    const q=p-.5,r=q*q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }
  const api={sweep,point,probit};host.DM_BINARY_CURVES=api;
  if(typeof document==="undefined")return;
  const root=document.getElementById("binary-curves-workbench"),decision=document.getElementById("binary-threshold-workbench");
  if(!root||!decision)return;
  const data=JSON.parse(document.getElementById("dashboard-data").textContent);
  const state={view:"small",show:"both",scale:"linear",markers:true};
  const cache=new Map(),plots=new Set(),jobs=new Map(),ready=new Set();
  const t=(key,args)=>host.DM_I18N.t(key,args),txt=(key,args)=>t("panel.binary.curves."+key,args);
  const fmt=(v,kind="num")=>host.DM_FMT.fmt(v,kind);
  const color=id=>host.DM_V2_MODELS.getColor(id);
  const rates={far:"#1768e8",frr:"#dc435a"};
  const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  let frame=0;
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;render();});};
  const observer=new IntersectionObserver(entries=>{
    entries.filter(entry=>entry.isIntersecting).forEach(entry=>{ready.add(entry.target);flush(entry.target);});
  },{rootMargin:"160px"});
  function flush(plot){
    const job=jobs.get(plot);if(!job||plot.closest("[hidden]")||!plot.getBoundingClientRect().width||plot._binaryBusy)return;
    jobs.delete(plot);plot._binaryBusy=true;
    Promise.resolve(Plotly.react(plot,job.traces,job.layout,{responsive:false,displayModeBar:true,displaylogo:false})).then(()=>{
      plot.dataset.curvesRendered="1";
    }).catch(error=>{console.error(error);}).finally(()=>{plot._binaryBusy=false;if(jobs.has(plot))flush(plot);});
  }
  function paint(plot,traces,layout){
    plot.dataset.comparison="managed";
    plot.setAttribute("role","region");plot.setAttribute("aria-label",plot.closest("article,section")?.querySelector("h3,h2")?.textContent||txt("combined"));plot.tabIndex=0;
    plots.add(plot);jobs.set(plot,{traces,layout});observer.observe(plot);
    const rect=plot.getBoundingClientRect();
    if(ready.has(plot)||(rect.top<innerHeight+160&&rect.bottom>-160))flush(plot);
  }
  function field(label,values,key){
    const wrap=el("div","dm-binary-curve-control"),caption=el("span",null,txt(label));wrap.append(caption);
    const group=el("div","dm-binary-segmented");group.setAttribute("role","group");group.setAttribute("aria-label",txt(label));
    for(const [value,name]of values){const button=el("button",null,txt(name));button.type="button";button.dataset.curveControl=key;button.dataset.value=value;
      button.setAttribute("aria-pressed",String(state[key]===value));button.addEventListener("click",()=>{state[key]=value;syncControls();schedule();});group.append(button);}
    wrap.append(group);return wrap;
  }
  function syncControls(){
    decision.querySelectorAll("[data-curve-control][data-value]").forEach(button=>button.setAttribute("aria-pressed",String(state[button.dataset.curveControl]===button.dataset.value)));
    markerButton.setAttribute("aria-checked",String(state.markers));markerButton.textContent=t(state.markers?"v2.controlOn":"v2.controlOff");
  }
  const controls=decision.querySelector(".dm-binary-curve-controls");
  controls.append(field("view",[["small","small"],["combined","combined"]],"view"));
  const showLabel=el("label","dm-binary-curve-control"),show=el("select");showLabel.append(el("span",null,txt("show")),show);
  show.dataset.curveControl="show";[["both",txt("both")],["far","FAR"],["frr","FRR"]].forEach(([value,name])=>show.add(new Option(name,value)));
  show.addEventListener("change",()=>{state.show=show.value;schedule();});controls.append(showLabel,field("scale",[["linear","linear"],["log","log"]],"scale"));
  const markerLabel=el("label","dm-binary-curve-control"),markerButton=el("button","dm-binary-marker-toggle");
  markerButton.type="button";markerButton.dataset.curveControl="markers";markerButton.setAttribute("role","switch");markerButton.setAttribute("aria-label",txt("markers"));
  markerLabel.append(el("span",null,txt("markers")),markerButton);controls.append(markerLabel);
  markerButton.addEventListener("click",()=>{state.markers=!state.markers;syncControls();schedule();});syncControls();
  const grid=decision.querySelector(".dm-binary-decision-grid"),cards=[];
  for(let slot=0;slot<5;slot++){
    const card=el("article","dm-binary-decision-card"),heading=el("h3"),summary=el("div","dm-binary-decision-summary"),plot=el("div","dm-binary-decision-plot");
    card.dataset.curveSlot=String(slot);plot.id="binary-decision-slot-"+slot;
    card.append(heading,summary,plot);grid.append(card);cards.push({card,heading,summary,plot});
  }
  const combined=decision.querySelector(".dm-binary-combined"),combinedPlot=document.getElementById("binary-decision-combined");
  const shownRates=()=>state.show==="both"?["far","frr"]:[state.show];
  const axis=title=>({title:{text:title,font:{size:12},standoff:8},tickfont:{size:11},gridcolor:"#e7edf5",linecolor:"#bac9db",zeroline:false,showline:true,automargin:true});
  function layout(height,xTitle,yTitle){return {height,margin:{l:52,r:15,t:10,b:44},font:{family:"Inter, system-ui, sans-serif",size:12,color:"#243d64"},paper_bgcolor:"rgba(0,0,0,0)",plot_bgcolor:"rgba(0,0,0,0)",showlegend:false,hovermode:"closest",hoverlabel:{font:{size:12}},xaxis:axis(xTitle),yaxis:axis(yTitle),uirevision:state.scale+"|"+state.show};}
  const chartLegend={orientation:"h",x:0,y:1.05,yanchor:"bottom",font:{size:11},groupclick:"togglegroup",tracegroupgap:4};
  const detail=p=>[p.threshold,p.far,p.frr,p.tp,p.tn,p.fp,p.fn,p.recall,p.accuracy,p.precision];
  function hover(){return txt("hover")+"<extra>%{fullData.name}</extra>";}
  function trace(record,rate,kind,marker=false){
    const points=marker?[record.current]:(kind==="threshold"?record.series.points:record.series.rocPoints);
    const values=points.map(p=>p[rate]);
    const y=values.map(value=>value===null?null:state.scale==="log"&&kind==="threshold"&&value===0?null:value);
    return {type:"scatter",mode:marker?"markers":"lines",name:record.name+(kind==="threshold"?" · "+rate.toUpperCase():""),
      meta:{experiment_id:record.id,binary_rate:rate,binary_marker:marker},uid:record.id+"-"+rate+"-"+marker,legendgroup:record.id,showlegend:!marker,
      x:points.map(p=>p.threshold),y,customdata:points.map(detail),hovertemplate:hover(),
      line:{color:color(record.id),width:2},marker:{color:color(record.id),size:7,line:{color:"#fff",width:1}},connectgaps:false};
  }
  function decisionTraces(records,small){
    const traces=[];
    for(const record of records)for(const rate of shownRates()){
      for(const marker of state.markers?[false,true]:[false]){
        const item=trace(record,rate,"threshold",marker);
        item.line.color=small?rates[rate]:color(record.id);item.line.dash=rate==="frr"?"dash":"solid";
        if(small)item.line.dash="solid";
        item.name=small?rate.toUpperCase():record.name;
        item.legendgroup=small?rate:record.id;
        item.showlegend=!marker&&(small||rate===shownRates()[0]);
        item.marker.color=item.line.color;item.marker.symbol=rate==="frr"?"diamond":"circle";traces.push(item);
      }
    }
    return traces;
  }
  function decisionLayout(records,small,domain){
    const chart=layout(small?214:310,t("plot.threshold"),txt("errorRate"));
    chart.margin={l:small?42:55,r:12,t:small?32:48,b:42};
    chart.showlegend=true;chart.legend={...chartLegend,...(small?{x:.5,xanchor:"center"}:{})};
    chart.xaxis.range=domain;chart.xaxis.nticks=small?3:8;
    chart.yaxis.type=state.scale;chart.yaxis.range=state.scale==="log"?[Math.log10(data.curve_config.log_floor),0]:[0,1];
    chart.yaxis.tickformat=state.scale==="log"?".2%":".0%";chart.yaxis.nticks=small?3:6;
    chart.shapes=state.markers?records.map(record=>({type:"line",x0:record.threshold,x1:record.threshold,xref:"x",y0:0,y1:1,yref:"paper",line:{color:small?"#879bb5":color(record.id),width:1.5,dash:"dash"}})):[];
    if(records.every(record=>!record.series.positive.length&&!record.series.negative.length))chart.annotations=[{xref:"paper",yref:"paper",x:.5,y:.5,text:t("v2.noRows"),showarrow:false,font:{size:12}}];
    return chart;
  }
  function render(){
    const manager=host.DM_V2_MODELS;if(!manager)return;
    const slots=manager.getSlots(),active=slots.filter(Boolean).map(id=>cache.get(id)).filter(Boolean);
    const domainValues=active.flatMap(record=>[...record.thresholds,record.threshold]).filter(Number.isFinite);
    let domain=domainValues.length?[Math.min(...domainValues),Math.max(...domainValues)]:[0,1];
    if(domain[0]===domain[1])domain=[domain[0]-.5,domain[1]+.5];
    for(const kind of ["roc","det"]){
      const chart=layout(289,kind==="roc"?data.curve_config.roc_x:txt("detX"),kind==="roc"?data.curve_config.roc_y:txt("detY"));
      chart.margin.t=44;chart.showlegend=true;chart.legend=chartLegend;
      const traces=[];
      const maxRate=Math.max(.5,...active.flatMap(record=>[record.current.far,record.current.frr]).filter(Number.isFinite));
      const upper=[.5,.8,.95,.99,.999].find(value=>value>=maxRate)||.999;
      const clip=value=>value===null?null:probit(Math.min(upper,Math.max(.001,value)));
      for(const record of active){
        if(!record.series.positive.length||!record.series.negative.length)continue;
        for(const marker of [false,true]){
          const item=trace(record,"recall",kind,marker),points=marker?[record.current]:record.series.rocPoints;
          item.x=points.map(p=>kind==="roc"?p.frr:clip(p.far));
          item.y=points.map(p=>kind==="roc"?p.recall:clip(p.frr));
          // Rates above the DET window are omitted, not flattened onto its edge.
          if(kind==="det"&&!marker){item.x=points.map(p=>p.far>upper||p.frr>upper?null:clip(p.far));item.y=points.map(p=>p.far>upper||p.frr>upper?null:clip(p.frr));}
          traces.push(item);
        }
      }
      if(kind==="roc"){
        traces.push({type:"scatter",x:[0,1],y:[0,1],mode:"lines",name:txt("chance"),line:{color:"#93abc4",width:1.5,dash:"dash"},hoverinfo:"skip"});
        chart.xaxis.range=[0,1];chart.yaxis.range=[0,1];
      }else{
        const ticks=[...new Set((upper===.5?[.001,.01,.1,.2,.5]:[.001,.01,.1,.5,.95,upper]).filter(p=>p<=upper))];
        for(const key of ["xaxis","yaxis"]){Object.assign(chart[key],{range:[probit(.001),probit(upper)],tickvals:ticks.map(probit),ticktext:ticks.map(v=>(100*v).toFixed(v<.01?2:v<.1||v>.99?1:0)+"%")});}
      }
      if(!active.some(record=>record.series.positive.length&&record.series.negative.length))chart.annotations=[{xref:"paper",yref:"paper",x:.5,y:.5,text:txt("bothClasses"),showarrow:false}];
      paint(document.getElementById("binary-"+kind),traces,chart);
    }
    grid.hidden=state.view!=="small";combined.hidden=state.view!=="combined";
    cards.forEach(({card,heading,summary,plot},slot)=>{
      const record=cache.get(slots[slot]);card.classList.toggle("dm-binary-decision-empty",!record);card.dataset.model=record?.id||"";
      heading.textContent=record?.name||t("v2.emptySlot");heading.title=heading.textContent;summary.replaceChildren();plot.hidden=!record;
      if(!record)return;
      card.style.setProperty("--model-color",color(record.id));
      const valid=record.series.points.filter(p=>p.far!==null&&p.frr!==null);
      const eerPoint=valid.reduce((best,p)=>!best||Math.abs(p.far-p.frr)<Math.abs(best.far-best.frr)?p:best,null);
      for(const [label,value]of [[t("plot.threshold"),fmt(record.threshold,"threshold")],["EER",fmt(eerPoint?(eerPoint.far+eerPoint.frr)/2:null,"pct")],["FAR",fmt(record.current.far,"pct")],["FRR",fmt(record.current.frr,"pct")]])summary.append(el("span",null,label+" "+value));
      paint(plot,decisionTraces([record],true),decisionLayout([record],true,domain));
    });
    paint(combinedPlot,decisionTraces(active,false),decisionLayout(active,false,domain));
    decision.querySelector(".dm-binary-log-note").hidden=state.scale!=="log";
    for(const plot of plots)if(!plot.closest("[hidden]")&&ready.has(plot))flush(plot);
  }
  api.presentation={paint,layout,el};
  api.update=(modelId,threshold,rows)=>{
    const model=data.models[modelId];if(!model)return;
    const id=model.experiment_id;
    const signature=rows.map(row=>row.label+":"+row.score).join("|");
    let record=cache.get(id);
    if(!record||record.signature!==signature){record={id,name:model.model_name,signature,thresholds:model.curve_thresholds,series:sweep(rows,model.curve_thresholds,model.positive_if_higher_score)};cache.set(id,record);}
    record.threshold=threshold;record.current=point(record.series.positive,record.series.negative,threshold,model.positive_if_higher_score);
    host.DM_BINARY_DISTRIBUTIONS?.update(modelId,threshold,rows,record.series);schedule();
  };
  document.addEventListener("dm:modelschange",schedule);
  document.addEventListener("dm:decimalschange",schedule);
  document.addEventListener("dm:comparisonlayout",()=>{plots.forEach(plot=>{if(jobs.has(plot))flush(plot);});});
})(typeof window==="undefined"?globalThis:window);
