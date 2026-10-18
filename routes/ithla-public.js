import { createClient } from '@supabase/supabase-js';
import { answerNexo } from '../lib/nexo_advisor.js';
import { replyNexoAI } from '../lib/nexo_ai.js';
import { requireRoles } from '../lib/_admin.js';
import { assertSession } from '../lib/ithla_session.js';
import { nexoTrustedContext } from '../lib/nexo_context.js';
const defaults={institucion:{siglas:'ITHLA',nombre_institucion:'Instituto Tecnológico e Histórico Latinoamericano',lema:'Scientia, Humanitas et Progressum',color_primary:'#1B365D',color_accent:'#D4AF37',logo_url:'/assets/ithla-logo.png',url_admisiones:'https://registro-escolar-virid.vercel.app/'},portal:{titulo:'Instituto Tecnológico e Histórico Latinoamericano',subtitulo:'Ciencia, Humanidad y Progreso',avisos:[],eventos:[],enlaces:[]},admisiones:{estado:'cerrado'},nexo:{activo:true,preguntas:[]}};
function selectPublic(config){const i=config.institucion||{},p=config.portal||{},a=config.admisiones||{};return {
 institucion:Object.fromEntries(['siglas','nombre_institucion','lema','color_primary','color_secondary','color_accent','logo_url','url_admisiones','telefono','direccion','entidad'].map(k=>[k,i[k]??defaults.institucion[k]??null])),
 portal:Object.fromEntries(['titulo','subtitulo','avisos','eventos','enlaces'].map(k=>[k,p[k]??defaults.portal[k]])),
 admisiones:{estado:a.estado||'cerrado',fecha_inicio:a.fecha_inicio||null,fecha_fin:a.fecha_fin||null,mensaje:a.mensaje||''}
};}
export default async function handler(req,res){
 res.setHeader('Cache-Control', req.method==='POST'||String(req.query?.action||'')==='director-status'?'no-store':'public,max-age=30,s-maxage=60');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false,error:'Método no permitido.'});
 try{
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
    const {data,error}=await db.from('ithla_config').select('clave,valor').in('clave',['institucion','admisiones','nexo']);
    if(error)throw error;
    const settings={...defaults,...Object.fromEntries((data||[]).map(r=>[r.clave,r.valor]))};
    if(!(data||[]).some(r=>r.clave==='admisiones'))settings.admisiones={}; // No inferir convocatorias no publicadas.
    let role=null;
    const bearer=/^Bearer\s+(.+)$/i.exec(String(req.headers?.authorization||''));
    if(bearer){
      const {data:{user},error:authError}=await db.auth.getUser(bearer[1].trim());
      if(authError||!user)return res.status(401).json({ok:false,error:'La sesión caducó; vuelve a iniciar sesión.'});
      const {data:profile,error:profileError}=await db.from('perfiles').select('rol,activo').eq('id',user.id).maybeSingle();
      if(profileError||!profile?.activo)return res.status(403).json({ok:false,error:'Perfil institucional no disponible.'});
      try{await assertSession(req,db,user.id,profile.rol,'jaguar');}catch{return res.status(401).json({ok:false,error:'La sesión protegida expiró.'});}
      role=profile.rol;
    }
    const result=await replyNexoAI({message:req.body?.message,history:req.body?.history,settings,req,trustedContext:nexoTrustedContext('jaguar',role),
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
