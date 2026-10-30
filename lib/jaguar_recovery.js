import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {digest,newCode,newProof,otpDigest,proofDigest,normalizeEmail,validEmail} from './jaguar_shield_crypto.js';
import {deliverJaguarNotification} from './jaguar_notifications_delivery.js';
import {renderOtpNotification,renderSystemNotification} from './jaguar_notifications_email.js';

const generic = 'Si la cuenta está activa y tiene un correo de recuperación verificado, recibirás un código. Revisa tu bandeja de entrada.';
const uuid = s=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(s||''));
const client = ()=>{
  const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  if(!url||!key)throw Object.assign(new Error('Supabase no está configurado.'),{status:503});
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
};
const fail=(msg,status=400)=>Object.assign(new Error(msg),{status});
function requireOrigin(req){
  const origin=String(req.headers?.origin||''), host=String(req.headers?.['x-forwarded-host']||req.headers?.host||'');
  if(!origin||!host)throw fail('Realiza la recuperación desde el sitio Jaguar.',403);
  try{if(new URL(origin).host===host&&new URL(origin).protocol==='https:')return;}catch{}
  // El desarrollo local también usa HTTP, pero solo en la misma máquina.
  try{const u=new URL(origin);if(u.host===host&&u.protocol==='http:'&&/^localhost(?::\d+)?$/.test(host))return;}catch{}
  throw fail('Origen de solicitud no autorizado.',403);
}
function ipIdentity(req){
  // Vercel informa la IP del cliente; el valor solo se utiliza para limitar intentos.
  const raw=String(req.headers?.['x-vercel-forwarded-for']||req.headers?.['x-real-ip']||req.headers?.['x-forwarded-for']||'unknown').split(',')[0].trim().slice(0,120);
  return digest('recovery-ip:'+raw);
}
export function passwordPolicy(p){
  return typeof p==='string'&&p.length>=12&&p.length<=128&&!/\s/.test(p)&&/[a-z]/.test(p)&&/[A-Z]/.test(p)&&/\d/.test(p);
}
function idAndCode(body){
  const id=String(body?.id||''),code=String(body?.code||'');
  if(!uuid(id)||!/^\d{6}$/.test(code))throw fail('El código es inválido o está incompleto.');
  return {id,code};
}

export async function recoveryStart(req,res){
  requireOrigin(req);res.setHeader('Cache-Control','no-store');
  const identifier=normalizeEmail(req.body?.identificador);
  if(identifier.length<3||identifier.length>250||!validEmail(identifier))throw fail('Escribe tu usuario institucional completo.');
  const db=client(),id=randomUUID(),code=newCode();
  const {data:p,error:pe}=await db.from('perfiles').select('id,activo,correo_recuperacion,shield_correo_verificado_at')
    .eq('correo',identifier).maybeSingle();
  if(pe)throw fail('No se pudo consultar el servicio de recuperación.',503);
  const eligible=Boolean(p?.activo&&p?.shield_correo_verificado_at&&validEmail(p?.correo_recuperacion));
  const {data:issued,error:ie}=await db.rpc('jaguar_recuperacion_emitir',{
    p_id:id,p_actor:eligible?p.id:null,p_ip_hash:ipIdentity(req),p_actor_hash:digest('recovery-user:'+identifier),
    p_codigo_hash:otpDigest(id,code)
  });
  if(ie)throw fail('Falta instalar la migración de recuperación de Jaguar.',503);
  if(issued&&eligible){
    try{await deliverJaguarNotification(normalizeEmail(p.correo_recuperacion),renderOtpNotification({code,purpose:'password_reset'}));}
    catch(e){
      await db.from('jaguar_recuperacion_codigos').update({consumido_at:new Date().toISOString()}).eq('id',id);
      console.error('Notificaciones Jaguar: no se pudo enviar un código de recuperación.',e?.code||e?.message||'EMAIL');
    }
  }
  // No revelar si un usuario existe, tiene correo registrado o fue limitado.
  return res.status(200).json({ok:true,id,message:generic,expires_seconds:300,sms_available:false});
}
export async function recoveryVerify(req,res){
  requireOrigin(req);res.setHeader('Cache-Control','no-store');
  const {id,code}=idAndCode(req.body);const db=client(),proof=newProof();
  const {data:ok,error}=await db.rpc('jaguar_recuperacion_verificar',{
    p_id:id,p_codigo_hash:otpDigest(id,code),p_prueba_hash:proofDigest(proof)
  });
  if(error)throw fail('No se pudo comprobar el código. Revisa el servicio de recuperación.',503);
  if(!ok)throw fail('Código incorrecto, vencido o con demasiados intentos.',403);
  return res.status(200).json({ok:true,proof,expires_seconds:180});
}
export async function recoveryComplete(req,res){
  requireOrigin(req);res.setHeader('Cache-Control','no-store');
  const id=String(req.body?.id||''), proof=String(req.body?.proof||'');
  const password=req.body?.password, repeat=req.body?.confirm_password;
  if(!uuid(id)||proof.length<32)throw fail('La verificación ya no es válida. Solicita un código nuevo.',403);
  if(!passwordPolicy(password))throw fail('Usa entre 12 y 128 caracteres, con mayúscula, minúscula y número, sin espacios.');
  if(password!==repeat)throw fail('Las contraseñas no coinciden.');
  const db=client();
  const {data:userId,error:ce}=await db.rpc('jaguar_recuperacion_consumir',{p_id:id,p_prueba_hash:proofDigest(proof)});
  if(ce)throw fail('No se pudo confirmar la autorización. Revisa la migración.',503);
  if(!userId)throw fail('El código ya fue utilizado o venció. Solicita uno nuevo.',403);
  // Invalidar las sesiones ANTES del cambio de contraseña: si falla, no autorizar el cambio.
  const {error:se}=await db.from('ithla_sesiones').update({revocada_en:new Date().toISOString()})
    .eq('usuario_id',userId).is('revocada_en',null);
  if(se){console.error('Notificaciones Jaguar: fallo al revocar sesiones institucionales.',se.message);throw fail('No se pudo asegurar el cierre de sesiones. Solicita un nuevo código.',503);}
  const {error:ae}=await db.auth.admin.updateUserById(userId,{password});
  if(ae){console.error('Notificaciones Jaguar: error al actualizar contraseña después de consumir código.',ae.message);throw fail('No se pudo actualizar la contraseña. Solicita un nuevo código.',503);}
  // Aviso sin secretos; el fallo del aviso no deshace la recuperación autorizada.
  try{
    const {data:p}=await db.from('perfiles').select('correo_recuperacion').eq('id',userId).maybeSingle();
    if(validEmail(p?.correo_recuperacion))await deliverJaguarNotification(p.correo_recuperacion,renderSystemNotification({title:'Tu contraseña fue actualizada',description:'Se restableció la contraseña de tu cuenta Jaguar.',category:'Aviso de seguridad',details:['Si realizaste el cambio, puedes iniciar sesión con tu nueva contraseña.','Si no reconoces esta operación, contacta de inmediato al soporte institucional.']}));
  }catch(e){console.warn('Notificaciones Jaguar: aviso de contraseña no entregado.',e?.code||'MAIL');}
  return res.status(200).json({ok:true,message:'Contraseña actualizada. Inicia sesión con tu usuario institucional.'});
}
