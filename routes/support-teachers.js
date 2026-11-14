import {validateCycle} from '../lib/jaguar_academic_lifecycle.js';
import {supportRequest} from '../lib/jaguar360_support.js';
const fail=(m,status=400)=>Object.assign(Error(m),{status});
const check=fn=>{try{return fn()}catch(e){throw fail(e.message)}};
export async function supportTeachers(req,res,{user,profile,adminClient:db}){
 const b=req.body||{},q=req.query||{};const write=req.method==='POST'&&b.action==='support_teacher';
 if(!write&&!(req.method==='GET'&&q.mode==='support_teacher'))return false;
 let rpc,args;const experimental=process.env.JAGUAR360_TEST_SEALS==='true';
 if(write){
  if(!['docente','servicios_docentes'].includes(profile.rol))throw fail('Sin atribución.',403);
  try{if(!req.headers?.origin||new URL(req.headers.origin).host!==(req.headers['x-forwarded-host']||req.headers.host))throw Error()}catch{throw fail('Origen no autorizado.',403)}
  if(!experimental)throw fail('Registro de apoyo deshabilitado fuera de pruebas.',409);
  const x=check(()=>supportRequest(b));if((['submit','withdraw'].includes(x.op)?'docente':'servicios_docentes')!==profile.rol)throw fail('Sin atribución.',403);
  rpc='jaguar360_registrar_apoyo_docente';args={p_actor:user.id,p_ciclo:x.cycle,p_accion:x.op,p_motivo:x.reason,p_propuesta:x.application??null,p_id:x.id??null,p_version:x.version??null,p_referencia:x.reference??null};
 }else{rpc='jaguar360_consultar_apoyo_docente';args={p_actor:user.id,p_ciclo:check(()=>validateCycle(q.cycle))};}
 const {data,error}=await db.rpc(rpc,args);if(error)throw fail(error.code==='42501'?'Sin atribución.':error.code==='P0001'?error.message:error.code==='55P03'?'Operación concurrente.':'No fue posible consultar o registrar el apoyo. Comprueba V10.',error.code==='42501'?403:['P0001','55P03'].includes(error.code)?409:503);
 res.status(200).json({ok:true,data:{...data,experimental}});return true;
}
