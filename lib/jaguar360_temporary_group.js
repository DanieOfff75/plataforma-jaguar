import { evidenceId } from './jaguar_history_evidence.js';
import { proposeTemporarySchedule } from './jaguar360_temporary_schedule.js';
const fail=m=>{throw Error(m)};
export const checks=['holders','contents','students','calendar','workload','room'];
export function confirmSavedSchedule(source){
 const prev=source.previous;
 if(prev?.state!=='propuesta'||prev.schedule?.state!=='proposed'||!prev.schedule.sessions?.length)fail('Se requiere programación vigente.');
 const forced={};
 for(const s of prev.schedule.sessions){const t=evidenceId(s.teacher);if(forced[s.period]&&forced[s.period]!==t)fail('Asignación inconsistente por bloque.');forced[s.period]=t;}
 const fresh=proposeTemporarySchedule(source,prev.schedule.sessions,'per_block',()=>0,forced);
 if(fresh.state!=='proposed'||fresh.sessions.length!==prev.schedule.sessions.length)fail('La programación ya no es compatible. Recalcula la propuesta.');
 for(let i=0;i<fresh.sessions.length;i++){const a=fresh.sessions[i],b=prev.schedule.sessions[i];if(['period','date','start','end','teacher','support','supportVersion'].some(k=>a[k]!==b[k]))fail('Cambió la candidatura o programación. Recalcula la propuesta.');}
 return fresh.sessions;
}
export function groupRequest(b){
 const call=evidenceId(b.call);
 if(!['activate','cancel'].includes(b.operation)||b.confirmed!==true||typeof b.reason!=='string'||b.reason.trim().length<15||b.reason.trim().length>1500)fail('Confirma y documenta la operación.');
 if(b.operation==='cancel')return {call,operation:b.operation,reason:b.reason.trim()};
 if(!Number.isSafeInteger(b.version)||b.version<1||b.version>2147483647||!/^[a-f0-9]{32}$/.test(b.fingerprint||''))fail('Consulta la programación vigente.');
 if(!b.checks||!checks.every(k=>b.checks[k]===true)||typeof b.reference!=='string'||b.reference.trim().length<5||b.reference.trim().length>300)fail('Completa las comprobaciones y referencia documental.');
 return {call,operation:b.operation,reason:b.reason.trim(),version:b.version,fingerprint:b.fingerprint,room:evidenceId(b.room),reference:b.reference.trim()};
}
export function marksRequest(b){
 const session=evidenceId(b.session);
 if(b.confirmed!==true||!Array.isArray(b.marks)||!b.marks.length||b.marks.length>1000)fail('Confirma una lista completa.');
 const seen=new Set();const marks=b.marks.map(m=>{const student=evidenceId(m.student);if(seen.has(student)||!['presente','falta','retardo'].includes(m.state))fail('Marca duplicada o inválida.');seen.add(student);return {student,state:m.state}});
 return {session,marks};
}
