import { randomInt } from 'node:crypto';
import { evidenceId } from './jaguar_history_evidence.js';
const fail=m=>{throw Error(m)};
const over=(a,b)=>a.start<b.end&&b.start<a.end;
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const day=d=>new Date(d+'T00:00:00Z').getUTCDay()||7;
const week=d=>{const t=new Date(d+'T00:00:00Z');t.setUTCDate(t.getUTCDate()-day(d)+1);return t.toISOString().slice(0,10)};
const int=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
export function validateTemporarySessions(call,sessions){
 if(!call||call.estado!=='autorizada_para_planeacion'||call.reglas?.kind!=='recourse')fail('Convocatoria de recursamiento autorizada requerida.');
 const rules=call.reglas,blocks=new Map(rules.blocks.map(b=>[b.period,b.minutes]));
 if(!Array.isArray(sessions)||!sessions.length||sessions.length>366)fail('Indica de 1 a 366 sesiones.');
 const rows=sessions.map(s=>{if(!s||!blocks.has(s.period)||!date(s.date)||s.date<rules.start||s.date>rules.end||!int(s.start,0,1439)||!int(s.end,1,1439)||s.end<=s.start)fail('Sesión fuera de la convocatoria o franja inválida.');return {period:s.period,date:s.date,start:s.start,end:s.end}}).sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start);
 for(let i=1;i<rows.length;i++)if(rows[i].date===rows[i-1].date&&over(rows[i],rows[i-1]))fail('Sesiones del grupo temporal traslapadas.');
 for(const [p,m] of blocks)if(rows.filter(s=>s.period===p).reduce((n,s)=>n+s.end-s.start,0)!==m)fail('Los minutos programados deben coincidir exactamente con el bloque P'+p+'.');
 return rows;
}
const time=v=>{const m=/^([01]\d|2[0-3]):([0-5]\d)(?::00(?:\.0+)?)?$/.exec(v??'');return m?+m[1]*60+ +m[2]:null};
/** Suggestions only. Excludes every known historical holder, requires approved support and avoids known conflicts. */
export function proposeTemporarySchedule(source,raw,mode='continuity',pick=randomInt,forced=null){
 const sessions=validateTemporarySessions(source.call,raw);
 if(!['continuity','per_block'].includes(mode))fail('Modalidad docente inválida.');
 if(!source.roster?.length)fail('No hay reservas vigentes.');
 if(source.roster.some(r=>r.stale))fail('Existe evidencia de reserva desactualizada; revisa el padrón.');
 const subject=evidenceId(source.subjectId);
 const excluded=new Set(source.holders.map(evidenceId));
 const teachers=source.teachers.filter(t=>t.active===true&&t.state==='validado'&&!excluded.has(evidenceId(t.teacher))&&t.application?.subjects?.map(evidenceId).includes(subject));
 const byBlock=[...new Set(sessions.map(s=>s.period))];
 const assigned=[], decisions=[];
 function eligible(t,rows){
  const teacher=evidenceId(t.teacher),application=t.application;
  if(!Array.isArray(application.slots)||!int(application.maxMinutes,1,10080))return false;
  const weekly=new Map();
  const commitments=source.commitments.filter(x=>evidenceId(x.teacher)===teacher);
  // Include earlier selections in this proposal and all other persisted drafts for safety.
  const others=[...commitments,...assigned.filter(s=>s.teacher===teacher)];
  for(const s of [...others,...rows]){const w=week(s.date);weekly.set(w,(weekly.get(w)||0)+s.end-s.start);}
  if(rows.some(s=>(weekly.get(week(s.date))||0)>application.maxMinutes))return false;
  return rows.every(s=>application.slots.some(slot=>slot.day===day(s.date)&&slot.start<=s.start&&slot.end>=s.end)&&!others.some(x=>x.date===s.date&&over(s,x))&&!source.ordinary.some(x=>{
    if(evidenceId(x.teacher)!==teacher)return false;
    const start=time(x.start),end=time(x.end);
    return start===null||end===null||start>=end||!int(x.day,1,7)||x.day===day(s.date)&&over(s,{start,end});
  }));
 }
 function select(rows,previous){
  const valid=teachers.filter(t=>eligible(t,rows));if(!valid.length)return null;
  if(previous){const same=valid.find(t=>evidenceId(t.teacher)===previous);if(same)return same;}
  const load=t=>source.commitments.filter(x=>evidenceId(x.teacher)===evidenceId(t.teacher)).reduce((n,s)=>n+s.end-s.start,0)+assigned.filter(x=>x.teacher===evidenceId(t.teacher)).reduce((n,s)=>n+s.end-s.start,0);
  const min=Math.min(...valid.map(load));const tied=valid.filter(t=>load(t)===min);return tied[pick(tied.length)];
 }
 function allocate(rows,t){const teacher=evidenceId(t.teacher);for(const s of rows)assigned.push({...s,teacher,support:evidenceId(t.id),supportVersion:t.version});decisions.push({periods:[...new Set(rows.map(s=>s.period))],teacher});return teacher;}
 const same=!forced&&mode==='continuity'?select(sessions,null):null;
 if(same)allocate(sessions,same);else{let previous=null;for(const p of byBlock){const rows=sessions.filter(s=>s.period===p),t=forced?teachers.find(t=>evidenceId(t.teacher)===forced[p]&&eligible(t,rows)):select(rows,previous);if(!t)return {state:'pending',reason:'Sin docente compatible para P'+p,sessions:[],decisions:[],excluded:excluded.size};previous=allocate(rows,t);}}
 return {state:'proposed',mode,sessions:assigned.sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start),decisions,excluded:excluded.size,limitations:'Propuesta: no autoriza acceso, no certifica titulares históricos completos ni límites laborales, no valida aula o disponibilidad de alumnos.'};
}
export function temporaryRequest(b){
 const call=evidenceId(b.call);if(!['preview','save','cancel'].includes(b.operation))fail('Operación inválida.');
 if(b.operation==='cancel'){if(b.confirmed!==true||typeof b.reason!=='string'||b.reason.trim().length<15||b.reason.trim().length>1500||!int(b.version,1,2147483647))fail('Confirmación, versión y motivo requeridos.');return {call,operation:b.operation,version:b.version,reason:b.reason.trim()};}
 if(!['continuity','per_block'].includes(b.mode))fail('Modalidad inválida.');
 if(!Array.isArray(b.sessions)||b.sessions.length<1||b.sessions.length>366)fail('Sesiones requeridas.');
 if(b.operation==='save'&&(b.confirmed!==true||typeof b.reason!=='string'||b.reason.trim().length<15||b.reason.trim().length>1500||!int(b.version,0,2147483647)||!/^[a-f0-9]{32}$/.test(b.fingerprint||'')))fail('Consulta, confirma y documenta la propuesta.');
 return {call,operation:b.operation,mode:b.mode,sessions:b.sessions,reason:b.reason?.trim(),version:b.version,fingerprint:b.fingerprint};
}
