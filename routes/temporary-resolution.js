import {evidenceId} from '../lib/jaguar_history_evidence.js';
import {reviewTemporaryResults} from '../lib/jaguar360_temporary_results.js';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const checked=fn=>{try{return fn()}catch(e){throw fail(e.message)}};
function guard(req,b){try{if(!req.headers.origin||new URL(req.headers.origin).host!==(req.headers['x-forwarded-host']||req.headers.host))throw Error()}catch{throw fail('Origen no autorizado.',403)}if(process.env.JAGUAR360_TEST_SEALS!=='true')throw fail('Solo entorno aislado de pruebas.',409);if(b.confirmed!==true||typeof b.reference!=='string'||b.reference.trim().length<5||b.reference.trim().length>300||typeof b.reason!=='string'||b.reason.trim().length<15||b.reason.trim().length>1500)throw fail('Confirma referencia y motivo documental.');}
async function rpc(db,name,args){const {data,error}=await db.rpc(name,args);if(error)throw fail(error.code==='42501'?'Sin atribución.':error.code==='P0001'?error.message:['55P03','23505'].includes(error.code)?'Conflicto o registro existente; vuelve a consultar.':'No se pudo completar. Comprueba V14.',error.code==='42501'?403:['P0001','55P03','23505'].includes(error.code)?409:503);return data;}
export function prepareActa(ctx){if(ctx.recorded||!ctx.canAuthorize)throw fail('Convocatoria sin concluir o acta ya registrada.',409);const rows=reviewTemporaryResults(ctx.source);if(!rows.length||rows.some(r=>!['blocks_passed','blocks_failed'].includes(r.state)||r.evaluation?.consumesAttempt!==true))throw fail('Existen alumnos pendientes de revisión; no se consume ningún intento.',409);return rows;}
export async function temporaryResolution(req,res,{user,profile,adminClient:db}){
 const b=req.body||{},q=req.query||{},write=req.method==='POST'&&b.action==='temporary_resolution';if(!write&&!(req.method==='GET'&&q.view==='temporary_resolution'))return false;
 if(!['direccion_escolar','coordinacion_academica','control_escolar','control'].includes(profile.rol))throw fail('Sin atribución.',403);
 const args={p_actor:user.id,p_call:checked(()=>evidenceId(write?b.call:q.call))};
 if(write){if(profile.rol!=='direccion_escolar')throw fail('Solo Dirección autoriza el acta.',403);guard(req,b);if(typeof b.fingerprint!=='string'||!/^[a-f0-9]{32}$/.test(b.fingerprint))throw fail('Consulta la huella vigente.');}
 const ctx=await rpc(db,'jaguar360_contexto_acta_recursamiento',args);let data;
 if(write){if(ctx.fingerprint!==b.fingerprint)throw fail('La evidencia cambió. Consulta nuevamente.',409);const rows=prepareActa(ctx);data=await rpc(db,'jaguar360_autorizar_acta_recursamiento',{...args,p_fingerprint:ctx.fingerprint,p_results:rows,p_reference:b.reference.trim(),p_reason:b.reason.trim()});}
 else if(ctx.recorded)data=ctx;
 else{const rows=reviewTemporaryResults(ctx.source);data={recorded:false,fingerprint:ctx.fingerprint,rows,canAuthorize:ctx.canAuthorize&&rows.length>0&&rows.every(r=>['blocks_passed','blocks_failed'].includes(r.state)&&r.evaluation?.consumesAttempt===true)};}
 res.status(200).json({ok:true,data:{...data,experimental:process.env.JAGUAR360_TEST_SEALS==='true',officialAccreditation:false}});return true;
}
export async function temporaryJustification(req,res,{user,profile,adminClient:db}){
 if(profile.rol!=='prefectura')throw fail('Solo Prefectura.',403);if(!['GET','POST'].includes(req.method))throw fail('Método no permitido.',405);
 const b=req.body||{},q=req.query||{},args={p_actor:user.id};let data;
 if(req.method==='GET'&&!q.session)data={sessions:await rpc(db,'jaguar360_listas_para_justificar',args)};
 else {args.p_session=checked(()=>evidenceId(req.method==='POST'?b.session:q.session));if(req.method==='POST'){guard(req,b);Object.assign(args,{p_student:checked(()=>evidenceId(b.student)),p_reference:b.reference.trim(),p_reason:b.reason.trim()});}data=await rpc(db,'jaguar360_justificar_temporal',args);}
 return res.status(200).json({ok:true,data:{...data,experimental:process.env.JAGUAR360_TEST_SEALS==='true'}});
}
