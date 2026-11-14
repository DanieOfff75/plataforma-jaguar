import {recoveryCandidate} from './jaguar360_recovery_candidate.js';
import {validatePlan} from './jaguar_academic_lifecycle.js';
import {validateCall} from './jaguar360_operations.js';
import {evaluateRegularization} from './jaguar360_regularization_results.js';
const fail=m=>{throw Error(m)};
export function targetRow(source,callRow){
 const plan=validatePlan(source.plan),call=validateCall(callRow.reglas,plan),subject=plan.curriculum.find(s=>s.key===call.subjectKey),period=call.blocks[0].period;
 const candidate=recoveryCandidate(source,callRow);
 if(!candidate.eligible)fail('Candidatura no vigente: '+candidate.reason);
 const before=source.periods.find(p=>p.number===period).rows.find(r=>r.subjectId===subject.legacyId&&r.grade===subject.grade&&r.evaluation===subject.evaluation);
 return {plan,call,subject,period,before,candidate};
}
const time=v=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v)?Number(v.slice(0,2))*60+Number(v.slice(3)):fail('Hora inválida.');
const doc=v=>typeof v==='string'&&v.trim().length>=5&&v.trim().length<=300?v.trim():fail('Referencia de evidencia requerida (5–300 caracteres).');
/** Transcribes signed documentary evidence. It is not a verified native attendance list. */
export function recoveryResult(source,callRow,evidence,usedAttempts){
 const {plan,call,subject,period,before}=targetRow(source,callRow);
 if(!evidence||!Array.isArray(evidence.sessions)||!evidence.sessions.length||evidence.sessions.length>500)fail('Se requiere relación de sesiones documentadas.');
 const counts={present:0,absent:0,late:0,justified:0,unknown:0};let minutes=0;
 const rows=evidence.sessions.map(s=>{
  if(!s||typeof s.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s.date)||!Number.isFinite(Date.parse(s.date))||new Date(s.date).toISOString().slice(0,10)!==s.date||s.date<call.start||s.date>call.end)fail('Sesión fuera de convocatoria.');
  const a=time(s.start),b=time(s.end);if(b<=a||!['present','absent','late','justified'].includes(s.mark))fail('Sesión o marca inválida.');
  counts[s.mark]++;minutes+=b-a;return {date:s.date,start:s.start,end:s.end,mark:s.mark,reference:doc(s.reference)};
 }).sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start));
 for(let i=1;i<rows.length;i++)if(rows[i].date===rows[i-1].date&&rows[i].start<rows[i-1].end)fail('Sesiones traslapadas o duplicadas.');
 if(minutes!==call.blocks[0].minutes)fail('La duración documentada debe coincidir con el bloque autorizado.');
 const qualitative=subject.evaluation==='cualitativa',raw=qualitative?evidence.result:evidence.grade;
 const periodRows=Array.from({length:plan.policy.periods},(_,i)=>i===period-1?before:null);
 const evaluation=evaluateRegularization(plan,callRow.reglas,{usedAttempts,cause:'academic',periodRows,blocks:[{period,state:'completed',attendance:counts,...(qualitative?{result:raw}:{grade:raw})}]});
 if(evaluation.consumesAttempt!==true)fail('Resultado requiere revisión: '+evaluation.reason);
 const after=structuredClone(before),block=evaluation.blocks[0];
 if(block.passed){if(qualitative){after.result='AP';}else{after.original=Math.max(before.original,block.adjusted);after.official=Math.max(before.official,block.adjusted);}}
 return {period,subjectKey:subject.key,before,after,evidence:{sessions:rows,reference:doc(evidence.reference),...(qualitative?{result:raw}:{grade:raw})},evaluation,usedAttempts,official:false};
}
