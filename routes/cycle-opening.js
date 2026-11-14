import {validateCycle,validatePlan} from '../lib/jaguar_academic_lifecycle.js';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const checked=f=>{try{return f()}catch(e){throw fail(e.message)}};
const text=(x,min,max)=>typeof x==='string'&&x.trim().length>=min&&x.trim().length<=max;
const validFingerprint=x=>typeof x==='string'&&/^[a-f0-9]{32}$/.test(x);
export async function cycleOpening(req,res,{user,profile,adminClient:db}){
 const b=req.body||{},q=req.query||{},write=req.method==='POST'&&b.action==='activate_cycle';
 if(!write&&!(req.method==='GET'&&q.view==='cycle_opening'))return false;
 const dir=profile.rol==='direccion_escolar',experimental=process.env.JAGUAR360_TEST_SEALS==='true';
 if(!['direccion_escolar','control_escolar','control','coordinacion_academica'].includes(profile.rol)||write&&!dir)throw fail('Sin atribución.',403);
 const cycle=checked(()=>validateCycle((write?b:q).cycle));
 if(write){
  try{if(!req.headers?.origin||new URL(req.headers.origin).host!==(req.headers['x-forwarded-host']||req.headers.host))throw Error()}catch{throw fail('Origen no autorizado.',403)}
  if(!experimental)throw fail('Solo entorno aislado de pruebas.',409);
  if(b.confirmed!==true||!validFingerprint(b.fingerprint)||!text(b.reason,15,1500)||!text(b.reference,5,300))throw fail('Confirmación, huella, motivo y referencia requeridos.');
 }
 const params={p_actor:user.id,p_ciclo:cycle};
 async function rpc(args){const {data,error}=await db.rpc('jaguar360_abrir_ciclo',args);if(error)throw fail(error.code==='42501'?'Sin atribución.':error.code==='P0001'?error.message:'No se pudo consultar o abrir el ciclo. Comprueba V22.',error.code==='42501'?403:['P0001','55P03','23505','23514'].includes(error.code)?409:503);return data;}
 let d=await rpc(params);
 if(d.plan)checked(()=>validatePlan(d.plan));
 if(write){if(d.activated===true&&d.fingerprint===b.fingerprint){/* idempotent retry */}
  else {if(d.ready!==true||d.activated===true||!d.plan||d.fingerprint!==b.fingerprint)throw fail('Apertura bloqueada o evidencia modificada.',409);d=await rpc({...params,p_huella:b.fingerprint,p_motivo:b.reason.trim(),p_referencia:b.reference.trim()});}
  if(d.activated!==true||d.fingerprint!==b.fingerprint||d.result?.studentMoves!==0)throw fail('No se confirmó la apertura.',409);
 }
 res.status(200).json({ok:true,data:{...d,experimental,canActivate:dir&&experimental&&d.ready===true&&d.activated!==true}});return true;
}
