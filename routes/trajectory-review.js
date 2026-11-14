import {historicalReport,historicalCSV} from '../lib/jaguar360_historical_report.js';
import {evidenceId} from '../lib/jaguar_history_evidence.js';
import {validateCycle} from '../lib/jaguar_academic_lifecycle.js';
import {trajectoryReview} from '../lib/jaguar360_trajectory.js';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const checked=fn=>{try{return fn()}catch(e){throw fail(e.message)}};
async function rpc(db,name,args){const {data,error}=await db.rpc(name,args);if(error)throw fail(error.code==='42501'?'Sin atribución.':error.code==='P0001'?error.message:['55P03','23505'].includes(error.code)?'Conflicto de escritura. Vuelve a consultar.':'No se pudo consultar el expediente. Comprueba la migración V15.',error.code==='42501'?403:['P0001','55P03','23505'].includes(error.code)?409:503);return data;}
export async function trajectoryRoute(req,res,{user,profile,adminClient:db}){
 const q=req.query||{},b=req.body||{},write=req.method==='POST'&&b.action==='apply_recourse';if(!write&&!(req.method==='GET'&&['trajectory_review','historical_report'].includes(q.view)))return false;
 const role=profile.rol;if(!['direccion_escolar','control_escolar','control','coordinacion_academica'].includes(role))throw fail('Sin atribución.',403);
 const x=write?b:q,student=checked(()=>evidenceId(x.student)),cycle=checked(()=>validateCycle(x.cycle)),args={p_actor:user.id,p_ciclo:cycle,p_alumno:student};
 const experimental=process.env.JAGUAR360_TEST_SEALS==='true';
 if(!write&&q.view==='historical_report'){const snapshot=await rpc(db,'jaguar360_informe_trayectoria',args),report=checked(()=>historicalReport(snapshot,student));res.status(200).json({ok:true,data:{...report,csv:historicalCSV(report)}});return true;}
 if(write){
  const op=b.operation;if(!['proponer','autorizar'].includes(op)||op==='proponer'&&!['control_escolar','control'].includes(role)||op==='autorizar'&&role!=='direccion_escolar')throw fail('Sin atribución.',403);
  try{if(!req.headers?.origin||new URL(req.headers.origin).host!==(req.headers['x-forwarded-host']||req.headers.host))throw Error()}catch{throw fail('Origen no autorizado.',403)}
  if(!experimental)throw fail('Solo entorno aislado de pruebas.',409);
  if(b.confirmed!==true||typeof b.fingerprint!=='string'||! /^[a-f0-9]{32}$/.test(b.fingerprint)||typeof b.reference!=='string'||b.reference.trim().length<5||b.reference.trim().length>300||typeof b.reason!=='string'||b.reason.trim().length<15||b.reason.trim().length>1500)throw fail('Confirmación, referencia, motivo y huella requeridos.');
 }
 let ctx=await rpc(db,'jaguar360_contexto_trayectoria',args),data=checked(()=>trajectoryReview(ctx,student));
 if(write){const call=checked(()=>evidenceId(b.call)),a=data.applications.find(a=>a.call===call);if(ctx.fingerprint!==b.fingerprint||!a||(b.operation==='proponer'?!a.canPropose:!a.canAuthorize))throw fail('Evidencia modificada o aplicación no disponible.',409);
  ctx=await rpc(db,'jaguar360_aplicar_recursamiento',{...args,p_call:call,p_accion:b.operation,p_huella:ctx.fingerprint,p_payload:a.proposal,p_referencia:b.reference.trim(),p_motivo:b.reason.trim()});data=checked(()=>trajectoryReview(ctx,student));}
 res.status(200).json({ok:true,data:{...data,cycle,student,planVersion:ctx.source.version,fingerprint:ctx.fingerprint,experimental}});return true;
}
