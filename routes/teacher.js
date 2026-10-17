import { requireRoles } from '../lib/_admin.js';

function cleanInt(v, d=0){const n=Number(v); return Number.isFinite(n)?Math.trunc(n):d;}

export default async function handler(req,res){
 try{
  if(req.method==='GET'){
    const {user,profile,adminClient}=await requireRoles(req,['docente','servicios_docentes','coordinacion_academica','direccion_escolar','control_escolar','control']);
    if(profile.rol==='docente'){
      const {data:doc,error}=await adminClient.from('docentes').select('*').eq('auth_user_id',user.id).maybeSingle();
      if(error) throw error;
      if(!doc) return res.status(404).json({ok:false,error:'No existe un registro docente vinculado a tu cuenta.'});
      const {data:disp,error:de}=await adminClient.from('docente_disponibilidad').select('*').eq('docente_id',doc.id).order('dia_semana').order('hora_inicio');
      if(de) throw de;
      const {data:colores,error:ce}=await adminClient.from('docente_materia_colores').select('materia_id,color_hex').eq('docente_id',doc.id); if(ce) throw ce; return res.status(200).json({ok:true,data:{docente:doc,disponibilidad:disp||[],colores:colores||[]}});
    }
    const {data,error}=await adminClient.from('docentes').select('id,auth_user_id,clave_docente,nombre_completo,correo,numero_empleado,especialidad,horas_solicitadas,horas_asignadas,activo,suspension_fecha,suspension_hasta,suspension_motivo,suspension_observaciones,revision_acceso_estado,disponibilidad,observaciones').order('nombre_completo');
    if(error) throw error;
    return res.status(200).json({ok:true,data:data||[]});
  }
  const {user,profile,adminClient}=await requireRoles(req,['docente','servicios_docentes','coordinacion_academica','direccion_escolar','control_escolar','control']);
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Método no permitido.'});
  const b=req.body||{};
  if(profile.rol==='docente' && b.action==='subject_colors'){
    const {data:doc,error}=await adminClient.from('docentes').select('id').eq('auth_user_id',user.id).maybeSingle();
    if(error||!doc) return res.status(404).json({ok:false,error:'Docente no encontrado.'});
    const {data:period}=await adminClient.from('periodos_escolares').select('ciclo_escolar').eq('activo',true).order('id',{ascending:false}).limit(1).maybeSingle(); const cycle=period?.ciclo_escolar||'2026-2027'; const {data:assignments,error:ae}=await adminClient.from('asignaciones_docentes').select('grupo_materia_id,grupo_materias(materia_id)').eq('docente_id',doc.id).eq('activo',true).eq('ciclo_escolar',cycle);
    if(ae) throw ae;
    const allowed=new Set((assignments||[]).map(a=>String(a.grupo_materias?.materia_id)).filter(Boolean));
    const rows=Array.isArray(b.colores)?b.colores:[];
    for(const r of rows){const materiaId=Number(r.materia_id||0);const color=String(r.color_hex||'').toUpperCase();if(!materiaId||!allowed.has(String(materiaId))||!/^#[0-9A-F]{6}$/.test(color))continue;const {error}=await adminClient.from('docente_materia_colores').upsert({docente_id:doc.id,materia_id:materiaId,color_hex:color,updated_at:new Date().toISOString()},{onConflict:'docente_id,materia_id'});if(error)throw error;}
    return res.status(200).json({ok:true,message:'Colores de materias guardados.'});
  }

  if(profile.rol==='docente'){
    const {data:doc,error}=await adminClient.from('docentes').select('id').eq('auth_user_id',user.id).maybeSingle();
    if(error||!doc) return res.status(404).json({ok:false,error:'Docente no encontrado.'});
    const horas=cleanInt(b.horas_solicitadas);
    if(horas<0||horas>60) return res.status(400).json({ok:false,error:'Las horas solicitadas deben estar entre 0 y 60.'});
    const {error:ue}=await adminClient.from('docentes').update({horas_solicitadas:horas,disponibilidad:b.disponibilidad||{}}).eq('id',doc.id);
    if(ue) throw ue;
    if(Array.isArray(b.disponibilidad_detalle)){
      await adminClient.from('docente_disponibilidad').delete().eq('docente_id',doc.id);
      const rows=b.disponibilidad_detalle.filter(x=>x.disponible!==false).map(x=>({docente_id:doc.id,dia_semana:cleanInt(x.dia_semana),hora_inicio:x.hora_inicio,hora_fin:x.hora_fin,disponible:true}));
      if(rows.length){const {error:ie}=await adminClient.from('docente_disponibilidad').insert(rows);if(ie) throw ie;}
    }
    return res.status(200).json({ok:true,message:'Tu disponibilidad y horas solicitadas fueron guardadas.'});
  }
  if(!['servicios_docentes','coordinacion_academica','direccion_escolar','control_escolar','control'].includes(profile.rol)) return res.status(403).json({ok:false,error:'Permiso insuficiente.'});
  const id=cleanInt(b.docente_id); if(!id) return res.status(400).json({ok:false,error:'Docente no válido.'});
  const patch={};
  if(b.horas_solicitadas!==undefined) patch.horas_solicitadas=cleanInt(b.horas_solicitadas);
  if(b.horas_asignadas!==undefined) patch.horas_asignadas=cleanInt(b.horas_asignadas);
  if(b.observaciones!==undefined) patch.observaciones=b.observaciones||null;
  if(Object.keys(patch).length){const {error}=await adminClient.from('docentes').update(patch).eq('id',id);if(error)throw error;}
  return res.status(200).json({ok:true,message:'Configuración docente actualizada.'});
 }catch(e){return res.status(e.status||500).json({ok:false,error:e.message||'Error interno.'});}
}
