/** Jaguar Classroom 5.6 · Etapa 1: registro manual, asignación y PDF privado.
 * La integración Google OAuth se añadirá en una etapa posterior.
 */
import {requireRoles} from '../lib/_admin.js';
import {CLASSROOM_MANAGERS,CLASSROOM_READERS,cleanRecord,canReadCourse} from '../lib/classroom_rules.js';
import {buildClassroomDirectory} from '../lib/classroom_pdf.js';
const fail=(msg,status=400)=>{throw Object.assign(new Error(msg),{status});};
const success=(res,data)=>res.status(200).json({ok:true,data});
const id=v=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<=0)fail('Identificador inválido.');return n;};
async function q(p){const {data,error}=await p;if(error){if(/jaguar_classroom_clases/i.test(error.message||''))fail('Falta instalar la migración SQL de Jaguar Classroom V5.6 en Supabase.',409);fail(error.message,409);}return data;}
async function activeCycle(db){let rows=await q(db.from('periodos_escolares').select('ciclo_escolar').eq('es_periodo_actual',true).order('id',{ascending:false}).limit(1));
 if(!rows?.length)rows=await q(db.from('periodos_escolares').select('ciclo_escolar').eq('activo',true).order('id',{ascending:false}).limit(1));
 if(!rows?.[0]?.ciclo_escolar)fail('Configura primero el ciclo escolar actual.',409);return rows[0].ciclo_escolar;
}
async function catalog(db,cycle){
 const [gms,teachers,assignments]=await Promise.all([
  q(db.from('grupo_materias').select('id,grupo_id,materia_id,grupos(id,clave,grado,activo),materias(id,nombre)').limit(2500)),
  q(db.from('docentes').select('id,nombre_completo,correo,activo').limit(1000)),
  q(db.from('asignaciones_docentes').select('docente_id,grupo_materia_id').eq('ciclo_escolar',cycle).eq('activo',true).limit(5000))
 ]);
 if(gms.length===2500||assignments.length===5000)fail('La consulta de asignaciones excedió el límite de seguridad; revisa la configuración escolar.',409);
 return {gms,teachers,assignments};
}
async function teacherId(db,user){const d=await q(db.from('docentes').select('id').eq('auth_user_id',user.id).maybeSingle());if(!d)fail('Tu cuenta no tiene docente asociado.',403);return d.id;}
async function fetchRecords(db,cycle){return q(db.from('jaguar_classroom_clases').select('*').eq('ciclo_escolar',cycle).order('grupo_materia_id').limit(2500));}
async function bootstrap(db,user,role){
 const cycle=await activeCycle(db),[catalogData,rows]=await Promise.all([catalog(db,cycle),fetchRecords(db,cycle)]);
 if(role!=='docente')return {cycle,...catalogData,rows};
 const tid=await teacherId(db,user);
 const assigned=new Set(catalogData.assignments.filter(a=>Number(a.docente_id)===tid).map(a=>Number(a.grupo_materia_id)));
 return {cycle,gms:catalogData.gms.filter(g=>assigned.has(Number(g.id))),teachers:catalogData.teachers.filter(t=>Number(t.id)===tid),assignments:catalogData.assignments.filter(a=>Number(a.docente_id)===tid),rows:rows.filter(r=>assigned.has(Number(r.grupo_materia_id))&&canReadCourse(role,tid,r))};
}
export default async function handler(req,res){
 try{
  const {user,profile,adminClient:db}=await requireRoles(req,CLASSROOM_READERS);
  const action=String(req.method==='GET'?req.query?.action:req.body?.action||'');
  const input=req.method==='GET'?req.query||{}:req.body||{};
  if(req.method==='GET'&&action==='bootstrap')return success(res,await bootstrap(db,user,profile.rol));
  if(req.method==='POST'&&action==='save'){
   if(!CLASSROOM_MANAGERS.includes(profile.rol))fail('Sólo Servicios Docentes administra las clases de Classroom.',403);
   const cycle=await activeCycle(db),record=cleanRecord(input.record||{});
   const data=await catalog(db,cycle), gm=data.gms.find(x=>Number(x.id)===record.grupo_materia_id);
   if(!gm||gm.grupos?.activo===false)fail('El grupo y su materia no están disponibles.',409);
   const assignmentIds=data.assignments.filter(a=>Number(a.grupo_materia_id)===record.grupo_materia_id).map(a=>Number(a.docente_id));
   if(record.docente_id!==null&&!assignmentIds.includes(record.docente_id))fail('Ese docente no está asignado a esta materia y grupo durante el ciclo.',409);
   if(record.docente_id===null&&assignmentIds.length===1)record.docente_id=assignmentIds[0];
   const teacher=record.docente_id==null?null:data.teachers.find(t=>Number(t.id)===record.docente_id);
   if(record.docente_id!=null&&(!teacher||teacher.activo===false))fail('Docente no disponible.',409);
   const old=await q(db.from('jaguar_classroom_clases').select('id,origen').eq('ciclo_escolar',cycle).eq('grupo_materia_id',record.grupo_materia_id).maybeSingle());
   if(old?.origen==='google'&&(record.google_course_id||record.codigo_union||record.enlace_clase))fail('Esta clase está vinculada a Google; actualízala desde la sincronización cuando esté disponible.',409);
   if(old){const saved=await q(db.from('jaguar_classroom_clases').update({...record,actualizado_por:user.id,actualizado_at:new Date().toISOString()}).eq('id',old.id).select('*').single());return success(res,saved);}
   const saved=await q(db.from('jaguar_classroom_clases').insert({...record,ciclo_escolar:cycle,origen:'manual',creado_por:user.id,actualizado_por:user.id}).select('*').single());return success(res,saved);
  }
  if(req.method==='GET'&&action==='pdf'){
   if(!CLASSROOM_MANAGERS.includes(profile.rol)&&!['control_escolar','direccion_escolar','coordinacion_academica','control'].includes(profile.rol))fail('No tienes autorización para descargar los códigos del grupo.',403);
   const groupId=id(input.grupo_id),cycle=await activeCycle(db);
   const data=await catalog(db,cycle),group=data.gms.find(g=>Number(g.grupo_id)===groupId);
   if(!group)fail('Grupo sin materias registradas.',404);
   const records=await fetchRecords(db,cycle),byGm=new Map(records.map(r=>[Number(r.grupo_materia_id),r]));
   const teacherNames=new Map(data.teachers.map(t=>[Number(t.id),t.nombre_completo]));
   const rows=data.gms.filter(g=>Number(g.grupo_id)===groupId).map(g=>{
     const r=byGm.get(Number(g.id)),teachers=data.assignments.filter(a=>Number(a.grupo_materia_id)===Number(g.id)).map(a=>teacherNames.get(Number(a.docente_id))).filter(Boolean);
     return {materia:g.materias?.nombre||'Asignatura',docente:r?.docente_id?teacherNames.get(Number(r.docente_id)):teachers.join(' / '),codigo_union:r?.estado==='registrada'?r.codigo_union:null,enlace_clase:r?.estado==='registrada'?r.enlace_clase:null};
   });
   const pdf=await buildClassroomDirectory({cycle,group:group.grupos?.clave||String(groupId),rows});
   return success(res,{filename:`ITHLA-Classroom-${String(group.grupos?.clave||groupId).replace(/[^a-z0-9_-]/gi,'_')}.pdf`,content:Buffer.from(pdf).toString('base64')});
  }
  return res.status(405).json({ok:false,error:'Operación no disponible.'});
 }catch(e){console.error('Classroom:',e?.message);return res.status(e.status||500).json({ok:false,error:e.message||'Error interno.'});}
}
