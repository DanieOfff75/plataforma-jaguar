import {evidenceId} from './jaguar_history_evidence.js';
import {validateCycle} from './jaguar_academic_lifecycle.js';
const bad=m=>{throw Error(m)};
export function supportApplication(raw){
 if(!raw||typeof raw!=='object'||!Array.isArray(raw.subjects)||raw.subjects.length<1||raw.subjects.length>40)bad('Selecciona materias válidas.');
 const subjects=raw.subjects.map(evidenceId);if(new Set(subjects).size!==subjects.length)bad('Materias duplicadas.');
 if(!Array.isArray(raw.slots)||!raw.slots.length||raw.slots.length>70)bad('Indica las franjas de disponibilidad.');
 const slots=raw.slots.map(s=>{if(!s||!Number.isInteger(s.day)||s.day<1||s.day>7||!Number.isInteger(s.start)||!Number.isInteger(s.end)||s.start<0||s.end>1440||s.end<=s.start)bad('Franja inválida.');return {day:s.day,start:s.start,end:s.end};}).sort((a,b)=>a.day-b.day||a.start-b.start);
 if(slots.some((s,i)=>i&&s.day===slots[i-1].day&&s.start<slots[i-1].end))bad('Disponibilidad traslapada.');
 const available=slots.reduce((n,s)=>n+s.end-s.start,0);
 if(!Number.isInteger(raw.maxMinutes)||raw.maxMinutes<1||raw.maxMinutes>available)bad('Carga de apoyo superior a disponibilidad declarada.');
 return {subjects,slots,maxMinutes:raw.maxMinutes};
}
export function supportRequest(b){
 if(b.confirmed!==true||typeof b.reason!=='string'||b.reason.trim().length<15||b.reason.trim().length>1500)bad('Confirma y documenta el motivo.');
 const op=b.operation;if(!['submit','approve','reject','withdraw','revoke'].includes(op))bad('Operación inválida.');
 const cycle=validateCycle(b.cycle),reason=b.reason.trim();
 if(op==='submit')return {op,cycle,reason,application:supportApplication(b.application)};
 if(!Number.isSafeInteger(b.version)||b.version<1||b.version>2147483647)bad('Versión inválida.');
 let reference=null;if(op==='approve'){if(typeof b.reference!=='string'||b.reference.trim().length<5||b.reference.trim().length>200)bad('Referencia de validación requerida.');reference=b.reference.trim();}
 return {op,cycle,reason,id:evidenceId(b.id),version:b.version,reference};
}
