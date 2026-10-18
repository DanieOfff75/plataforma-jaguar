import { randomUUID } from 'node:crypto';
const DEFAULTS={tecnico:[10,240],direccion_escolar:[15,240],control_escolar:[15,360],administrativo:[15,360],docente:[30,480],alumno:[30,480],aspirante:[20,120]};
export function sessionClass(role){
  if(role==='tecnico')return 'tecnico';
  if(role==='direccion_escolar')return 'direccion_escolar';
  if(role==='docente'||role==='alumno')return role;
  if(role==='aspirante')return 'aspirante';
  if(role==='control_escolar'||role==='control')return 'control_escolar';
  return 'administrativo';
}
export async function getSessionLimits(admin,role){
  const klass=sessionClass(role),defaults=DEFAULTS[klass];
  const {data,error}=await admin.from('ithla_config').select('valor').eq('clave','sesiones').single();
  if(error)throw Object.assign(new Error('Instala la migración ITHLA V6 de sesiones antes de habilitar el inicio de sesión.'),{status:503});
  const item=data?.valor?.[klass]||{};
  // Evitar políticas de duración ilimitada por error de configuración.
  const idle=Math.max(5,Math.min(60,Number(item.inactividad)||defaults[0]));
  const absolute=Math.max(idle,Math.min(480,Number(item.absoluta)||defaults[1]));
  return {idle,absolute};
}
export async function createSession(admin,userId,role,app){
  const policy=await getSessionLimits(admin,role);
  const id=randomUUID(),now=Date.now();
  const {error}=await admin.from('ithla_sesiones').insert({id,usuario_id:userId,aplicacion:app,perfil:sessionClass(role),ultimo_uso:new Date(now).toISOString(),vence_absoluto:new Date(now+policy.absolute*60e3).toISOString()});
  if(error)throw Object.assign(new Error('No se pudo crear la sesión protegida. Comprueba la migración V6.'),{status:503});
  return {id,inactividad_min:policy.idle,absoluta_min:policy.absolute};
}
export async function assertSession(req,admin,userId,role,app){
  const sid=String(req.headers['x-ithla-session']||'');
  if(!/^[0-9a-f-]{36}$/i.test(sid))throw Object.assign(new Error('Sesión protegida ausente. Vuelve a iniciar sesión.'),{status:401,code:'SESSION_EXPIRED'});
  const policy=await getSessionLimits(admin,role);
  const now=Date.now();
  const {data,error}=await admin.from('ithla_sesiones').update({ultimo_uso:new Date(now).toISOString()})
    .eq('id',sid).eq('usuario_id',userId).eq('aplicacion',app).is('revocada_en',null)
    .gt('vence_absoluto',new Date(now).toISOString())
    .gt('ultimo_uso',new Date(now-policy.idle*60e3).toISOString())
    .select('id').maybeSingle();
  if(error)throw Object.assign(new Error('No se pudo verificar la sesión.'),{status:503});
  if(!data)throw Object.assign(new Error('La sesión caducó por inactividad o tiempo máximo.'),{status:401,code:'SESSION_EXPIRED'});
  return policy;
}
export async function revokeSession(req,admin,userId){
  const sid=String(req.headers['x-ithla-session']||'');
  if(!/^[0-9a-f-]{36}$/i.test(sid))return;
  const {error}=await admin.from('ithla_sesiones').update({revocada_en:new Date().toISOString()}).eq('id',sid).eq('usuario_id',userId);
  if(error)throw error;
}
