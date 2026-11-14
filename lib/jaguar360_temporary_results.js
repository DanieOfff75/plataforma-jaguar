import {evidenceId} from './jaguar_history_evidence.js';
import {validatePlan} from './jaguar_academic_lifecycle.js';
import {validateCall} from './jaguar360_operations.js';
import {evaluateRegularization} from './jaguar360_regularization_results.js';
const fail=m=>{throw Error(m)};
export function blockResultRequest(b){
 const session=evidenceId(b.session);
 if(b.confirmed!==true||typeof b.reference!=='string'||b.reference.trim().length<5||b.reference.trim().length>300||!Array.isArray(b.results)||!b.results.length||b.results.length>1000)fail('Confirma resultados completos y referencia de evaluación.');
 const seen=new Set();const results=b.results.map(r=>{const student=evidenceId(r.student);if(seen.has(student))fail('Alumno duplicado.');seen.add(student);const value=r.value;if(!(value==='AP'||value==='RP'||typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=10))fail('Resultado inválido.');return {student,value};});
 return {session,reference:b.reference.trim(),results};
}
/** The sources are loaded by a restricted RPC, not supplied by the browser. No grade or attempt is applied. */
export function reviewTemporaryResults(data){
 const out=[];for(const r of data.students){
  if(r.stale||!r.source||r.blocks.some(b=>!b.complete||b.value==null)){out.push({student:r.student,name:r.name,state:'pending',reason:r.stale?'Cambió expediente sellado.':'Faltan listas o resultados del bloque.'});continue;}
  try{const plan=validatePlan(r.source.plan),call=validateCall(data.call.reglas,plan),subject=plan.curriculum.find(s=>s.key===call.subjectKey);
   if(r.source.version!==data.call.plan_version||plan.cycle!==data.call.ciclo)fail('Versión de plan incompatible.');
   const periodRows=r.source.periods.slice().sort((a,b)=>a.number-b.number).map(p=>{const rows=p.rows.filter(x=>x.subjectId===subject.legacyId);if(!p.verified||rows.length!==1)fail('Evidencia ordinaria ambigua.');return rows[0];});
   const blocks=r.blocks.map(b=>({period:b.period,state:'completed',attendance:b.attendance,...(subject.evaluation==='cualitativa'?{result:b.value}:{grade:b.value})}));
   const evaluation=evaluateRegularization(plan,call,{cause:r.cause,periodRows,blocks,usedAttempts:0});
   out.push({student:r.student,name:r.name,state:evaluation.state,evaluation});
  }catch(e){out.push({student:r.student,name:r.name,state:'pending',reason:e.message});}
 }
 return out;
}
