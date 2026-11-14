import {validateCycle} from '../lib/jaguar_academic_lifecycle.js';
import {evidenceId} from '../lib/jaguar_history_evidence.js';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
export async function studentContinuity(req,res,{user,profile,adminClient:db}){
 const q=req.query||{},b=req.body||{};
 if(q.mode!=='student_continuity'&&b.action!=='student_continuity')return false;
 if(!['GET','POST'].includes(req.method))throw fail('Método no permitido.',405);
 if(profile.rol!=='alumno')throw fail('Sin atribución.',403);
 const write=req.method==='POST',x=write?b:q,experimental=process.env.JAGUAR360_TEST_SEALS==='true';
 let cycle;try{cycle=validateCycle(x.cycle)}catch(e){throw fail(e.message)}
 const args={p_actor:user.id,p_ciclo:cycle};
 if(write){
  try{if(!req.headers?.origin||new URL(req.headers.origin).host!==(req.headers['x-forwarded-host']||req.headers.host))throw Error()}catch{throw fail('Origen no autorizado.',403)}
  if(!experimental)throw fail('Solo entorno aislado de pruebas.',409);
  if(x.confirmed!==true||!['confirmada','retirada'].includes(x.response))throw fail('Confirma la acción de continuidad.');
  try{args.p_dictamen=evidenceId(x.decision)}catch(e){throw fail(e.message)}args.p_accion=x.response;
 }
 const {data,error}=await db.rpc('jaguar360_confirmar_continuidad',args);
 if(error)throw fail(error.code==='42501'?'Sin atribución.':error.code==='P0001'?error.message:'No se pudo consultar o registrar continuidad.',error.code==='42501'?403:['P0001','55P03','23505'].includes(error.code)?409:503);
 if(!data||typeof data.canRespond!=='boolean')throw fail('Respuesta de continuidad incompleta.',503);
 res.status(200).json({ok:true,data:{...data,canRespond:experimental&&data.canRespond,experimental}});return true;
}
