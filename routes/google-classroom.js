/** Sincronización supervisada y creación individual confirmada de clases PROVISIONED en Google. */
import {requireRoles} from '../lib/_admin.js';
import {googleConfig,googleAccess,googleCourses,googleCreateCourse,projectCourse,readConnection,googleTopics,googleMakeTopic,googleWork,googleSubmissions,googleStudents} from '../lib/google_classroom_oauth.js';
import {classCode,classroomLink} from '../lib/classroom_rules.js';
import {classroomCoursePayload,normalizedClassroomName} from '../lib/classroom_naming.js';
import {topicForPeriod,matchingTopic,gradeEntries} from '../lib/classroom_periods.js';
import {gradeSelection,gradeReport,gradeProof,verifyProof} from '../lib/classroom_grades.js';
import {normalizeWorkTypes,classifiedWork} from '../lib/classroom_classification.js';
const fail=(msg,status=400)=>{throw Object.assign(new Error(msg),{status});};
const success=(res,data)=>res.status(200).json({ok:true,data});
const numberId=(v)=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<1)fail('Identificador de asignación inválido.');return n;};
async function q(p){const {data,error}=await p;if(error){if(/jaguar_classroom_alumnos|jaguar_classroom_importaciones|jaguar_classroom_importar_rubrica|jaguar_classroom_trabajos_tipo/i.test(error.message||''))fail('Falta ejecutar la migración SQL V5.7.4 o V5.7.5 de Classroom en Supabase.',409);fail('No fue posible consultar o guardar datos de Classroom. Revisa los registros del servidor.',409);}return data;}
async function activeCycle(db){
 let rows=await q(db.from('periodos_escolares').select('ciclo_escolar').eq('es_periodo_actual',true).order('id',{ascending:false}).limit(1));
 if(!rows?.length)rows=await q(db.from('periodos_escolares').select('ciclo_escolar').eq('activo',true).order('id',{ascending:false}).limit(1));
 if(!rows?.[0]?.ciclo_escolar)fail('Configura el ciclo escolar activo.',409);return rows[0].ciclo_escolar;
}
async function googleData(db){const cfg=googleConfig(),token=await googleAccess(db,cfg);return {cfg,classes:(await googleCourses(token)).map(projectCourse)};}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 try{
  const {user,profile,adminClient:db}=await requireRoles(req,['servicios_docentes','docente']);
  const manager=profile.rol==='servicios_docentes';
  const action=String((req.method==='GET'?req.query?.action:req.body?.action)||'');
  if(req.method==='GET'&&action==='list'){if(!manager)fail('Acceso sólo de Servicios Docentes.',403);
   const {classes}=await googleData(db),cycle=await activeCycle(db);
   const linked=await q(db.from('jaguar_classroom_clases').select('grupo_materia_id,google_course_id').eq('ciclo_escolar',cycle));
   return success(res,{classes:classes.map(c=>({...c,grupo_materia_id:linked.find(x=>x.google_course_id===c.id)?.grupo_materia_id||null})),cycle});
  }
  if(req.method==='POST'&&action==='create'){if(!manager)fail('Sólo Servicios Docentes puede crear clases.',403);
   const cfg=googleConfig();
   if(String(req.headers.origin||'')!==cfg.origin)fail('Crea clases sólo desde Jaguar en su dominio autorizado.',403);
   if(req.body?.confirmado!==true)fail('Confirma la vista previa antes de crear la clase.');
   const gmId=numberId(req.body?.grupo_materia_id),teacherId=numberId(req.body?.docente_id);
   const treatment=String(req.body?.tratamiento||'');
   const cycle=await activeCycle(db);
   const gm=await q(db.from('grupo_materias').select('id,grupo_id,grupos(id,clave,activo),materias(id,nombre)').eq('id',gmId).maybeSingle());
   if(!gm||gm.grupos?.activo===false||!gm.materias?.nombre)fail('La materia y grupo no están disponibles.',409);
   const assigned=await q(db.from('asignaciones_docentes').select('docente_id').eq('ciclo_escolar',cycle).eq('grupo_materia_id',gmId).eq('activo',true).eq('docente_id',teacherId).maybeSingle());
   if(!assigned)fail('El docente seleccionado no está asignado a esta materia y grupo en el ciclo actual.',409);
   const teacher=await q(db.from('docentes').select('id,nombre_completo,activo').eq('id',teacherId).maybeSingle());
   if(!teacher||teacher.activo===false)fail('El docente no está disponible.',409);
   const payload=classroomCoursePayload(gm.grupos,gm.materias.nombre,teacher.nombre_completo,treatment);
   if(String(req.body?.nombre_confirmado||'')!==payload.name||String(req.body?.docente_confirmado||'')!==payload.section)
    fail('Los datos de la vista previa cambiaron. Actualízala antes de confirmar.',409);
   const existing=await q(db.from('jaguar_classroom_clases').select('id,google_course_id').eq('ciclo_escolar',cycle).eq('grupo_materia_id',gmId).maybeSingle());
   if(existing?.google_course_id)fail('Esta materia ya tiene un Google Classroom vinculado. No se creará otro.',409);
   const connection=await readConnection(db);
   if(!String(connection?.permisos||'').split(/\s+/).includes('https://www.googleapis.com/auth/classroom.courses'))
    fail('Tu conexión actual es de solo lectura. Desconecta y vuelve a conectar Google para autorizar la creación de clases.',409);
   const {classes}=await googleData(db);
   const duplicate=classes.find(c=>normalizedClassroomName(c.nombre)===normalizedClassroomName(payload.name)&&!['ARCHIVED','DECLINED','SUSPENDED'].includes(c.estado));
   if(duplicate)fail(`Ya existe una clase con ese nombre en Google (${duplicate.estado}). Vincúlala desde la lista en vez de duplicarla.`,409);
   const token=await googleAccess(db,cfg);
   const created=await googleCreateCourse(token,payload);
   const code=created.enrollmentCode?classCode(created.enrollmentCode):null;
   const link=created.alternateLink?classroomLink(created.alternateLink):null;
   const patch={nombre:payload.name,descripcion:payload.description,codigo_union:code,enlace_clase:link,google_course_id:String(created.id),estado:created.courseState==='ACTIVE'&&code&&link?'registrada':'pendiente',origen:'google',docente_id:teacherId,actualizado_por:user.id,actualizado_at:new Date().toISOString()};
   // El registro sólo se guarda después de que Google confirme que existe. Si fallase Supabase,
   // la clase NO debe volver a crearse: en una nueva consulta se podrá vincular manualmente.
   let saved;
   try{
    saved=existing
     ?await q(db.from('jaguar_classroom_clases').update(patch).eq('id',existing.id).select('*').single())
     :await q(db.from('jaguar_classroom_clases').insert({...patch,ciclo_escolar:cycle,grupo_materia_id:gmId,creado_por:user.id}).select('*').single());
   }catch(e){fail(`Google creó la clase con ID ${created.id}, pero Jaguar no pudo vincularla. Consulta Classroom y vincúlala manualmente; NO vuelvas a crearla.`,409);}
   return success(res,{saved,google_state:String(created.courseState||'PROVISIONED'),nombre:payload.name,docente:payload.section});
  }

  if(req.method==='GET'&&action==='periods'){
   const cycle=await activeCycle(db);
   const periods=await q(db.from('periodos_escolares').select('id,nombre,numero_periodo,activo,es_periodo_actual,fecha_fin,ciclo_escolar').eq('ciclo_escolar',cycle).order('numero_periodo'));
   return success(res,{cycle,periods:periods.map(p=>({...p,topic_name:topicForPeriod(p)}))});
  }
  if(req.method==='POST'&&action==='ensure_topics'){
   if(!manager)fail('Sólo Servicios Docentes crea los temas institucionales.',403);
   if(String(req.headers.origin||'')!==googleConfig().origin)fail('Solicitud fuera del dominio de Jaguar.',403);
   if(req.body?.confirmado!==true)fail('Confirma la preparación de los periodos.',400);
   const gmId=numberId(req.body.grupo_materia_id),cycle=await activeCycle(db);
   const linked=await q(db.from('jaguar_classroom_clases').select('google_course_id').eq('ciclo_escolar',cycle).eq('grupo_materia_id',gmId).maybeSingle());
   if(!linked?.google_course_id)fail('Primero vincula la clase de Google con su materia.',409);
   const access=await readConnection(db);
   if(!String(access?.permisos||'').split(/\s+/).includes('https://www.googleapis.com/auth/classroom.topics'))fail('Falta autorizar el permiso Classroom Topics. Desconecta y vuelve a conectar Google.',409);
   const all=(await q(db.from('periodos_escolares').select('id,nombre,numero_periodo,ciclo_escolar').eq('ciclo_escolar',cycle).order('numero_periodo')));
   if(!all.length||all.length>10)fail('Configura de 1 a 10 periodos escolares antes de crear los temas.',409);
   const cfg=googleConfig(),token=await googleAccess(db,cfg);const before=await googleTopics(token,linked.google_course_id);
   const created=[],existing=[];let known=[...before];
   for(const period of all){const title=topicForPeriod(period),current=matchingTopic(known,period);
    if(current){existing.push(title);continue;}
    try{const newTopic=await googleMakeTopic(token,linked.google_course_id,title);known.push(newTopic);created.push(title);}
    catch(e){fail(`Se crearon ${created.length} temas y se detuvo en «${title}»: ${e.message}. Reintentar es seguro: los temas existentes se omiten.`,e.status||502);}
   }
   return success(res,{created,existing,total:created.length+existing.length});
  }
  // El correo del propietario es institucional, pero no otorga a otros usuarios derechos en Google.
  // Las consultas académicas sí son visibles al docente autenticado cuando tiene asignación vigente.
  if(['grades','roster','map_student','save_work_types','grade_preview','grade_commit'].includes(action)){
   const gmId=numberId(req.method==='GET'?req.query?.grupo_materia_id:req.body?.grupo_materia_id);
   const cycle=await activeCycle(db);
   const gm=await q(db.from('grupo_materias').select('id,grupo_id,grupos(id,clave),materias(id,nombre)').eq('id',gmId).maybeSingle());
   if(!gm)fail('Grupo y materia no encontrados.',404);
   let teacherId=null;
   if(!manager){const teacher=await q(db.from('docentes').select('id').eq('auth_user_id',user.id).maybeSingle());
    if(!teacher)fail('Cuenta docente sin registro institucional.',403);
    const assignment=await q(db.from('asignaciones_docentes').select('docente_id').eq('grupo_materia_id',gmId).eq('docente_id',teacher.id).eq('activo',true).eq('ciclo_escolar',cycle).maybeSingle());
    if(!assignment)fail('Esta materia no está asignada a tu cuenta.',403);teacherId=Number(teacher.id);
   }
   const linked=await q(db.from('jaguar_classroom_clases').select('google_course_id').eq('grupo_materia_id',gmId).eq('ciclo_escolar',cycle).maybeSingle());
   if(!linked?.google_course_id)fail('Esta materia aún no tiene Google Classroom vinculado.',409);
   const course=linked.google_course_id;
   const cfg=googleConfig(),connection=await readConnection(db);
   const scopes=String(connection?.permisos||'').split(/\s+/);
   const needed=['https://www.googleapis.com/auth/classroom.coursework.students.readonly','https://www.googleapis.com/auth/classroom.rosters.readonly'];
   if(needed.some(s=>!scopes.includes(s)))fail('Reconecta Google para autorizar consulta de actividades y alumnos de Classroom.',409);
   const token=await googleAccess(db,cfg);
   const students=await googleStudents(token,course);
   if(students.length>250)fail('El curso supera el límite de 250 alumnos para importar notas.',409);
   const roster=await q(db.from('alumnos').select('id,matricula,nombre_completo,grupo_id').eq('grupo_id',gm.grupo_id).eq('activo',true).limit(251));
   if(roster.length>250)fail('El grupo supera el límite seguro de 250 alumnos.',409);
   const links=await q(db.from('jaguar_classroom_alumnos').select('google_user_id,alumno_id').eq('google_course_id',course).limit(251));
   if(req.method==='GET'&&action==='roster')return success(res,{students:students.map(s=>({google_user_id:String(s.userId),name:s.profile?.name?.fullName||'',email:s.profile?.emailAddress||'',alumno_id:links.find(l=>String(l.google_user_id)===String(s.userId))?.alumno_id||null})),alumnos:roster,gm});
   if(req.method==='POST'&&action==='map_student'){
    if(!manager)fail('Sólo Servicios Docentes vincula las matrículas.',403);
    if(String(req.headers.origin||'')!==cfg.origin)fail('Origen no autorizado.',403);
    const googleId=String(req.body.google_user_id||'');if(!students.some(s=>String(s.userId)===googleId))fail('El alumno Google no pertenece al curso.',403);
    const studentId=numberId(req.body.alumno_id);
    if(!roster.some(s=>Number(s.id)===studentId))fail('La matrícula no pertenece a este grupo.',403);
    const col=links.find(l=>Number(l.alumno_id)===studentId&&String(l.google_user_id)!==googleId);
    if(col)fail('La matrícula ya está vinculada a otra cuenta de Google en este curso.',409);
    const result=await q(db.from('jaguar_classroom_alumnos').upsert({google_course_id:course,google_user_id:googleId,alumno_id:studentId,ciclo_escolar:cycle,actualizado_por:user.id,actualizado_at:new Date().toISOString()},{onConflict:'google_course_id,google_user_id'}).select('id').single());
    return success(res,{linked:true});
   }
   const pid=numberId(req.method==='GET'?req.query?.periodo_id:req.body?.periodo_id);
   const period=await q(db.from('periodos_escolares').select('id,nombre,numero_periodo,ciclo_escolar,activo,es_periodo_actual,fecha_fin').eq('id',pid).maybeSingle());
   if(!period||period.ciclo_escolar!==cycle)fail('El periodo no pertenece al ciclo actual.',409);
   const topic_name=topicForPeriod(period);
   const [topics,coursework,submissions]=await Promise.all([googleTopics(token,course),googleWork(token,course),googleSubmissions(token,course)]);
   const topic=matchingTopic(topics,period);
   if(!topic)fail(`No existe «${topic_name}» en esa clase. Primero prepara los temas.`,409);
   const {work:rawWork,rows}=gradeEntries(coursework,submissions,topic.topicId);
   const savedTypes=await q(db.from('jaguar_classroom_trabajos_tipo').select('google_work_id,tipo,fuente_examen,google_form_id').eq('google_course_id',course).eq('grupo_materia_id',gmId).eq('periodo_id',pid).limit(301));
   const work=classifiedWork(rawWork,savedTypes);
   if(req.method==='POST'&&action==='save_work_types'){
    if(manager)fail('Sólo el docente asignado clasifica las evaluaciones.',403);
    if(String(req.headers.origin||'')!==cfg.origin)fail('Origen no autorizado.',403);
    if(period.es_periodo_actual!==true||period.activo===false||(period.fecha_fin&&period.fecha_fin<new Date().toISOString().slice(0,10)))fail('Las clasificaciones sólo pueden editarse durante el periodo académico abierto.',409);
    const rubric=await q(db.from('rubricas_evaluacion').select('id,estado').eq('docente_id',teacherId).eq('grupo_materia_id',gmId).eq('periodo_id',pid).maybeSingle());
    if(rubric?.estado==='cerrada')fail('La rúbrica ya está cerrada: no pueden modificarse las evaluaciones.',409);
    if(!rawWork.length)fail('Este periodo no contiene trabajos puntuables para clasificar.',409);
    const types=normalizeWorkTypes(req.body?.trabajos,rawWork);
    // Los IDs de Google y el periodo se recalculan en servidor, no se toman del navegador.
    const saved=await q(db.from('jaguar_classroom_trabajos_tipo').upsert(types.map(t=>({
     ...t,google_course_id:course,grupo_materia_id:gmId,periodo_id:pid,
     actualizado_por:user.id,actualizado_at:new Date().toISOString()
    })),{onConflict:'google_course_id,google_work_id'}).select('google_work_id'));
    return success(res,{saved:saved.length,activities:types.filter(t=>t.tipo==='actividad').length,exams:types.filter(t=>t.tipo==='examen').length,excluded:types.filter(t=>t.tipo==='excluir').length});
   }
   const mappedStudents=students.map(s=>({google_user_id:String(s.userId),name:s.profile?.name?.fullName||'',email:s.profile?.emailAddress||'',alumno_id:links.find(l=>String(l.google_user_id)===String(s.userId))?.alumno_id||null}));
   if(req.method==='GET'&&action==='grades')return success(res,{gm,period:{...period,topic_name},course,topic:{id:String(topic.topicId),name:topic.name},work,rows,students:mappedStudents,alumnos:roster,closed:period.activo===false||period.es_periodo_actual!==true||!!(period.fecha_fin&&period.fecha_fin<new Date().toISOString().slice(0,10))});
   if(!['grade_preview','grade_commit'].includes(action)||req.method!=='POST')fail('Acción no permitida.',405);
   if(manager)fail('Sólo el docente asignado confirma las calificaciones de Classroom.',403);
   if(String(req.headers.origin||'')!==cfg.origin)fail('Origen no autorizado.',403);
   const selection=gradeSelection(req.body,work,students);
   const result=gradeReport(coursework,submissions,topics,{...period,topic_name},students,req.body,work);
   if(result.grades.some(g=>g.unresolved.length))fail('Existen tareas sin calificación: decide cuáles cuentan como cero o se excluyen.',409);
   if(result.grades.some(g=>g.grade==null))fail('Hay alumnos sin actividades calificables. No se importarán ceros inventados.',409);
   if(mappedStudents.some(s=>!s.alumno_id)||roster.length!==mappedStudents.length||new Set(mappedStudents.map(s=>Number(s.alumno_id))).size!==roster.length)
    fail('Servicios Docentes debe verificar todas las correspondencias entre cuentas Google y matrículas antes de importar.',409);
   const rubric=await q(db.from('rubricas_evaluacion').select('id,estado,docente_id,grupo_materia_id,periodo_id').eq('docente_id',teacherId).eq('grupo_materia_id',gmId).eq('periodo_id',pid).maybeSingle());
   if(!rubric)fail('Primero configura la rúbrica de evaluación de este periodo.',409);
   const components=await q(db.from('rubrica_componentes').select('id,nombre,ponderacion').eq('rubrica_id',rubric.id));
   const classroomComponents=components.filter(c=>/classroom/i.test(c.nombre));
   if(classroomComponents.length!==1)fail('La rúbrica debe contener exactamente un componente llamado Classroom, con la ponderación elegida para este periodo.',409);
   const component=classroomComponents[0];
   const grades=result.grades.map(g=>({alumno_id:Number(mappedStudents.find(s=>s.google_user_id===g.google_user_id).alumno_id),valor:g.grade,earned:g.earned,possible:g.possible}));
   const payload={user:user.id,course,gmId,pid,component_id:component.id,weight:component.ponderacion,work:result.work,rows:result.rows,grades,excluded:selection.excluded,decisions:selection.decisions};
   const proof=gradeProof(payload,cfg.stateSecret);
   if(action==='grade_preview')return success(res,{grades,component:{nombre:component.nombre,ponderacion:component.ponderacion,id:component.id},proof});
   if(period.es_periodo_actual!==true||period.activo===false||(period.fecha_fin&&period.fecha_fin<new Date().toISOString().slice(0,10))||rubric.estado==='cerrada')fail('Sólo se importan actividades del periodo escolar actual y con rúbrica abierta.',409);
   if(!verifyProof(req.body.proof,proof))fail('Las notas o decisiones cambiaron después de la vista previa. Vuelve a revisarlas antes de guardar.',409);
   if(req.body.confirmado!==true)fail('El docente debe confirmar la importación.',400);
   const imported=await q(db.rpc('jaguar_classroom_importar_rubrica',{p_actor:user.id,p_rubrica_id:rubric.id,p_componente_id:component.id,p_google_course_id:course,p_periodo_id:pid,p_grades:grades.map(g=>({alumno_id:g.alumno_id,valor:g.valor})),p_snapshot:{work:result.work,grades,excluded:selection.excluded,decisions:selection.decisions,topic:topic_name}}));
   return success(res,{imported,component:component.nombre});
  }
  if(req.method==='POST'&&action==='link'){if(!manager)fail('Sólo Servicios Docentes puede vincular clases.',403);
   const origin=String(req.headers.origin||'');
   const cfg=googleConfig();if(origin!==cfg.origin)fail('La vinculación debe iniciarse desde Jaguar en su dominio autorizado.',403);
   const gmId=numberId(req.body?.grupo_materia_id),googleId=String(req.body?.google_course_id||'').trim();
   if(!/^[a-zA-Z0-9_-]{4,70}$/.test(googleId))fail('Selecciona un Classroom de la lista sincronizada.');
   const cycle=await activeCycle(db);
   const gm=await q(db.from('grupo_materias').select('id,grupo_id,grupos(id,activo)').eq('id',gmId).maybeSingle());
   if(!gm||gm.grupos?.activo===false)fail('La materia y grupo no están disponibles.',409);
   const {classes}=await googleData(db),course=classes.find(c=>c.id===googleId);
   if(!course)fail('La clase no está disponible en la cuenta Google autorizada.',409);
   if(course.estado==='ARCHIVED'||course.estado==='DECLINED'||course.estado==='SUSPENDED')fail('La clase está archivada o no está activa. Revísala en Google.',409);
   const existing=await q(db.from('jaguar_classroom_clases').select('*').eq('ciclo_escolar',cycle).eq('grupo_materia_id',gmId).maybeSingle());
   if(existing?.google_course_id&&existing.google_course_id!==googleId)fail('Ya hay una clase Google vinculada a esa asignatura. No se reemplazó.',409);
   const collision=await q(db.from('jaguar_classroom_clases').select('id,grupo_materia_id').eq('google_course_id',googleId).maybeSingle());
   if(collision&&Number(collision.grupo_materia_id)!==gmId)fail('Ese Classroom ya está vinculado con otra asignatura.',409);
   const teachers=await q(db.from('asignaciones_docentes').select('docente_id').eq('ciclo_escolar',cycle).eq('grupo_materia_id',gmId).eq('activo',true).limit(20));
   const teacherIds=[...new Set((teachers||[]).map(t=>Number(t.docente_id)))];
   const teacherId=existing?.docente_id&&teacherIds.includes(Number(existing.docente_id))?Number(existing.docente_id):(teacherIds.length===1?teacherIds[0]:null);
   const codigo=course.codigo?classCode(course.codigo):null;
   const url=course.enlace?classroomLink(course.enlace):null;
   const estado=codigo&&url?'registrada':'pendiente';
   if(!course.nombre||course.nombre.length<4)fail('La clase Google no tiene un nombre válido.',409);
   const patch={nombre:course.nombre.slice(0,150),descripcion:course.descripcion.slice(0,800),codigo_union:codigo,enlace_clase:url,google_course_id:googleId,estado,origen:'google',docente_id:teacherId,actualizado_por:user.id,actualizado_at:new Date().toISOString()};
   const saved=existing
    ?await q(db.from('jaguar_classroom_clases').update(patch).eq('id',existing.id).select('*').single())
    :await q(db.from('jaguar_classroom_clases').insert({...patch,grupo_materia_id:gmId,ciclo_escolar:cycle,creado_por:user.id}).select('*').single());
   return success(res,{saved});
  }
  return res.status(405).json({ok:false,error:'Operación no disponible.'});
 }catch(e){console.error('Google Classroom:',e?.message);return res.status(e.status||500).json({ok:false,error:e.message||'Error interno.'});}
}
