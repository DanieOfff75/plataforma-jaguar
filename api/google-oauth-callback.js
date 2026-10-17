/** Callback público de Google; vincula sólo la cuenta autorizada de Servicios Docentes. */
import {getClients} from '../lib/_admin.js';
import {googleConfig,verifyState,nonceCookie,clearNonceCookie,tokenExchange,googleIdentity,seal,readConnection,GOOGLE_CONN_KEY} from '../lib/google_classroom_oauth.js';
const errorPage=(res,status)=>res.redirect(303,`/?google_connect=${status}`);
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 clearNonceCookie(res);
 if(req.method!=='GET')return res.status(405).end();
 try{
  const config=googleConfig();
  const id=verifyState(req.query?.state,nonceCookie(req),config.stateSecret);
  if(req.query?.error)return errorPage(res,'denied');
  const {adminClient:db}=getClients(req);
  // Revalidar rol incluso después de la redirección (podría haberse desactivado).
  const {data:role,error:roleError}=await db.from('perfiles').select('rol,activo').eq('id',id).maybeSingle();
  if(roleError||role?.rol!=='servicios_docentes'||role.activo!==true)return errorPage(res,'unauthorized');
  await readConnection(db);
  const tokens=await tokenExchange(config,req.query?.code);
  const identity=await googleIdentity(tokens.access_token);
  if(!identity.email_verified||String(identity.email||'').trim().toLowerCase()!==config.ownerEmail)return errorPage(res,'wrong_account');
  const old=await readConnection(db);
  // Google podría no entregar refresh_token en cada conexión. Conservar el anterior sólo de la MISMA cuenta.
  const existingRefresh=old?.correo?.toLowerCase()===config.ownerEmail?old?.refresh_token_cifrado:null;
  if(!tokens.refresh_token&&!existingRefresh)return errorPage(res,'no_refresh');
  const payload={clave:GOOGLE_CONN_KEY,correo:config.ownerEmail,google_subject:String(identity.sub||''),access_token_cifrado:seal(tokens.access_token,config.key),refresh_token_cifrado:tokens.refresh_token?seal(tokens.refresh_token,config.key):existingRefresh,expires_at:new Date(Date.now()+Number(tokens.expires_in||3600)*1000).toISOString(),permisos:String(tokens.scope||''),conectado_por:id,actualizado_at:new Date().toISOString()};
  const {error}=await db.from('jaguar_google_conexiones').upsert(payload,{onConflict:'clave'});
  if(error)throw new Error('No se pudo guardar la autorización Google.');
  return errorPage(res,'ok');
 }catch(e){console.error('Google OAuth callback:',e?.message);return errorPage(res,'error');}
}
