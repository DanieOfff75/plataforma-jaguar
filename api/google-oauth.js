/** Inicio, estado y desconexión de OAuth de Servicios Docentes. */
import {requireRoles} from '../lib/_admin.js';
import {googleConfig,signState,authUrl,setNonceCookie,readConnection,GOOGLE_CONN_KEY} from '../lib/google_classroom_oauth.js';
const failure=(message,status)=>{throw Object.assign(new Error(message),{status});};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 try{
  const {user,adminClient:db}=await requireRoles(req,['servicios_docentes']);
  const action=String((req.method==='GET'?req.query?.action:req.body?.action)||'');
  if(req.method==='GET'&&action==='status'){
   // Si aún no hay secretos en Vercel, mostramos una configuración pendiente, sin romper el módulo manual.
   let configured=true;try{googleConfig();}catch{configured=false;}
   let connection=null;try{connection=await readConnection(db);}catch(e){if(configured)throw e;}
   return res.status(200).json({ok:true,data:{configured,connected:!!connection,correo:connection?.correo||null,expires_at:connection?.expires_at||null}});
  }
  if(req.method==='POST'&&action==='start'){
   const config=googleConfig();
   const origin=String(req.headers.origin||'');
   if(origin!==config.origin)failure('Abre Jaguar desde su dominio autorizado antes de conectar Google.',403);
   // Evitar iniciar OAuth si falta la migración SQL.
   await readConnection(db);
   const {state,nonce}=signState(user.id,config.stateSecret);
   setNonceCookie(res,nonce,config);
   return res.status(200).json({ok:true,data:{url:authUrl(config,state)}});
  }
  if(req.method==='POST'&&action==='disconnect'){
   const config=googleConfig();
   if(String(req.headers.origin||'')!==config.origin)failure('Solicitud rechazada por origen distinto.',403);
   const {error}=await db.from('jaguar_google_conexiones').delete().eq('clave',GOOGLE_CONN_KEY);
   if(error)failure('No se pudo desconectar Google.',502);
   return res.status(200).json({ok:true,data:{connected:false}});
  }
  return res.status(405).json({ok:false,error:'Operación no disponible.'});
 }catch(e){console.error('OAuth Servicios Docentes:',e?.message);return res.status(e.status||500).json({ok:false,error:e.message||'Error interno.'});}
}
