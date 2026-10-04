import fs from 'node:fs';
const base=process.env.SILAH_URL || 'http://localhost:3000';
const cases=JSON.parse(fs.readFileSync(new URL('./gold100.json', import.meta.url),'utf8'));
function val(data,key){
 if(key==='targetServiceId') return data.route?.targetServiceIds?.[0];
 if(key==='targetServiceIds') return data.route?.targetServiceIds||[];
 if(key==='needsConfirmation') return !!data.route?.pendingConfirmation;
 if(key==='started') return data.route?.started ?? (data.route?.jobStage==='started'?true:data.route?.jobStage!=='unknown'?false:null);
 if(key==='accepted') return data.route?.accepted ?? (data.route?.jobStage==='accepted'?true:['reviewing','rejected'].includes(data.route?.jobStage)?false:null);
 if(key==='ended') return data.route?.ended ?? (data.route?.intent==='employment_end_negated'?false:data.route?.endStage==='ended'?true:null);
 return data.route?.[key];
}
function eq(a,e){return Array.isArray(e)?Array.isArray(a)&&e.every(x=>a.includes(x)):a===e}
let pass=0; const fails=[]; const rows=[];
for(const c of cases){
 const r=await fetch(base+'/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:c.message,profileId:c.persona,history:[],scenarioState:c.previousState||{}})});
 const data=await r.json(); const f=[];
 for(const [k,e] of Object.entries(c.expected)){
  if(['expectedEligibility','forbidConclusion'].includes(k)) continue;
  const a = k==='requiresClarification'?data.route?.requiresClarification:k==='incomeSource'?data.route?.incomeSource:val(data,k);
  if(!eq(a,e)) f.push(`${k}: ${JSON.stringify(a)} != ${JSON.stringify(e)}`);
 }
 if(!f.length) pass++; else fails.push({id:c.id,message:c.message,f,reply:data.reply,route:data.route});
 rows.push({id:c.id,reply:data.reply,aiMode:data.aiMode,aiCalls:data.routingMeta?.aiCalls||0});
}
console.log(JSON.stringify({pass,fail:cases.length-pass,rate:pass},null,2));
if(fails.length){console.log(JSON.stringify(fails.slice(0,20),null,2));process.exitCode=1}
fs.writeFileSync(new URL('./http100_results.json',import.meta.url),JSON.stringify(rows,null,2),'utf8');
