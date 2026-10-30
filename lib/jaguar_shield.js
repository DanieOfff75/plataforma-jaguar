import { randomUUID } from 'node:crypto';
import { renderOtpNotification } from './jaguar_notifications_email.js';
import { deliverJaguarNotification } from './jaguar_notifications_delivery.js';
import { normalizeEmail,validEmail,secret,digest,otpDigest,proofDigest,newCode,newProof,maskEmail } from './jaguar_shield_crypto.js';
export {normalizeEmail,validEmail,secret,digest,otpDigest,proofDigest,newCode,newProof,maskEmail};
import { createClient } from '@supabase/supabase-js';
import { getClients } from './_admin.js';
import { assertSession } from './ithla_session.js';

export const SHIELD_PURPOSES = Object.freeze(['enroll','change_old','change_new','eval_open','eval_close']);
export const sessionId = req => String(req.headers?.['x-ithla-session'] || '');
export function shieldError(message, status=400, code='SHIELD_ERROR'){
  return Object.assign(new Error(message),{status,code});
}
export function assertSameOrigin(req){
  const origin=String(req.headers?.origin||'');
  const host=String(req.headers?.['x-forwarded-host']||req.headers?.host||'');
  if(!origin||!host)throw shieldError('Confirma esta acción desde la página institucional.',403,'SHIELD_ORIGEN');
  try{if(new URL(origin).host===host)return;}catch{}
  throw shieldError('La solicitud no proviene del dominio institucional.',403,'SHIELD_ORIGEN');
}
export async function identity(req){
  const {token,adminClient:db}=getClients(req);
  if(!token)throw shieldError('Inicia sesión para continuar.',401);
  const {data:{user},error:ue}=await db.auth.getUser(token);
  if(ue||!user)throw shieldError('Sesión de identidad inválida.',401);
  const {data:profile,error:pe}=await db.from('perfiles')
    .select('id,rol,activo,correo,correo_recuperacion,shield_correo_verificado_at')
    .eq('id',user.id).maybeSingle();
  if(pe)throw shieldError('Instala la migración Jaguar Shield en Supabase.',503,'SHIELD_MIGRACION');
  if(!profile?.activo)throw shieldError('Perfil inactivo o inexistente.',403);
  await assertSession(req,db,user.id,profile.rol,'jaguar');
  if(!/^[0-9a-f-]{36}$/i.test(sessionId(req)))throw shieldError('Sesión protegida ausente.',401);
  return {db,user,profile,sid:sessionId(req)};
}
export async function checkPassword(user,password){
  if(typeof password!=='string'||!password)throw shieldError('Escribe tu contraseña actual para continuar.',400);
  const {data,error}=await createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY)
    .auth.signInWithPassword({email:user.email,password});
  if(error||data?.user?.id!==user.id)throw shieldError('La contraseña actual no es correcta.',403,'SHIELD_CONTRASENA');
}
/** Servicio de envío compartido: plantilla reutilizable, sin rutas públicas nuevas. */
export async function deliverEmail(destination,code,purpose){
  return deliverJaguarNotification(destination,renderOtpNotification({code,purpose}));
}
export async function startChallenge({db,user,profile,sid},body){
  const purpose=String(body?.purpose||'');
  if(!SHIELD_PURPOSES.includes(purpose))throw shieldError('Tipo de verificación no reconocido.');
  const channel=String(body?.channel||'email');
  if(channel==='sms')throw shieldError('El SMS está desactivado en este laboratorio hasta contar con línea y autorización.',409,'SHIELD_SMS_INACTIVO');
  if(channel!=='email')throw shieldError('Canal no disponible.');
  const recovery=normalizeEmail(profile.correo_recuperacion);
  const target=normalizeEmail(body?.new_email);
  let destination='',context='';
  if(purpose==='enroll'){
    // Alta inicial: verifica el correo nuevo ANTES de que first_access pueda guardarlo.
    // Para correos ya registrados se requiere además la contraseña actual.
    if(validEmail(recovery)){
      await checkPassword(user,body?.password);destination=context=recovery;
    }else{
      const initial=normalizeEmail(body?.new_email);
      if(!validEmail(initial))throw shieldError('Indica el correo que deseas registrar.');
      destination=context=initial;
    }
  }else if(purpose==='eval_open'||purpose==='eval_close'){
    if(profile.rol!=='direccion_escolar')throw shieldError('Solo Dirección Escolar puede autorizar evaluaciones.',403);
    if(!profile.shield_correo_verificado_at||!validEmail(recovery))throw shieldError('Primero verifica tu correo de recuperación en Mi perfil.',409,'SHIELD_SIN_CORREO_VERIFICADO');
    const pid=Number(body?.period_id);
    if(!Number.isSafeInteger(pid)||pid<=0)throw shieldError('Periodo de evaluación inválido.');
    destination=recovery;context=String(pid);
  }else if(purpose==='change_old'){
    if(!validEmail(target)||target===recovery)throw shieldError('Escribe un correo diferente y válido.');
    if(!profile.shield_correo_verificado_at)throw shieldError('Primero verifica tu correo actual en Mi perfil.',409);
    await checkPassword(user,body?.password);
    destination=recovery;context=target;
  }else if(purpose==='change_new'){
    if(!validEmail(target)||target===recovery)throw shieldError('Escribe un correo diferente y válido.');
    const proof=String(body?.old_proof||'');
    if(!proof)throw shieldError('Confirma antes el código enviado a tu correo anterior.');
    const {data:old,error:oe}=await db.from('jaguar_shield_desafios')
      .select('id').eq('usuario_id',user.id).eq('sesion_id',sid).eq('proposito','change_old')
      .eq('contexto',target).eq('destino',recovery).eq('prueba_hash',proofDigest(proof))
      .is('usado_at',null).gt('vence_at',new Date().toISOString()).not('verificado_at','is',null).limit(1);
    if(oe||!old?.length)throw shieldError('La verificación del correo anterior venció o no corresponde.',403);
    destination=context=target;
  }
  if(!validEmail(destination))throw shieldError('No hay un correo válido para verificar.');
  const id=randomUUID(),code=newCode();
  const {data:issued,error:ie}=await db.rpc('jaguar_shield_emitir',{
    p_id:id,p_actor:user.id,p_sesion:sid,p_proposito:purpose,p_contexto:context,
    p_destino:destination,p_codigo_hash:otpDigest(id,code)
  });
  if(ie)throw shieldError('No fue posible crear el desafío de verificación. Revisa la migración Shield.',503,'SHIELD_SQL');
  if(!issued)throw shieldError('Demasiadas solicitudes. Intenta nuevamente más tarde.',429,'SHIELD_LIMITE');
  try{await deliverEmail(destination,code,purpose);}catch(e){
    await db.from('jaguar_shield_desafios').update({usado_at:new Date().toISOString()}).eq('id',id).eq('usuario_id',user.id);
    throw e;
  }
  return {id,channel:'email',sent_to:maskEmail(destination),expires_seconds:300};
}
export async function verifyChallenge({db,user,sid},body){
  const id=String(body?.id||''),code=String(body?.code||'');
  if(!/^[0-9a-f-]{36}$/i.test(id)||!/^[0-9]{6}$/.test(code))throw shieldError('Código o desafío no válido.',400);
  const proof=newProof();
  const {data:verified,error}=await db.rpc('jaguar_shield_verificar',{
    p_id:id,p_actor:user.id,p_sesion:sid,p_codigo_hash:otpDigest(id,code),p_prueba_hash:proofDigest(proof)
  });
  if(error)throw shieldError('No se pudo confirmar el código en Supabase.',503,'SHIELD_SQL');
  if(!verified)throw shieldError('Código incorrecto, agotado o vencido.',403,'SHIELD_CODIGO');
  return {proof};
}
export async function consumeProof(db,userId,sid,purpose,context,proof){
  if(typeof proof!=='string'||proof.length<20)throw shieldError('Es necesaria una verificación nueva.',403,'SHIELD_VERIFICACION');
  const {data:ok,error}=await db.rpc('jaguar_shield_consumir',{
    p_actor:userId,p_sesion:sid,p_proposito:purpose,p_contexto:String(context),p_prueba_hash:proofDigest(proof)
  });
  if(error)throw shieldError('No se pudo comprobar la autorización Shield.',503,'SHIELD_SQL');
  if(!ok)throw shieldError('Código ya utilizado, vencido o correspondiente a otra operación.',403,'SHIELD_VERIFICACION');
  return true;
}
