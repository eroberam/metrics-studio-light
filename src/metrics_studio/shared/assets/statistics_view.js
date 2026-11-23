/* Automatic, full-dataset Statistics. No metric calculations or input mutation. */
(function(host){
  "use strict";
  const numeric=value=>value!==null&&value!==undefined&&!(typeof value==="string"&&!value.trim())&&typeof value!=="boolean"&&Number.isFinite(Number(value));
  function quantile(sorted,p){
    if(!sorted.length)return null;
    const index=(sorted.length-1)*p,lo=Math.floor(index),hi=Math.ceil(index);
    return sorted[lo]+(sorted[hi]-sorted[lo])*(index-lo);
  }
  function distribution(values){
    const sorted=values.filter(numeric).map(Number).sort((a,b)=>a-b);
    if(!sorted.length)return null;
    const q1=quantile(sorted,.25),median=quantile(sorted,.5),q3=quantile(sorted,.75),iqr=q3-q1;
    const inliers=sorted.filter(value=>value>=q1-1.5*iqr&&value<=q3+1.5*iqr);
    return {n:sorted.length,q1,median,q3,low:inliers[0],high:inliers.at(-1),min:sorted[0],max:sorted.at(-1),
      outliers:sorted.filter(value=>value<inliers[0]||value>inliers.at(-1))};
  }
  function liveRows(exp,data,manager,rows=exp.rows||[]){
    if(data.task!=="binary")return rows;
    const cfg=data.worst_case,threshold=manager.getThreshold(exp.id)??cfg.decision_threshold;
    return rows.map(row=>{
      const label=row._binary_label??row.ground_truth;
      const result=host.DM_BINARY_SAMPLES.classify(label,numeric(row.score)?Number(row.score):NaN,threshold,cfg.positive_if_higher_score);
      return {...row,prediction:result.prediction===null?null:result.prediction?cfg.positive_label:cfg.negative_label};
    });
  }
  function specification(data){
    return data.task==="binary"?{key:"score",group:"_binary_label",title:"byTrueClass",metric:"score"}:
      data.task==="multiclass"?{key:"_confidence",group:"label_original",title:"byTrueClass",metric:"confidence"}:
      ["regression","age_estimation"].includes(data.task)?{key:"residual",title:"distribution",metric:data.task==="age_estimation"?"residualYears":"residual"}:
      data.task==="ocr"?{key:"cer",group:"field_name",title:"byField",metric:"cer",multiplier:100}:
      data.task==="segmentation"?{key:"macro_dice",title:"distribution",metric:"dice"}:
      data.task==="object_detection"?{key:"confidence",group:"predicted_class",title:"byPredictedClass",metric:"confidence",population:"detections"}:
      data.panel_mode==="tracking"?{key:"confidence",group:"eye_side",title:"byEye",metric:"confidence"}:
      {key:"angular_error",group:"eye_side",title:"byEye",metric:"angularError",population:"gaze3d"};
  }
  function summarize(rows,spec){
    if(spec.population==="gaze3d")rows=rows.filter(row=>row.target_type==="gaze_3d");
    if(spec.population==="detections")rows=rows.filter(row=>row.error_type!=="missed_ground_truth");
    const groups=new Map();let valid=0;
    for(const row of rows){
      let value=row[spec.key];
      if(spec.key==="_confidence"){
        const scores=Object.entries(row).filter(([key,v])=>key.startsWith("score__")&&numeric(v)).map(([,v])=>Number(v));
        value=scores.length?Math.max(...scores):null;
      }
      if(!numeric(value))continue;
      valid++;
      const key=spec.group?String(row[spec.group]??"UNKNOWN"):"__all__";
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(Number(value)*(spec.multiplier||1));
    }
    return {n:rows.length,valid,missing:rows.length-valid,
      groups:[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([key,values])=>({key,...distribution(values)}))};
  }
  host.DM_STATISTICS={numeric,quantile,distribution,liveRows,specification,summarize};
  host.DM_STATISTICS.mountSummary=({data,manager,getRows,icon})=>{
    const t=(key,args)=>host.DM_I18N.t("statistics."+key,args);
    const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
    const fmt=value=>host.DM_FMT.fmt(value,"num"),spec=specification(data);
    const section=el("section","dm-v2-stat-section dm-stat-summary");section.id="dm-v2-statistical-summary";
    const header=el("header"),symbol=el("span");symbol.innerHTML=icon("chart");header.append(symbol,el("h2",null,t("summary")));section.append(header);
    const scroll=el("div","dm-stat-summary-scroll"),table=el("table"),head=el("thead"),body=el("tbody");
    const caption=el("caption","sr-only",t("summary"));table.append(caption,head,body);scroll.append(table);section.append(scroll);
    const note=el("p","dm-stat-summary-note");section.append(note);
    const label=(key,exp)=>key==="__all__"?t("allRecords"):key==="UNKNOWN"?t("unavailable"):
      data.task==="binary"?(exp.sample_class_names?.[key]||host.DM_I18N.t("sampleExplorer."+(key==="1"?"positive":"negative"),{label:key})):key;
    function boxplot(profile,exp,domain){
      const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
      const width=500,rowHeight=26,height=profile.groups.length*rowHeight+29,start=140,end=478;
      svg.setAttribute("viewBox",`0 0 ${width} ${height}`);svg.setAttribute("role","img");
      svg.setAttribute("aria-label",t("plotDescription",{name:exp.name,metric:t(spec.metric)}));
      svg.classList.add("dm-stat-boxplot");
      const draw=(tag,attrs,text,parent=svg)=>{const node=document.createElementNS(svg.namespaceURI,tag);Object.entries(attrs).forEach(([key,value])=>node.setAttribute(key,value));if(text!==undefined)node.textContent=text;parent.append(node);return node;};
      const x=value=>start+(end-start)*(value-domain[0])/(domain[1]-domain[0]);
      for(let i=0;i<=5;i++){
        const value=domain[0]+i*(domain[1]-domain[0])/5,px=x(value);
        draw("line",{x1:px,x2:px,y1:2,y2:height-25,class:"dm-stat-grid"});
        draw("text",{x:px,y:height-7,"text-anchor":"middle",class:"dm-stat-axis"},fmt(value));
      }
      profile.groups.forEach((group,index)=>{
        const y=14+index*rowHeight,color=(data.task==="binary"?group.key==="0":index%2===0)?"#3388ed":"#e88331",g=draw("g",{});
        draw("title",{},t("boxDetails",{name:label(group.key,exp),n:group.n,median:fmt(group.median),q1:fmt(group.q1),q3:fmt(group.q3),low:fmt(group.low),high:fmt(group.high)}),g);
        const title=label(group.key,exp);draw("text",{x:130,y:y+4,"text-anchor":"end",class:"dm-stat-axis"},title.length>16?title.slice(0,15)+"…":title,g);
        draw("line",{x1:x(group.low),x2:x(group.high),y1:y,y2:y,stroke:color},undefined,g);
        for(const value of [group.low,group.high])draw("line",{x1:x(value),x2:x(value),y1:y-4,y2:y+4,stroke:color},undefined,g);
        draw("rect",{x:x(group.q1),y:y-6,width:Math.max(1,x(group.q3)-x(group.q1)),height:12,fill:color,"fill-opacity":.25,stroke:color},undefined,g);
        draw("line",{x1:x(group.median),x2:x(group.median),y1:y-6,y2:y+6,stroke:color,"stroke-width":2},undefined,g);
        // Unique outlier positions avoid thousands of identical SVG marks.
        for(const value of new Set(group.outliers))draw("circle",{cx:x(value),cy:y,r:1.5,fill:color},undefined,g);
      });
      return svg;
    }
    function render(){
      const entries=manager.getActiveExperiments().map(exp=>({exp,profile:summarize(getRows(exp),spec)}));
      const groups=entries.flatMap(entry=>entry.profile.groups);
      let min=groups.length?Math.min(...groups.map(group=>group.min)):0,max=groups.length?Math.max(...groups.map(group=>group.max)):1;
      if(["score","confidence","dice"].includes(spec.metric)&&min>=0&&max<=1){min=0;max=1;}
      if(min===max){const pad=Math.abs(min)*.05||.5;min-=pad;max+=pad;}
      if(!["score","confidence","dice"].includes(spec.metric)){
        const rough=(max-min)/5,magnitude=10**Math.floor(Math.log10(rough));
        const step=[1,2,5,10].find(value=>value*magnitude>=rough)*magnitude;
        min=Math.floor(min/step)*step;max=Math.ceil(max/step)*step;
      }
      head.replaceChildren();const hr=el("tr");
      for(const key of ["model","quality",spec.title,"boxplot"]){const th=el("th",null,key===spec.title?t(key,{metric:t(spec.metric)}):t(key));th.scope="col";hr.append(th);}head.append(hr);
      body.replaceChildren();
      for(const {exp,profile}of entries){
        const row=el("tr");row.dataset.statSummaryModel=exp.id;
        const model=el("th","dm-stat-summary-model");model.scope="row";
        const dot=el("span","dm-stat-model-dot");dot.style.background=manager.getColor(exp.id);model.append(dot,document.createTextNode(exp.name));
        const quality=el("td","dm-stat-quality");quality.append(el("div",null,t("records",{n:profile.n.toLocaleString()})),el("div",null,t("missingMetric",{n:profile.missing.toLocaleString(),pct:profile.n?fmt(profile.missing/profile.n*100):fmt(0)})));
        quality.title=t("missingHelp",{metric:t(spec.metric)});
        const values=el("td","dm-stat-summary-values"),plot=el("td","dm-stat-summary-plot");
        for(const group of profile.groups){const line=el("div"),name=el("strong",null,label(group.key,exp));name.title=label(group.key,exp);line.append(name,el("span",null,t("quartiles",{median:fmt(group.median),q1:fmt(group.q1),q3:fmt(group.q3)})));values.append(line);}
        if(profile.groups.length)plot.append(boxplot(profile,exp,[min,max]));
        else{values.textContent=t("unavailable");plot.textContent=t("noNumericData");}
        row.append(model,quality,values,plot);body.append(row);
      }
      note.textContent=t("boxHelp")+(spec.population?" "+t("population."+spec.population):"");
    }
    return {section,render};
  };
})(typeof window==="undefined"?globalThis:window);
