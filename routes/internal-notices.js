import {evidenceId} from '../lib/jaguar_history_evidence.js';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const roles=['alumno','docente','direccion_escolar','control_escolar','control','coordinacion_academica','servicios_docentes','servicios_estudiantiles','prefectura','archivo_escolar','recursos_monetarios'];
const proposers=roles.filter(r=>!['alumno','docente','direccion_escolar'].includes(r));
const text=(v,min,max)=>{if(typeof v!=='string'||v.trim().length<min||v.trim().length>max)throw fail('Campos de comunicado incompletos.');return v.trim();};
export async function internalNotices(req,res,{user,profile,adminClient:db}){
 const q=req.query||{},b=req.body||{},write=req.method==='POST'&&b.action==='internal_notice';if(!write&&!(req.method==='GET'&&q.mode==='internal_notices'))return false;
 if(!roles.includes(profile.rol))throw fail('Sin atribución.',403);const experimental=process.env.JAGUAR360_TEST_SEALS==='true',args={p_actor:user.id};
 if(write){try{if(!req.headers?.origin||new URL(req.headers.origin).host!==(req.headers['x-forwarded-host']||req.headers.host))throw Error()}catch{throw fail('Origen no autorizado.',403)}
  if(!experimental)throw fail('Solo entorno aislado de pruebas.',409);
  if(!['propose','publish','reject','ack'].includes(b.operation)||b.confirmed!==true)throw fail('Operación o confirmación inválida.');
  args.p_op=b.operation;
  if(b.operation==='propose'){
   if(!proposers.includes(profile.rol))throw fail('Sin atribución.',403);
   if(!Array.isArray(b.roles)||!b.roles.length||b.roles.length>roles.length||new Set(b.roles).size!==b.roles.length||b.roles.some(r=>!roles.includes(r)))throw fail('Alcance inválido.');
   Object.assign(args,{p_asunto:text(b.subject,6,180),p_contenido:text(b.body,15,6000),p_roles:b.roles,p_referencia:text(b.reference,5,300),p_motivo:text(b.reason,15,1500)});
  }else{
   try{args.p_id=evidenceId(b.id)}catch{throw fail('Comunicado inválido.');}
   if(b.operation!=='ack'){if(profile.rol!=='direccion_escolar')throw fail('Sin atribución.',403);args.p_motivo=text(b.reason,15,1500);}
  }
 }
 const {data,error}=await db.rpc('jaguar360_comunicados_bandeja',args);if(error)throw fail(error.code==='42501'?'Sin atribución.':error.code==='P0001'?error.message:'No se pudo consultar el comunicado.',error.code==='42501'?403:['P0001','55P03','23505'].includes(error.code)?409:503);
 res.status(200).json({ok:true,data:{...data,experimental}});return true;
}
