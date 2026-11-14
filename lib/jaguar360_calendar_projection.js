import {validatePlan} from './jaguar_academic_lifecycle.js';
import {ordinarySchedule,minute} from './jaguar360_ordinary_schedule.js';
const fail=m=>{throw Error(m)};
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const clock=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
const text=v=>typeof v==='string'&&v.trim().length>=5&&v.trim().length<=300?v.trim():fail('Referencia documental inválida.');
/** Projection only. No attendance or cancellation is created by this preview. */
export function projectCalendar(context,week,raw={}, {full=false}={}){
 const plan=validatePlan(context.plan);if(!week?.compatible||!week.slots?.length)fail('Se requiere semana compatible.');
 const p=plan.calendar[week.period-1];if(!p)fail('Periodo inválido.');
 const normalized=week.slots.map(s=>({...s,start:clock(s.start),end:clock(s.end)}));
 const check=ordinarySchedule(context,{period:week.period,limits:week.limits,slots:normalized});if(!check.compatible)fail('La semana dejó de ser compatible.');
 const start=Date.parse(p.start),end=Date.parse(p.end),day=86400000;
 if((end-start)/day>370||Math.ceil((end-start+day)/day/7)*week.slots.length>100000)fail('Periodo demasiado amplio para proyección.');
 const events=raw.suspensions??[];if(!Array.isArray(events)||events.length>200)fail('Suspensiones inválidas.');
 const suspensions=new Map();for(const e of events){if(!date(e.date)||e.date<p.start||e.date>p.end||suspensions.has(e.date))fail('Fecha de suspensión inválida o repetida.');suspensions.set(e.date,text(e.reference));}
 const rows=[],metrics=new Map();for(let t=start;t<=end;t+=day){const d=new Date(t),dow=d.getUTCDay(),ds=d.toISOString().slice(0,10);for(const s of check.slots.filter(x=>x.day===dow)){
  const suspended=suspensions.has(ds),key=`${ds}/${s.groupSubject}/${s.start}`;rows.push({...s,date:ds,key,state:suspended?'proposed_suspension':'planned',reference:suspensions.get(ds)??null});
  const a=metrics.get(s.groupSubject)||{groupSubject:s.groupSubject,planned:0,suspended:0,replacement:0};a.planned+=s.end-s.start;if(suspended)a.suspended+=s.end-s.start;metrics.set(s.groupSubject,a);
 }}
 const replacements=raw.replacements??[];if(!Array.isArray(replacements)||replacements.length>500)fail('Reposiciones inválidas.');const used=new Set();
 for(const r of replacements){const original=rows.find(x=>x.key===r.original&&x.state==='proposed_suspension');if(!original||used.has(r.original)||!date(r.date)||r.date<p.start||r.date>p.end||suspensions.has(r.date))fail('Reposición sin suspensión válida o repetida.');const dow=new Date(r.date).getUTCDay(),rs=minute(r.start),re=rs+original.end-original.start;if(dow<1||dow>5||re>=1440)fail('Franja de reposición inválida.');
  const g=context.groups.find(x=>x.id===original.group);if(plan.policy.scheduleModel==='fixed'&&(rs<minute(g.start)||re>minute(g.end)))fail('Reposición fuera de jornada fija.');
  const av=context.availability.filter(x=>x.teacher===original.teacher&&x.day===dow).map(x=>({...x,start:minute(x.start),end:minute(x.end)}));if(!av.some(x=>x.available===true&&x.start<=rs&&x.end>=re)||av.some(x=>x.available===false&&x.start<re&&rs<x.end))fail('Reposición fuera de disponibilidad docente.');
  if(rows.some(x=>x.date===r.date&&x.state!=='proposed_suspension'&&x.start<re&&rs<x.end&&(x.group===original.group||x.teacher===original.teacher||x.room===original.room)))fail('Traslape de reposición.');
  used.add(r.original);rows.push({...original,day:dow,start:rs,end:re,date:r.date,key:r.date+'/replacement/'+r.original,state:'proposed_replacement',reference:text(r.reference),replaces:r.original});metrics.get(original.groupSubject).replacement+=re-rs;
 }
 // Validate actual projected working days/weeks, after adding replacements and excluding suspensions.
 // This includes only dates within this period; other periods and non-teaching duties still require review.
 if(replacements.length){
  const actual=rows.filter(x=>x.state!=='proposed_suspension'),byDay=new Map(),byWeek=new Map(),byGroup=new Map();
  const add=(map,key,row)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(row);};
  for(const row of actual){const d=new Date(row.date),monday=new Date(d.getTime()-((d.getUTCDay()+6)%7)*day).toISOString().slice(0,10);add(byDay,row.teacher+'/'+row.date,row);add(byWeek,row.teacher+'/'+monday,row);add(byGroup,row.group+'/'+row.date,row);}
  const L=check.limits;
  for(const rs of byDay.values()){
   rs.sort((a,b)=>a.start-b.start);let total=0,continuous=0,last=rs[0].start;
   for(const row of rs){if(row.start-last>=L.minBreak)continuous=0;continuous+=row.end-row.start;total+=row.end-row.start;if(continuous>L.maxConsecutive)fail('Reposición excede las clases consecutivas autorizadas.');last=Math.max(last,row.end);}
   if(total>L.maxDaily||last-rs[0].start>L.maxSpan)fail('Reposición excede la jornada docente autorizada.');
  }
  for(const rs of byWeek.values())if(rs.reduce((a,r)=>a+r.end-r.start,0)>L.maxWeekly)fail('Reposición excede la carga lectiva semanal autorizada.');
  for(const rs of byGroup.values()){rs.sort((a,b)=>a.start-b.start);let last=rs[0].end;for(const row of rs.slice(1)){if(row.start-last>plan.policy.maxStudentGap)fail('Reposición genera un hueco estudiantil superior al autorizado.');last=Math.max(last,row.end);}}
 }
 const summary=check.metrics.map(m=>{const a=metrics.get(m.groupSubject)||{groupSubject:m.groupSubject,planned:0,suspended:0,replacement:0};const projected=a.planned-a.suspended+a.replacement;return {...a,projected,target:m.periodMinutes,shortfall:Math.max(0,m.periodMinutes-projected),surplus:Math.max(0,projected-m.periodMinutes)};});
 return {period:week.period,start:p.start,end:p.end,summary,rows:full?rows:[...rows.filter(r=>r.state!=='planned'),...rows.filter(r=>r.state==='planned')].slice(0,1000),sessionCount:rows.length,truncated:!full&&rows.length>1000,official:false,limitations:'Proyección documental, no registra asistencia ni suspensiones autorizadas. Comprueba disponibilidad, traslapes y carga lectiva de reposiciones dentro del periodo. No verifica obligaciones no lectivas, pausas institucionales ni carga entre periodos.'};
}
