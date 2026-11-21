/* Jaguar 360 V53. Clasificaciones y reservas, nunca transferencia automática de la titularidad. */
import {ROLES_POOL,TYPES,MODES,cycleValid,id,isActive,summary,canNominate} from '../lib/jaguar_teacher_pool_v53.js';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const str=(v,n=600)=>String(v??'').trim().slice(0,n);
async function read(p){const {data,error}=await p;if(error)throw fail(['42P01','PGRST205'].includes(error.code)?'Primero instala la migración V53 de bolsa docente.':'No se pudo consultar la bolsa docente.',503);return data;}
function checkOrigin(req){const origin=req.headers?.origin,host=req.headers?.['x-forwarded-host']||req.headers?.host;try{if(!origin||!host||new URL(origin).host!==host)throw Error();}catch{throw fail('Origen de solicitud no autorizado.',403);}}
async function currentCycle(db){const rows=await read(db.from('periodos_escolares').select('ciclo_escolar,es_periodo_actual').eq('es_periodo_actual',true).limit(10));const cycles=[...new Set(rows.map(r=>r.ciclo_escolar).filter(cycleValid))];if(cycles.length!==1)throw fail('No se pudo determinar un único ciclo vigente.',409);return cycles[0];}
async function getAll(db,cycle,full,teacherId){
 const teachers=full?await read(db.from('docentes').select('id,nombre_completo,especialidad,activo,estado_profesional,suspension_fecha,horas_solicitadas,horas_asignadas').order('nombre_completo').limit(2000)):await read(db.from('docentes').select('id,nombre_completo,especialidad,activo,estado_profesional,suspension_fecha,horas_solicitadas,horas_asignadas').eq('id',teacherId).limit(1));
 const [pools,candidates]=await Promise.all([
  read(full?db.from('jaguar_docente_bolsa_v53').select('*').eq('ciclo',cycle).limit(2000):db.from('jaguar_docente_bolsa_v53').select('*').eq('ciclo',cycle).eq('docente_id',teacherId).limit(1)),
  read(full?db.from('jaguar_docente_candidaturas_v53').select('*').eq('ciclo',cycle).limit(4000):db.from('jaguar_docente_candidaturas_v53').select('*').eq('ciclo',cycle).eq('docente_id',teacherId).limit(250))
 ]);
 if(!full)return {teachers,pools,candidates,lessons:[],loads:[],totals:{teachers:teachers.length,pool:pools.filter(x=>x.estado==='aprobado').length,candidates:candidates.filter(x=>x.estado==='vigente').length},subjects:[]};
 const [gms,as,hours]=await Promise.all([
  read(db.from('grupo_materias').select('id,grupo_id,materia_id,activo,horas_semana,grupos(id,clave,activo),materias(id,nombre,horas_semana,activa)').eq('activo',true).limit(3000)),
  read(db.from('asignaciones_docentes').select('id,docente_id,grupo_materia_id,horas_asignadas,ciclo_escolar,activo').eq('ciclo_escolar',cycle).eq('activo',true).limit(4000)),
  read(db.from('horarios').select('id,grupo_materia_id,docente_id,dia_semana,hora_inicio,hora_fin,ciclo_escolar').eq('ciclo_escolar',cycle).limit(6000))
 ]);
 const sums=summary({groupSubjects:gms,assignments:as,schedules:hours,teachers,pools,candidates});
 return {...sums,teachers,pools,candidates,subjects:gms,assignments:as,warning:hours.length>=6000||gms.length>=3000||as.length>=4000?'Se alcanzó el límite de consulta; verificar cifras antes de asignar.':null};
}
export async function teacherPoolV53(req,res,{user,profile,adminClient:db}){
 const b=req.body||{},q=req.query||{};
 if(!(req.method==='GET'&&q.mode==='bolsa_v53')&&!(req.method==='POST'&&b.action?.startsWith('bolsa_v53_')))return false;
 const manager=ROLES_POOL.includes(profile.rol);
 if(!manager&&profile.rol!=='docente')throw fail('Perfil no autorizado.',403);
 const cycle=await currentCycle(db);
 const own=profile.rol==='docente'?await read(db.from('docentes').select('id,activo,estado_profesional,suspension_fecha').eq('auth_user_id',user.id).maybeSingle()):null;
 if(profile.rol==='docente'&&!own)throw fail('No tienes ficha de docente vinculada.',403);
 if(req.method==='GET')return res.status(200).json({ok:true,data:{cycle,role:profile.rol,own_id:own?.id||null,...await getAll(db,cycle,manager,own?.id)}}),true;
 checkOrigin(req);
 if(b.ciclo!==cycle)throw fail('El ciclo cambió. Recarga la vista antes de guardar.',409);
 const action=b.action;
 const teacherId=profile.rol==='docente'?id(own.id):id(b.docente_id);
 if(!teacherId)throw fail('Selecciona un docente.',400);
 const t=await read(db.from('docentes').select('id,activo,estado_profesional,suspension_fecha').eq('id',teacherId).maybeSingle());
 if(!isActive(t))throw fail('El docente está inactivo o suspendido.',409);
 if(action==='bolsa_v53_solicitar'){
  if(!['docente','servicios_docentes','direccion_escolar'].includes(profile.rol))throw fail('Sólo el docente o Servicios Docentes pueden proponer la incorporación.',403);
  const modalidad=str(b.modalidad,30);if(!MODES.includes(modalidad))throw fail('Modalidad inválida.');
  const rec=b.recuperacion===true,rc=b.recursamiento===true,su=b.suplencia===true;
  if(!rec&&!rc&&!su)throw fail('Selecciona al menos un tipo de atención.');
  if(modalidad==='regularizacion'&&(su||(!rec&&!rc)))throw fail('Regularización sólo admite recuperación y/o recursamiento.');
  if(modalidad==='reserva'&&(!su||rec||rc))throw fail('Reserva exclusiva requiere suplencia sin actividades de regularización.');
  if(modalidad==='mixto'&&(!su||(!rec&&!rc)))throw fail('Modalidad mixta requiere suplencia y al menos una regularización.');
  const max=Number(b.horas_max_semanales);if(!Number.isInteger(max)||max<1||max>60)throw fail('Indica un máximo de 1 a 60 horas semanales.');
  const materias=Array.isArray(b.materias_ids)?[...new Set(b.materias_ids.map(id))]:[];
  if(materias.length>40||materias.some(x=>!x))throw fail('Materias de especialidad inválidas.');
  if(materias.length){const found=await read(db.from('materias').select('id').in('id',materias).eq('activa',true).limit(40));if(found.length!==materias.length)throw fail('Existe una materia inactiva o desconocida.',409);}
  const before=await read(db.from('jaguar_docente_bolsa_v53').select('estado').eq('ciclo',cycle).eq('docente_id',teacherId).maybeSingle());
  if(before?.estado==='aprobado'&&profile.rol==='docente')throw fail('La ficha ya está aprobada. Solicita cambios a Servicios Docentes.',409);
  await read(db.from('jaguar_docente_bolsa_v53').upsert({ciclo:cycle,docente_id:teacherId,modalidad,recuperacion:rec,recursamiento:rc,suplencia:su,horas_max_semanales:max,materias_ids:materias,observaciones:str(b.observaciones,700),estado:'solicitado',solicitado_por:user.id,aprobado_por:null,actualizado_en:new Date().toISOString()},{onConflict:'ciclo,docente_id'}).select('docente_id').single());
  return res.status(200).json({ok:true,data:{estado:'solicitado'},message:'Solicitud guardada para revisión.'}),true;
 }
 if(action==='bolsa_v53_resolver'){
  if(!['servicios_docentes','direccion_escolar'].includes(profile.rol))throw fail('Sólo Servicios Docentes o Dirección autorizan perfiles de apoyo.',403);
  const estado=str(b.estado,30);if(!['aprobado','rechazado','suspendido'].includes(estado))throw fail('Decisión inválida.');
  const current=await read(db.from('jaguar_docente_bolsa_v53').select('docente_id,estado').eq('ciclo',cycle).eq('docente_id',teacherId).maybeSingle());if(!current)throw fail('El docente aún no tiene una solicitud.',404);
  if(estado==='aprobado'&&current.estado!=='solicitado')throw fail('Sólo se aprueban solicitudes pendientes.',409);
  await read(db.from('jaguar_docente_bolsa_v53').update({estado,aprobado_por:estado==='aprobado'?user.id:null,actualizado_en:new Date().toISOString()}).eq('ciclo',cycle).eq('docente_id',teacherId).select('docente_id').single());
  if(estado!=='aprobado')await read(db.from('jaguar_docente_candidaturas_v53').update({estado:'retirada',actualizado_en:new Date().toISOString()}).eq('ciclo',cycle).eq('docente_id',teacherId).eq('estado','vigente').select('id'));
  return res.status(200).json({ok:true,data:{estado}}),true;
 }
 if(action==='bolsa_v53_candidato'){
  if(!['coordinacion_academica','direccion_escolar'].includes(profile.rol))throw fail('Sólo Coordinación o Dirección confirman candidatos.',403);
  const gmId=id(b.grupo_materia_id),tipo=str(b.tipo,30),prioridad=Number(b.prioridad);
  if(!TYPES.includes(tipo)||!Number.isInteger(prioridad)||prioridad<1||prioridad>5||!gmId)throw fail('Materia, tipo o prioridad inválidos.');
  const [pool,gm,assignments]=await Promise.all([
   read(db.from('jaguar_docente_bolsa_v53').select('*').eq('ciclo',cycle).eq('docente_id',teacherId).maybeSingle()),
   read(db.from('grupo_materias').select('id,materia_id,activo,materias(id,activa)').eq('id',gmId).maybeSingle()),
   read(db.from('asignaciones_docentes').select('grupo_materia_id,docente_id,activo').eq('ciclo_escolar',cycle).eq('grupo_materia_id',gmId).eq('activo',true).limit(15))
  ]);
  const issue=canNominate({teacher:t,pool,groupSubject:gm,assignments,type:tipo});if(issue)throw fail(issue,409);
  const others=await read(db.from('jaguar_docente_candidaturas_v53').select('id,docente_id').eq('ciclo',cycle).eq('grupo_materia_id',gmId).eq('tipo',tipo).eq('prioridad',prioridad).eq('estado','vigente').limit(2));
  if(others.some(x=>id(x.docente_id)!==teacherId))throw fail('La prioridad ya corresponde a otro docente. Retira o cambia la candidatura.',409);
  await read(db.from('jaguar_docente_candidaturas_v53').upsert({ciclo:cycle,grupo_materia_id:gmId,docente_id:teacherId,tipo,prioridad,estado:'vigente',observaciones:str(b.observaciones,400),registrado_por:user.id,actualizado_en:new Date().toISOString()},{onConflict:'ciclo,grupo_materia_id,docente_id,tipo'}).select('id').single());
  return res.status(200).json({ok:true,data:{estado:'vigente'}}),true;
 }
 if(action==='bolsa_v53_retirar'){
  if(!['coordinacion_academica','direccion_escolar'].includes(profile.rol))throw fail('Sólo Coordinación o Dirección retiran candidatos.',403);
  const cid=id(b.candidatura_id);if(!cid)throw fail('Selecciona una candidatura.');
  const current=await read(db.from('jaguar_docente_candidaturas_v53').select('id').eq('id',cid).eq('ciclo',cycle).eq('docente_id',teacherId).eq('estado','vigente').maybeSingle());if(!current)throw fail('Candidatura no vigente.',404);
  await read(db.from('jaguar_docente_candidaturas_v53').update({estado:'retirada',actualizado_en:new Date().toISOString()}).eq('id',cid).eq('ciclo',cycle).select('id').single());
  return res.status(200).json({ok:true,data:{estado:'retirada'}}),true;
 }
 throw fail('Acción desconocida.');
}
