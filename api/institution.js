import { requireRoles } from '../lib/_admin.js';
import { getDepartmentByKey } from './responsables.js';

const DEFAULTS={
  id:1,
  nombre_institucion:'Instituto Tecnológico e Histórico Latinoamericano',
  siglas:'ITHLA',
  cct:'15USU0128X',
  tipo:'Privada',
  clave_rvoe:'RVOE SEP-2024-0482',
  zona_escolar:'012',
  sector:'03',
  turnos:'Matutino y Vespertino',
  entidad:'Estado de México',
  direccion:'Av. Universidad Tecnológica No. 405, Col. Valle Verde, CP 50100',
  telefono:'5589001234',
  lema:'Scientia, Humanitas et Progressum',
  lema_traduccion:'Ciencia, Humanidad y Progreso',
  dominio_institucional:'ithla.edu.mx',
  mascota:'Jaguar',
  color_primary:'#1B365D',
  color_secondary:'#008080',
  color_accent:'#D4AF37',
  color_bg:'#F4F6F9',
  color_text:'#2C3E50'
};

export async function getInstitution(admin){
  const {data,error}=await admin.from('institucion_config').select('*').eq('id',1).maybeSingle();
  if(error && !/does not exist|schema cache/i.test(error.message||'')) throw error;
  return {...DEFAULTS,...(data||{})};
}

function clean(v,max=300){return String(v??'').trim().slice(0,max);}

async function ensureSignatureBucket(admin){
  const {data,error}=await admin.storage.getBucket('firmas-institucionales');
  if(error && /not found|does not exist|not exist/i.test(error.message||'')){
    const {error:e}=await admin.storage.createBucket('firmas-institucionales',{public:false,fileSizeLimit:1048576,allowedMimeTypes:['image/png','image/jpeg','image/webp']});
    if(e && !/already exists/i.test(e.message||'')) throw e;
  }else if(error) throw error;
}

export default async function handler(req,res){
  try{
    const {user,profile,adminClient}=await requireRoles(req,[
      'direccion_escolar','control_escolar','control','servicios_docentes','servicios_estudiantiles','prefectura','coordinacion_academica','archivo_escolar','recursos_monetarios','docente','alumno'
    ]);
    if(req.method==='GET') return res.status(200).json({ok:true,data:await getInstitution(adminClient)});
    if(req.method!=='POST') return res.status(405).json({ok:false,error:'Método no permitido.'});
    const b=req.body||{};
    if(b.action==='prepareResponsibleSignatureUpload'){
      if(profile.rol!=='direccion_escolar') return res.status(403).json({ok:false,error:'Solo Dirección Escolar puede registrar la firma de un encargado.'});
      const key=clean(b.departamento_clave,10).toUpperCase();
      const dep=await adminClient.from('departamentos').select('id').eq('clave',key).maybeSingle();
      if(dep.error)throw dep.error;if(!dep.data)return res.status(404).json({ok:false,error:'Departamento no encontrado.'});
      await ensureSignatureBucket(adminClient);
      const path=`${user.id}/responsables/${key}-${Date.now()}.png`;
      const {data,error}=await adminClient.storage.from('firmas-institucionales').createSignedUploadUrl(path);if(error)throw error;
      return res.status(200).json({ok:true,data:{bucket:'firmas-institucionales',path,token:data.token}});
    }
    if(b.action==='saveResponsibleSignature'){
      if(profile.rol!=='direccion_escolar') return res.status(403).json({ok:false,error:'Solo Dirección Escolar puede registrar la firma de un encargado.'});
      const key=clean(b.departamento_clave,10).toUpperCase(); const path=clean(b.path,500); const clientSha=clean(b.sha256,64).toLowerCase();
      const dep=await getDepartmentByKey(adminClient,key); if(!dep)return res.status(404).json({ok:false,error:'Departamento no encontrado.'});
      if(!path.startsWith(`${user.id}/responsables/${key}-`)||!/\.(png|jpg|jpeg|webp)$/i.test(path))return res.status(400).json({ok:false,error:'Ruta de firma no válida.'});
      const {data:stored,error:de}=await adminClient.storage.from('firmas-institucionales').download(path);if(de||!stored)return res.status(409).json({ok:false,error:'La firma no pudo verificarse en el almacenamiento privado.'});
      const cryptoMod=await import('node:crypto'); const serverSha=cryptoMod.createHash('sha256').update(Buffer.from(await stored.arrayBuffer())).digest('hex');
      if(clientSha&&clientSha!==serverSha)return res.status(409).json({ok:false,error:'La firma cargada no coincide con la firma enviada.'});
      const {data:row,error:re}=await adminClient.from('responsables_departamento').select('id').eq('departamento_id',dep.id).eq('activo',true).maybeSingle();if(re){if(/responsables_departamento|schema cache|does not exist/i.test(re.message||''))return res.status(409).json({ok:false,error:'Falta la tabla responsables_departamento. Ejecuta el script sql/ITHLA_DB_COMPLETO_2026_2027.sql en Supabase.'});throw re;}if(!row)return res.status(409).json({ok:false,error:'Primero registra al encargado del departamento.'});
      const {error:ue}=await adminClient.from('responsables_departamento').update({firma_path:path,firma_sha256:serverSha,firma_subida_at:new Date().toISOString()}).eq('id',row.id);if(ue)throw ue;
      return res.status(200).json({ok:true,message:'Firma del encargado guardada de forma privada.'});
    }
    if(profile.rol!=='direccion_escolar') return res.status(403).json({ok:false,error:'Solo Dirección Escolar puede modificar los datos de la institución.'});
    const data={
      nombre_institucion:clean(b.nombre_institucion,180), siglas:clean(b.siglas,30).toUpperCase(), cct:clean(b.cct,30).toUpperCase(),
      tipo:clean(b.tipo,60), clave_rvoe:clean(b.clave_rvoe,80), zona_escolar:clean(b.zona_escolar,30), sector:clean(b.sector,30),
      turnos:clean(b.turnos,80), entidad:clean(b.entidad,100), direccion:clean(b.direccion,240), telefono:clean(b.telefono,30),
      lema:clean(b.lema,180), lema_traduccion:clean(b.lema_traduccion,180), dominio_institucional:clean(b.dominio_institucional,120).toLowerCase(),
      mascota:clean(b.mascota,60), color_primary:clean(b.color_primary,7), color_secondary:clean(b.color_secondary,7),
      color_accent:clean(b.color_accent,7), color_bg:clean(b.color_bg,7), color_text:clean(b.color_text,7),
      updated_at:new Date().toISOString(), updated_by:user.id
    };
    if(!/^#[0-9a-fA-F]{6}$/.test(data.color_primary)||!/^#[0-9a-fA-F]{6}$/.test(data.color_secondary)||!/^#[0-9a-fA-F]{6}$/.test(data.color_accent)||!/^#[0-9a-fA-F]{6}$/.test(data.color_bg)||!/^#[0-9a-fA-F]{6}$/.test(data.color_text)){
      return res.status(400).json({ok:false,error:'Todos los colores deben estar en formato hexadecimal #RRGGBB.'});
    }
    if(!data.nombre_institucion||!data.siglas||!data.cct||!data.dominio_institucional)return res.status(400).json({ok:false,error:'Nombre, siglas, CCT y dominio institucional son obligatorios.'});
    const {data:saved,error}=await adminClient.from('institucion_config').upsert({id:1,...data},{onConflict:'id'}).select('*').single();
    if(error) throw error;
    return res.status(200).json({ok:true,data:saved,message:'Datos de la institución actualizados.'});
  }catch(e){return res.status(e.status||500).json({ok:false,error:e.message||'No se pudieron guardar los datos institucionales.'});}
}
