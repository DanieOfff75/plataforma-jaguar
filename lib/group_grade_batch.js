import crypto from 'node:crypto';
// Institucional: entrega por grupo; ninguna nota pasa a oficial sin aceptar la materia.
const adminRoles=new Set(['control_escolar','control','direccion_escolar']);
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
const db=async(q)=>{const {data,error}=await q;if(error)throw error;return data;};
export async function createGroupGradeBatch(admin,user,profile,body){
  if(!adminRoles.has(profile.rol))throw bad('Sólo Control Escolar y Dirección pueden enviar cargas por grupo.',403);
  const grupo=Number(body.grupo_id),periodo=Number(body.periodo_id),materias=body.materias;
  if(!Number.isSafeInteger(grupo)||grupo<1||!Number.isSafeInteger(periodo)||periodo<1)throw bad('Grupo y periodo obligatorios.');
  if(!Array.isArray(materias)||!materias.length||materias.length>30)throw bad('Selecciona todas las materias del grupo.');
  const firma=await db(admin.from('perfiles').select('firma_path,firma_sha256').eq('id',user.id).maybeSingle());
  if(!firma?.firma_path||!firma?.firma_sha256)throw bad('Registra primero tu firma institucional en Perfil.',409);
  // La RPC vuelve a verificar cada fila y publica únicamente borradores.
  const operation=crypto.randomUUID();
  const row=await db(admin.rpc('jaguar_crear_carga_grupo',{
    p_actor:user.id,p_operacion:operation,p_grupo_id:grupo,p_periodo_id:periodo,p_materias:materias
  }));
  const revisions=await db(admin.from('jaguar_cargas_materias').select('id,docente_id,grupo_materia_id').eq('carga_id',row));
  const ids=[...new Set(revisions.map(x=>x.docente_id))];
  const teachers=ids.length?await db(admin.from('docentes').select('id,auth_user_id,nombre_completo').in('id',ids)):[];
  const map=new Map(teachers.map(t=>[String(t.id),t]));
  for(const r of revisions){
    const teacher=map.get(String(r.docente_id));if(!teacher?.auth_user_id)continue;
    // El lote persiste incluso si falla una notificación: la bandeja docente lo mostrará.
    try{await db(admin.from('notificaciones').insert({usuario_id:teacher.auth_user_id,titulo:'Oficio de revisión de calificaciones',contenido:`Control Escolar envió una carga para revisión y firma. Lote ${row}, materia ${r.grupo_materia_id}.`,tipo:'solicitud',leida:false}));}catch(e){console.warn('Notificación no enviada',e.message)}
  }
  return {carga_id:row,operacion_id:operation,materias_enviadas:revisions.length,estado:'pendiente_docentes'};
}
export async function listGroupGradeReviews(admin,user,profile){
  if(profile.rol!=='docente'&&!adminRoles.has(profile.rol))throw bad('No autorizado.',403);
  let q=admin.from('jaguar_cargas_materias').select('id,carga_id,grupo_materia_id,docente_id,estado,notas_originales,notas_finales,firmado_at,jaguar_cargas_grupo(id,grupo_id,periodo_id,actor_nombre,actor_rol,estado,creado_at),grupo_materias(id,materias(nombre),grupos(clave))').order('id',{ascending:false}).limit(300);
  if(profile.rol==='docente'){
    const t=await db(admin.from('docentes').select('id').eq('auth_user_id',user.id).maybeSingle());
    if(!t)return [];
    q=q.eq('docente_id',t.id);
  }
  return db(q);
}
export async function approveGroupGradeReview(admin,user,profile,body){
  if(profile.rol!=='docente')throw bad('Sólo el docente asignado puede aceptar su evaluación.',403);
  const id=Number(body.revision_id);
  if(!Number.isSafeInteger(id)||id<1||!Array.isArray(body.notas))throw bad('Revisión y notas obligatorias.');
  return db(admin.rpc('jaguar_aceptar_carga_materia',{p_actor:user.id,p_revision_id:id,p_notas:body.notas}));
}
