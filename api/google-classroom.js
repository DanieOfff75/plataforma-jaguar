/** Sincronización por consulta y asociación supervisada, sin creación automática en Google. */
import {requireRoles} from '../lib/_admin.js';
import {googleConfig,googleAccess,googleCourses,projectCourse} from '../lib/google_classroom_oauth.js';
import {classCode,classroomLink} from '../lib/classroom_rules.js';
const fail=(msg,status=400)=>{throw Object.assign(new Error(msg),{status});};
const success=(res,data)=>res.status(200).json({ok:true,data});
const numberId=(v)=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<1)fail('Identificador de asignación inválido.');return n;};
async function q(p){const {data,error}=await p;if(error)fail('No fue posible consultar o guardar los registros de Classroom.',409);return data;}
async function activeCycle(db){
 let rows=await q(db.from('periodos_escolares').select('ciclo_escolar').eq('es_periodo_actual',true).order('id',{ascending:false}).limit(1));
 if(!rows?.length)rows=await q(db.from('periodos_escolares').select('ciclo_escolar').eq('activo',true).order('id',{ascending:false}).limit(1));
 if(!rows?.[0]?.ciclo_escolar)fail('Configura el ciclo escolar activo.',409);return rows[0].ciclo_escolar;
}
async function googleData(db){const cfg=googleConfig(),token=await googleAccess(db,cfg);return {cfg,classes:(await googleCourses(token)).map(projectCourse)};}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 try{
  const {user,adminClient:db}=await requireRoles(req,['servicios_docentes']);
  const action=String((req.method==='GET'?req.query?.action:req.body?.action)||'');
  if(req.method==='GET'&&action==='list'){
   const {classes}=await googleData(db),cycle=await activeCycle(db);
   const linked=await q(db.from('jaguar_classroom_clases').select('grupo_materia_id,google_course_id').eq('ciclo_escolar',cycle));
   return success(res,{classes:classes.map(c=>({...c,grupo_materia_id:linked.find(x=>x.google_course_id===c.id)?.grupo_materia_id||null})),cycle});
  }
  if(req.method==='POST'&&action==='link'){
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
