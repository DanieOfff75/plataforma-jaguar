import {evidenceId} from '../lib/jaguar_history_evidence.js';
import {targetRow,recoveryResult} from '../lib/jaguar360_recovery_workflow.js';
import {recoveryCandidate} from '../lib/jaguar360_recovery_candidate.js';
const fail=(m,status=400)=>Object.assign(Error(m),{status});
const check=fn=>{try{return fn()}catch(e){throw fail(e.message,409)}};
async function rpc(db,name,args){const {data,error}=await db.rpc(name,args);if(error)throw fail(error.code==='42501'?'Sin atribución.':error.code==='P0001'?error.message:['55P03','23505'].includes(error.code)?'Conflicto concurrente. Vuelve a consultar.':'No se pudo consultar recuperación V24.',error.code==='42501'?403:['P0001','55P03','23505'].includes(error.code)?409:503);return data;}
export async function recoveryWorkflow(req,res,{user,profile,adminClient:db}){
 const q=req.query||{},b=req.body||{},write=req.method==='POST'&&b.action==='recovery_workflow';if(!write&&!(req.method==='GET'&&q.view==='recovery_workflow'))return false;
 const role=profile.rol,experimental=process.env.JAGUAR360_TEST_SEALS==='true',x=write?b:q;
 if(!['direccion_escolar','coordinacion_academica','control_escolar','control'].includes(role))throw fail('Sin atribución.',403);
 const args={p_actor:user.id,p_call:check(()=>evidenceId(x.call)),p_alumno:check(()=>evidenceId(x.student))};
 if(write){const op=b.operation;if(!['reservar','cancelar','evaluar','autorizar','rechazar'].includes(op)||(['autorizar','rechazar'].includes(op)?role!=='direccion_escolar':role!=='coordinacion_academica'))throw fail('Sin atribución.',403);
  try{if(!req.headers?.origin||new URL(req.headers.origin).host!==(req.headers['x-forwarded-host']||req.headers.host))throw Error()}catch{throw fail('Origen no autorizado.',403)}
  if(!experimental)throw fail('Solo entorno aislado de pruebas.',409);
  if(b.confirmed!==true||typeof b.fingerprint!=='string'||! /^[a-f0-9]{32}$/.test(b.fingerprint)||typeof b.reference!=='string'||b.reference.trim().length<5||b.reference.trim().length>300||typeof b.reason!=='string'||b.reason.trim().length<15||b.reason.trim().length>1500)throw fail('Confirmación, referencia, motivo y huella requeridos.');
 }
 let ctx=await rpc(db,'jaguar360_recuperacion_contexto',args);
 if(write){if(ctx.fingerprint!==b.fingerprint)throw fail('La evidencia cambió. Vuelve a consultar.',409);let payload=null;
  if(b.operation==='reservar')payload=check(()=>{const t=targetRow(ctx.source,ctx.call);return {before:t.before,period:t.period,subjectKey:t.subject.key};});
  if(b.operation==='evaluar')payload=check(()=>recoveryResult(ctx.source,ctx.call,b.evidence,ctx.usedAttempts));
  if(b.operation==='autorizar')payload=check(()=>recoveryResult(ctx.source,ctx.call,ctx.record?.payload?.evidence,ctx.usedAttempts));
  ctx=await rpc(db,'jaguar360_recuperacion_mover',{...args,p_accion:b.operation,p_huella:b.fingerprint,p_payload:payload,p_referencia:b.reference.trim(),p_motivo:b.reason.trim()});
 }
 let candidate=null;try{candidate=recoveryCandidate(ctx.source,ctx.call)}catch(e){candidate={eligible:false,reason:e.message};}
 res.status(200).json({ok:true,data:{candidate,record:ctx.record,history:ctx.history,capacity:ctx.capacity,reserved:ctx.reserved,usedAttempts:ctx.usedAttempts,limit:ctx.call.reglas.attempts,fingerprint:ctx.fingerprint,experimental,call:args.p_call,student:args.p_alumno}});return true;
}
