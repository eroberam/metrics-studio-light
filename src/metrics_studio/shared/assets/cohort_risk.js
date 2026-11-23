/* Dynamic intersectional cohort-risk engine. UI-independent and testable in Node. */
(function (root) {
  "use strict";

  const METRICS = Object.freeze({
    far: { direction:"higher", label:"FAR" },
    frr: { direction:"higher", label:"FRR" },
    accuracy: { direction:"lower", label:"Accuracy" },
    precision: { direction:"lower", label:"Precision" },
    recall: { direction:"lower", label:"Recall" },
    f1: { direction:"lower", label:"F1" },
    tar: { direction:"lower", label:"TAR" },
    error_rate: { direction:"higher", label:"Error rate" },
  });

  function finite(value) {
    return value!==null&&value!==""&&typeof value!=="boolean"&&Number.isFinite(Number(value));
  }
  function safeRatio(numerator, denominator) {
    return denominator > 0 ? numerator / denominator : null;
  }
  function metricDefinition(metric) {
    return METRICS[metric] || METRICS.far;
  }
  function combinations(values, order) {
    const result=[];
    function visit(start, selected) {
      if(selected.length===order){result.push(selected.slice());return;}
      for(let index=start;index<values.length;index+=1){
        selected.push(values[index]);visit(index+1,selected);selected.pop();
      }
    }
    visit(0,[]);return result;
  }
  function normalizedValue(value) {
    return value==null||value===""||value==="UNKNOWN"?"UNKNOWN":String(value);
  }
  function canonicalCohortKey(definition) {
    return JSON.stringify(definition.map(item=>[item.dimension,item.value]));
  }
  function cohortLabel(definition) {
    return definition.map(item=>item.dimension+"="+item.value).join(" AND ");
  }

  function applyDecisionThreshold(records, model, decisionThreshold) {
    const threshold=Number(decisionThreshold);
    const positiveLabel=Number(model?.positiveLabel??model?.positive_label??1);
    const negativeLabel=Number(model?.negativeLabel??model?.negative_label??0);
    const positiveIfHigher=model?.positiveIfHigherScore??model?.positive_if_higher_score??true;
    return (records||[]).map((record,index)=>{
      const score=Number(record.score);
      const truth=Number(record.ground_truth??record.label);
      const predictedPositive=finite(score)&&finite(threshold)
        ?(positiveIfHigher?score>=threshold:score<=threshold):false;
      return {
        ...record,
        _sourceIndex:index,
        _truthPositive:truth===positiveLabel,
        _truthNegative:truth===negativeLabel,
        _predictedPositive:predictedPositive,
      };
    });
  }

  function calculateConfusionCounts(records) {
    return (records||[]).reduce((counts,row)=>{
      if(row._truthPositive&&row._predictedPositive)counts.tp+=1;
      else if(row._truthPositive&&!row._predictedPositive)counts.fn+=1;
      else if(row._truthNegative&&row._predictedPositive)counts.fp+=1;
      else if(row._truthNegative&&!row._predictedPositive)counts.tn+=1;
      return counts;
    },{tp:0,tn:0,fp:0,fn:0});
  }

  function metricEvidence(counts, metric) {
    const total=counts.tp+counts.tn+counts.fp+counts.fn;
    const positives=counts.tp+counts.fn;
    const negatives=counts.tn+counts.fp;
    const errors=counts.fp+counts.fn;
    if(metric==="far")return {events:counts.fn,eligible:positives,numerator:counts.fn,denominator:positives};
    if(metric==="frr")return {events:counts.fp,eligible:negatives,numerator:counts.fp,denominator:negatives};
    if(metric==="accuracy")return {events:errors,eligible:total,numerator:counts.tp+counts.tn,denominator:total};
    if(metric==="precision")return {events:counts.fp,eligible:total,numerator:counts.tp,denominator:counts.tp+counts.fp};
    if(metric==="recall")return {events:counts.fn,eligible:total,numerator:counts.tp,denominator:positives};
    if(metric==="tar")return {events:counts.fp,eligible:total,numerator:counts.tn,denominator:negatives};
    if(metric==="error_rate")return {events:errors,eligible:total,numerator:errors,denominator:total};
    return {events:errors,eligible:total,numerator:null,denominator:null};
  }

  function calculateMetric(counts, metric) {
    const total=counts.tp+counts.tn+counts.fp+counts.fn;
    if(metric==="far")return safeRatio(counts.fn,counts.tp+counts.fn);
    if(metric==="frr")return safeRatio(counts.fp,counts.tn+counts.fp);
    if(metric==="accuracy")return safeRatio(counts.tp+counts.tn,total);
    if(metric==="precision")return safeRatio(counts.tp,counts.tp+counts.fp);
    if(metric==="recall")return safeRatio(counts.tp,counts.tp+counts.fn);
    if(metric==="f1")return safeRatio(2*counts.tp,2*counts.tp+counts.fp+counts.fn);
    if(metric==="tar")return safeRatio(counts.tn,counts.tn+counts.fp);
    if(metric==="error_rate")return safeRatio(counts.fp+counts.fn,total);
    return null;
  }

  function aggregateMetric(records, spec) {
    const rows=records||[];
    if(!rows.length)return {value:null,numerator:0,denominator:0,events:0,support:0};
    if(spec?.kind==="f1"){
      const counts=rows.reduce((sum,row)=>{
        sum.tp+=Number(row._tp)||0;sum.fp+=Number(row._fp)||0;sum.fn+=Number(row._fn)||0;
        return sum;
      },{tp:0,fp:0,fn:0});
      const denominator=2*counts.tp+counts.fp+counts.fn;
      return {value:denominator>0?2*counts.tp/denominator:null,numerator:2*counts.tp,
        denominator,events:counts.fp+counts.fn,support:rows.length};
    }
    const totals=rows.reduce((sum,row)=>{
      sum.numerator+=Number(row[spec?.numerator])||0;
      sum.denominator+=Number(row[spec?.denominator])||0;
      return sum;
    },{numerator:0,denominator:0});
    const ratio=totals.denominator>0?totals.numerator/totals.denominator:null;
    const value=ratio==null?null:(spec?.kind==="rmse"?Math.sqrt(ratio):ratio);
    const events=spec?.key==="accuracy"?Math.max(0,totals.denominator-totals.numerator):
      spec?.key==="error_rate"||spec?.key==="missing_rate"?totals.numerator:rows.length;
    const support=spec?.support==="denominator"?totals.denominator:rows.length;
    return {...totals,value,events,support};
  }

  function calculateFilteredOverall(records, model, metric, decisionThreshold) {
    const decided=applyDecisionThreshold(records,model,decisionThreshold);
    const counts=calculateConfusionCounts(decided);
    return {value:calculateMetric(counts,metric),counts,evidence:metricEvidence(counts,metric)};
  }

  function generateObservedIntersections(records, selectedDimensions, minOrder, maxOrder) {
    const dimensions=Array.from(new Set(selectedDimensions||[]));
    const minimum=Math.max(1,Math.min(dimensions.length,Number(minOrder)||1));
    const maximum=Math.max(minimum,Math.min(dimensions.length,Number(maxOrder)||dimensions.length));
    const intersections=[];
    for(let order=minimum;order<=maximum;order+=1){
      combinations(dimensions,order).forEach(subset=>{
        const groups=new Map();
        (records||[]).forEach(row=>{
          const definition=subset.map(dimension=>({dimension,value:normalizedValue(row[dimension])}));
          const key=canonicalCohortKey(definition);
          if(!groups.has(key))groups.set(key,{key,definition,label:cohortLabel(definition),order,rows:[]});
          groups.get(key).rows.push(row);
        });
        groups.forEach(group=>{
          group.sampleSignature=group.rows.map(row=>row._sourceIndex).sort((a,b)=>a-b).join(",");
          intersections.push(group);
        });
      });
    }
    return intersections;
  }

  function calculateWilsonInterval(successes, trials, z) {
    const n=Number(trials),x=Number(successes),critical=finite(z)?Number(z):1.959963984540054;
    if(!(n>0)||!(x>=0)||x>n)return null;
    const proportion=x/n,z2=critical*critical,denominator=1+z2/n;
    const center=(proportion+z2/(2*n))/denominator;
    const spread=critical*Math.sqrt((proportion*(1-proportion)+z2/(4*n))/n)/denominator;
    return [Math.max(0,center-spread),Math.min(1,center+spread)];
  }

  function evaluateCohort(records, cohortDefinition, model, metric, decisionThreshold) {
    const decided=records?.[0]?._predictedPositive===undefined
      ?applyDecisionThreshold(records,model,decisionThreshold):records;
    const counts=calculateConfusionCounts(decided);
    const evidence=metricEvidence(counts,metric),value=calculateMetric(counts,metric);
    const interval=metric==="f1"||evidence.numerator==null
      ?null:calculateWilsonInterval(evidence.numerator,evidence.denominator);
    return {definition:cohortDefinition,counts,evidence,value,interval};
  }

  function calculateAdverseDifference(cohortValue, overallValue, metricDirection) {
    if(!finite(cohortValue)||!finite(overallValue))return null;
    return metricDirection==="lower"
      ?Number(overallValue)-Number(cohortValue)
      :Number(cohortValue)-Number(overallValue);
  }

  function calculateRelativeRisk(cohortValue, overallValue) {
    if(!finite(cohortValue)||!finite(overallValue))return null;
    if(Number(overallValue)===0)return Number(cohortValue)>0?Infinity:null;
    return Number(cohortValue)/Number(overallValue);
  }

  function parentKeys(definition) {
    if(!definition||definition.length<=1)return[];
    return definition.map((_item,index)=>canonicalCohortKey(definition.filter((_entry,entryIndex)=>entryIndex!==index)));
  }

  function calculateInteractionUplift(cohort, parentCohorts, metricDirection) {
    if(!cohort||cohort.order<=1||!finite(cohort.value))return null;
    const values=(parentCohorts||[]).map(parent=>parent?.value).filter(finite).map(Number);
    if(!values.length)return null;
    return metricDirection==="lower"
      ?Math.min(...values)-Number(cohort.value)
      :Number(cohort.value)-Math.max(...values);
  }

  function removeRedundantIntersections(results, tolerance) {
    const limit=(finite(tolerance)?Number(tolerance):0.01);
    const lookup=new Map((results||[]).map(result=>[result.key,result]));
    return (results||[]).filter(result=>{
      if(result.order<=1)return true;
      const parents=parentKeys(result.definition).map(key=>lookup.get(key)).filter(Boolean);
      return !parents.some(parent=>
        result.sampleSignature===parent.sampleSignature||
        (finite(result.value)&&finite(parent.value)&&Math.abs(result.value-parent.value)<=limit)
      );
    });
  }

  function matchesTarget(value, operator, target) {
    if(!finite(value)||!finite(target))return false;
    const observed=Number(value),goal=Number(target);
    if(operator===">")return observed>goal;
    if(operator==="<=")return observed<=goal;
    if(operator==="<")return observed<goal;
    return observed>=goal;
  }

  function updateThresholdRegistry(registry, experiments, modelId, value, applyToAll) {
    if(!registry||typeof registry.set!=="function"||!finite(value))return false;
    const threshold=Number(value);
    if(applyToAll===true){
      (experiments||[]).forEach(experiment=>registry.set(experiment.id,threshold));
      return true;
    }
    if(!modelId)return false;
    let experiment=(experiments||[]).find(item=>item.id===modelId);
    if(!experiment){
      const match=String(modelId).match(/(\d+)$/),index=match?Number(match[1]):-1;
      experiment=(experiments||[])[index];
    }
    if(!experiment)return false;
    registry.set(experiment.id,threshold);return true;
  }

  function rankCohorts(results, searchMode, riskTarget, operator, rankBy, metricDirection) {
    const direction=metricDirection||"higher";
    let ranked=(results||[]).filter(result=>result.eligible&&finite(result.value));
    if(searchMode==="target")ranked=ranked.filter(result=>matchesTarget(result.value,operator,riskTarget));
    ranked.sort((a,b)=>{
      if(searchMode==="target"){
        return a.order-b.order||b.evidence.eligible-a.evidence.eligible||
          (b.adverseDifference??-Infinity)-(a.adverseDifference??-Infinity)||
          (direction==="lower"?a.value-b.value:b.value-a.value)||a.label.localeCompare(b.label);
      }
      const primary=rankBy==="observed"
        ?(direction==="lower"?a.value-b.value:b.value-a.value)
        :(b.adverseDifference??-Infinity)-(a.adverseDifference??-Infinity);
      return primary||b.evidence.eligible-a.evidence.eligible||a.order-b.order||a.label.localeCompare(b.label);
    });
    return ranked.map((result,index)=>({...result,rank:index+1}));
  }

  function analyzeCohortRisk(options) {
    const metric=options.metric||"far",definition=metricDefinition(metric);
    const minimumSupport=finite(options.minimumEligibleSupport)?Math.max(1,Number(options.minimumEligibleSupport)):20;
    const minimumErrors=finite(options.minimumErrorEvents)?Math.max(0,Number(options.minimumErrorEvents)):3;
    const requestedMinOrder=Math.max(1,Number(options.minOrder)||1);
    const requestedMaxOrder=Math.max(requestedMinOrder,Number(options.maxOrder)||(options.dimensions||[]).length);
    const decided=applyDecisionThreshold(options.records||[],options.model||{},options.decisionThreshold);
    const overallCounts=calculateConfusionCounts(decided);
    const overallValue=calculateMetric(overallCounts,metric);
    const intersections=generateObservedIntersections(
      decided,options.dimensions||[],1,requestedMaxOrder
    );
    let results=intersections.map(intersection=>{
      const evaluated=evaluateCohort(intersection.rows,intersection.definition,options.model,metric,options.decisionThreshold);
      return {
        ...intersection,...evaluated,
        modelId:options.modelId||"",modelName:options.modelName||"",
        metric,metricDirection:definition.direction,overallValue,
        adverseDifference:calculateAdverseDifference(evaluated.value,overallValue,definition.direction),
        relativeRisk:calculateRelativeRisk(evaluated.value,overallValue),
        eligible:evaluated.evidence.eligible>=minimumSupport&&evaluated.evidence.events>=minimumErrors,
      };
    });
    const lookup=new Map(results.map(result=>[result.key,result]));
    results.forEach(result=>{
      result.interactionUplift=calculateInteractionUplift(
        result,parentKeys(result.definition).map(key=>lookup.get(key)).filter(Boolean),definition.direction
      );
    });
    if(options.removeRedundant!==false)results=removeRedundantIntersections(results,options.redundancyTolerance??0.01);
    const observedCount=intersections.filter(intersection=>intersection.order>=requestedMinOrder).length;
    results=results.filter(result=>result.order>=requestedMinOrder);
    const eligible=results.filter(result=>result.eligible&&finite(result.value));
    const ranked=rankCohorts(
      results,options.searchMode||"worst",options.riskTarget,options.operator||">=",
      options.rankBy||"adverse_difference",definition.direction
    );
    return {
      metric,metricDefinition:definition,modelId:options.modelId||"",modelName:options.modelName||"",
      decisionThreshold:Number(options.decisionThreshold),
      overallValue,overallCounts,observedCount,
      eligibleCount:eligible.length,targetCount:(options.searchMode==="target"?ranked.length:0),
      highestEligible:rankCohorts(eligible,"worst",null,">=","observed",definition.direction)[0]||null,
      results,ranked,
    };
  }

  function analyzeAggregatedCohortRisk(options) {
    const records=(options.records||[]).map((row,index)=>
      row._sourceIndex===undefined?{...row,_sourceIndex:index}:row
    );
    const metric=options.spec?.key||options.metric||"metric";
    const direction=options.metricDirection||"higher";
    const minimumSupport=finite(options.minimumSupport)
      ?Math.max(1,Number(options.minimumSupport)):20;
    const requestedMinOrder=Math.max(1,Number(options.minOrder)||1);
    const requestedMaxOrder=Math.max(requestedMinOrder,
      Number(options.maxOrder)||(options.dimensions||[]).length);
    const overall=aggregateMetric(records,options.spec||{});
    const intersections=generateObservedIntersections(
      records,options.dimensions||[],1,requestedMaxOrder
    );
    let results=intersections.map(intersection=>{
      const aggregate=aggregateMetric(intersection.rows,options.spec||{});
      return {...intersection,modelId:options.modelId||"",modelName:options.modelName||"",
        metric,metricDirection:direction,value:aggregate.value,overallValue:overall.value,
        evidence:{events:aggregate.events,eligible:aggregate.support,numerator:aggregate.numerator,
          denominator:aggregate.denominator},interval:null,
        adverseDifference:calculateAdverseDifference(aggregate.value,overall.value,direction),
        relativeRisk:calculateRelativeRisk(aggregate.value,overall.value),
        eligible:aggregate.support>=minimumSupport&&finite(aggregate.value)};
    });
    const lookup=new Map(results.map(result=>[result.key,result]));
    results.forEach(result=>{
      result.interactionUplift=calculateInteractionUplift(
        result,parentKeys(result.definition).map(key=>lookup.get(key)).filter(Boolean),direction
      );
    });
    const observedCount=intersections.filter(intersection=>intersection.order>=requestedMinOrder).length;
    results=results.filter(result=>result.order>=requestedMinOrder);
    if(options.removeRedundant!==false){
      results=removeRedundantIntersections(results,options.redundancyTolerance??0.01);
    }
    const eligibleCount=results.filter(result=>result.eligible).length;
    const ranked=rankCohorts(results,"worst",null,">=",options.rankBy||"observed",direction);
    return {metric,metricDirection:direction,modelId:options.modelId||"",modelName:options.modelName||"",
      overallValue:overall.value,overallEvidence:{eligible:overall.support,numerator:overall.numerator,
        denominator:overall.denominator},observedCount,eligibleCount,filteredCount:records.length,results,ranked};
  }

  root.DM_COHORT_RISK={
    METRICS,metricDefinition,canonicalCohortKey,applyDecisionThreshold,
    calculateConfusionCounts,calculateMetric,aggregateMetric,calculateFilteredOverall,
    generateObservedIntersections,evaluateCohort,calculateWilsonInterval,
    calculateAdverseDifference,calculateRelativeRisk,calculateInteractionUplift,
    removeRedundantIntersections,rankCohorts,matchesTarget,updateThresholdRegistry,analyzeCohortRisk,
    analyzeAggregatedCohortRisk,
  };
})(typeof globalThis!=="undefined"?globalThis:this);
