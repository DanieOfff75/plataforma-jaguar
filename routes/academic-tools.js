/** Jaguar V5.5: gestión de aulas, banco de exámenes y carga institucional segura. */
import crypto from 'node:crypto';
import {planRoomAllocation} from '../lib/room_auto_allocation.js';
import {requireRoles} from '../lib/_admin.js';
import {ROOM_MANAGERS,ROOM_READERS,GRADE_MANAGERS,EXAM_ROLES,fail,positiveId,normalizeRoom,normalizeQuestion,validateGradeRows,calculateGradePreview} from '../lib/academic_tools_rules.js';
import {examToPdf,examToDocx,examToGoogleAppsScript} from '../lib/jaguar_examen_export.js';
const ALL=[...new Set([...ROOM_READERS,...GRADE_MANAGERS,...EXAM_ROLES])];
const allowed=(role,roles)=>{if(!roles.includes(role))fail('Acceso no autorizado para esta función.',403);};
const asResult=(res,data)=>res.status(200).json({ok:true,data});
async function checked(query){const {data,error}=await query;if(error)throw Object.assign(new Error(error.message),{status:400});return data;}
async function currentCycle(db){
 let rows=await checked(db.from('periodos_escolares').select('ciclo_escolar').eq('es_periodo_actual',true).order('id',{ascending:false}).limit(1));
 if(!rows?.[0])rows=await checked(db.from('periodos_escolares').select('ciclo_escolar').eq('activo',true).order('id',{ascending:false}).limit(1));
 if(!rows?.[0]?.ciclo_escolar)fail('Configura un ciclo y periodo escolar antes de continuar.',409);
 return rows[0].ciclo_escolar;
}
async function docId(db,user){const doc=await checked(db.from('docentes').select('id').eq('auth_user_id',user.id).maybeSingle());if(!doc)fail('Tu cuenta no tiene un docente asociado.',403);return doc.id;}
async function teacherGroups(db,doc,cycle){return checked(db.from('asignaciones_docentes').select('grupo_materia_id,grupo_materias(id,materia_id,grupo_id,grupos(id,clave),materias(id,nombre))').eq('docente_id',doc).eq('activo',true).eq('ciclo_escolar',cycle));}
async function bootstrap(db,user,role){
 const cycle=await currentCycle(db);
 const periods=await checked(db.from('periodos_escolares').select('id,nombre,ciclo_escolar,activo,fecha_inicio,fecha_fin').eq('ciclo_escolar',cycle).order('id'));
 if(role==='docente'){
  const teacher=await docId(db,user),assignments=await teacherGroups(db,teacher,cycle);
  return {cycle,periods,assignments,teacher_id:teacher};
 }
 const [groups,gms,subjects]=await Promise.all([
  checked(db.from('grupos').select('id,clave,grado,turno,activo').eq('activo',true).order('clave')),
  checked(db.from('grupo_materias').select('id,grupo_id,materia_id,grupos(id,clave,grado),materias(id,nombre)').order('id').limit(2000)),
  checked(db.from('materias').select('id,nombre,clave').order('nombre').limit(600))
 ]);
 return {cycle,periods,groups,gms,subjects};
}
async function roomData(db){
 const cycle=await currentCycle(db);
 const [rooms,schedule,groupsCount,groups]=await Promise.all([
   checked(db.from('jaguar_aulas').select('*').order('codigo')),
   checked(db.from('horarios').select('id,grupo_materia_id,docente_id,dia_semana,hora_inicio,hora_fin,aula,grupo_materias(id,grupo_id,grupos(id,clave,turno),materias(id,nombre))').eq('ciclo_escolar',cycle).order('dia_semana').order('hora_inicio').order('id').limit(1500)),
   checked(db.from('alumnos').select('id,grupo_id').eq('activo',true).limit(5000)),
   checked(db.from('grupos').select('id,clave,turno,activo').eq('activo',true).order('id').limit(100))
 ]);
 const count={};for(const s of groupsCount||[])count[s.grupo_id]=(count[s.grupo_id]||0)+1;
 return {cycle,rooms,schedule,groups,group_counts:count};
}
async function teacherAssignmentForSubject(db,doc,materiaId,cycle){
 const rows=await teacherGroups(db,doc,cycle);
 if(!rows.some(r=>Number(r.grupo_materias?.materia_id)===materiaId))fail('Esa asignatura no está asignada al docente durante el ciclo actual.',403);
 return rows;
}
async function gradeContext(db,gmId,periodId){
 const cycle=await currentCycle(db);
 const [gm,period]=await Promise.all([
   checked(db.from('grupo_materias').select('id,grupo_id,materia_id,grupos(id,clave),materias(id,nombre)').eq('id',gmId).maybeSingle()),
   checked(db.from('periodos_escolares').select('id,nombre,ciclo_escolar,activo,fecha_fin').eq('id',periodId).maybeSingle())
 ]);
 if(!gm||!period||period.ciclo_escolar!==cycle)fail('Materia o periodo no pertenece al ciclo activo.',409);
 if(period.activo===false||(period.fecha_fin&&period.fecha_fin<new Date().toISOString().slice(0,10)))fail('Periodo finalizado o inactivo: usa el procedimiento oficial de rectificación.',409);
 const [students,existing]=await Promise.all([
   checked(db.from('alumnos').select('id,matricula,nombre_completo,grupo_id').eq('grupo_id',gm.grupo_id).eq('activo',true).order('nombre_completo').limit(251)),
   checked(db.from('calificaciones').select('id,alumno_id,calificacion,observaciones,rubrica_id,cierre_evaluacion_id,detalle_evaluacion').eq('grupo_materia_id',gmId).eq('periodo_id',periodId).limit(500))
 ]);
 if(students.length>250)fail('Hay más de 250 alumnos en el grupo; no se deben omitir registros. Contacta a Control Escolar para dividir el proceso.',409);
 if(new Set((existing||[]).map(x=>x.alumno_id)).size!==existing.length)fail('Existen calificaciones duplicadas en este periodo: deben corregirse antes de importar.',409);
 return {gm,period,students,existing};
}
function parseGradePayload(raw){
 return {gmId:positiveId(raw.grupo_materia_id,'Grupo-materia'),periodId:positiveId(raw.periodo_id,'Periodo'),allowUpdates:raw.allow_updates===true,motivo:String(raw.motivo||'').trim().slice(0,500),rows:validateGradeRows(raw.rows)};
}
function fingerprint(user,context,body,rows){
 const secret=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
 if(!secret)fail('Falta configuración de seguridad del servidor.',500);
 const normalized={user:user.id,group:context.gm.id,period:context.period.id,allowUpdates:body.allowUpdates,motivo:body.motivo,rows};
 return crypto.createHmac('sha256',secret).update(JSON.stringify(normalized)).digest('hex');
}
async function buildGradePreview(db,user,raw){
 const b=parseGradePayload(raw);
 if(b.allowUpdates&&b.motivo.length<20)fail('La actualización de notas requiere un motivo de 20 caracteres como mínimo.');
 const ctx=await gradeContext(db,b.gmId,b.periodId);
 const preview=calculateGradePreview(b.rows,ctx.students,ctx.existing,{allowUpdates:b.allowUpdates});
 return {...preview,context:{gm:ctx.gm,period:ctx.period},token:fingerprint(user,ctx,b,b.rows),normalized:b};
}
export default async function handler(req,res){
 try{
  const {user,profile,adminClient:db}=await requireRoles(req,ALL);
  const role=profile.rol,action=String(req.method==='GET'?req.query?.action:req.body?.action||'');
  const input=req.method==='GET'?req.query||{}:req.body||{};
  if(req.method==='GET'&&action==='bootstrap')return asResult(res,await bootstrap(db,user,role));
  if(req.method==='GET'&&action==='rooms'){allowed(role,ROOM_READERS);return asResult(res,await roomData(db));}
  if((req.method==='GET'&&action==='previewAutoRooms')||(req.method==='POST'&&action==='commitAutoRooms')){
    allowed(role,ROOM_MANAGERS);
    const data=await roomData(db);
    const seed=Number(input.seed);
    if(!Number.isSafeInteger(seed)||seed<1||seed>2147483647)fail('Genera primero una vista previa de asignación.',400);
    const preview=planRoomAllocation({...data,seed});
    const privateKey=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
    if(!privateKey)fail('Falta clave del servidor para comprobar la vista previa.',500);
    const payload=JSON.stringify({actor:user.id,seed,cycle:data.cycle,rooms:data.rooms,schedule:data.schedule,groups:data.groups,counts:data.group_counts,pairs:preview.pairs});
    const token=crypto.createHmac('sha256',privateKey).update(payload).digest('hex');
    if(req.method==='GET')return asResult(res,{...preview,cycle:data.cycle,seed,token});
    const clientToken=String(input.preview_token||'');
    if(!/^[0-9a-f]{64}$/.test(clientToken)||!crypto.timingSafeEqual(Buffer.from(clientToken,'hex'),Buffer.from(token,'hex')))
      fail('La vista previa ya caducó porque cambiaron las aulas u horarios. Actualiza y confirma otra vez.',409);
    if(input.confirmar!==true)fail('Confirma expresamente la asignación de los 18 grupos.',400);
    return asResult(res,await checked(db.rpc('jaguar_asignar_aulas_grupos_lote',{
      p_actor:user.id,p_ciclo:data.cycle,p_asignaciones:preview.pairs.map(p=>({grupo_id:p.grupo_id,aula_id:p.aula_id}))
    })));
  }
  if(req.method==='POST'&&action==='saveRoom'){
    allowed(role,ROOM_MANAGERS);const payload=normalizeRoom(input.room||{});
    const id=input.room?.id?positiveId(input.room.id):null;
    if(id){
      // No permitir renombrar un aula con horarios asignados: alteraría el vínculo del PDF histórico.
      const old=await checked(db.from('jaguar_aulas').select('id,nombre').eq('id',id).maybeSingle());if(!old)fail('Aula inexistente.',404);
      const slots=await checked(db.from('horarios').select('id,grupo_materias(grupo_id)').eq('aula',old.nombre).limit(2000));
      if(slots.length && old.nombre!==payload.nombre)fail('El aula tiene horarios; conserva el nombre para evitar desvincularlos.',409);
      if(slots.length && !payload.activo)fail('Antes de desactivar un aula, reasigna sus clases.',409);
      const groupIds=[...new Set(slots.map(x=>x.grupo_materias?.grupo_id).filter(Boolean))];
      if(groupIds.length){
        const students=await checked(db.from('alumnos').select('id,grupo_id').in('grupo_id',groupIds).eq('activo',true).limit(5000));
        const counts={};students.forEach(x=>counts[x.grupo_id]=(counts[x.grupo_id]||0)+1);
        if(groupIds.some(x=>(counts[x]||0)>payload.capacidad))fail('La nueva capacidad dejaría grupos asignados sin espacio. Reasigna primero esas clases.',409);
      }
      return asResult(res,await checked(db.from('jaguar_aulas').update(payload).eq('id',id).select('*').single()));
    }
    return asResult(res,await checked(db.from('jaguar_aulas').insert(payload).select('*').single()));
  }
  if(req.method==='POST'&&action==='assignRoom'){
    allowed(role,ROOM_MANAGERS);
    const id=positiveId(input.horario_id,'Horario');const aulaId=input.aula_id==null||input.aula_id===''?null:positiveId(input.aula_id,'Aula');
    return asResult(res,await checked(db.rpc('jaguar_asignar_aula',{p_horario_id:id,p_aula_id:aulaId,p_actor:user.id})));
  }
  if(req.method==='GET'&&action==='questions'){
    allowed(role,EXAM_ROLES);const tid=await docId(db,user),cycle=await currentCycle(db);
    const materiaId=positiveId(input.materia_id,'Materia');await teacherAssignmentForSubject(db,tid,materiaId,cycle);
    return asResult(res,await checked(db.from('jaguar_preguntas').select('id,materia_id,tipo,enunciado,opciones,respuesta,puntos,creado_at').eq('docente_id',tid).eq('materia_id',materiaId).order('id',{ascending:false}).limit(400)));
  }
  if(req.method==='POST'&&action==='saveQuestion'){
    allowed(role,EXAM_ROLES);const tid=await docId(db,user),cycle=await currentCycle(db);
    const materiaId=positiveId(input.materia_id,'Materia');await teacherAssignmentForSubject(db,tid,materiaId,cycle);
    const clean={...normalizeQuestion(input.question||{}),docente_id:tid,materia_id:materiaId,actualizado_at:new Date().toISOString()};
    if(input.question?.id){const id=positiveId(input.question.id);return asResult(res,await checked(db.from('jaguar_preguntas').update(clean).eq('id',id).eq('docente_id',tid).eq('materia_id',materiaId).select('id').single()));}
    return asResult(res,await checked(db.from('jaguar_preguntas').insert(clean).select('id').single()));
  }
  if(req.method==='POST'&&action==='saveExam'){
    allowed(role,EXAM_ROLES);const tid=await docId(db,user),cycle=await currentCycle(db),gmId=positiveId(input.grupo_materia_id,'Grupo-materia');
    const assignments=await teacherGroups(db,tid,cycle),assignment=assignments.find(r=>Number(r.grupo_materia_id)===gmId);if(!assignment)fail('No tienes asignado ese grupo-materia.',403);
    const questionIds=[...new Set((input.question_ids||[]).map(x=>positiveId(x,'Reactivo')))];
    if(!questionIds.length||questionIds.length>60)fail('Selecciona entre 1 y 60 preguntas.');
    const qs=await checked(db.from('jaguar_preguntas').select('id,docente_id,materia_id,tipo,enunciado,opciones,respuesta,puntos').eq('docente_id',tid).eq('materia_id',assignment.grupo_materias.materia_id).in('id',questionIds));
    if(qs.length!==questionIds.length)fail('Alguna pregunta ya no está disponible o no te pertenece.',403);
    const byId=new Map(qs.map(q=>[q.id,q]));const snapshot=questionIds.map(id=>byId.get(id));
    const titulo=String(input.titulo||'').trim(),instrucciones=String(input.instrucciones||'').trim();if(titulo.length<5||titulo.length>160||instrucciones.length>1500)fail('Escribe un título válido (5–160 caracteres) e instrucciones de hasta 1500.');
    const exam=await checked(db.from('jaguar_examenes').insert({docente_id:tid,grupo_materia_id:gmId,ciclo_escolar:cycle,titulo,instrucciones,preguntas:snapshot}).select('id,titulo').single());
    return asResult(res,exam);
  }
  if(req.method==='GET'&&action==='exams'){
    allowed(role,EXAM_ROLES);const tid=await docId(db,user);
    return asResult(res,await checked(db.from('jaguar_examenes').select('id,titulo,grupo_materia_id,ciclo_escolar,creado_at,preguntas').eq('docente_id',tid).order('id',{ascending:false}).limit(150)));
  }
  if(req.method==='POST'&&action==='exportExam'){
    allowed(role,EXAM_ROLES);const tid=await docId(db,user),id=positiveId(input.id,'Examen'),format=String(input.format||'');
    if(!['pdf','docx','forms'].includes(format))fail('Formato no admitido.');
    const exam=await checked(db.from('jaguar_examenes').select('*').eq('id',id).eq('docente_id',tid).maybeSingle());if(!exam)fail('Examen no encontrado.',404);
    const gm=await checked(db.from('grupo_materias').select('grupos(clave),materias(nombre)').eq('id',exam.grupo_materia_id).maybeSingle());
    if(format==='forms')return asResult(res,{filename:`jaguar-examen-${id}.gs`,mime:'text/plain',content:Buffer.from(examToGoogleAppsScript(exam)).toString('base64'),manual:true});
    const bytes=format==='docx'?await examToDocx(exam,gm?.grupos?.clave||'—',gm?.materias?.nombre||'—'):await examToPdf(exam,gm?.grupos?.clave||'—',gm?.materias?.nombre||'—');
    return asResult(res,{filename:`ITHLA-Examen-${id}.${format}`,mime:format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',content:bytes.toString('base64')});
  }
  if(req.method==='GET'&&action==='gradeRoster'){
    allowed(role,GRADE_MANAGERS);
    const gmId=positiveId(input.grupo_materia_id),periodId=positiveId(input.periodo_id);
    return asResult(res,await gradeContext(db,gmId,periodId));
  }
  if(req.method==='POST'&&action==='previewGrades'){
    allowed(role,GRADE_MANAGERS);const preview=await buildGradePreview(db,user,input);
    return asResult(res,{rows:preview.rows,summary:preview.summary,context:preview.context,token:preview.token});
  }
  if(req.method==='POST'&&action==='commitGrades'){
    allowed(role,GRADE_MANAGERS);
    const preview=await buildGradePreview(db,user,input);
    const clientToken=String(input.preview_token||'');
    if(!/^[0-9a-f]{64}$/.test(clientToken)||!crypto.timingSafeEqual(Buffer.from(clientToken,'hex'),Buffer.from(preview.token,'hex')))fail('La vista previa ya no coincide con las notas actuales. Vuelve a validar antes de confirmar.',409);
    if(preview.summary.errores)fail(`El lote tiene ${preview.summary.errores} error(es). Corrige y revisa antes de continuar.`,409);
    const operation=crypto.randomUUID();const dbRows=preview.rows.map(r=>({alumno_id:r.alumno_id,calificacion:r.calificacion,observaciones:r.observaciones}));
    const result=await checked(db.rpc('jaguar_importar_calificaciones_lote',{p_operacion:operation,p_actor:user.id,p_grupo_materia_id:preview.normalized.gmId,p_periodo_id:preview.normalized.periodId,p_rows:dbRows,p_allow_updates:preview.normalized.allowUpdates,p_motivo:preview.normalized.motivo}));
    return asResult(res,result);
  }
  return res.status(405).json({ok:false,error:'Acción o método no permitido.'});
 }catch(err){console.error('Academic tools:',err?.message);return res.status(err.status||500).json({ok:false,error:err.message||'Error interno.'});}
}
