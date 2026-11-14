import {validatePlan} from './jaguar_academic_lifecycle.js';
import {projectVerifiedRecord,validateCall} from './jaguar360_operations.js';
import {evidenceId} from './jaguar_history_evidence.js';
const fail=m=>{throw Error(m)};
/** Recourse only. The source must be loaded from the sealed record by the server.
 * No new academic credit, attendance waiver or permission follows from this reservation. */
export function recourseCandidate(source,callRow,requestedBlocks=null){
 const plan=validatePlan(source.plan),call=validateCall(callRow.reglas,plan);
 if(call.kind!=='recourse'||callRow.estado!=='autorizada_para_planeacion'||source.version!==callRow.plan_version||plan.cycle!==callRow.ciclo)fail('Se requiere convocatoria de recursamiento autorizada y la misma versión del plan sellado.');
 if(source.pendingRecovery?.includes(call.subjectKey))fail('Existe una recuperación pendiente de resolución para esta materia.');
 const projection=projectVerifiedRecord(plan,source.periods),subject=projection.subjects?.find(s=>s.key===call.subjectKey);
 if(projection.state!=='projected'||subject?.state!=='candidate')fail('No hay candidatura inequívoca en el expediente sellado.');
 const allowed=call.blocks.map(b=>b.period),suggested=subject.suggestedBlocks||[];
 if(!['academic','attendance','mixed'].includes(subject.reason))fail('Motivo de recursamiento no determinado.');
 const mandatory=subject.reason==='attendance'?[]:[...new Set([...(subject.failed||[]),...(subject.attendanceFailed||[]),...(plan.curriculum.find(s=>s.key===call.subjectKey)?.evaluation==='cualitativa'?suggested:[])])];
 const defaults=[...new Set([...mandatory,...suggested])].sort((a,b)=>a-b);
 const blocks=requestedBlocks===null?null:validateBlocks(requestedBlocks,allowed,mandatory);
 return {cause:subject.reason,suggested:defaults,mandatory,available:allowed,needsReview:subject.needsBlockReview===true||defaults.length===0,blocks,planVersion:source.version,subjectKey:call.subjectKey,allSuggestedAvailable:defaults.every(p=>allowed.includes(p))};
}
export function validateBlocks(value,allowed,mandatory=[]){
 if(!Array.isArray(value)||value.length<1||value.length>6||value.some(v=>!Number.isSafeInteger(v)||!allowed.includes(v))||new Set(value).size!==value.length)fail('Selecciona bloques válidos y sin duplicados.');
 if(mandatory.some(v=>!value.includes(v)))fail('Faltan bloques con adeudos identificados.');
 return value.slice().sort((a,b)=>a-b);
}
export function rosterRequest(body){
 if(body.confirmed!==true||typeof body.reason!=='string'||body.reason.trim().length<15||body.reason.trim().length>1500)fail('Confirmación y motivo de 15 a 1500 caracteres requeridos.');
 const op=body.operation;if(!['reservar','cancelar'].includes(op))fail('Operación inválida.');
 const base={operation:op,call:evidenceId(body.call),student:evidenceId(body.student),reason:body.reason.trim()};
 if(op==='cancelar')return {...base,id:evidenceId(body.id),version:checkVersion(body.version)};
 if(typeof body.fingerprint!=='string'||! /^[a-f0-9]{32}$/.test(body.fingerprint))fail('Primero consulta la candidatura vigente.');
 return {...base,fingerprint:body.fingerprint,blocks:validateBlocks(body.blocks,[1,2,3,4,5,6])};
}
function checkVersion(v){if(!Number.isSafeInteger(v)||v<1||v>2147483647)fail('Versión inválida.');return v}
