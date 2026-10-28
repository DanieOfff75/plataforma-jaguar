/** Jaguar 360: tablero contextual y solicitudes estudiantiles presenciales.
 * No genera ni entrega documentos privados. No confía en rol/alumno enviado por navegador.
 */
import {requireRoles} from '../lib/_admin.js';
import {ALL_ROLES,DESK_ROLES,REQUEST_TYPES,validRequest,OPEN_STATES,canView} from '../lib/jaguar360_rules.js';
const fail=(code,message)=>Object.assign(new Error(message),{status:code});
async function read(p){const {data,error}=await p;if(error){if(error.code==='42P01'||error.code==='PGRST202')throw fail(503,'Jaguar 360 necesita instalar su migración SQL.');throw fail(500,'No se pudo completar la consulta institucional.');}return data;}
const trim=(v,max)=>String(v??'').trim().slice(0,max);
const isUuid=(s)=>/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(String(s||''));
async function writeRpc(p){const {data,error}=await p;if(error){if(error.code==='P0001')throw fail(409,error.message);if(error.code==='PGRST202'||error.code==='42P01')throw fail(503,'Primero instala la migración de Jaguar 360.');throw fail(500,'No se pudo completar el cambio.');}return data;}
const publicFields='id,folio,tipo,departamento,asunto,estado,comentario_publico,created_at,updated_at,cerrado_at';
const privateFields=publicFields+',detalle';
async function ownStudent(db,userId){
 const st=await read(db.from('alumnos').select('id,activo,suspension_fecha,suspension_hasta').eq('auth_user_id',userId).maybeSingle());
 if(!st||!st.activo)throw fail(403,'Tu cuenta no tiene un alumno activo vinculado. Comunícate con Control Escolar.');
 if(st.suspension_fecha && (!st.suspension_hasta||new Date(st.suspension_hasta)>new Date()))throw fail(403,'Tu acceso escolar está suspendido. Utiliza la revisión de acceso disponible.');
 return st;
}
async function list(db,user,role,mode){
 let query=db.from('jaguar360_solicitudes').select(['alumno','direccion_escolar'].includes(role)?publicFields:privateFields).order('created_at',{ascending:false}).limit(mode==='dashboard'?8:120);
 if(role==='alumno'){
  const st=await ownStudent(db,user.id);
  query=query.eq('alumno_id',st.id).eq('solicitante_id',user.id);
 }else if(role==='control')query=query.eq('departamento','control_escolar');
 else if(role!=='direccion_escolar')query=query.eq('departamento',role);
 return read(query);
}
async function insights(db,user,role){
 const items=[];
 const add=async(label,table,filters,page)=>{
  let q=db.from(table).select('id',{count:'exact',head:true});
  for(const [name,value] of filters){q=name==='estado_in'?q.in('estado',value):q.eq(name,value)}
  const {count,error}=await q;
  if(!error&&Number.isFinite(count))items.push({label,value:count,page});
 };
 try{
  if(role==='docente'){
   const teacher=await read(db.from('docentes').select('id').eq('auth_user_id',user.id).maybeSingle());
   if(teacher){await add('Planeaciones pendientes','planeaciones_docentes',[['docente_id',teacher.id],['estado_in',['borrador','enviada','devuelta']]],'planeaciones');
     await add('Grupos asignados','asignaciones_docentes',[['docente_id',teacher.id],['activo',true]],'grupos');}
  } else if(role==='alumno'){
   const st=await ownStudent(db,user.id);
   await add('Evaluaciones registradas','calificaciones',[['alumno_id',st.id]],'calificaciones');
   await add('Asistencias registradas','asistencias',[['alumno_id',st.id]],'asistencia');
  } else if(['direccion_escolar','coordinacion_academica'].includes(role)){
   await add('Planeaciones por revisar','planeaciones_docentes',[['estado','enviada']],'planeaciones');
   await add('Materias sin titular','jaguar_vacantes_docentes',[['estado','pendiente']],'relevos_docentes');
  } else if(role==='servicios_docentes'){
   await add('Vacantes por cubrir','jaguar_vacantes_docentes',[['estado','pendiente']],'relevos_docentes');
  } else if(role==='archivo_escolar'){
   await add('Solicitudes de archivo pendientes','solicitudes_archivo_escolar',[['estado','pendiente']],'archivo');
  } else if(role==='recursos_monetarios'){
   await add('Egresos pendientes','recursos_egresos',[['estado','pendiente_aprobacion']],'recursos_monetarios');
  }
 }catch{ /* No bloquear el tablero si un módulo opcional todavía no está instalado */ }
 return items;
}
async function checks(db){
 const start=Date.now();
 const r=await Promise.allSettled([
  db.from('periodos_escolares').select('id').limit(1),
  db.from('jaguar360_solicitudes').select('id').limit(1)
 ]);
 const names=['Sistema académico','Solicitudes 360'];
 return r.map((item,i)=>({name:names[i],ok:item.status==='fulfilled'&&!item.value.error,latency_ms:Date.now()-start}));
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 try{
  const {user,profile,adminClient:db}=await requireRoles(req,ALL_ROLES);
  const role=profile.rol;
  if(req.method==='GET'){
   const mode=trim(req.query?.mode||'list',30);
   if(mode==='history'){
    if(!isUuid(req.query?.id))throw fail(400,'Solicitud inválida');
    const sol=await read(db.from('jaguar360_solicitudes').select('id,alumno_id,solicitante_id,departamento').eq('id',req.query.id).maybeSingle());
    if(!sol||!canView(role,sol,user.id))throw fail(403,'No tienes autorización para consultar este historial.');
    if(role==='alumno'){
      const st=await ownStudent(db,user.id);
      if(st.id!==sol.alumno_id)throw fail(403,'Solicitud fuera de tu expediente');
    }
    const events=await read(db.from('jaguar360_solicitud_eventos').select('estado_anterior,estado_nuevo,descripcion,created_at').eq('solicitud_id',sol.id).order('created_at',{ascending:true}).limit(60));
    return res.status(200).json({ok:true,data:{events}});
   }
   if(mode==='catalog')return res.status(200).json({ok:true,data:{types:role==='alumno'?REQUEST_TYPES:[],role}});
   if(mode==='health'){
    if(!['direccion_escolar','control_escolar','control'].includes(role))throw fail(403,'Solo áreas de supervisión pueden ver el estado técnico.');
    return res.status(200).json({ok:true,data:{checks:await checks(db),checked_at:new Date().toISOString(),note:'Comprobaciones básicas de base de datos, no disponibilidad de terceros.'}});
   }
   if(mode!=='list'&&mode!=='dashboard')throw fail(400,'Consulta no reconocida');
   if(role!=='alumno'&&role!=='direccion_escolar'&&!DESK_ROLES.includes(role)){
    return res.status(200).json({ok:true,data:{rows:[],role,scope:'perfil',summary:{total:0,open:0,ready:0},insights:mode==='dashboard'?await insights(db,user,role):[]}});
   }
   const rows=await list(db,user,role,mode);
   const output=rows.map(r=>role==='alumno'?r:({...r,nota_interna:undefined}));
   return res.status(200).json({ok:true,data:{rows:output,role,scope:role==='alumno'?'mias':role==='direccion_escolar'?'supervision':'departamento',summary:{total:rows.length,open:rows.filter(x=>OPEN_STATES.includes(x.estado)).length,ready:rows.filter(x=>x.estado==='lista_para_recoger').length},insights:mode==='dashboard'?await insights(db,user,role):[]}});
  }
  if(req.method!=='POST')throw fail(405,'Método no permitido');
  const body=req.body&&typeof req.body==='object'?req.body:{};
  if(body.action==='create'){
   if(role!=='alumno')throw fail(403,'Solo estudiantes pueden solicitar trámites desde este módulo.');
   await ownStudent(db,user.id);
   const tipo=trim(body.tipo,50),asunto=trim(body.asunto,140),detalle=trim(body.detalle,1500);
   if(!validRequest(tipo,asunto,detalle))throw fail(400,'Elige un trámite y escribe un asunto entre 6 y 140 caracteres.');
   const created=await writeRpc(db.rpc('jaguar360_crear_solicitud',{p_actor:user.id,p_tipo:tipo,p_asunto:asunto,p_detalle:detalle}));
   return res.status(201).json({ok:true,data:created,message:'Solicitud registrada. La documentación privada se entrega únicamente en persona.'});
  }
  if(body.action==='status'){
   if(!isUuid(body.id))throw fail(400,'Solicitud inválida');
   const next=trim(body.estado,40),comment=trim(body.comentario,700);
   if(!['en_revision','requiere_aclaracion','lista_para_recoger','entregada','rechazada','cancelada'].includes(next))throw fail(400,'Estado inválido');
   // Transiciones, bloqueos concurrentes, permisos y evento de auditoría se ejecutan juntos en SQL.
   const changed=await writeRpc(db.rpc('jaguar360_cambiar_estado',{p_actor:user.id,p_id:body.id,p_estado:next,p_comentario:comment}));
   return res.status(200).json({ok:true,data:changed});
  }
  throw fail(400,'Acción no reconocida');
 }catch(e){const status=e.status||((e.code==='PGRST202'||e.code==='42P01')?503:500);
  // No revelar nombres de tablas ni datos personales de Supabase a usuarios.
  const safe=status===500?'La operación no pudo completarse. Consulta el registro del servidor.':status===503?'Falta configurar Jaguar 360 o no está disponible.':e.message;
  return res.status(status).json({ok:false,error:safe});
 }
}
