/* Scientific relationship explorer: one model, two axes and optional facets. */
(function(host){
  "use strict";
  const COLORS=[[0,"#e8f5e9"],[.24,"#b9ded0"],[.5,"#fff3c4"],[.76,"#f3bd8a"],[1,"#cf5b4d"]];
  const HIGHER_IS_BETTER=new Set(["accuracy","word_recall","precision","recall","f1","mean:macro_dice","mean:mean_iou","mean:boundary_f1","mean:pixel_accuracy","valid_rate"]);
  const finite=value=>value!==null&&value!==undefined&&String(value).trim()!==""&&Number.isFinite(Number(value));
  const escape=value=>String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  function metricDefinitions(data){
    const mean=(key,label,unit="number")=>({key:"mean:"+key,label,unit,aggregate:rows=>{
      const values=rows.map(row=>Number(row[key])).filter(Number.isFinite);
      return {value:values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null,n:values.length};
    }});
    const ratio=(key,label,accept)=>({key,label,unit:"percent",aggregate:rows=>{
      const values=rows.map(accept).filter(value=>value&&value[1]),denominator=values.length,numerator=values.filter(value=>value[0]).length;
      return {value:denominator?100*numerator/denominator:null,n:denominator,numerator,denominator};
    }});
    const count={key:"count",label:"relationship.metric.count",unit:"count",aggregate:rows=>({value:rows.length,n:rows.length})};
    if(data.task==="binary")return [count,
      ratio("far","relationship.metric.far",row=>[row._binary_label===1&&row.prediction!==data.worst_case.positive_label,row._binary_label===1]),
      ratio("frr","relationship.metric.frr",row=>[row._binary_label===0&&row.prediction!==data.worst_case.negative_label,row._binary_label===0]),
      ratio("accuracy","relationship.metric.accuracy",row=>[row.prediction===row.ground_truth,row.prediction!=null&&row.ground_truth!=null]),
      ratio("error_rate","relationship.metric.errorRate",row=>[row.prediction!==row.ground_truth,row.prediction!=null&&row.ground_truth!=null]),
      mean("score","relationship.metric.meanScore")];
    if(data.task==="multiclass")return [count,
      ratio("accuracy","relationship.metric.accuracy",row=>[row.prediction===row.ground_truth,row.prediction!=null&&row.ground_truth!=null]),
      ratio("error_rate","relationship.metric.errorRate",row=>[row.prediction!==row.ground_truth,row.prediction!=null&&row.ground_truth!=null])];
    if(["regression","age_estimation"].includes(data.task))return [count,mean("absolute_error","relationship.metric.mae"),
      {key:"rmse",label:"relationship.metric.rmse",unit:"number",aggregate:rows=>{const values=rows.map(row=>Number(row.residual)).filter(Number.isFinite);return {value:values.length?Math.sqrt(values.reduce((sum,value)=>sum+value*value,0)/values.length):null,n:values.length};}},
      mean("residual","relationship.metric.meanResidual")];
    if(data.task==="ocr")return [count,
      {key:"cer",label:"relationship.metric.cer",unit:"percent",aggregate:rows=>weighted(rows,"char_errors","gt_char_len",false)},
      {key:"word_recall",label:"relationship.metric.wordRecall",unit:"percent",aggregate:rows=>weighted(rows,"word_matches","gt_word_len",false)}];
    if(data.task==="object_detection")return [count,
      {key:"precision",label:"relationship.metric.precision",unit:"percent",aggregate:rows=>detection(rows,"precision")},
      {key:"recall",label:"relationship.metric.recall",unit:"percent",aggregate:rows=>detection(rows,"recall")},
      {key:"f1",label:"relationship.metric.f1",unit:"percent",aggregate:rows=>detection(rows,"f1")},
      mean("confidence","relationship.metric.meanConfidence")];
    if(data.task==="segmentation")return [count,mean("macro_dice","relationship.metric.macroDice","percent_ratio"),
      mean("mean_iou","relationship.metric.meanIou","percent_ratio"),mean("boundary_f1","relationship.metric.boundaryF1","percent_ratio"),
      mean("pixel_accuracy","relationship.metric.pixelAccuracy","percent_ratio")];
    if(data.panel_mode==="tracking")return [count,mean("confidence","relationship.metric.meanConfidence"),
      ratio("valid_rate","relationship.metric.validRate",row=>[Boolean(row.valid),row.valid!==null&&row.valid!==undefined]),
      mean("pupil_diameter","relationship.metric.meanPupil")];
    return [count,mean("angular_error","relationship.metric.meanAngular"),mean("primary_error","relationship.metric.meanPrimary")];
  }
  function weighted(rows,numeratorKey,denominatorKey,invert){
    let numerator=0,denominator=0;
    rows.forEach(row=>{if(finite(row[numeratorKey])&&finite(row[denominatorKey])){numerator+=Number(row[numeratorKey]);denominator+=Number(row[denominatorKey]);}});
    const value=denominator?100*numerator/denominator:null;
    return {value:value===null?null:(invert?100-value:value),n:denominator,numerator,denominator};
  }
  function detection(rows,kind){
    let tp=0,fp=0,fn=0;
    rows.forEach(row=>{tp+=Number(row._tp)||0;fp+=Number(row._fp)||0;fn+=Number(row._fn)||0;});
    const denominator=kind==="precision"?tp+fp:kind==="recall"?tp+fn:2*tp+fp+fn;
    const numerator=kind==="f1"?2*tp:tp;
    return {value:denominator?100*numerator/denominator:null,n:rows.length,numerator,denominator};
  }
  function axis(values,name,bins,missing){
    const present=values.filter(value=>!missing(value));
    const numeric=present.length&&present.every(finite);
    const unique=[...new Set(present.map(String))];
    if(numeric&&unique.length>20){
      const numbers=present.map(Number),min=Math.min(...numbers),max=Math.max(...numbers),count=bins==="auto"?10:Number(bins)||10;
      const width=(max-min)/count||1;
      const format=value=>Math.abs(value)>=100?value.toFixed(0):Math.abs(value)>=10?value.toFixed(1):value.toFixed(2);
      const labels=Array.from({length:count},(_,index)=>index===count-1?`${format(min+index*width)}–${format(max)}`:`${format(min+index*width)}–<${format(min+(index+1)*width)}`);
      const map=value=>{
        if(missing(value))return "UNKNOWN";
        return labels[Math.min(count-1,Math.max(0,Math.floor((Number(value)-min)/width)))];
      };
      return {name,numeric:true,labels,map};
    }
    const counts=new Map();values.forEach(value=>{const key=missing(value)?"UNKNOWN":String(value);counts.set(key,(counts.get(key)||0)+1);});
    const labels=[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],undefined,{numeric:true})).slice(0,16).map(entry=>entry[0]);
    const allowed=new Set(labels),hasOther=counts.size>labels.length;if(hasOther)labels.push("Other");
    return {name,numeric:false,labels,map:value=>{const key=missing(value)?"UNKNOWN":String(value);return allowed.has(key)?key:"Other";}};
  }
  function order(labels,counts,mode){
    const result=labels.slice();
    if(mode==="label_asc")result.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    if(mode==="label_desc")result.sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
    if(mode==="frequency_desc")result.sort((a,b)=>(counts.get(b)||0)-(counts.get(a)||0)||a.localeCompare(b));
    if(mode==="frequency_asc")result.sort((a,b)=>(counts.get(a)||0)-(counts.get(b)||0)||a.localeCompare(b));
    return result;
  }
  function normalize(value,count,rowCount,columnCount,total,mode,metric){
    if(metric!=="count")return value;
    const denominator=mode==="row_pct"?rowCount:mode==="column_pct"?columnCount:mode==="total_pct"?total:null;
    return denominator?100*count/denominator:value;
  }
  host.DM_RELATIONSHIP={metricDefinitions,weighted,detection,axis,order,normalize};
  host.DM_RELATIONSHIP.mount=({data,manager,getRows,icon,onShowTable})=>{
    const t=(key,args)=>host.DM_I18N.t("statistics."+(key.startsWith("relationship.")?key:"relationship."+key),args),el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
    const missing=value=>host.DM_V2_AGG.isMissing(value,data.statistics_schema?.missing_tokens||["UNKNOWN"]);
    const schema=data.statistics_schema?.variables||[],metrics=metricDefinitions(data),panels=[],root=el("div","dm-relationship-explorer");
    const dialog=el("dialog","dm-relationship-dialog"),dialogHead=el("header"),dialogTitle=el("h2"),dialogClose=el("button",null,"×"),dialogBody=el("div","dm-relationship-dialog-body");
    dialogTitle.id="dm-relationship-detail-title";dialog.setAttribute("aria-labelledby",dialogTitle.id);dialogClose.type="button";dialogClose.setAttribute("aria-label",t("close"));dialogClose.addEventListener("click",()=>dialog.close());dialogHead.append(dialogTitle,dialogClose);dialog.append(dialogHead,dialogBody);dialog.addEventListener("click",event=>{if(event.target===dialog)dialog.close();});
    function field(key,options,value,cls=""){
      const label=el("label","dm-rel-control "+cls),caption=el("span",null,t(key)),select=el("select");select.setAttribute("aria-label",t(key));
      options.forEach(option=>select.add(new Option(option.label,option.value)));select.value=value;label.append(caption,select);return {label,select};
    }
    function toggle(key,checked){
      const label=el("label","dm-rel-toggle"),caption=el("span",null,t(key)),input=el("input");input.type="checkbox";input.checked=checked;input.setAttribute("role","switch");input.setAttribute("aria-label",t(key));label.append(caption,input);return {label,input};
    }
    function activeModelOptions(){return manager.getActiveExperiments().map(exp=>({value:exp.id,label:exp.name}));}
    function availableVariables(modelId){return schema.filter(item=>item.available_in.includes(modelId)&&item.role!=="path"&&!(item.role==="identifier"&&item.key!=="type_id")).map(item=>item.key);}
    function defaults(modelId,count){
      const variables=availableVariables(modelId),rows=getRows(manager.getActiveExperiments().find(exp=>exp.id===modelId));
      const categories=variables.filter(variable=>{const values=rows.map(row=>row[variable]),unique=new Set(values.filter(value=>!missing(value)).map(String)).size;return unique>1&&unique<=30;});
      const metadata=categories.filter(variable=>schema.find(item=>item.key===variable)?.role==="metadata");
      const analytical=categories.filter(variable=>!metadata.includes(variable)&&!['ground_truth','label'].includes(variable));
      const targets=categories.filter(variable=>!metadata.includes(variable)&&!analytical.includes(variable));
      const preferred={
        binary:["capture_device","environment","quality_band","age_bin","gender","race","true_label","ground_truth","label","pred_label","prediction","score"],age_estimation:["gender","race","quality_band"],
        regression:["gender","quality_band","environment"],multiclass:["ground_truth","prediction","quality_band"],
        ocr:["type_id","country","device_os"],object_detection:["ground_truth_class","predicted_class","error_type"],
        segmentation:["density_band","contrast_band","area_band"],eye_evaluation:["eye_side","target_type","quality_band"],
        eye_tracking:["condition","valid","confidence"],
      }[data.panel_mode==="tracking"?"eye_tracking":data.task]||[];
      const semanticKey=variable=>["ground_truth","label","true_label"].includes(variable)?"__target__":["prediction","pred_label","predicted_label"].includes(variable)?"__prediction__":variable;
      const seen=new Set(),ranked=[...preferred.filter(variable=>variables.includes(variable)),...metadata,...analytical,...targets,...variables.filter(variable=>!categories.includes(variable))];
      const picks=ranked.filter(variable=>{const key=semanticKey(variable);if(seen.has(key))return false;seen.add(key);return true;}).slice(0,count);
      while(picks.length<count)picks.push(variables.find(variable=>!picks.includes(variable))||variables[0]||"");
      if(count===3){const cardinality=variable=>new Set(rows.map(row=>row[variable]).filter(value=>!missing(value)).map(String)).size,facet=picks.reduce((a,b)=>cardinality(a)<=cardinality(b)?a:b);picks.splice(0,3,...picks.filter(value=>value!==facet),facet);}
      return picks;
    }
    function build(count){
      const section=el("section","dm-v2-stat-section dm-v2-custom dm-relationship-panel");section.id="dm-v2-custom"+count;
      section.dataset.relationshipVariables=String(count);
      const header=el("header","dm-rel-header"),badge=el("span","dm-rel-number",String(count)),heading=el("div"),title=el("h2",null,t(count===2?"twoVariables":"threeVariables")),subtitle=el("p",null,t(count===2?"twoHelp":"threeHelp")),hint=el("span","dm-rel-hint",t("cellHint"));heading.append(title,subtitle);header.append(badge,heading,hint);section.append(header);
      const modelId=manager.getActiveIds()[0],variables=availableVariables(modelId),initial=defaults(modelId,count),state={count,modelId,x:initial[0],y:initial[1],z:initial[2]||null,metric:"count",normalize:"none",visualization:"heatmap",scale:"shared",sortRows:"default",sortColumns:"default",labels:"both",hideZeros:false,bins:"auto"};
      const controls=el("div","dm-rel-controls"),model=field("model",activeModelOptions(),state.modelId,"dm-rel-model"),x=field("xAxis",variables.map(value=>({value,label:value})),state.x),y=field("yAxis",variables.map(value=>({value,label:value})),state.y),z=count===3?field("facet",variables.map(value=>({value,label:value})),state.z):null;
      const metric=field("value",metrics.map(item=>({value:item.key,label:t(item.label)})),state.metric),visualization=field("visualization",[{value:"heatmap",label:t("heatmap")},{value:"bubble",label:t("bubbleMatrix")}],state.visualization),normalization=field("normalize",[{value:"none",label:t("none")},{value:"row_pct",label:t("rowPercentage")},{value:"column_pct",label:t("columnPercentage")},{value:"total_pct",label:t("totalPercentage")}],state.normalize),scale=field("scale",[{value:"shared",label:t("shared")},{value:"independent",label:t("independent")}],state.scale),sortRows=field("sortRows",sortOptions(),state.sortRows),sortColumns=field("sortColumns",sortOptions(),state.sortColumns),labels=field("labels",[{value:"both",label:t("countAndPercent")},{value:"value",label:t("valueOnly")},{value:"support",label:t("supportOnly")},{value:"none",label:t("none")}],state.labels),hideZeros=toggle("hideZeros",false),bins=field("binning",[{value:"auto",label:t("automaticBins")},...[5,10,15,20].map(value=>({value:String(value),label:t("binsCount",{n:value})}))],state.bins,"dm-rel-bins");
      const controlsList=[model,x,y,...(z?[z]:[]),metric,visualization,normalization,scale,sortRows,sortColumns,labels];controlsList.forEach(control=>controls.append(control.label));controls.append(hideZeros.label,bins.label);section.append(controls);
      const chartHead=el("div","dm-rel-chart-head"),chartTitle=el("h3"),chartMeta=el("p"),plots=el("div","dm-rel-plots"),notice=el("p","dm-stat-summary-note");notice.hidden=true;chartHead.append(chartTitle,chartMeta);section.append(notice,chartHead,plots);
      const panel={section,state,controls:{model,x,y,z,metric,visualization,normalization,scale,sortRows,sortColumns,labels,hideZeros,bins},chartTitle,chartMeta,plots,notice,cells:new Map(),frame:0};panels.push(panel);
      const schedule=()=>{if(!panel.frame)panel.frame=requestAnimationFrame(()=>{panel.frame=0;renderPanel(panel);});};
      for(const [key,control]of Object.entries(panel.controls)){
        const input=control?.select||control?.input;if(!input)continue;
        input.dataset.relationshipControl=key==="normalization"?"normalize":key;
        input.addEventListener("change",()=>{
          const stateKey=key==="model"?"modelId":key==="normalization"?"normalize":key;
          panel.state[stateKey]=input.type==="checkbox"?input.checked:input.value;
          if(key==="model")syncVariables(panel,true);
          if(key==="metric"){const countMetric=input.value==="count";normalization.select.disabled=!countMetric;if(!countMetric){normalization.select.value="none";panel.state.normalize="none";}labels.select.options[0].textContent=countMetric?t("countAndPercent"):t("valueAndSupport");}
          if(key==="x"||key==="y"||key==="z")preventDuplicate(panel,key);
          schedule();
        });
      }
      return section;
    }
    function sortOptions(){return [{value:"default",label:t("default")},{value:"frequency_desc",label:t("frequencyHigh")},{value:"frequency_asc",label:t("frequencyLow")},{value:"label_asc",label:t("labelAscending")},{value:"label_desc",label:t("labelDescending")}];}
    function preventDuplicate(panel,key){
      const keys=panel.state.count===3?["x","y","z"]:["x","y"],chosen=panel.state[key],duplicate=keys.find(name=>name!==key&&panel.state[name]===chosen);if(!duplicate)return;
      const variables=availableVariables(panel.state.modelId),replacement=variables.find(variable=>!keys.some(name=>panel.state[name]===variable));if(replacement){panel.state[duplicate]=replacement;panel.controls[duplicate].select.value=replacement;}
    }
    function syncVariables(panel,reset){
      const variables=availableVariables(panel.state.modelId),keys=panel.state.count===3?["x","y","z"]:["x","y"],fresh=defaults(panel.state.modelId,panel.state.count);
      keys.forEach((key,index)=>{const select=panel.controls[key].select,current=reset?fresh[index]:panel.state[key];select.replaceChildren(...variables.map(value=>new Option(value,value)));panel.state[key]=variables.includes(current)?current:fresh[index];select.value=panel.state[key];});
    }
    function cellLabel(cell,display,metric,state,share){
      if(state.labels==="none")return "";
      const value=metric.unit==="percent"||metric.unit==="percent_ratio"?display.toFixed(display>=10?1:2)+"%":display.toLocaleString(undefined,{maximumFractionDigits:3});
      const support=cell.rows.length.toLocaleString();
      if(state.labels==="value")return value;if(state.labels==="support")return support;
      return metric.key==="count"?(state.normalize==="none"?`${support}<br><span>${share.toFixed(1)}%</span>`:`${value}<br><span>${support}</span>`):`${value}<br><span>n=${support}</span>`;
    }
    function renderPanel(panel){
      const state=panel.state,exp=manager.getActiveExperiments().find(item=>item.id===state.modelId);
      if(!exp)return;
      const rows=getRows(exp),metric=metrics.find(item=>item.key===state.metric)||metrics[0],xAxis=axis(rows.map(row=>row[state.x]),state.x,state.bins,missing),yAxis=axis(rows.map(row=>row[state.y]),state.y,state.bins,missing),zAxis=state.count===3?axis(rows.map(row=>row[state.z]),state.z,state.bins,missing):{labels:[null],map:()=>null};
      const colorScale=HIGHER_IS_BETTER.has(metric.key)?COLORS.map((stop,index)=>[stop[0],COLORS[COLORS.length-1-index][1]]):COLORS;
      const xCounts=new Map(),yCounts=new Map(),cells=new Map();let total=0;
      rows.forEach(row=>{const xv=xAxis.map(row[state.x]),yv=yAxis.map(row[state.y]),zv=zAxis.map(row[state.z]);xCounts.set(xv,(xCounts.get(xv)||0)+1);yCounts.set(yv,(yCounts.get(yv)||0)+1);const key=JSON.stringify([zv,yv,xv]),cell=cells.get(key)||{rows:[],x:xv,y:yv,z:zv};cell.rows.push(row);cells.set(key,cell);total++;});
      const xs=order(xAxis.labels,xCounts,state.sortColumns),ys=order(yAxis.labels,yCounts,state.sortRows),facets=zAxis.labels;
      cells.forEach(cell=>{cell.metric=metric.aggregate(cell.rows);if(metric.unit==="percent_ratio"&&cell.metric.value!==null)cell.metric.value*=100;});
      const facetData=facets.map(facet=>{
        const facetRows=facet===null?rows:rows.filter(row=>zAxis.map(row[state.z])===facet);
        const matrix=ys.map(y=>xs.map(x=>cells.get(JSON.stringify([facet,y,x]))||{rows:[],x,y,z:facet,metric:{value:metric.key==="count"?0:null,n:0}}));
        const rowTotals=new Map(ys.map((y,rowIndex)=>[y,matrix[rowIndex].reduce((sum,cell)=>sum+cell.rows.length,0)]));
        const columnTotals=new Map(xs.map((x,column)=>[x,matrix.reduce((sum,row)=>sum+row[column].rows.length,0)]));
        const values=matrix.map(row=>row.map(cell=>normalize(cell.metric.value,cell.rows.length,rowTotals.get(cell.y),columnTotals.get(cell.x),facetRows.length,state.normalize,metric.key)));
        return {facet,facetRows,matrix,values};
      });
      const displayed=facetData.flatMap(item=>item.values.flat()).filter(Number.isFinite),globalMax=Math.max(1,...displayed),globalMin=metric.key==="mean:residual"?Math.min(0,...displayed):0;
      const displayMean=displayed.length?displayed.reduce((sum,value)=>sum+value,0)/displayed.length:0;
      panel.controls.bins.select.disabled=![xAxis,yAxis,...(state.count===3?[zAxis]:[])].some(item=>item.numeric);
      panel.cells=cells;panel.chartTitle.textContent=t(state.count===2?"chartTitleTwo":"chartTitleThree",{value:t(metric.label),x:state.x,y:state.y,facet:state.z});
      const meta=[state.normalize!=="none"?t("normalizedBy",{mode:t(state.normalize==="row_pct"?"row":state.normalize==="column_pct"?"column":"total")}):t("rawValues"),state.count===3?t(state.scale==="shared"?"sharedScaleAll":"independentScales"):t("sharedScale"),t("totalCount",{n:total.toLocaleString()})];panel.chartMeta.textContent=meta.join("  |  ");
      panel.notice.hidden=rows.length>0;panel.notice.textContent=rows.length?"":t("noRows");panel.plots.replaceChildren();panel.plots.className="dm-rel-plots dm-rel-facets-"+Math.min(4,facets.length);
      facetData.forEach(({facet,facetRows,matrix,values},index)=>{
        const card=el("article","dm-rel-facet"),header=el("header"),title=el("h4",null,facet===null?t("allRecords"):String(facet));header.append(title,el("span",null,t("facetN",{n:facetRows.length.toLocaleString()})));card.append(header);
        const plot=el("div","dm-rel-plot");plot.tabIndex=0;plot.setAttribute("aria-label",panel.chartTitle.textContent+(facet===null?"":" · "+state.z+" "+facet));card.append(plot);panel.plots.append(card);
        plot.dataset.relationshipFacet=facet===null?"__all__":String(facet);
        const local=values.flat().filter(Number.isFinite),zmin=state.scale==="shared"?globalMin:(metric.key==="mean:residual"?Math.min(0,...local):0),zmax=state.scale==="shared"?globalMax:Math.max(1,...local);
        const plottedValues=state.hideZeros?values.map((row,rowIndex)=>row.map((value,columnIndex)=>matrix[rowIndex][columnIndex].rows.length?value:null)):values;
        const annotations=[];matrix.forEach((row,rowIndex)=>row.forEach((cell,columnIndex)=>{const value=values[rowIndex][columnIndex];if(state.hideZeros&&cell.rows.length===0)return;if(value===null){if(cell.rows.length)annotations.push({x:xs[columnIndex],y:ys[rowIndex],text:t("unavailable"),showarrow:false,font:{size:11,color:"#70839e"}});return;}const share=facetRows.length?100*cell.rows.length/facetRows.length:0,text=cellLabel(cell,value,metric,state,share);if(text)annotations.push({x:xs[columnIndex],y:ys[rowIndex],text,showarrow:false,font:{size:12,color:"#173352"},bordercolor:cell.rows.length>0&&cell.rows.length<(Number(data.group_audit_min_samples)||20)?"#e4a058":"rgba(0,0,0,0)",borderwidth:cell.rows.length>0&&cell.rows.length<(Number(data.group_audit_min_samples)||20)?1:0,borderpad:1});}));
        const custom=matrix.map((row,rowIndex)=>row.map((cell,columnIndex)=>[cell.rows.length,cell.metric.n??cell.rows.length,cell.metric.numerator??null,cell.metric.denominator??null,JSON.stringify([facet,cell.y,cell.x]),facetRows.length?100*cell.rows.length/facetRows.length:0,(values[rowIndex][columnIndex]??0)-displayMean]));
        const hover=`<b>${escape(state.x)}: %{x}</b><br>${escape(state.y)}: %{y}<br>${escape(t(metric.label))}: %{z:.3f}<br>${escape(t("support"))}: %{customdata[0]:,}<br>${escape(t("facetShare"))}: %{customdata[5]:.2f}%<br>${escape(t("differenceMean"))}: %{customdata[6]:+.3f}<extra>${escape(exp.name)}</extra>`;
        const trace=state.visualization==="bubble"?{type:"scatter",mode:"markers",x:matrix.flat().map(cell=>cell.x),y:matrix.flat().map(cell=>cell.y),customdata:custom.flat(),marker:{size:plottedValues.flat().map(value=>value===null?0:8+34*Math.sqrt(Math.abs(value)/(Math.max(Math.abs(zmin),Math.abs(zmax))||1))),color:plottedValues.flat(),colorscale:colorScale,cmin:zmin,cmax:zmax,showscale:index===facets.length-1,colorbar:{title:{text:t(metric.label)}}},hovertemplate:hover}:{type:"heatmap",x:xs,y:ys,z:plottedValues,customdata:custom,colorscale:colorScale,zmin,zmax,showscale:index===facets.length-1,colorbar:{title:{text:t(metric.label)}},hoverongaps:false,hovertemplate:hover};
        const height=Math.max(state.count===2?310:245,120+ys.length*36),layout={height,margin:{l:Math.min(180,Math.max(74,Math.max(...ys.map(value=>String(value).length),4)*7)),r:index===facets.length-1?72:18,t:10,b:Math.min(110,48+Math.max(...xs.map(value=>String(value).length),4)*3)},annotations,showlegend:false,xaxis:{type:"category",title:{text:state.x},categoryorder:"array",categoryarray:xs,tickangle:xs.length>8?-28:0,automargin:true},yaxis:{type:"category",title:{text:state.y},categoryorder:"array",categoryarray:ys,autorange:"reversed",automargin:true}};
        host.Plotly.react(plot,[trace],layout,{responsive:true,displayModeBar:true}).then(()=>{host.DM_COMPARISON?.resize(plot);host.DM_I18N?.localizePlot?.(plot);});
        plot.on("plotly_click",event=>{const point=event.points?.[0],token=point?.customdata?.[4];if(token)openCell(panel,exp,metric,cells.get(token),point.event?.target||plot);});
      });
    }
    let dialogOpener=null;
    function openCell(panel,exp,metric,cell,opener){
      if(!cell)return;dialogOpener=opener;dialogTitle.textContent=t("detailTitle",{x:cell.x,y:cell.y});dialogBody.replaceChildren();
      const summary=el("p","dm-rel-detail-summary",t("detailSummary",{model:exp.name,metric:t(metric.label),n:cell.rows.length.toLocaleString()}));dialogBody.append(summary);
      const wrap=el("div","dm-rel-detail-table-wrap"),table=el("table","dm-rel-detail-table"),head=el("thead"),body=el("tbody"),keys=["record_id","sample_id","image_id",panel.state.x,panel.state.y,...(panel.state.z?[panel.state.z]:[]),"ground_truth","prediction","score"].filter((key,index,array)=>key&&array.indexOf(key)===index&&cell.rows.some(row=>Object.hasOwn(row,key))).slice(0,8),trh=el("tr");keys.forEach(key=>{const th=el("th",null,key);th.scope="col";trh.append(th);});head.append(trh);cell.rows.slice(0,25).forEach(row=>{const tr=el("tr");keys.forEach(key=>tr.append(el("td",null,String(row[key]??t("unavailable")))));body.append(tr);});table.append(head,body);wrap.append(table);dialogBody.append(wrap);
      const actions=el("footer");if(data.task==="binary"&&onShowTable){const button=el("button",null,t("showInTable"));button.type="button";button.addEventListener("click",()=>{dialog.close();onShowTable(exp.id,[{dimension:panel.state.x,value:cell.x},{dimension:panel.state.y,value:cell.y}]);});actions.append(button);}const note=el("span",null,cell.rows.length>25?t("showingFirst",{n:25}):t("showingAll"));actions.append(note);dialogBody.append(actions);dialog.showModal();
    }
    dialog.addEventListener("close",()=>dialogOpener?.focus?.({preventScroll:true}));
    root.append(build(2),build(3),dialog);
    function reconcileModels(){
      const options=activeModelOptions();panels.forEach(panel=>{const select=panel.controls.model.select,current=panel.state.modelId;select.replaceChildren(...options.map(option=>new Option(option.label,option.value)));panel.state.modelId=options.some(option=>option.value===current)?current:options[0]?.value;select.value=panel.state.modelId;syncVariables(panel,false);});render();
    }
    function syncModels(){reconcileModels();}
    function render(){
      const active=activeModelOptions();
      panels.forEach(panel=>{
        const currentOptions=[...panel.controls.model.select.options].map(option=>option.value);
        const nextOptions=active.map(option=>option.value);
        if(currentOptions.join("\0")!==nextOptions.join("\0")||!nextOptions.includes(panel.state.modelId)){
          panel.controls.model.select.replaceChildren(...active.map(option=>new Option(option.label,option.value)));
          panel.state.modelId=nextOptions.includes(panel.state.modelId)?panel.state.modelId:nextOptions[0];
          panel.controls.model.select.value=panel.state.modelId;syncVariables(panel,false);
        }
        renderPanel(panel);
      });
    }
    return {root,render,syncModels};
  };
})(typeof window==="undefined"?globalThis:window);
