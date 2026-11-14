import {evidenceId} from '../lib/jaguar_history_evidence.js';
import {validateCycle} from '../lib/jaguar_academic_lifecycle.js';
import {trajectoryReview} from '../lib/jaguar360_trajectory.js';
import {continuityDecision} from '../lib/jaguar360_continuity.js';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const checked=fn=>{try{return fn()}catch(e){throw fail(e.message)}};
async function rpc(db,args){const {data,error}=await db.rpc('jaguar360_continuidad',args);if(error)throw fail(error.code==='42501'?'Sin atribución.':error.code==='P0001'?error.message:['55P03','23505'].includes(error.code)?'Registro duplicado o escritura concurrente. Vuelve a consultar.':'No se pudo consultar continuidad. Comprueba V16.',error.code==='42501'?403:['P0001','55P03','23505'].includes(error.code)?409:503);return data;}
export async function continuityRoute(req,res,{user,profile,adminClient:db}){
 const b=req.body||{},q=req.query||{},write=req.method==='POST'&&b.action==='record_continuity';if(!write&&!(req.method==='GET'&&q.view==='continuity'))return false;
 const ce=['control_escolar','control'].includes(profile.rol),experimental=process.env.JAGUAR360_TEST_SEALS==='true';
 if(!ce&&!['direccion_escolar','coordinacion_academica'].includes(profile.rol)||write&&!ce)throw fail('Sin atribución.',403);
 if(write){try{if(!req.headers?.origin||new URL(req.headers.origin).host!==(req.headers['x-forwarded-host']||req.headers.host))throw Error()}catch{throw fail('Origen no autorizado.',403)}
  if(!experimental)throw fail('Solo entorno aislado de pruebas.',409);
  if(b.confirmed!==true||typeof b.fingerprint!=='string'||! /^[a-f0-9]{32}$/.test(b.fingerprint)||typeof b.reference!=='string'||b.reference.trim().length<5||b.reference.trim().length>300||typeof b.reason!=='string'||b.reason.trim().length<15||b.reason.trim().length>1500)throw fail('Confirmación, huella y justificación requeridas.');}
 const x=write?b:q,student=checked(()=>evidenceId(x.student)),cycle=checked(()=>validateCycle(x.cycle)),args={p_actor:user.id,p_ciclo:cycle,p_alumno:student};
 let result=await rpc(db,args);
 let decision=checked(()=>continuityDecision(trajectoryReview(result.context,student),result.context.source.plan));
 if(write){if(!decision.canRecord||result.context.fingerprint!==b.fingerprint||result.history.some(r=>r.fingerprint===b.fingerprint))throw fail('Evidencia modificada, registro existente o determinación pendiente.',409);
  result=await rpc(db,{...args,p_huella:b.fingerprint,p_payload:decision,p_referencia:b.reference.trim(),p_motivo:b.reason.trim()});decision=checked(()=>continuityDecision(trajectoryReview(result.context,student),result.context.source.plan));}
 const history=result.history.map(r=>({...r,current:r.fingerprint===result.context.fingerprint}));
 res.status(200).json({ok:true,data:{student,cycle,decision,history,fingerprint:result.context.fingerprint,canRecord:ce&&experimental&&decision.canRecord&&!history.some(r=>r.current),experimental}});return true;
}
