import {sessionKey,validateSessionOperation} from '../lib/jaguar360_session_attendance.js';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const checked=fn=>{try{return fn()}catch(e){throw fail(e.message)}};
export async function sessionAttendance(req,res,{user,profile,adminClient:db}){
 const isGet=req.method==='GET';if(!isGet&&req.method!=='POST')throw fail('Método no permitido.',405);
 const b=req.body||{},key=checked(()=>sessionKey(isGet?req.query:b));
 const args={p_actor:user.id,p_periodo:key.period,p_gm:key.groupMaterial,p_fecha:key.date,p_inicio:key.time};
 let query;
 if(isGet)query=db.rpc('jaguar360_contexto_sesion',args);
 else {
  if(!['docente','prefectura'].includes(profile.rol))throw fail('Sin atribución.',403);
  const origin=req.headers?.origin,host=req.headers?.['x-forwarded-host']||req.headers?.host;
  try{if(!origin||!host||new URL(origin).host!==host)throw Error()}catch{throw fail('Origen no autorizado.',403)}
  const m=checked(()=>validateSessionOperation(b));
  if(m.operation==='save'&&profile.rol!=='docente'||m.operation==='justify'&&profile.rol!=='prefectura')throw fail('Docente captura y Prefectura justifica.',403);
  query=db.rpc('jaguar360_registrar_sesion',{...args,p_accion:m.operation,p_version:m.version,p_padron:m.rosterVersion,p_sesiones:m.scheduleVersion,p_marcas:m.marks,p_alumno:m.student,p_motivo:m.reason});
 }
 const {data,error}=await query;if(error)throw fail(error.code==='42501'?'Sin atribución.':['P0001','23514','40001','23505'].includes(error.code)?(['P0001','23514'].includes(error.code)?error.message:'Los datos cambiaron; actualiza la consulta.'):'No se pudo consultar o guardar; comprueba la migración V8.',error.code==='42501'?403:['P0001','23514','40001','23505'].includes(error.code)?409:503);
 return res.status(200).json({ok:true,data});
}
