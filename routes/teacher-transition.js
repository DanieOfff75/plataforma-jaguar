/** Flujo de baja y relevo: solo API autenticada, operaciones atómicas en PostgreSQL. */
import {requireRoles} from '../lib/_admin.js';
import {buildHandoverRubricPdf} from '../lib/jaguar_relevo_rubrica_pdf.js';
import {googleConfig,googleAccess,googleRenameTeacher,googleInviteReplacement} from '../lib/google_classroom_oauth.js';
const MANAGERS=['servicios_docentes','coordinacion_academica','direccion_escolar'];
const ROLES=[...MANAGERS,'docente'];
const failure=(status,message)=>Object.assign(new Error(message),{status});
async function q(p){const {data,error}=await p;if(error)throw failure(error.code==='PGRST116'?404:500,error.message);return data;}
const id=n=>Number.isSafeInteger(Number(n))&&Number(n)>0?Number(n):0;
const cut=(v,n)=>String(v??'').trim().slice(0,n);
async function teacherOwn(db,user){return q(db.from('docentes').select('id,nombre_completo,activo').eq('auth_user_id',user.id).maybeSingle());}
export default async function handler(req,res){
 try{
  const {user,profile,adminClient:db}=await requireRoles(req,ROLES);
  res.setHeader('Cache-Control','private, no-store');
  const role=profile.rol,admin=MANAGERS.includes(role);
  // La vista PDF se sirve sólo tras verificar sesión, vacante, titular actual y materia activa.
  if(req.method==='GET'&&req.query?.mode==='rubrica_pdf'){
   if(role!=='docente')throw failure(403,'El PDF sólo está disponible para el docente sustituto');
   const teacher=await teacherOwn(db,user),vid=id(req.query?.vacante_id),rubricId=id(req.query?.rubrica_id);
   if(!teacher?.activo||!vid||!rubricId)throw failure(403,'Docente, vacante o rúbrica no autorizados');
   const v=await q(db.from('jaguar_vacantes_docentes').select('id,estado,docente_nuevo_id,docente_anterior_id,grupo_materia_id,ciclo_escolar').eq('id',vid).maybeSingle());
   if(!v||v.estado!=='cubierta'||Number(v.docente_nuevo_id)!==Number(teacher.id))throw failure(403,'Relevo ajeno o sin cubrir');
   const own=await q(db.from('asignaciones_docentes').select('id').eq('docente_id',teacher.id).eq('grupo_materia_id',v.grupo_materia_id).eq('ciclo_escolar',v.ciclo_escolar).eq('activo',true).limit(1));
   if(!own.length)throw failure(403,'No tienes la asignación vigente');
   const rubric=await q(db.from('rubricas_evaluacion').select('id,titulo,descripcion,estado,escala_maxima,periodo_id,docente_id,grupo_materia_id').eq('id',rubricId).maybeSingle());
   const rb=rubric;
   if(!rb||Number(rb.docente_id)!==Number(v.docente_anterior_id)||Number(rb.grupo_materia_id)!==Number(v.grupo_materia_id))throw failure(404,'La rúbrica no pertenece a ese relevo');
   const [components,original,gm,period]=await Promise.all([
    q(db.from('rubrica_componentes').select('nombre,ponderacion,maximo,orden').eq('rubrica_id',rubricId).order('orden')),
    q(db.from('docentes').select('nombre_completo').eq('id',v.docente_anterior_id).maybeSingle()),
    q(db.from('grupo_materias').select('grupos(clave),materias(nombre)').eq('id',v.grupo_materia_id).maybeSingle()),
    q(db.from('periodos_escolares').select('nombre,ciclo_escolar').eq('id',rubric.periodo_id).maybeSingle())
   ]);
   const pdf=await buildHandoverRubricPdf({rubric,components,sourceTeacher:original?.nombre_completo||'Docente anterior',group:gm?.grupos?.clave||'',subject:gm?.materias?.nombre||'',period:period?.nombre||''});
   res.setHeader('Content-Type','application/pdf');
   res.setHeader('Content-Disposition',`${req.query?.download==='1'?'attachment':'inline'}; filename="rubrica-relevo-${rubricId}.pdf"`);
   res.setHeader('X-Content-Type-Options','nosniff');
   return res.status(200).send(pdf);
  }
  if(req.method==='GET'&&req.query?.mode==='planeacion'){
   if(role!=='docente')throw failure(403,'Solo docentes sustitutos pueden descargar este documento');
   const teacher=await teacherOwn(db,user),planId=id(req.query?.planeacion_id);
   const plan=await q(db.from('planeaciones_docentes').select('id,docente_id,grupo_materia_id,estado,archivo_path,archivo_nombre').eq('id',planId).maybeSingle());
   if(!plan||plan.estado!=='revisada'||!plan.archivo_path)throw failure(404,'No hay archivo aprobado disponible');
   const v=await q(db.from('jaguar_vacantes_docentes').select('id,ciclo_escolar').eq('docente_anterior_id',plan.docente_id).eq('grupo_materia_id',plan.grupo_materia_id).eq('docente_nuevo_id',teacher?.id||-1).eq('estado','cubierta').limit(1));
   if(!v.length)throw failure(403,'No eres sustituto de este grupo/materia');
   const own=await q(db.from('asignaciones_docentes').select('id').eq('docente_id',teacher.id).eq('grupo_materia_id',plan.grupo_materia_id).eq('ciclo_escolar',v[0].ciclo_escolar).eq('activo',true).limit(1));
   if(!own.length)throw failure(403,'No tienes una asignación activa para esta materia');
   if(!String(plan.archivo_path).startsWith(`docente/${Number(plan.docente_id)}/`))throw failure(409,'La ruta de este documento no se puede verificar');
   const {data,error}=await db.storage.from('archivo-escolar').createSignedUrl(plan.archivo_path,90);
   if(error||!data?.signedUrl)throw failure(502,'No se pudo crear el enlace seguro');
   return res.status(200).json({ok:true,data:{url:data.signedUrl,expires_in:90,nombre:plan.archivo_nombre||'Planeación institucional'}});
  }
  if(req.method==='GET'&&req.query?.mode==='bitacora'){
   if(role!=='docente')throw failure(403,'Solo el docente sustituto puede consultar las bitácoras históricas');
   const teacher=await teacherOwn(db,user),vid=id(req.query?.vacante_id);
   const v=await q(db.from('jaguar_vacantes_docentes').select('id,estado,docente_nuevo_id,docente_anterior_id,grupo_materia_id,ciclo_escolar').eq('id',vid).maybeSingle());
   if(!v||v.estado!=='cubierta'||Number(v.docente_nuevo_id)!==Number(teacher?.id))throw failure(403,'Relevo no autorizado para tu sesión');
   const active=await q(db.from('asignaciones_docentes').select('id').eq('docente_id',teacher.id).eq('grupo_materia_id',v.grupo_materia_id).eq('ciclo_escolar',v.ciclo_escolar).eq('activo',true).limit(1));
   if(!active.length)throw failure(403,'No tienes esta materia asignada actualmente');
   const adoptions=await q(db.from('jaguar_relevo_adopciones_actividades').select('bitacora_origen_id,bitacora_destino_id,registrado_at').eq('vacante_id',vid).limit(200));
   const booklets=await q(db.from('bitacora_excel_diaria').select('id,periodo_id,fecha_clase,version,estado,snapshot,created_at').eq('docente_id',v.docente_anterior_id).eq('grupo_materia_id',v.grupo_materia_id).order('created_at',{ascending:false}).limit(25));
   const gm=await q(db.from('grupo_materias').select('grupo_id').eq('id',v.grupo_materia_id).single());
   const students=await q(db.from('alumnos').select('id,nombre_completo,matricula').eq('grupo_id',gm.grupo_id).limit(300));
   return res.status(200).json({ok:true,data:{booklets,students,adoptions,archival:true}});
  }
  if(req.method==='GET'&&req.query?.mode==='historial'){
   if(role!=='docente')throw failure(403,'Solo el docente sustituto puede revisar el historial de calificaciones de su grupo');
   const teacher=await teacherOwn(db,user),vid=id(req.query?.vacante_id);
   const v=await q(db.from('jaguar_vacantes_docentes').select('id,estado,docente_nuevo_id,docente_anterior_id,grupo_materia_id,ciclo_escolar').eq('id',vid).maybeSingle());
   if(!v||v.estado!=='cubierta'||Number(v.docente_nuevo_id)!==Number(teacher?.id))throw failure(403,'Este relevo no pertenece a tu sesión');
   const active=await q(db.from('asignaciones_docentes').select('id').eq('docente_id',teacher.id).eq('grupo_materia_id',v.grupo_materia_id).eq('ciclo_escolar',v.ciclo_escolar).eq('activo',true).limit(1));
   if(!active?.length)throw failure(403,'Ya no tienes asignado el grupo');
   const rubrics=await q(db.from('rubricas_evaluacion').select('id,titulo,periodo_id,estado').eq('docente_id',v.docente_anterior_id).eq('grupo_materia_id',v.grupo_materia_id).limit(30));
   const rubricIds=rubrics.map(x=>x.id);
   const components=rubricIds.length?await q(db.from('rubrica_componentes').select('id,rubrica_id,nombre,ponderacion,maximo,orden').in('rubrica_id',rubricIds).limit(500)):[];
   const notes=rubricIds.length?await q(db.from('evaluacion_notas').select('rubrica_id,componente_id,alumno_id,valor').in('rubrica_id',rubricIds).limit(5000)):[];
   const gm=await q(db.from('grupo_materias').select('grupo_id').eq('id',v.grupo_materia_id).single());
   const students=await q(db.from('alumnos').select('id,nombre_completo').eq('grupo_id',gm.grupo_id).limit(300));
   return res.status(200).json({ok:true,data:{rubrics,components,notes,students,archival:true}});
  }
  if(req.method==='GET'){
   const self=role==='docente'?await teacherOwn(db,user):null;
   let bajas=await q(db.from('jaguar_bajas_docentes').select('*').order('id',{ascending:false}).limit(250));
   let vacantes=await q(db.from('jaguar_vacantes_docentes').select('*').order('id',{ascending:false}).limit(500));
   let resources=[];const ids=vacantes.map(v=>v.id);
   if(ids.length)resources=await q(db.from('jaguar_relevo_recursos').select('id,vacante_id,tipo,titulo,descripcion,referencia,autorizado_at').in('vacante_id',ids).limit(1500));
   if(!admin){
    bajas=bajas.filter(x=>Number(x.docente_id)===Number(self?.id));
    vacantes=vacantes.filter(x=>Number(x.docente_nuevo_id)===Number(self?.id));
    const allowed=new Set(vacantes.map(x=>x.id));resources=resources.filter(x=>allowed.has(x.vacante_id));
   }
   const output={bajas,vacantes,resources,actor_role:role};
   if(admin){
    const [teachers,assignments,subjects,gm]=await Promise.all([
      q(db.from('docentes').select('id,nombre_completo,especialidad,horas_solicitadas,horas_asignadas,activo').limit(2000)),
      q(db.from('asignaciones_docentes').select('id,docente_id,grupo_materia_id,ciclo_escolar,activo,horas_asignadas').eq('activo',true).limit(5000)),
      q(db.from('materias').select('id,nombre,horas_semana').limit(600)),
      q(db.from('grupo_materias').select('id,grupo_id,materia_id,horas_semana,grupos(clave),materias(nombre,horas_semana)').limit(4000))
    ]);
    output.teachers=teachers;output.assignments=assignments;output.subjects=subjects;output.groupSubjects=gm;
   }else if(vacantes.length){
    const originalIds=[...new Set(vacantes.map(x=>x.docente_anterior_id))];
    const groupIds=[...new Set(vacantes.map(x=>x.grupo_materia_id))];
    const [plans,rubrics]=await Promise.all([
      q(db.from('planeaciones_docentes').select('id,docente_id,grupo_materia_id,titulo,estado,fecha_planeada').in('docente_id',originalIds).in('grupo_materia_id',groupIds).eq('estado','revisada').limit(300)),
      q(db.from('rubricas_evaluacion').select('id,docente_id,grupo_materia_id,periodo_id,titulo,estado,version').in('docente_id',originalIds).in('grupo_materia_id',groupIds).limit(300))
    ]);
    const valid=(x)=>vacantes.some(v=>Number(v.docente_anterior_id)===Number(x.docente_id)&&Number(v.grupo_materia_id)===Number(x.grupo_materia_id));
    output.planes=plans.filter(valid);output.rubrics=rubrics.filter(valid);
   }
   return res.status(200).json({ok:true,data:output});
  }
  if(req.method!=='POST')throw failure(405,'Método no permitido');
  const body=req.body||{},action=cut(body.action,40);
  if(action==='reintentar_bloqueo'){
    if(!['direccion_escolar','servicios_docentes'].includes(role))throw failure(403,'Operación reservada');
    const target=await q(db.from('docentes').select('id,auth_user_id,activo,estado_profesional').eq('id',id(body.docente_id)).single());
    if(target.activo!==false||target.estado_profesional!=='archivado')throw failure(409,'Este docente todavía no está archivado');
    if(!target.auth_user_id)return res.status(200).json({ok:true,message:'No tiene cuenta Auth asociada.'});
    const {error}=await db.auth.admin.updateUserById(target.auth_user_id,{ban_duration:'876000h'});
    if(error)throw failure(502,'No se completó el bloqueo de Auth: '+error.message);
    return res.status(200).json({ok:true,message:'Cuenta de acceso bloqueada. El expediente histórico permanece archivado.'});
  }
  if(action==='classroom_actualizar'||action==='classroom_invitar'){
   if(role!=='servicios_docentes')throw failure(403,'Sólo Servicios Docentes administra la continuidad de Classroom');
   if(body.confirmado!==true)throw failure(400,'La acción requiere confirmación expresa');
   const vid=id(body.vacante_id);const v=await q(db.from('jaguar_vacantes_docentes').select('id,estado,docente_nuevo_id,docente_anterior_id,grupo_materia_id,ciclo_escolar').eq('id',vid).maybeSingle());
   if(!v||v.estado!=='cubierta'||!v.docente_nuevo_id)throw failure(409,'Primero debe estar cubierta formalmente la vacante');
   const assignment=await q(db.from('asignaciones_docentes').select('id').eq('docente_id',v.docente_nuevo_id).eq('grupo_materia_id',v.grupo_materia_id).eq('ciclo_escolar',v.ciclo_escolar).eq('activo',true).limit(1));
   if(!assignment.length)throw failure(409,'El docente B ya no tiene asignación activa en ese grupo');
   const course=await q(db.from('jaguar_classroom_clases').select('id,google_course_id,docente_id').eq('grupo_materia_id',v.grupo_materia_id).eq('ciclo_escolar',v.ciclo_escolar).maybeSingle());
   if(!course?.google_course_id)throw failure(409,'Este grupo no tiene una clase de Google Classroom vinculada');
   const teacher=await q(db.from('docentes').select('id,nombre_completo,correo,activo').eq('id',v.docente_nuevo_id).maybeSingle());
   if(!teacher?.activo)throw failure(409,'Docente sustituto inactivo');
   const cfg=googleConfig();const token=await googleAccess(db,cfg);
   if(action==='classroom_invitar'){
    if(!teacher.correo)throw failure(409,'El docente B necesita un correo de Google registrado para recibir la invitación');
    const invitation=await googleInviteReplacement(token,course.google_course_id,teacher.correo);
    return res.status(200).json({ok:true,data:{invitacion_id:invitation.id||null},message:'Invitación enviada. El docente debe aceptarla en Google Classroom.'});
   }
   const newName=`${String(teacher.nombre_completo||'').trim()}`;
   await googleRenameTeacher(token,course.google_course_id,`PROF. ${newName}`);
   const {error:ue}=await db.from('jaguar_classroom_clases').update({docente_id:teacher.id,actualizado_por:user.id,actualizado_at:new Date().toISOString()}).eq('id',course.id);
   if(ue)throw failure(409,'Google se actualizó pero Jaguar no pudo guardar el vínculo. Revisa la clase antes de reintentar.');
   return res.status(200).json({ok:true,data:{google_course_id:course.google_course_id,docente_id:teacher.id},message:'Clase existente actualizada. No se han cambiado alumnos ni propietario.'});
  }
  if(action==='adoptar_actividades'){
   if(role!=='docente')throw failure(403,'Sólo el sustituto puede adoptar actividades');
   const vacante=id(body.vacante_id),bitacora=id(body.bitacora_id);
   if(!vacante||!bitacora)throw failure(400,'Selecciona una vacante y bitácora válidas');
   // La RPC es atómica, valida la asignación con auth user y conserva la bitácora original.
   const data=await q(db.rpc('jaguar_relevo_adoptar_actividades',{
     p_vacante_id:vacante,p_bitacora_id:bitacora,p_actor:user.id
   }));
   return res.status(200).json({ok:true,data,message:'Actividades adoptadas sin modificar la bitácora original.'});
  }
  if(action==='adoptar_rubrica'){
   if(role!=='docente')throw failure(403,'Solo el docente sustituto puede adoptar una rúbrica');
   if(!id(body.vacante_id)||!id(body.periodo_id))throw failure(400,'Vacante y periodo son obligatorios');
   const data=await q(db.rpc('jaguar_relevo_adoptar_rubrica',{p_vacante_id:id(body.vacante_id),p_periodo_id:id(body.periodo_id),p_actor:user.id}));
   return res.status(200).json({ok:true,data});
  }
  const allowed=['solicitar','notificar','enterado','autorizar','ejecutar','cancelar','cubrir','recurso'];
  if(!allowed.includes(action))throw failure(400,'Acción desconocida');
  if(!admin&&action!=='enterado')throw failure(403,'Acción reservada al personal autorizado');
  const detail={motivo:cut(body.motivo,1200),fecha_efectiva:cut(body.fecha_efectiva,10),
    motivo_sin_firma:cut(body.motivo_sin_firma,1200),tipo:cut(body.tipo,60),titulo:cut(body.titulo,160),
    descripcion:cut(body.descripcion,4000),referencia:cut(body.referencia,300)};
  if(action==='solicitar'&&detail.motivo.length<20)throw failure(400,'Justifica la baja en al menos 20 caracteres');
  const data=await q(db.rpc('jaguar_gestion_baja',{p_accion:action,p_id:id(body.id)||null,p_docente_id:id(body.docente_id)||null,p_actor:user.id,p_detalle:detail}));
  let warning=null;
  if(action==='ejecutar'){
   const old=await q(db.from('jaguar_bajas_docentes').select('docente_id').eq('id',id(body.id)).single());
   const teacher=await q(db.from('docentes').select('auth_user_id').eq('id',old.docente_id).single());
   if(teacher.auth_user_id){
    const {error}=await db.auth.admin.updateUserById(teacher.auth_user_id,{ban_duration:'876000h'});
    if(error)warning='El acceso está bloqueado por perfil inactivo, pero requiere completar el bloqueo de Auth: '+error.message;
   }
  }
  return res.status(200).json({ok:true,data,message:warning?'Operación registrada con observación de acceso.':'Operación registrada correctamente.',warning});
 }catch(e){return res.status(e.status||500).json({ok:false,error:e.message||'Error de gestión docente'});}
}
