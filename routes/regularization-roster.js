import {evidenceId} from '../lib/jaguar_history_evidence.js';
import {recourseCandidate,rosterRequest} from '../lib/jaguar360_roster.js';
const fail=(m,status=400)=>Object.assign(Error(m),{status});
const check=fn=>{try{return fn()}catch(e){throw fail(e.message)}};
async function rpc(db,name,args){const {data,error}=await db.rpc(name,args);if(error)throw fail(error.code==='42501'?'Sin atribución.':error.code==='P0001'?error.message:error.code==='55P03'?'Operación concurrente; vuelve a consultar.':'No se pudo consultar o registrar. Comprueba V10.',error.code==='42501'?403:['P0001','55P03'].includes(error.code)?409:503);return data}
export async function regularizationRoster(req,res,{user,profile,adminClient:db}){
 const q=req.query||{},b=req.body||{};const writing=req.method==='POST'&&b.action==='recourse_roster';
 if(!writing&&!(req.method==='GET'&&['recourse_candidate','recourse_roster'].includes(q.view)))return false;
 const experimental=process.env.JAGUAR360_TEST_SEALS==='true';let data;
 const load=async(call,student)=>rpc(db,'jaguar360_candidatura_recursamiento',{p_actor:user.id,p_call:call,p_alumno:student});
 if(writing){
  if(profile.rol!=='coordinacion_academica')throw fail('Solo Coordinación gestiona reservas.',403);
  try{if(!req.headers?.origin||new URL(req.headers.origin).host!==(req.headers['x-forwarded-host']||req.headers.host))throw Error()}catch{throw fail('Origen no autorizado.',403)}
  if(!experimental)throw fail('Reservas deshabilitadas fuera de ambiente de prueba.',409);
  const x=check(()=>rosterRequest(b)),args={p_actor:user.id,p_call:x.call,p_alumno:x.student,p_accion:x.operation,p_motivo:x.reason};
  if(x.operation==='reservar'){
   const src=await load(x.call,x.student);if(src.fingerprint!==x.fingerprint)throw fail('La evidencia cambió; vuelve a consultar.',409);
   const candidate=check(()=>recourseCandidate(src.source,src.call,x.blocks));
   Object.assign(args,{p_huella:x.fingerprint,p_bloques:candidate.blocks,p_causa:candidate.cause});
  }else Object.assign(args,{p_id:x.id,p_version:x.version});
  data=await rpc(db,'jaguar360_reservar_recursamiento',args);
 }else{
  const call=check(()=>evidenceId(q.call));
  if(q.view==='recourse_roster')data={rows:await rpc(db,'jaguar360_padron_recursamiento',{p_actor:user.id,p_call:call})};
  else{const src=await load(call,check(()=>evidenceId(q.student)));data={...check(()=>recourseCandidate(src.source,src.call)),fingerprint:src.fingerprint,capacity:src.capacity,reserved:src.reserved};}
 }
 res.status(200).json({ok:true,data:{...data,experimental}});return true;
}
