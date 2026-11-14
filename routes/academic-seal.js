import {evidenceId} from '../lib/jaguar_history_evidence.js';
import {validateCycle} from '../lib/jaguar_academic_lifecycle.js';
import {projectVerifiedRecord} from '../lib/jaguar360_operations.js';
const err=(message,status=400)=>Object.assign(new Error(message),{status});
const checked=fn=>{try{return fn()}catch(e){throw err(e.message)}};
export function sealRequest(b){
 if(b.confirmed!==true||!Number.isSafeInteger(b.planVersion)||b.planVersion<1||b.planVersion>2147483647||typeof b.fingerprint!=='string'||! /^[a-f0-9]{32}$/.test(b.fingerprint)||typeof b.reason!=='string'||b.reason.trim().length<15||b.reason.length>1500)throw err('Confirmación, versión, huella o motivo inválido.');
 return {p_periodo:checked(()=>evidenceId(b.period)),p_plan_version:b.planVersion,p_huella:b.fingerprint,p_motivo:b.reason.trim()};
}
async function rpc(db,name,args){const {data,error}=await db.rpc(name,args);if(error)throw err(error.code==='42501'?'Sin atribución.':error.code==='P0001'?error.message:error.code==='55P03'?'Hay escrituras en curso: vuelve a consultar.':'No fue posible acceder al cierre protegido · código '+(String(error.code||'').match(/^[A-Z0-9]{5,10}$/)?.[0]||'sin código')+'.',error.code==='42501'?403:['P0001','55P03'].includes(error.code)?409:503);return data;}
export async function academicSeal(req,res,{user,profile,adminClient:db}){
 const b=req.body||{},q=req.query||{};let data;
 const experimental=process.env.JAGUAR360_TEST_SEALS==='true';
 if(req.method==='GET'&&q.view==='seal')data=await rpc(db,'jaguar360_cierre_periodo',{p_actor:user.id,p_periodo:checked(()=>evidenceId(q.period))});
 else if(req.method==='GET'&&q.view==='sealed_projection'){
  const cycle=checked(()=>validateCycle(q.cycle));const source=await rpc(db,'jaguar360_fuentes_selladas',{p_actor:user.id,p_ciclo:cycle,p_alumno:checked(()=>evidenceId(q.student))});
  data={...checked(()=>projectVerifiedRecord(source.plan,source.periods)),cycle,planVersion:source.version,periods:source.periods.map(p=>({number:p.number,verified:p.verified})),mapping:'Proyección histórica de sellos. Considera rectificaciones numéricas autorizadas en el libro V9, no regularizaciones posteriores; no es una promoción oficial.'};
 }else if((req.method==='GET'&&q.view==='rectifications')||(req.method==='POST'&&b.action==='sealed_rectification')){
  const writing=req.method==='POST', x=writing?b:q, op=writing?b.operation:'consultar';
  const args={p_actor:user.id,p_periodo:checked(()=>evidenceId(x.period)),p_alumno:checked(()=>evidenceId(x.student)),p_gm:checked(()=>evidenceId(x.groupMaterial)),p_accion:op};
  if(writing){
   const origin=req.headers?.origin,host=req.headers?.['x-forwarded-host']||req.headers?.host;
   try{if(!origin||!host||new URL(origin).host!==host)throw Error()}catch{throw err('Origen no autorizado.',403)}
   if(!['proponer','autorizar','rechazar'].includes(op)||op==='proponer'&&!['control','control_escolar'].includes(profile.rol)||op!=='proponer'&&profile.rol!=='direccion_escolar')throw err('Sin atribución.',403);
   if(b.confirmed!==true||typeof b.reason!=='string'||b.reason.trim().length<15||b.reason.length>1500)throw err('Confirmación y motivo requeridos.');
   if(!experimental)throw err('Escrituras de sellos y rectificaciones deshabilitadas fuera de pruebas.',409);
   args.p_motivo=b.reason.trim();
   if(op==='proponer'){
    if(typeof b.grade!=='string'||! /^(?:10(?:\.0+)?|[0-9](?:\.[0-9]{1,15})?)$/.test(b.grade)||typeof b.reference!=='string'||b.reference.trim().length<5||b.reference.length>200)throw err('Nota decimal o referencia inválida.');
    args.p_nota=b.grade;args.p_anterior=b.previousId==null?null:checked(()=>evidenceId(b.previousId));args.p_referencia=b.reference.trim();
   }else args.p_id=checked(()=>evidenceId(b.id));
  }
  data=await rpc(db,'jaguar360_rectificar_sello',args);
 }else if(req.method==='POST'&&b.action==='seal_period'){
  if(profile.rol!=='direccion_escolar')throw err('Solo Dirección autoriza el cierre.',403);
  const origin=req.headers?.origin,host=req.headers?.['x-forwarded-host']||req.headers?.host;
  try{if(!origin||!host||new URL(origin).host!==host)throw Error()}catch{throw err('Origen no autorizado.',403)}
  if(!experimental)throw err('Cierre protegido deshabilitado fuera de pruebas.',409);
  data=await rpc(db,'jaguar360_cierre_periodo',{p_actor:user.id,...sealRequest(b)});
 }else return false;
 if(q.view==='seal'||q.view==='rectifications'||['seal_period','sealed_rectification'].includes(b.action))data={...data,experimental};
 res.status(200).json({ok:true,data});return true;
}
