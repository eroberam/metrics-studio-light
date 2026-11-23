/* Class-score evidence. Raw rows and stable model IDs come from the Binary
 * workbench; no thresholds, metrics or selections are written by this view. */
(function(host){
  "use strict";
  const EPS=1e-12;
  function bins(values,domain,count){
    const width=(domain[1]-domain[0])/count,counts=Array(count).fill(0);
    for(const value of values){let index=0;while(index<count-1&&value>=domain[0]+(index+1)*width)index++;counts[index]++;}
    return {x:counts.map((_,i)=>domain[0]+(i+.5)*width),counts,width,
      density:counts.map(n=>values.length?n/values.length/width:0)};
  }
  function bandwidth(values){
    if(values.length<2)return null;
    const mean=values.reduce((a,b)=>a+b,0)/values.length;
    const sd=Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/(values.length-1));
    return sd>1e-12?sd*Math.pow(values.length,-.2):null;
  }
  function kde(values,domain,bounded=false){
    const h=bandwidth(values);if(!h)return null;
    // Resolve narrow score clusters without flattening peaks between samples.
    const lower=Math.max(domain[0],values.reduce((a,b)=>Math.min(a,b),Infinity)-3*h);
    const upper=Math.min(domain[1],values.reduce((a,b)=>Math.max(a,b),-Infinity)+3*h);
    const x=[...new Set([...Array.from({length:181},(_,i)=>domain[0]+i*(domain[1]-domain[0])/180),
      ...Array.from({length:201},(_,i)=>lower+i*(upper-lower)/200)])].sort((a,b)=>a-b);
    const kernel=z=>Math.exp(-.5*z*z);
    const y=x.map(at=>bounded&&(at<0||at>1)?0:values.reduce((sum,v)=>sum+kernel((at-v)/h)+(bounded?kernel((at+v)/h)+kernel((at-2+v)/h):0),0)/(values.length*h*Math.sqrt(2*Math.PI)));
    return {x,y,bandwidth:h};
  }
  function calibration(rows,higher,count=10){
    if(!rows.length||rows.some(r=>r.score < -1e-9||r.score > 1+1e-9))return null;
    const prob=rows.map(r=>Math.min(1,Math.max(0,higher?r.score:1-r.score)));
    const classes=[0,1].map(label=>{
      const cells=Array.from({length:count},(_,i)=>({start:i*(1/count),end:(i+1)*(1/count),n:0,sum:0,observed:0}));
      prob.forEach((p,i)=>{const score=label?p:1-p;let index=0;while(index<count-1&&score>=(index+1)*(1/count))index++;const cell=cells[index];cell.n++;cell.sum+=score;cell.observed+=Number(rows[i].label===label);});
      return cells.filter(cell=>cell.n).map(cell=>({...cell,x:cell.sum/cell.n,y:cell.observed/cell.n}));
    });
    // Preserve the report's ECE definition: 10 bins, inner edges included on
    // the left (numpy digitize right=True), probabilities clipped at EPS.
    const eceBins=Array.from({length:10},()=>({n:0,sum:0,observed:0}));let brier=0;
    prob.forEach((value,i)=>{const p=Math.min(1-EPS,Math.max(EPS,value));
      let index=0;while(index<9&&p>(index+1)*.1)index++;
      const cell=eceBins[index];cell.n++;cell.sum+=p;cell.observed+=rows[i].label;brier+=(rows[i].label-p)**2;
    });
    return {classes,prob,ece:eceBins.reduce((s,c)=>s+Math.abs(c.observed-c.sum),0)/rows.length,brier:brier/rows.length,
      hist:[0,1].map(label=>bins(prob.filter((_,i)=>rows[i].label===label),[0,1],count))};
  }
  function discrimination(series,higher){
    if(!series.positive.length||!series.negative.length)return {auc:null,ap:null,eer:null};
    const points=series.rocPoints.slice().sort((a,b)=>higher?b.threshold-a.threshold:a.threshold-b.threshold);
    let auc=0,ap=0;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i];auc+=(b.frr-a.frr)*(b.recall+a.recall)/2;
      if(b.recall>a.recall)ap+=(b.recall-a.recall)*b.precision;
    }
    // Preserve the report EER estimate on its configured dense threshold grid.
    const finite=series.points;
    const crossing=finite.reduce((best,p)=>!best||Math.abs(p.far-p.frr)<Math.abs(best.far-best.frr)?p:best,null);
    return {auc,ap,eer:crossing?(crossing.far+crossing.frr)/2:null};
  }
  const api={bins,bandwidth,kde,calibration,discrimination};host.DM_BINARY_DISTRIBUTIONS=api;
  if(typeof document==="undefined")return;
  const dist=document.getElementById("binary-distributions-workbench"),calib=document.getElementById("binary-calibration-workbench");
  if(!dist||!calib)return;
  const {paint,layout,el}=host.DM_BINARY_CURVES.presentation;
  const data=JSON.parse(document.getElementById("dashboard-data").textContent),cache=new Map();
  const state={density:"kde",focus:"all",threshold:true,view:"small",bins:10,histogram:true};
  const t=(key,args)=>host.DM_I18N.t(key,args),txt=(key,args)=>t("panel.binary.distributions."+key,args);
  const fmt=(v,kind="num")=>host.DM_FMT.fmt(v,kind),color=id=>host.DM_V2_MODELS.getColor(id);
  const colors=["#1675ef","#f48616"],fills=["rgba(22,117,239,.24)","rgba(244,134,22,.25)"];
  const className=label=>label?data.positive_name:data.negative_name;
  let frame=0;
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;render();});};
  function segmented(root,key,caption,options){
    const field=el("div","dm-binary-curve-control"),group=el("div","dm-binary-segmented");
    group.setAttribute("role","group");group.setAttribute("aria-label",caption);
    if(key==="view")field.append(el("span",null,caption));
    for(const [value,label]of options){const button=el("button",null,label);button.type="button";button.dataset.evidenceControl=key;button.dataset.value=value;
      button.setAttribute("aria-pressed",String(state[key]===value));button.addEventListener("click",()=>{state[key]=value;sync();schedule();});group.append(button);}
    field.append(group);root.append(field);
  }
  function toggle(root,key,caption){
    const field=el("div","dm-binary-curve-control"),button=el("button","dm-binary-marker-toggle");button.type="button";
    button.dataset.evidenceControl=key;button.setAttribute("role","switch");button.setAttribute("aria-label",caption);
    button.addEventListener("click",()=>{state[key]=!state[key];sync();schedule();});field.append(el("span",null,caption),button);root.append(field);
  }
  function select(root,key,caption,options){
    const field=el("label","dm-binary-curve-control"),select=el("select");select.dataset.evidenceControl=key;
    select.setAttribute("aria-label",caption);if(key==="bins")field.append(el("span",null,caption));
    for(const [value,label]of options)select.add(new Option(label,value));select.value=String(state[key]);
    select.addEventListener("change",()=>{state[key]=key==="bins"?Number(select.value):select.value;schedule();});field.append(select);root.append(field);return select;
  }
  function sync(){
    [dist,calib].forEach(root=>root.querySelectorAll("[data-evidence-control]").forEach(node=>{
      const key=node.dataset.evidenceControl;
      if(node.hasAttribute("aria-pressed"))node.setAttribute("aria-pressed",String(state[key]===node.dataset.value));
      if(node.getAttribute("role")==="switch"){node.setAttribute("aria-checked",String(state[key]));node.textContent=t(state[key]?"v2.controlOn":"v2.controlOff");}
    }));
  }
  [dist,calib].forEach(root=>{
    const legend=root.querySelector(".dm-binary-evidence-legend");
    [0,1].forEach(label=>{const item=el("span"),swatch=el("i");swatch.style.background=fills[label];swatch.style.borderColor=colors[label];item.append(swatch,document.createTextNode(className(label)));legend.append(item);});
  });
  const idealKey=el("span","dm-binary-ideal-key",txt("ideal"));calib.querySelector(".dm-binary-evidence-legend").append(idealKey);
  const dc=dist.querySelector(".dm-binary-curve-controls"),cc=calib.querySelector(".dm-binary-curve-controls");
  segmented(dc,"density",txt("densityView"),[["kde",txt("kde")],["histogram",txt("histogram")]]);
  const focus=select(dc,"focus",txt("modelFocus"),[["all",txt("allModels")]]);toggle(dc,"threshold",txt("showThreshold"));
  segmented(cc,"view",t("panel.binary.curves.view"),[["small",t("panel.binary.curves.small")],["combined",t("panel.binary.curves.combined")]]);
  const binControl=select(cc,"bins",txt("bins"),[5,10,15,20].map(n=>[String(n),String(n)]));binControl.title=txt("eceHelp");
  toggle(cc,"histogram",txt("showHistogram"));sync();
  function cards(root,prefix){
    return Array.from({length:5},(_,slot)=>{
      const card=el("article","dm-binary-evidence-card"),heading=el("h3"),summary=el("div","dm-binary-evidence-summary"),plot=el("div","dm-binary-evidence-plot");
      card.dataset.evidenceSlot=String(slot);plot.id=prefix+slot;card.append(heading,summary,plot);root.querySelector(".dm-binary-evidence-grid").append(card);
      return {card,heading,summary,plot};
    });
  }
  const distCards=cards(dist,"binary-distribution-slot-"),calibCards=cards(calib,"binary-calibration-slot-");
  const combined=calib.querySelector(".dm-binary-evidence-combined"),combinedPlot=document.getElementById("binary-calibration-combined");
  function header(card,record,metrics){
    card.card.classList.toggle("dm-binary-evidence-empty",!record);card.card.dataset.model=record?.id||"";
    card.heading.textContent=record?.name||t("v2.emptySlot");card.heading.title=card.heading.textContent;card.summary.replaceChildren();card.plot.hidden=!record;
    if(!record)return;
    card.card.style.setProperty("--model-color",color(record.id));
    for(const [label,value,kind]of metrics){const item=el("span",null,txt(label)+" "+fmt(value,kind));if(label==="ece")item.title=txt("eceHelp");card.summary.append(item);}
  }
  function empty(chart,message){chart.annotations=[{xref:"paper",yref:"paper",x:.5,y:.5,text:message,showarrow:false,font:{size:12},width:160}];}
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function distribution(record,domain,bounded){
    const chart=layout(210,txt("modelScore"),txt("density"));chart.margin={l:42,r:10,t:25,b:43};chart.xaxis.range=domain;chart.xaxis.nticks=4;chart.yaxis.nticks=4;chart.yaxis.rangemode="tozero";
    chart.uirevision=record.id+"|"+state.density;chart.barmode="overlay";chart.bargap=.05;
    const traces=[];let fallback=false;
    for(const label of [0,1]){
      const values=record.series[label?"positive":"negative"],key=JSON.stringify([domain,bounded,label]);if(!values.length)continue;
      if(!record.densities.has(key)){if(record.densities.size>12)record.densities.clear();record.densities.set(key,kde(values,domain,bounded));}
      const density=record.densities.get(key),hist=bins(values,domain,24);
      const base={name:className(label),legendgroup:String(label),uid:record.id+"-density-"+label,meta:{experiment_id:record.id,class_label:label},showlegend:false};
      if(state.density==="kde"&&density)traces.push({...base,type:"scatter",mode:"lines",x:density.x,y:density.y,line:{color:colors[label],width:1.6},fill:"tozeroy",fillcolor:fills[label],hovertemplate:txt("densityHover")+"<extra>%{fullData.name}</extra>"});
      else {fallback||=state.density==="kde";traces.push({...base,type:"bar",x:hist.x,y:hist.density,width:hist.width,marker:{color:fills[label],line:{color:colors[label],width:.6}},customdata:hist.counts,hovertemplate:txt("histHover")+"<extra>%{fullData.name}</extra>"});}
    }
    if(state.threshold){chart.shapes=[{type:"line",xref:"x",yref:"paper",x0:record.threshold,x1:record.threshold,y0:0,y1:1,line:{color:"#203e72",width:1.4,dash:"dash"}}];
      chart.annotations=[{xref:"x",yref:"paper",x:record.threshold,y:1.02,text:escape(t("plot.threshold"))+" "+fmt(record.threshold,"threshold"),showarrow:false,yanchor:"bottom",font:{size:11,color:"#193765"}}];}
    if(!record.rows.length)empty(chart,t("v2.noRows"));
    else if(fallback)chart.annotations=[...(chart.annotations||[]),{xref:"paper",yref:"paper",x:.5,y:.95,text:txt("kdeFallback"),showarrow:false,font:{size:11},bgcolor:"rgba(255,255,255,.9)"}];
    return {traces,chart};
  }
  function calibrationChart(records,small,histogramMax=100){
    const chart=layout(state.histogram?(small?335:420):(small?235:310),txt("predictedProbability"),txt("observedFrequency"));
    chart.margin={l:44,r:10,t:8,b:42};chart.xaxis.range=[0,1];chart.yaxis.range=[0,1];chart.xaxis.nticks=4;chart.yaxis.nticks=4;
    chart.showlegend=true;chart.legend={orientation:"h",x:small?-.2:0,xanchor:"left",y:state.histogram?.40:-.3,yanchor:"top",font:{size:11},groupclick:"togglegroup",tracegroupgap:0};
    chart.uirevision=records.map(r=>r.id).join("|")+"|"+state.bins+"|"+state.histogram;chart.barmode="overlay";
    if(state.histogram){
      chart.yaxis.domain=[.54,1];chart.xaxis.anchor="y";chart.xaxis.title.standoff=3;
      chart.yaxis2={...chart.yaxis,domain:[0,.23],range:[0,histogramMax],title:{text:txt("samplesPercent"),font:{size:11},standoff:4},ticksuffix:"%",nticks:3,anchor:"x2",rangemode:"tozero"};
      chart.xaxis2={...chart.xaxis,anchor:"y2",title:{text:txt("positiveProbability"),font:{size:11},standoff:3}};
    }
    const traces=[{type:"scatter",x:[0,1],y:[0,1],mode:"lines",name:txt("ideal"),showlegend:!small,line:{color:"#8998af",width:1,dash:"dash"},hoverinfo:"skip",legendgroup:"ideal"}];
    for(const record of records){
      if(!record.calibrations.has(state.bins))record.calibrations.set(state.bins,calibration(record.rows,record.higher,state.bins));
      const result=record.calibrations.get(state.bins);if(!result)continue;
      for(const label of [0,1]){
        const cells=result.classes[label],lineColor=small?colors[label]:color(record.id),name=small?txt(label?"positiveShort":"negativeShort"):record.name;
        const group=small?String(label):record.id;
        traces.push({type:"scatter",mode:"lines+markers",x:cells.map(c=>c.x),y:cells.map(c=>c.y),name,legendgroup:group,showlegend:small||label===1,
          uid:record.id+"-calibration-"+label,meta:{experiment_id:record.id,class_label:label},
          line:{color:lineColor,width:1.6,dash:small||label?"solid":"dash"},marker:{color:lineColor,size:4},
          customdata:cells.map(c=>[c.n,c.start,c.end]),hovertemplate:"<b>"+escape(className(label))+"</b><br>"+txt("calibrationHover")+"<extra>"+escape(record.name)+"</extra>"});
        if(state.histogram){const hist=result.hist[label];
          traces.push({type:"bar",x:hist.x,y:hist.counts.map(n=>100*n/record.rows.length),width:hist.width*.92,xaxis:"x2",yaxis:"y2",name:className(label),legendgroup:group,showlegend:false,
            uid:record.id+"-calibration-hist-"+label,meta:{experiment_id:record.id,class_label:label},
            marker:{color:small?fills[label]:color(record.id),opacity:small?1:.25,line:{color:lineColor,width:.5},pattern:{shape:!small&&!label?"/":""}},customdata:hist.counts,
            hovertemplate:txt("calibrationHistHover")+"<extra>"+escape(record.name)+" · "+escape(className(label))+"</extra>"});
        }
      }
    }
    if(traces.length===1)empty(chart,records.some(r=>r.rows.length)?txt("probabilityRequired"):t("v2.noRows"));
    return {traces,chart};
  }
  function render(){
    const slots=host.DM_V2_MODELS.getSlots(),active=slots.filter(Boolean).map(id=>cache.get(id)).filter(Boolean);
    if(!slots.includes(state.focus))state.focus="all";
    const optionIds=[...focus.options].slice(1).map(o=>o.value).join("|");
    if(optionIds!==active.map(r=>r.id).join("|")){focus.replaceChildren(new Option(txt("allModels"),"all"));active.forEach(r=>focus.add(new Option(r.name,r.id)));}focus.value=state.focus;
    const scores=active.flatMap(r=>[...r.series.positive,...r.series.negative]);
    const min=scores.reduce((a,b)=>Math.min(a,b),Infinity),max=scores.reduce((a,b)=>Math.max(a,b),-Infinity),bounded=min>=0&&max<=1;
    const pad=Math.max(...active.flatMap(r=>[bandwidth(r.series.positive)||0,bandwidth(r.series.negative)||0]),.01)*3;
    let domain=scores.length?(bounded?[0,1]:[min-pad,max+pad]):[0,1];
    if(state.threshold)domain=[Math.min(domain[0],...active.map(r=>r.threshold)),Math.max(domain[1],...active.map(r=>r.threshold))];
    dist.querySelector(".dm-binary-evidence-grid").classList.toggle("dm-binary-evidence-focused",state.focus!=="all");
    const distributions=new Map(active.map(record=>[record.id,distribution(record,domain,bounded)]));

    distCards.forEach((card,slot)=>{
      const record=cache.get(slots[slot]);card.card.hidden=state.focus!=="all"&&record?.id!==state.focus;
      header(card,record,record?[["auc",record.discrimination.auc],["eer",record.discrimination.eer,"pct"],["ap",record.discrimination.ap]]:[]);
      if(record){const result=distributions.get(record.id);result.chart.yaxis.range=[0,Math.max(1,...result.traces.flatMap(trace=>trace.y))*1.08];paint(card.plot,result.traces,result.chart);}
    });
    calib.querySelector(".dm-binary-evidence-grid").hidden=state.view!=="small";combined.hidden=state.view!=="combined";
    const histogramMax=Math.max(5,...active.flatMap(record=>{
      if(!record.calibrations.has(state.bins))record.calibrations.set(state.bins,calibration(record.rows,record.higher,state.bins));
      return record.calibrations.get(state.bins)?.hist.flatMap(hist=>hist.counts.map(n=>100*n/record.rows.length))||[];
    }))*1.1;
    calibCards.forEach((card,slot)=>{
      const record=cache.get(slots[slot]),metrics=record?.calibrations.get(10);
      header(card,record,record?[["ece",metrics?.ece??null],["brier",metrics?.brier??null]]:[]);
      card.card.classList.toggle("dm-binary-calibration-no-histogram",!state.histogram);
      if(record){const result=calibrationChart([record],true,histogramMax);paint(card.plot,result.traces,result.chart);}
    });
    const result=calibrationChart(active,false,histogramMax);paint(combinedPlot,result.traces,result.chart);
  }
  api.update=(modelId,threshold,rows,series)=>{
    const model=data.models[modelId];if(!model)return;
    let record=cache.get(model.experiment_id);
    if(!record||record.series!==series){record={id:model.experiment_id,name:model.model_name,rows,series,higher:model.positive_if_higher_score,
      discrimination:discrimination(series,model.positive_if_higher_score),densities:new Map(),calibrations:new Map([[10,calibration(rows,model.positive_if_higher_score,10)]])};cache.set(record.id,record);}
    record.threshold=threshold;schedule();
  };
  document.addEventListener("dm:modelschange",schedule);document.addEventListener("dm:decimalschange",schedule);
})(typeof window==="undefined"?globalThis:window);
