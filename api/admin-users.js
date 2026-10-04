import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { requireRoles } from '../lib/_admin.js';
import { departmentKeyForRole, getDepartmentByKey, listResponsibleUsers, validateResponsible } from './responsables.js';
import { getInstitution } from './institution.js';
import { audit } from '../lib/audit.js';

function tempPassword(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';let out='IN';for(let i=0;i<12;i++)out+=chars[Math.floor(Math.random()*chars.length)];return out;}
async function findUser(admin,email){const target=String(email||'').trim().toLowerCase();if(!target)return null;for(let page=1;page<=5;page++){const {data,error}=await admin.auth.admin.listUsers({page,perPage:1000});if(error)throw error;const u=(data?.users||[]).find(x=>(x.email||'').toLowerCase()===target);if(u)return u;if((data?.users||[]).length<1000)break;}return null;}
async function credentialsPdf({nombre_completo,rol,matricula,email,temporary_password,admin}){
  const institution=admin?await getInstitution(admin):{siglas:'ITHLA',nombre_institucion:'Instituto Tecnológico e Histórico Latinoamericano',dominio_institucional:'ithla.edu.mx'};
  const p=await PDFDocument.create();
  const page=p.addPage([612,792]);
  const regular=await p.embedFont(StandardFonts.Helvetica);
  const bold=await p.embedFont(StandardFonts.HelveticaBold);
  let logo=null;
  try{logo=await p.embedPng(await readFile(new URL('../assets/ithla-logo.png',import.meta.url)));}catch{}
  const GREEN=rgb(27/255,54/255,93/255), GREEN2=rgb(0,128/255,128/255), GOLD=rgb(212/255,175/255,55/255), GOLD_SOFT=rgb(248/255,244/255,228/255), PAPER=rgb(244/255,246/255,249/255), INK=rgb(44/255,62/255,80/255), MUTED=rgb(.34,.43,.40), RED=rgb(.58,.07,.10);
  page.drawRectangle({x:0,y:0,width:612,height:792,color:PAPER});
  page.drawRectangle({x:0,y:728,width:612,height:64,color:GREEN});
  page.drawRectangle({x:0,y:724,width:612,height:4,color:GOLD});
  page.drawRectangle({x:22,y:22,width:568,height:682,borderColor:rgb(.78,.82,.80),borderWidth:.8,color:rgb(1,1,1)});
  if(logo) page.drawImage(logo,{x:38,y:741,width:38,height:40});
  page.drawText(institution.siglas||'ITHLA',{x:90,y:761,size:19,font:bold,color:rgb(1,1,1)});
  page.drawText('Instituto Tecnológico e Histórico Latinoamericano',{x:90,y:745,size:7.2,font:regular,color:rgb(.86,.94,.91)});
  page.drawText('CREDENCIALES DE ACCESO INSTITUCIONAL',{x:40,y:684,size:18,font:bold,color:GREEN});
  page.drawText('Documento de entrega de usuario y contrasena temporal',{x:40,y:666,size:9,font:regular,color:MUTED});
  page.drawRectangle({x:40,y:612,width:532,height:34,color:GOLD_SOFT,borderColor:GOLD,borderWidth:.7});
  page.drawText('INFORMACION CONFIDENCIAL - ENTREGA PERSONAL',{x:53,y:624,size:9,font:bold,color:INK});
  const box=(x,y,w,h,fill,border)=>page.drawRectangle({x,y,width:w,height:h,color:fill,borderColor:border,borderWidth:.8});
  const label=(t,x,y)=>page.drawText(String(t).toUpperCase(),{x,y,size:7,font:bold,color:MUTED});
  const value=(t,x,y,maxw,size=11)=>{let text=String(t||'-'),z=size;while(z>7&&bold.widthOfTextAtSize(text,z)>maxw)z-=.25;page.drawText(text,{x,y,size:z,font:bold,color:INK});};
  box(40,520,532,72,rgb(1,1,1),rgb(.74,.80,.77));
  label('Nombre completo',55,572); value(nombre_completo,55,554,500,12);
  label('Rol / tipo de cuenta',55,536); value(rol,185,536,360,9.5);
  box(40,406,532,94,rgb(.985,.993,.989),GREEN2);
  label('USUARIO INSTITUCIONAL',55,474); value(email,55,450,490,15);
  label('MATRICULA',55,428); value(matricula||'-',145,428,180,10.5);
  label('TIPO',350,428); value('ACCESO TEMPORAL',395,428,150,8.5);
  box(40,286,532,94,rgb(1,.975,.965),rgb(.72,.22,.18));
  label('CONTRASENA TEMPORAL',55,354); value(temporary_password,55,324,490,18);
  page.drawText('Esta contrasena es temporal y debe cambiarse en el primer inicio de sesion.',{x:55,y:301,size:8.5,font:regular,color:RED});
  page.drawText('PRIMER ACCESO',{x:40,y:250,size:12,font:bold,color:GREEN});
  const steps=[
    `1. Ingresa al portal de ${institution.siglas||'ITHLA'} con el usuario institucional.`,
    '2. Utiliza la contrasena temporal indicada en este documento.',
    '3. El sistema te obligara a crear una nueva contrasena personal.',
    '4. Registra tu correo de recuperacion cuando el sistema lo solicite.'
  ];
  let y=228;for(const st of steps){page.drawText(st,{x:55,y,size:9.2,font:regular,color:INK});y-=21;}
  box(40,112,532,78,rgb(.95,.97,.965),rgb(.72,.79,.76));
  page.drawText('RECOMENDACIONES DE SEGURIDAD',{x:55,y:170,size:9,font:bold,color:GREEN});
  const rec=['No compartas esta contrasena con otras personas.','Conserva este documento en un lugar seguro.','Si pierdes el acceso, utiliza la recuperacion institucional.'];
  y=151;for(const st of rec){page.drawText('- '+st,{x:60,y,size:8.2,font:regular,color:MUTED});y-=15;}
  page.drawLine({start:{x:40,y:76},end:{x:572,y:76},color:GOLD,thickness:1});
  page.drawText(`${institution.siglas||'ITHLA'} - SISTEMA ESCOLAR`,{x:40,y:57,size:7.5,font:bold,color:GREEN});
  page.drawText('Documento generado automaticamente - No sustituye una identificacion escolar',{x:40,y:43,size:6.8,font:regular,color:MUTED});
  return Buffer.from(await p.save()).toString('base64');
}
const adminRoles=[
  'direccion_escolar',
  'control_escolar',
  'control',
  'servicios_docentes',
  'servicios_estudiantiles',
  'archivo_escolar',
  'prefectura',
  'coordinacion_academica'
];
const departmentRoles=['direccion_escolar','control_escolar','archivo_escolar','servicios_docentes','servicios_estudiantiles','prefectura','coordinacion_academica','recursos_monetarios'];

export default async function handler(req,res){
 try{
  const {user,profile,adminClient}=await requireRoles(req,adminRoles);
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Método no permitido.'});
  const b=req.body||{};
  const institution=await getInstitution(adminClient);
  const institutionDomain=String(institution.dominio_institucional||'ithla.edu.mx').trim().toLowerCase().replace(/^@/,'');
  if(b.action==='list_responsables'){
   const requested=String(b.departamento_clave||departmentKeyForRole(profile.rol)||'').toUpperCase();
   if(!requested)return res.status(400).json({ok:false,error:'No se pudo determinar el departamento.'});
   if(profile.rol!=='direccion_escolar' && requested!==departmentKeyForRole(profile.rol))return res.status(403).json({ok:false,error:'No puedes consultar encargados de otro departamento.'});
   const rows=await listResponsibleUsers(adminClient,requested);
   return res.status(200).json({ok:true,departamento:requested,responsables:rows.map(r=>({id:r.usuario_id,registro_id:r.id,nombre_completo:r.nombre_responsable||r.perfil?.nombre_completo||'—',nombre_cuenta:r.perfil?.nombre_completo||'—',correo:r.perfil?.correo||'',rol:r.perfil?.rol||'',cargo:r.cargo||'',es_director:!!r.es_director,firma_registrada:!!r.firma_path||!!r.perfil?.firma_path,activo:true}))});
  }
  if(b.action==='save_department_responsible'){
   if(profile.rol!=='direccion_escolar')return res.status(403).json({ok:false,error:'Solo el Director de la escuela puede administrar encargados departamentales.'});
   const key=String(b.departamento_clave||'').trim().toUpperCase();
   const nombre=String(b.nombre_responsable||'').trim(); const cargo=String(b.cargo||'').trim();
   if(!key||!nombre||!cargo)return res.status(400).json({ok:false,error:'Departamento, nombre del encargado y cargo son obligatorios.'});
   const dep=await getDepartmentByKey(adminClient,key); if(!dep)return res.status(404).json({ok:false,error:'Departamento no encontrado.'});
   const current=await listResponsibleUsers(adminClient,key);
   if(current.length){
    if(!current[0].id)return res.status(409).json({ok:false,error:'La tabla responsables_departamento aún no está instalada. Ejecuta sql/ITHLA_DB_COMPLETO_2026_2027.sql en Supabase para administrar el encargado y su firma.'});
    const changedName=String(current[0].nombre_responsable||'').trim()!==nombre;
    const patch={nombre_responsable:nombre,cargo,es_director:key==='DIR',activo:true};
    if(changedName){patch.firma_path=null;patch.firma_sha256=null;patch.firma_subida_at=null;}
    const {error}=await adminClient.from('responsables_departamento').update(patch).eq('id',current[0].id); if(error)throw error;
   }else{
    const roleList=key==='DIR'?['direccion_escolar']:key==='CE'?['control_escolar','control']:key==='AE'?['control_escolar','control','direccion_escolar']:key==='SD'?['servicios_docentes']:key==='SE'?['servicios_estudiantiles']:key==='PRE'?['prefectura']:key==='CA'?['coordinacion_academica']:[];
    if(!roleList.length)return res.status(400).json({ok:false,error:'Departamento no válido.'});
    const {data:accounts,error:ae}=await adminClient.from('perfiles').select('id,activo').in('rol',roleList).eq('activo',true).limit(2); if(ae)throw ae;
    if(!accounts?.length)return res.status(409).json({ok:false,error:'No existe una cuenta departamental activa para asociar. No se creará una cuenta duplicada automáticamente.'});
    const {error}=await adminClient.from('responsables_departamento').upsert({departamento_id:dep.id,usuario_id:accounts[0].id,nombre_responsable:nombre,cargo,es_director:key==='DIR',activo:true},{onConflict:'departamento_id,usuario_id'}); if(error)throw error;
   }
   return res.status(200).json({ok:true,message:'Encargado departamental guardado. La cuenta de acceso no se modificó.'});
  }
  if(b.action==='deactivate_department_responsible'){
   if(profile.rol!=='direccion_escolar')return res.status(403).json({ok:false,error:'Solo el Director de la escuela puede dar de baja encargados.'});
   const key=String(b.departamento_clave||'').trim().toUpperCase();
   if(key==='DIR')return res.status(400).json({ok:false,error:'El Director de la escuela no puede darse de baja desde este módulo.'});
   const dep=await getDepartmentByKey(adminClient,key); if(!dep)return res.status(404).json({ok:false,error:'Departamento no encontrado.'});
   const current=await listResponsibleUsers(adminClient,key);
   if(current.length && !current[0].id)return res.status(409).json({ok:false,error:'La tabla responsables_departamento aún no está instalada. Ejecuta sql/ITHLA_DB_COMPLETO_2026_2027.sql en Supabase para administrar el encargado.'});
   const {error}=await adminClient.from('responsables_departamento').update({activo:false,es_director:false}).eq('departamento_id',dep.id).eq('activo',true); if(error)throw error;
   return res.status(200).json({ok:true,message:'Encargado dado de baja. La cuenta departamental se conserva; puedes registrar un nuevo encargado.'});
  }
  if(b.action==='assign_responsable'||b.action==='remove_responsable')return res.status(400).json({ok:false,error:'Este flujo fue sustituido: ahora existe un solo encargado interno por departamento y no se crean cuentas adicionales para cambiarlo.'});
  if(b.action==='suspend_student' || b.action==='reactivate_student'){
   if(!['direccion_escolar','control_escolar','control','servicios_estudiantiles'].includes(profile.rol))return res.status(403).json({ok:false,error:'No tienes permisos para gestionar suspensiones de alumnos.'});
   const alumnoId=Number(b.alumno_id);if(!alumnoId)return res.status(400).json({ok:false,error:'Alumno no válido.'});
   if(b.action==='suspend_student'){
    const motivo=String(b.motivo||'').trim()||null;
    const fechaHasta=String(b.fecha_hasta||'').trim()||null;
    const observaciones=String(b.observaciones||'').trim()||null;
    const responsible=await validateResponsible(adminClient,b.responsable_id,profile.rol,departmentKeyForRole(profile.rol));
    const {data:alumno,error:ae}=await adminClient.from('alumnos').select('id,auth_user_id,nombre_completo').eq('id',alumnoId).maybeSingle();
    if(ae)throw ae;if(!alumno)return res.status(404).json({ok:false,error:'Alumno no encontrado.'});
    const {error}=await adminClient.from('alumnos').update({suspension_fecha:new Date().toISOString().slice(0,10),suspension_hasta:fechaHasta,suspension_motivo:motivo,suspension_observaciones:observaciones,revision_acceso_estado:null,suspension_responsable_id:responsible.usuario_id}).eq('id',alumnoId);
    if(error)throw error;
    if(alumno.auth_user_id){try{await adminClient.from('notificaciones').insert({usuario_id:alumno.auth_user_id,titulo:'Acceso escolar suspendido',contenido:`Tu acceso a ITHLA fue suspendido.${motivo?` Motivo: ${motivo}`:''}${fechaHasta?` Vigencia hasta: ${fechaHasta}.`:''} Puedes solicitar una revisión desde tu inicio de sesión.`,tipo:'suspension',leida:false});}catch(e){console.warn('No se pudo notificar la suspensión al alumno:',e.message)}}
    return res.status(200).json({ok:true,message:'Alumno suspendido. Se habilitó la revisión de acceso para el alumno.'});
   }
   const responsible=await validateResponsible(adminClient,b.responsable_id,profile.rol,departmentKeyForRole(profile.rol));
   const {data:alumno,error:ae}=await adminClient.from('alumnos').select('id,auth_user_id,nombre_completo').eq('id',alumnoId).maybeSingle();
   if(ae)throw ae;if(!alumno)return res.status(404).json({ok:false,error:'Alumno no encontrado.'});
   const {error}=await adminClient.from('alumnos').update({activo:true,suspension_fecha:null,suspension_hasta:null,suspension_motivo:null,suspension_observaciones:null,revision_acceso_estado:'aprobada',suspension_responsable_id:responsible.usuario_id}).eq('id',alumnoId);if(error)throw error;
   if(alumno.auth_user_id){try{await adminClient.from('notificaciones').insert({usuario_id:alumno.auth_user_id,titulo:'Acceso escolar reactivado',contenido:'Tu acceso a ITHLA fue reactivado por la autoridad escolar.',tipo:'suspension',leida:false});}catch(e){console.warn('No se pudo notificar la reactivación al alumno:',e.message)}}
   return res.status(200).json({ok:true,message:'Alumno reactivado. El acceso vuelve a estar disponible.'});
  }
  if(b.action==='suspend_teacher' || b.action==='reactivate_teacher'){
   if(!['direccion_escolar','control_escolar','control','servicios_docentes'].includes(profile.rol))return res.status(403).json({ok:false,error:'No tienes permisos para gestionar suspensiones de docentes.'});
   const teacherId=Number(b.docente_id||0);if(!teacherId)return res.status(400).json({ok:false,error:'Docente no válido.'});
   const teacherDepartment=profile.rol==='servicios_docentes'?'SD':'CE';
   const responsible=await validateResponsible(adminClient,b.responsable_id,profile.rol,teacherDepartment);
   const {data:teacher,error:te}=await adminClient.from('docentes').select('id,auth_user_id,nombre_completo').eq('id',teacherId).maybeSingle();if(te||!teacher)return res.status(404).json({ok:false,error:'Docente no encontrado.'});
   const suspended=b.action==='suspend_teacher';
   const patch=suspended?{activo:true,suspension_fecha:new Date().toISOString().slice(0,10),suspension_hasta:b.fecha_hasta||null,suspension_motivo:String(b.motivo||'').trim()||null,suspension_observaciones:String(b.observaciones||'').trim()||null,revision_acceso_estado:null,suspension_responsable_id:responsible.usuario_id}:{activo:true,suspension_fecha:null,suspension_hasta:null,suspension_motivo:null,suspension_observaciones:null,revision_acceso_estado:null,suspension_responsable_id:null};
   const {error:ue}=await adminClient.from('docentes').update(patch).eq('id',teacherId);if(ue)throw ue;
   return res.status(200).json({ok:true,message:suspended?'Docente suspendido.':'Docente reactivado.',activo:true,nombre_completo:teacher.nombre_completo});
  }
  if(b.action==='set_teacher_status'){
   const teacherId=Number(b.docente_id||0);
   if(!teacherId)return res.status(400).json({ok:false,error:'Docente no válido.'});
   if(!['direccion_escolar','control_escolar','control','servicios_docentes'].includes(profile.rol))return res.status(403).json({ok:false,error:'No tienes permisos para cambiar el estado de un docente.'});
   const activo=b.activo===true;
   const {data:teacher,error:te}=await adminClient.from('docentes').select('id,auth_user_id,nombre_completo,activo').eq('id',teacherId).maybeSingle();
   if(te||!teacher)return res.status(404).json({ok:false,error:'Docente no encontrado.'});
   const {error:du}=await adminClient.from('docentes').update({activo}).eq('id',teacherId);
   if(du)throw du;
   if(teacher.auth_user_id){
    const {error:pu}=await adminClient.from('perfiles').update({activo}).eq('id',teacher.auth_user_id);
    if(pu)throw pu;
   }
   if(!activo){
    const {error:au}=await adminClient.from('asignaciones_docentes').update({activo:false}).eq('docente_id',teacherId).eq('activo',true);
    if(au)throw au;
    const {error:rh}=await adminClient.rpc('recalcular_horas_docente',{p_docente_id:teacherId});
    if(rh)throw rh;
   }
   return res.status(200).json({ok:true,message:activo?'Docente reactivado.':'Docente dado de baja. Las asignaciones activas quedaron desactivadas.',activo,nombre_completo:teacher.nombre_completo});
  }
  if(b.action==='update_user'){
   if(!['control_escolar','control'].includes(profile.rol))return res.status(403).json({ok:false,error:'Solo Control Escolar puede modificar usuarios.'});
   const id=String(b.user_id||'').trim(); if(!id)return res.status(400).json({ok:false,error:'Usuario no válido.'});
   const {data:target,error:te}=await adminClient.from('perfiles').select('id,rol,nombre_completo,correo,correo_recuperacion,activo').eq('id',id).maybeSingle();
   if(te||!target)return res.status(404).json({ok:false,error:'Usuario no encontrado.'});
   const patch={}; if(b.nombre_completo!=null)patch.nombre_completo=String(b.nombre_completo).trim(); if(b.correo_recuperacion!=null)return res.status(403).json({ok:false,error:'El correo de recuperación solo puede modificarlo el propio usuario desde Perfil.'});
   if(b.rol!=null && String(b.rol)!==String(target.rol)) return res.status(403).json({ok:false,error:'El cambio de rol está bloqueado desde Usuarios. Usa una operación administrativa específica.'});
   const {error:pe}=await adminClient.from('perfiles').update(patch).eq('id',id); if(pe)throw pe;
   if(target.rol==='docente' && patch.nombre_completo){const {error:e}=await adminClient.from('docentes').update({nombre_completo:patch.nombre_completo}).eq('auth_user_id',id);if(e)throw e;}
   if(target.rol==='alumno' && patch.nombre_completo){const {error:e}=await adminClient.from('alumnos').update({nombre_completo:patch.nombre_completo}).eq('auth_user_id',id);if(e)throw e;}
   return res.status(200).json({ok:true,message:'Usuario actualizado.'});
  }
  if(b.action==='update_student_email'){
   if(!['servicios_estudiantiles','coordinacion_academica','control_escolar','direccion_escolar'].includes(profile.rol))return res.status(403).json({ok:false,error:'No autorizado para administrar correos de alumnos.'});
   const id=Number(b.alumno_id||0),email=String(b.email||'').trim().toLowerCase();if(!id||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({ok:false,error:'Alumno y correo válido son obligatorios.'});
   const {data:s,error:se}=await adminClient.from('alumnos').select('id,auth_user_id,nombre_completo').eq('id',id).maybeSingle();if(se||!s)return res.status(404).json({ok:false,error:'Alumno no encontrado.'});
   if(s.auth_user_id){const {error:ae}=await adminClient.auth.admin.updateUserById(s.auth_user_id,{email, email_confirm:true, user_metadata:{login_email:email}});if(ae)throw ae;const {error:pe}=await adminClient.from('perfiles').update({correo:email,correo_auth:email}).eq('id',s.auth_user_id);if(pe)throw pe;}
   return res.status(200).json({ok:true,message:'Correo institucional del alumno actualizado.'});
  }

  if(b.action==='delete_student' || b.action==='delete_teacher'){
   if(!['control_escolar','control','direccion_escolar'].includes(profile.rol)) return res.status(403).json({ok:false,error:'Solo Control Escolar puede eliminar permanentemente usuarios escolares.'});
   const kind=b.action==='delete_student'?'student':'teacher';
   const id=Number(b.id || (kind==='student'?b.alumno_id:b.docente_id) || 0);
   if(!id)return res.status(400).json({ok:false,error:'Registro no válido.'});
   if(kind==='student'){
     const {data:s,error:se}=await adminClient.from('alumnos').select('id,auth_user_id,nombre_completo,matricula,grupo_id,activo,estado_escolar').eq('id',id).maybeSingle();
     if(se||!s)return res.status(404).json({ok:false,error:'Alumno no encontrado.'});
     const reason=String(b.motivo||'Archivo escolar administrativo').trim();
     const {error:ae}=await adminClient.rpc('ithla_archivar_alumno',{p_alumno_id:id,p_tipo:'archivado',p_motivo:reason,p_usuario:user.id,p_ciclo:null});
     if(ae){
       const {error:fallback}=await adminClient.from('alumnos').update({activo:false,grupo_id:null,estado_escolar:'archivado',archivado_at:new Date().toISOString(),archivado_por:user.id,archivado_motivo:reason,archivado_tipo:'archivado'}).eq('id',id);
       if(fallback)throw fallback;
     }
     if(s.auth_user_id){try{await adminClient.auth.admin.updateUserById(s.auth_user_id,{ban_duration:'876000h'});}catch{};const {error:pp}=await adminClient.from('perfiles').update({activo:false}).eq('id',s.auth_user_id);if(pp)throw pp;}
     await audit(adminClient,{userId:user.id,role:profile.rol,action:'archivar_alumno',module:'archivo_escolar',entity:'alumnos',entityId:id,description:`Alumno ${s.nombre_completo||s.matricula||id} enviado al archivo escolar.`,before:{activo:s.activo,grupo_id:s.grupo_id,estado_escolar:s.estado_escolar},after:{activo:false,grupo_id:null,estado_escolar:'archivado'},req});
     return res.status(200).json({ok:true,message:`Alumno ${s.nombre_completo||s.matricula||id} fue enviado al Archivo Escolar. Su expediente histórico se conserva y ya no ocupa cupo.`});
   }
   const {data:t,error:te}=await adminClient.from('docentes').select('id,auth_user_id,nombre_completo,numero_empleado,activo').eq('id',id).maybeSingle();
   if(te||!t)return res.status(404).json({ok:false,error:'Docente no encontrado.'});
   const uid=t.auth_user_id;
   const {data:assigned}=await adminClient.from('asignaciones_docentes').select('id,grupo_materia_id,horas_asignadas,grupo_materias(grupos(clave,grado,letra),materias(nombre,clave,horas_semana))').eq('docente_id',id).eq('activo',true);
   const grupos_que_deja=[...(assigned||[])].map(a=>({asignacion_id:a.id,grupo:a.grupo_materias?.grupos?.clave||'—',materia:a.grupo_materias?.materias?.nombre||'—',clave_materia:a.grupo_materias?.materias?.clave||'—',horas:Number(a.horas_asignadas||a.grupo_materias?.materias?.horas_semana||0)}));
   const {data:activePeriod}=await adminClient.from('periodos_escolares').select('ciclo_escolar').eq('activo',true).order('id',{ascending:false}).limit(1).maybeSingle();
   const currentCycle=activePeriod?.ciclo_escolar||'2026-2027';
   const {data:scheduled,error:she}=await adminClient.from('horarios').select('id,dia_semana,hora_inicio,hora_fin,aula,grupo_materia_id,grupo_materias(grupos(clave),materias(nombre))').eq('docente_id',id).eq('ciclo_escolar',currentCycle);
   if(she && !String(she.message||'').toLowerCase().includes('does not exist'))throw she;
   const horarios_que_deja=(scheduled||[]).map(h=>({horario_id:h.id,grupo:h.grupo_materias?.grupos?.clave||'—',materia:h.grupo_materias?.materias?.nombre||'—',dia:h.dia_semana,hora_inicio:h.hora_inicio,hora_fin:h.hora_fin}));
   if(grupos_que_deja.length || horarios_que_deja.length){
     return res.status(409).json({ok:false,error:'No se puede enviar al docente al archivo mientras tenga horas, grupos o clases activas en el ciclo actual. Primero cubre y reasigna todas sus horas.',grupos_que_deben_reasignarse:grupos_que_deja,horarios_que_deben_reasignarse:horarios_que_deja});
   }
   const motivo=String(b.motivo||'Baja/archivo profesional').trim();
   const {error:de}=await adminClient.from('asignaciones_docentes').update({activo:false}).eq('docente_id',id).eq('activo',true);
   if(de)throw de;
   const {error:dt}=await adminClient.from('docentes').update({
     activo:false,
     estado_profesional:'archivado',
     archivado_at:new Date().toISOString(),
     archivado_por:user.id,
     archivado_motivo:motivo
   }).eq('id',id);
   if(dt)throw dt;
   if(uid){
     const {error:pp}=await adminClient.from('perfiles').update({activo:false}).eq('id',uid);if(pp)throw pp;
     try{await adminClient.auth.admin.updateUserById(uid,{ban_duration:'876000h'});}catch{}
   }
   await audit(adminClient,{userId:user.id,role:profile.rol,action:'archivar_docente',module:'archivo_escolar',entity:'docentes',entityId:id,description:`Docente ${t.nombre_completo||t.numero_empleado||id} enviado al archivo profesional.`,before:{activo:t.activo,estado_profesional:'activo'},after:{activo:false,estado_profesional:'archivado',archivado_motivo:motivo},req});
   return res.status(200).json({ok:true,message:`Docente ${t.nombre_completo||t.numero_empleado||id} fue enviado al Archivo Escolar. El historial académico y sus evidencias se conservan.`});
  }

  if(b.action==='set_user_status'){
   if(!['control_escolar','control'].includes(profile.rol))return res.status(403).json({ok:false,error:'Solo Control Escolar puede dar de baja o reactivar usuarios.'});
   const id=String(b.user_id||'').trim(); const activo=b.activo===true; if(!id)return res.status(400).json({ok:false,error:'Usuario no válido.'});
   if(id===String(user.id))return res.status(403).json({ok:false,error:'No puedes cambiar el estado de tu propia cuenta desde Usuarios.'});
   const {data:target,error:te}=await adminClient.from('perfiles').select('id,rol').eq('id',id).maybeSingle(); if(te||!target)return res.status(404).json({ok:false,error:'Usuario no encontrado.'});
   if(['direccion_escolar','control_escolar','control'].includes(target.rol))return res.status(403).json({ok:false,error:'Las cuentas de Dirección y Control Escolar requieren una operación administrativa especial.'});
   const {error:pe}=await adminClient.from('perfiles').update({activo}).eq('id',id); if(pe)throw pe;
   if(target.rol==='docente'){const {error:e}=await adminClient.from('docentes').update({activo}).eq('auth_user_id',id);if(e)throw e;}
   if(target.rol==='alumno'){const {error:e}=await adminClient.from('alumnos').update({activo}).eq('auth_user_id',id);if(e)throw e;}
   if(!activo) await adminClient.auth.admin.updateUserById(id,{ban_duration:'876000h'}); else await adminClient.auth.admin.updateUserById(id,{ban_duration:'none'});
   await audit(adminClient,{userId:user.id,role:profile.rol,action:activo?'reactivar_usuario':'dar_baja_usuario',module:'usuarios',entity:'perfiles',entityId:id,description:activo?'Usuario reactivado.':'Usuario dado de baja.',before:{activo:!activo,rol:target.rol},after:{activo,rol:target.rol}});
   return res.status(200).json({ok:true,message:activo?'Usuario reactivado.':'Usuario dado de baja.'});
  }
  if(b.action==='force_password_change'){
   const id=String(b.user_id||'').trim();if(!id)return res.status(400).json({ok:false,error:'Usuario no válido.'});
   if(id===String(user.id))return res.status(403).json({ok:false,error:'No puedes forzar el cambio de tu propia contraseña desde Usuarios.'});
   const {data:targetProfile,error:tp}=await adminClient.from('perfiles').select('id,rol,activo').eq('id',id).maybeSingle();if(tp||!targetProfile)return res.status(404).json({ok:false,error:'Usuario no encontrado.'});
   const allowed = profile.rol==='direccion_escolar' ||
     (['control_escolar','control'].includes(profile.rol) && !['direccion_escolar','control_escolar','control'].includes(targetProfile.rol)) ||
     (profile.rol==='servicios_estudiantiles' && targetProfile.rol==='alumno') ||
     (['servicios_docentes','coordinacion_academica'].includes(profile.rol) && targetProfile.rol==='docente');
   if(!allowed)return res.status(403).json({ok:false,error:'No tienes permisos para forzar el cambio de esta cuenta.'});
   if(!targetProfile.activo)return res.status(400).json({ok:false,error:'La cuenta está inactiva.'});
   const {data:u,error}=await adminClient.auth.admin.getUserById(id);if(error||!u?.user)return res.status(404).json({ok:false,error:'Usuario no encontrado.'});
   const {error:ue}=await adminClient.auth.admin.updateUserById(id,{user_metadata:{...(u.user.user_metadata||{}),must_change_password:true}});if(ue)throw ue;
   await audit(adminClient,{userId:user.id,role:profile.rol,action:'forzar_cambio_password',module:'usuarios',entity:'perfiles',entityId:id,description:'Se forzó cambio de contraseña en el siguiente inicio.',before:{must_change_password:u.user.user_metadata?.must_change_password||false},after:{must_change_password:true},req});
   return res.status(200).json({ok:true,message:'Se forzó el cambio de contraseña en el siguiente acceso.'});
  }
  if(b.action==='reset_password'){
   const id=String(b.user_id||'').trim();
   if(!id)return res.status(400).json({ok:false,error:'Usuario no válido.'});

   const {data:targetProfile,error:pe}=await adminClient
     .from('perfiles')
     .select('id,nombre_completo,correo,rol,activo,matricula,clave_docente')
     .eq('id',id)
     .maybeSingle();

   if(pe)throw pe;
   if(!targetProfile)return res.status(404).json({ok:false,error:'Perfil no encontrado.'});
   if(!targetProfile.activo)return res.status(400).json({ok:false,error:'La cuenta está inactiva.'});

   const caller=profile.rol;
   const target=targetProfile.rol;
   if(id===String(user.id)) return res.status(403).json({ok:false,error:'Para tu propia cuenta utiliza recuperación de contraseña; no uses el restablecimiento administrativo.'});
   if(['direccion_escolar','control_escolar','control'].includes(target) && caller!=='direccion_escolar') {
     return res.status(403).json({ok:false,error:'Las cuentas de Dirección y Control Escolar requieren una operación administrativa especial.'});
   }

   const callerCanResetAll=['direccion_escolar','control_escolar','control'].includes(caller);
   const callerCanResetTeacher=['servicios_docentes','coordinacion_academica'].includes(caller);
   const callerCanResetStudent=caller==='servicios_estudiantiles';

   const allowed =
     callerCanResetAll ||
     (callerCanResetTeacher && target==='docente') ||
     (callerCanResetStudent && target==='alumno');

   if(!allowed){
     return res.status(403).json({
       ok:false,
       error:'No tienes permisos para restablecer esta cuenta.'
     });
   }

   const {data:u,error:ue}=await adminClient.auth.admin.getUserById(id);
   if(ue||!u?.user)return res.status(404).json({ok:false,error:'La cuenta de acceso no existe.'});

   const password=tempPassword();
   const metadata={
     ...(u.user.user_metadata||{}),
     rol:target,
     must_change_password:true,
     login_email:targetProfile.correo
   };

   const {data:updated,error:ae}=await adminClient.auth.admin.updateUserById(id,{
     password,
     user_metadata:metadata
   });

   if(ae)throw ae;
   await audit(adminClient,{userId:user.id,role:profile.rol,action:'reset_password_admin',module:'usuarios',entity:'perfiles',entityId:id,description:'Se generó una nueva contraseña temporal administrativa.',after:{target_role:target,must_change_password:true}});

   return res.status(200).json({
     ok:true,
     message:'Acceso restablecido. La contraseña temporal debe cambiarse en el siguiente inicio de sesión.',
     account:{
       user_id:id,
       nombre_completo:targetProfile.nombre_completo,
       rol:target,
       email:targetProfile.correo || u.user.email || '',
       matricula:targetProfile.matricula || '',
       temporary_password:password,
       pdf_base64:await credentialsPdf({
         nombre_completo:targetProfile.nombre_completo,
         rol:target,
         matricula:targetProfile.matricula || '',
         email:targetProfile.correo || u.user.email || '',
         temporary_password:password,
         admin:adminClient
       })
     }
   });
  }
  if(b.action==='provision_student'){
   if(!['direccion_escolar','control_escolar','control'].includes(profile.rol))return res.status(403).json({ok:false,error:'Solo administración escolar puede crear accesos de alumnos.'});
   const id=Number(b.alumno_id);if(!id)return res.status(400).json({ok:false,error:'Alumno no válido.'});
   const {data:a,error:ae}=await adminClient.from('alumnos').select('id,auth_user_id,matricula,nombre_completo,activo').eq('id',id).maybeSingle();if(ae||!a)throw Object.assign(new Error(ae?.message||'Alumno no encontrado.'),{status:404});
   if(a.auth_user_id)return res.status(200).json({ok:true,account:{created:false,linked:true,mensaje:'El alumno ya tiene una cuenta vinculada.'}});
   if(!a.matricula)return res.status(400).json({ok:false,error:'El alumno no tiene matrícula.'});
   const matriculaLimpia=String(a.matricula||'').replace(/\s+/g,'').toLowerCase();
   const email=`${matriculaLimpia}@${institutionDomain}`;const password=tempPassword();let u=await findUser(adminClient,email);let created=false;
   if(!u){const {data,error}=await adminClient.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{rol:'alumno',matricula:a.matricula,must_change_password:true}});if(error)throw error;u=data.user;created=true;}
   const {error:pe}=await adminClient.from('perfiles').upsert({id:u.id,nombre_completo:a.nombre_completo,correo:email,rol:'alumno',activo:true},{onConflict:'id'});if(pe)throw pe;
   const {error:le}=await adminClient.from('alumnos').update({auth_user_id:u.id}).eq('id',id);if(le)throw le;
   return res.status(200).json({ok:true,account:{user_id:u.id,email,temporary_password:created?password:null,created,rol:'alumno',matricula:a.matricula,nombre_completo:a.nombre_completo,pdf_base64:created?await credentialsPdf({nombre_completo:a.nombre_completo,rol:'alumno',matricula:a.matricula,email,temporary_password:password,admin:adminClient}):null,mensaje:created?'Cuenta creada.':'Cuenta vinculada.'}});
  }
  const rol=String(b.rol||'').trim();const nombre=String(b.nombre_completo||'').trim();let email=String(b.email||'').trim().toLowerCase();if(!nombre||!rol)return res.status(400).json({ok:false,error:'Nombre y rol son obligatorios.'});
  // Las cuentas institucionales de departamentos se crean por Control Escolar.
  // Dirección Escolar administra los departamentos y a sus responsables, pero no
  // crea directamente cuentas de acceso; así evitamos que la creación de
  // privilegios dependa de una sola persona. Recursos Monetarios sigue esta
  // misma regla y conserva una sola cuenta institucional activa.
  if(departmentRoles.includes(rol)){
    if(!['control_escolar','control'].includes(profile.rol))return res.status(403).json({ok:false,error:'Solo Control Escolar puede crear cuentas institucionales de departamentos.'});
  } else if(rol==='docente' && ['servicios_docentes','control_escolar','control'].includes(profile.rol)){}
  else if(!['control_escolar','control'].includes(profile.rol))return res.status(403).json({ok:false,error:'Este departamento no puede crear este tipo de cuenta.'});
  if(!['docente','alumno',...departmentRoles].includes(rol))return res.status(400).json({ok:false,error:'Rol no permitido.'});
  const requestedDept=departmentKeyForRole(rol);
  if(requestedDept){
   const accountRoles=requestedDept==='CE'?['control_escolar','control']:requestedDept==='DIR'?['direccion_escolar']:requestedDept==='SD'?['servicios_docentes']:requestedDept==='SE'?['servicios_estudiantiles']:requestedDept==='PRE'?['prefectura']:requestedDept==='CA'?['coordinacion_academica']:requestedDept==='AE'?['archivo_escolar']:['recursos_monetarios'];
   const {data:existing,error:ee}=await adminClient.from('perfiles').select('id').in('rol',accountRoles).eq('activo',true).limit(1);
   if(ee)throw ee;
   if(existing?.length)return res.status(409).json({ok:false,error:'Este departamento ya tiene una cuenta institucional. Para cambiar al encargado, usa “Encargados departamentales”; no se crea otra cuenta.'});
  }
  if(rol==='alumno'){const mat=String(b.matricula||'').trim();if(!mat)return res.status(400).json({ok:false,error:'La matrícula es obligatoria para el alumno.'});email=`${mat.replace(/\s+/g,'').toLowerCase()}@${institutionDomain}`;}
  if(rol==='docente') email=docenteEmail(nombre,institutionDomain);
  if(rol==='docente' && email){const base=email.replace(new RegExp(`@${institutionDomain.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`,'i'),'');let candidate=email;let n=2;while(await findUser(adminClient,candidate)){candidate=`${base}${n}@${institutionDomain}`;n++;}email=candidate;}
  if(!email)return res.status(400).json({ok:false,error:'Correo obligatorio.'});
  const password=tempPassword();const {data:created,error}=await adminClient.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{rol,must_change_password:true,login_email:email}});if(error)throw error;const id=created.user.id;
  const {error:pe}=await adminClient.from('perfiles').insert({id,nombre_completo:nombre,correo:email,rol,activo:true,matricula:rol==='alumno'?(b.matricula||null):null,clave_docente:rol==='docente'?(b.numero_empleado||null):null});if(pe){await adminClient.auth.admin.deleteUser(id);throw pe;}
  if(departmentKeyForRole(rol)){const dep=await getDepartmentByKey(adminClient,departmentKeyForRole(rol));if(dep){if(b.es_director===true){const {error:de}=await adminClient.from('responsables_departamento').update({es_director:false}).eq('departamento_id',dep.id).eq('es_director',true);if(de){await adminClient.from('perfiles').delete().eq('id',id);await adminClient.auth.admin.deleteUser(id);throw de;}}const {error:re}=await adminClient.from('responsables_departamento').upsert({departamento_id:dep.id,usuario_id:id,cargo:String(b.cargo||'').trim()||`Responsable de ${dep.nombre}`,es_director:b.es_director===true,activo:true},{onConflict:'departamento_id,usuario_id'});if(re){await adminClient.from('perfiles').delete().eq('id',id);await adminClient.auth.admin.deleteUser(id);throw re;}}}
  let ce=null;
  if(rol==='docente')ce=(await adminClient.from('docentes').insert({auth_user_id:id,nombre_completo:nombre,correo:email,numero_empleado:b.numero_empleado||null,clave_docente:b.numero_empleado||null,especialidad:b.especialidad||null,horas_solicitadas:Number(b.horas_solicitadas||0),activo:true}).select('id').maybeSingle()).error;
  if(rol==='alumno')ce=(await adminClient.from('alumnos').insert({auth_user_id:id,nombre_completo:nombre,matricula:b.matricula,grupo_id:b.grupo_id||null,activo:true}).select('id').maybeSingle()).error;
  if(ce){await adminClient.from('perfiles').delete().eq('id',id);await adminClient.auth.admin.deleteUser(id);throw ce;}
  return res.status(200).json({ok:true,user_id:id,email,temporary_password:password,rol,matricula:b.matricula||'',pdf_base64:await credentialsPdf({nombre_completo:nombre,rol,matricula:b.matricula||'',email,temporary_password:password,admin:adminClient})});
 }catch(e){return res.status(e.status||500).json({ok:false,error:e.message||'Error interno.'});}
}
function docenteEmail(nombre,domain='ithla.edu.mx'){
  const clean=String(nombre||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z\s]/g,' ').trim().split(/\s+/).filter(Boolean);
  if(clean.length<3)return '';
  const base=`${clean[0].slice(0,3)}${clean[1].slice(0,2)}${clean[2].slice(0,2)}`.toLowerCase();
  return `${base}.docente@${domain}`;
}
