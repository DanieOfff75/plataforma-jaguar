import {blockResultRequest,reviewTemporaryResults} from '../lib/jaguar360_temporary_results.js';
import {evidenceId} from '../lib/jaguar_history_evidence.js';
import {confirmSavedSchedule,groupRequest,marksRequest} from '../lib/jaguar360_temporary_group.js';
const fail=(m,status=400)=>Object.assign(Error(m),{status});
const check=fn=>{try{return fn()}catch(e){throw fail(e.message)}};
const guard=req=>{try{if(!req.headers.origin||new URL(req.headers.origin).host!==(req.headers['x-forwarded-host']||req.headers.host))throw Error()}catch{throw fail('Origen no autorizado.',403)}if(process.env.JAGUAR360_TEST_SEALS!=='true')throw fail('Escrituras deshabilitadas fuera de pruebas.',409)};
async function rpc(db,name,args){const {data,error}=await db.rpc(name,args);if(error)throw fail(error.code==='42501'?'Sin atribución.':error.code==='P0001'?error.message:error.code==='55P03'?'Operación concurrente; vuelve a consultar.':'No se pudo consultar o registrar. Comprueba V12.',error.code==='42501'?403:['P0001','55P03'].includes(error.code)?409:503);return data;}
export async function temporaryGroup(req,res,{user,profile,adminClient:db}){
 const b=req.body||{},q=req.query||{};
 if(req.method==='GET'&&q.view==='temporary_results'){if(!['direccion_escolar','coordinacion_academica','control_escolar','control'].includes(profile.rol))throw fail('Sin atribución.',403);const data=await rpc(db,'jaguar360_revision_resultados_temporales',{p_actor:user.id,p_call:check(()=>evidenceId(q.call))});res.status(200).json({ok:true,data:{rows:reviewTemporaryResults(data),official:false}});return true;}
 const write=req.method==='POST'&&b.action==='temporary_group';if(!write&&!(req.method==='GET'&&q.view==='temporary_group'))return false;
 const experimental=process.env.JAGUAR360_TEST_SEALS==='true', role=profile.rol;
 if(!['direccion_escolar','coordinacion_academica','control_escolar','control'].includes(role))throw fail('Sin atribución.',403);
 const call=check(()=>evidenceId(write?b.call:q.call)),args={p_actor:user.id,p_call:call};let data;
 if(write){if(role!=='direccion_escolar')throw fail('Solo Dirección autoriza el grupo.',403);guard(req);const x=check(()=>groupRequest(b));
  if(x.operation==='cancel')data=await rpc(db,'jaguar360_activar_grupo_temporal',{...args,p_op:'cancel',p_reason:x.reason});
  else{const src=await rpc(db,'jaguar360_fuentes_programacion_temporal',args);if(src.fingerprint!==x.fingerprint||src.previous?.version!==x.version)throw fail('Las fuentes cambiaron. Consulta nuevamente.',409);check(()=>confirmSavedSchedule(src));data=await rpc(db,'jaguar360_activar_grupo_temporal',{...args,p_op:'activate',p_reason:x.reason,p_version:x.version,p_fingerprint:x.fingerprint,p_room:x.room,p_reference:x.reference});}
 }else{data=await rpc(db,'jaguar360_consultar_grupo_temporal',args);if(!data.group&&role==='direccion_escolar'){const src=await rpc(db,'jaguar360_fuentes_programacion_temporal',args);try{check(()=>confirmSavedSchedule(src));data={...data,ready:true,fingerprint:src.fingerprint,version:src.previous.version};}catch(e){data={...data,ready:false,reason:e.message};}}}
 res.status(200).json({ok:true,data:{...data,experimental}});return true;
}
export async function temporaryTeacher(req,res,{user,profile,adminClient:db}){
 const b=req.body||{},q=req.query||{};
 if(req.method==='POST'&&b.action==='temporary_block_result'||req.method==='GET'&&q.mode==='temporary_block_result'){
  if(profile.rol!=='docente')throw fail('Solo docente asignado.',403);const args={p_actor:user.id,p_session:check(()=>evidenceId(req.method==='POST'?b.session:q.session))};
  if(req.method==='POST'){guard(req);const x=check(()=>blockResultRequest(b));Object.assign(args,{p_results:x.results,p_reference:x.reference});}
  const data=await rpc(db,'jaguar360_resultado_bloque_temporal',args);res.status(200).json({ok:true,data:{...data,experimental:process.env.JAGUAR360_TEST_SEALS==='true'}});return true;
 }
 const write=req.method==='POST'&&b.action==='temporary_teacher';if(!write&&!(req.method==='GET'&&q.mode==='temporary_teacher'))return false;
 if(profile.rol!=='docente')throw fail('Solo docente asignado.',403);
 let data;
 if(write){guard(req);const x=check(()=>marksRequest(b));data=await rpc(db,'jaguar360_lista_temporal',{p_actor:user.id,p_session:x.session,p_marks:x.marks});}
 else if(q.session)data=await rpc(db,'jaguar360_lista_temporal',{p_actor:user.id,p_session:check(()=>evidenceId(q.session))});
 else data={sessions:await rpc(db,'jaguar360_mis_sesiones_temporales',{p_actor:user.id})};
 res.status(200).json({ok:true,data:{...data,experimental:process.env.JAGUAR360_TEST_SEALS==='true'}});return true;
}
