import { createClient } from '@supabase/supabase-js';
import { randomBytes, createHash } from 'node:crypto';
import { answerNexo } from '../lib/nexo_advisor.js';
import { replyNexoAI } from '../lib/nexo_ai.js';
import { requireRoles } from '../lib/_admin.js';
import { assertSession } from '../lib/ithla_session.js';
import { nexoTrustedContext } from '../lib/nexo_context.js';
const defaults={institucion:{siglas:'ITHLA',nombre_institucion:'Instituto Tecnológico e Histórico Latinoamericano',lema:'Scientia, Humanitas et Progressum',color_primary:'#1B365D',color_accent:'#D4AF37',logo_url:'/assets/ithla-logo.png',url_admisiones:'https://registro-escolar-virid.vercel.app/'},portal:{titulo:'Instituto Tecnológico e Histórico Latinoamericano',subtitulo:'Ciencia, Humanidad y Progreso',avisos:[],eventos:[],enlaces:[],directorio_publico:[]},admisiones:{estado:'cerrado'},nexo:{activo:true,preguntas:[]}};
function selectPublic(config){const i=config.institucion||{},p=config.portal||{},a=config.admisiones||{};return {
 institucion:Object.fromEntries(['siglas','nombre_institucion','lema','color_primary','color_secondary','color_accent','logo_url','url_admisiones','telefono','direccion','entidad'].map(k=>[k,i[k]??defaults.institucion[k]??null])),
 portal:{...Object.fromEntries(['titulo','subtitulo','avisos','eventos','enlaces'].map(k=>[k,p[k]??defaults.portal[k]])),
 citas_publicas_activas:p.citas_publicas_activas===true,
 aviso_privacidad_url:(typeof p.aviso_privacidad_url==='string'&&/^https:\/\/[a-z0-9.-]+\//i.test(p.aviso_privacidad_url))?p.aviso_privacidad_url:null,
 directorio_publico:(Array.isArray(p.directorio_publico)?p.directorio_publico:[]).filter(x=>x?.publicado===true&&typeof x.nombre==='string').slice(0,24).map(x=>({nombre:String(x.nombre).slice(0,110),departamento:String(x.departamento||'').slice(0,90),cargo:String(x.cargo||'').slice(0,110),publicado:true}))},
 admisiones:{estado:a.estado||'cerrado',fecha_inicio:a.fecha_inicio||null,fecha_fin:a.fecha_fin||null,mensaje:a.mensaje||''}
};}
function appointmentClient(){
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
 if(!url||!key)throw Error('Servicio de citas sin configurar.');
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
function originOK(req){const origin=String(req.headers?.origin||'');if(!origin)return true;try{const u=new URL(origin);return ['http:','https:'].includes(u.protocol)&&u.host===String(req.headers?.host||'')}catch{return false}}
function normalized(s,max){return typeof s==='string'?s.trim().replace(/[\x00-\x1F\x7F]/g,' ').slice(0,max):''}
async function appointments(req,res){
 res.setHeader('Cache-Control','no-store');
 const action=String(req.query?.action||'');
 // Ninguna cita se abre al público sin autorización editorial y enlace de privacidad verificable.
 const configDB=appointmentClient();
 const {data:portalRow,error:portalError}=await configDB.from('ithla_config').select('valor').eq('clave','portal').maybeSingle();
 if(portalError)throw portalError;
 const config=portalRow?.valor||{};
 const active=config.citas_publicas_activas===true&&typeof config.aviso_privacidad_url==='string'&&/^https:\/\/[a-z0-9.-]+\//i.test(config.aviso_privacidad_url);
 if(!active){
  if(action==='appointment-slots')return res.status(200).json({ok:true,data:[]});
  return res.status(503).json({ok:false,error:'La agenda pública aún no está autorizada.'});
 }
 if(action==='appointment-slots'){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Método no permitido.'});
  const db=configDB;
  const {data,error}=await db.from('ithla_cita_horarios').select('id,departamento,inicio,fin,capacidad,reservadas')
   .eq('estado','publicado').gte('inicio',new Date(Date.now()+30*60*1000).toISOString())
   .order('inicio',{ascending:true}).limit(50);
  if(error)throw error;
  return res.status(200).json({ok:true,data:(data||[]).filter(x=>x.reservadas<x.capacidad).map(x=>({id:x.id,departamento:x.departamento,inicio:x.inicio,fin:x.fin}))});
 }
 if(action!=='book-appointment')return res.status(404).json({ok:false,error:'Operación no disponible.'});
 if(req.method!=='POST')return res.status(405).json({ok:false,error:'Método no permitido.'});
 if(!originOK(req))return res.status(403).json({ok:false,error:'Origen no autorizado.'});
 if(!String(req.headers?.['content-type']||'').toLowerCase().startsWith('application/json'))return res.status(415).json({ok:false,error:'Envía un formulario válido.'});
 if(Number(req.headers?.['content-length']||0)>3000)return res.status(413).json({ok:false,error:'Solicitud demasiado grande.'});
 const b=req.body||{};
 if(b.website)return res.status(400).json({ok:false,error:'No fue posible validar el formulario.'});
 const id=normalized(b.slot_id,60),nombre=normalized(b.nombre,110),correo=normalized(b.correo,160).toLowerCase(),motivo=normalized(b.motivo,300);
 if(!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(id)||nombre.length<3||motivo.length<10||!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(correo)||b.consentimiento!==true)
  return res.status(400).json({ok:false,error:'Completa horario, nombre, correo, motivo y consentimiento.'});
 if(!process.env.NEXO_RATE_LIMIT_SECRET||process.env.NEXO_RATE_LIMIT_SECRET.length<16)return res.status(503).json({ok:false,error:'Servicio de citas no habilitado todavía.'});
 const clientIP=String(req.headers?.['x-vercel-forwarded-for']||req.headers?.['x-forwarded-for']||req.socket?.remoteAddress||'').split(',')[0].trim();
 const hash=createHash('sha256').update(String(process.env.NEXO_RATE_LIMIT_SECRET)+':citas:'+clientIP).digest('hex');
 const referencia='CITA-'+randomBytes(5).toString('hex').toUpperCase();
 const db=configDB;
 const {data,error}=await db.rpc('ithla_reservar_cita_publica',{p_slot_id:id,p_referencia:referencia,p_nombre:nombre,p_correo:correo,p_motivo:motivo,p_cliente_hash:hash,p_consentimiento:true});
 if(error){if(/ithla_reservar_cita_publica|schema cache|does not exist/i.test(error.message||''))return res.status(503).json({ok:false,error:'Agenda aún no habilitada. Revisa la instalación de citas.'});throw error}
 if(data!==true)return res.status(409).json({ok:false,error:'Ese horario ya no está disponible o alcanzaste el límite de solicitudes. Actualiza los horarios.'});
 return res.status(201).json({ok:true,data:{referencia,mensaje:'Tu solicitud quedó registrada en el horario seleccionado. Guarda la referencia; no se envía correo automático.'}});
}
export default async function handler(req,res){
 res.setHeader('Cache-Control', req.method==='POST'||String(req.query?.action||'')==='director-status'?'no-store':'public,max-age=30,s-maxage=60');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false,error:'Método no permitido.'});
 try{
  if(['appointment-slots','book-appointment'].includes(String(req.query?.action||'')))return await appointments(req,res);
  if(req.method==='POST'&&req.body?.action==='nexo-chat'){
    // Ruta pública independiente de operaciones de Dirección. Nunca lee expedientes.
    const origin=String(req.headers?.origin||'');
    const host=String(req.headers?.host||'');
    if(origin){
      let sameOrigin=false;
      try{const parsed=new URL(origin);sameOrigin=parsed.host===host&&(['https:','http:'].includes(parsed.protocol));}catch{}
      if(!sameOrigin)return res.status(403).json({ok:false,error:'Origen no permitido.'});
    }
    if(!String(req.headers?.['content-type']||'').toLowerCase().startsWith('application/json'))
      return res.status(415).json({ok:false,error:'Se requiere application/json.'});
    if(Number(req.headers?.['content-length']||0)>5000)
      return res.status(413).json({ok:false,error:'Solicitud demasiado grande.'});
    if(!process.env.SUPABASE_URL||!(process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY))
      return res.status(503).json({ok:false,error:'Base institucional no configurada.'});
    const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY,
      {auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await db.from('ithla_config').select('clave,valor').in('clave',['institucion','admisiones','nexo','portal']);
    if(error)throw error;
    const settings={...defaults,...Object.fromEntries((data||[]).map(r=>[r.clave,r.valor]))};
    if(!(data||[]).some(r=>r.clave==='admisiones'))settings.admisiones={}; // No inferir convocatorias no publicadas.
    let role=null,actorId=null;
    const bearer=/^Bearer\s+(.+)$/i.exec(String(req.headers?.authorization||''));
    if(bearer){
      const {data:{user},error:authError}=await db.auth.getUser(bearer[1].trim());
      if(authError||!user)return res.status(401).json({ok:false,error:'La sesión caducó; vuelve a iniciar sesión.'});
      const {data:profile,error:profileError}=await db.from('perfiles').select('rol,activo').eq('id',user.id).maybeSingle();
      if(profileError||!profile?.activo)return res.status(403).json({ok:false,error:'Perfil institucional no disponible.'});
      try{await assertSession(req,db,user.id,profile.rol,'jaguar');}catch{return res.status(401).json({ok:false,error:'La sesión protegida expiró.'});}
      role=profile.rol;actorId=user.id;
    }
    const result=await replyNexoAI({message:req.body?.message,history:req.body?.history,settings,req,trustedContext:nexoTrustedContext('jaguar',role),verifiedActorId:actorId,
      acquireQuota:async hash=>{
        const quota=await db.rpc('ithla_nexo_ai_take_quota',{p_client_hash:hash});
        if(quota.error)throw quota.error;
        return quota.data===true;
      }});
    return res.status(200).json({ok:true,data:result});
  }
  if(req.method==='POST'){
    const {user,adminClient}=await requireRoles(req,['direccion_escolar']);
    if(req.body?.action!=='set-admissions')return res.status(400).json({ok:false,error:'Operación no permitida.'});
    const estado=String(req.body?.estado||''),motivo=String(req.body?.motivo||'').trim();
    if(!['abierto','pausado','cerrado'].includes(estado)||motivo.length<12||motivo.length>1000)return res.status(400).json({ok:false,error:'Estado y motivo institucional obligatorios.'});
    const {data,error}=await adminClient.rpc('ithla_direccion_cambiar_convocatoria',{p_estado:estado,p_motivo:motivo,p_actor:user.id});
    if(error)return res.status(409).json({ok:false,error:error.message});
    return res.status(200).json({ok:true,data});
  }
  if(String(req.query?.action||'')==='director-status'){
    await requireRoles(req,['direccion_escolar']);
    const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY);
    const {data,error}=await db.from('ithla_config').select('valor,revision,actualizado_en').eq('clave','admisiones').single();
    if(error)throw error;res.setHeader('Cache-Control','no-store');return res.status(200).json({ok:true,data});
  }

  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  if(!url||!key)return res.status(503).json({ok:false,error:'Configuración institucional no disponible.'});
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await db.from('ithla_config').select('clave,valor').in('clave',['institucion','portal','admisiones','nexo']);
  if(error)throw error;
  const settings={...defaults,...Object.fromEntries((data||[]).map(r=>[r.clave,r.valor]))};
  if(String(req.query?.action||'')==='nexo'){
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    if(settings.nexo?.activo===false)return res.status(503).json({ok:false,error:'NEXO está temporalmente desactivado.'});
    return res.status(200).json({ok:true,data:answerNexo(String(req.query?.q||''),settings.nexo?.preguntas,settings.nexo?.mensaje_no_encontrado)});
  }
  return res.status(200).json({ok:true,data:selectPublic(settings)});
 }catch(e){const status=[401,403].includes(e?.status)?e.status:503;return res.status(status).json({ok:false,error:status===503?'El contenido institucional aún no está configurado.':(e.message||'Acceso no autorizado.')});}
}
