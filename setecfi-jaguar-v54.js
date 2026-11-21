// Jaguar V54: solicitud -> Direccion Escolar -> resolucion independiente Portal SETECFI.
const MANAGERS=new Set(['direccion_escolar','servicios_docentes','coordinacion_academica','control_escolar']);
const TYPES=new Set(['alta_docente','baja_docente','permiso_docente','reingreso_docente','suplencia_docente','alta_direccion','baja_direccion','permiso_direccion']);
const fail=(msg,status=400)=>Object.assign(Error(msg),{status});
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)?v:null;
const nat=n=>Number.isSafeInteger(Number(n))&&Number(n)>0?Number(n):null;
const cut=(s,n=2000)=>String(s??'').trim().slice(0,n);
const checkOrigin=req=>{const host=req.headers?.['x-forwarded-host']||req.headers?.host,origin=req.headers?.origin;try{if(!origin||new URL(origin).host!==host)throw Error();}catch{throw fail('Origen de peticion invalido.',403);}};
async function read(query){const {data,error}=await query;if(error)throw fail(['42P01','PGRST205'].includes(error.code)?'Instala primero el SQL de Portal SETECFI V54.':'No se pudo consultar el expediente.',503);return data;}
async function cycle(db){const p=await read(db.from('periodos_escolares').select('ciclo_escolar').eq('es_periodo_actual',true).limit(10));const unique=[...new Set(p.map(x=>x.ciclo_escolar))];if(unique.length!==1)throw fail('No se encuentra un ciclo escolar vigente unico.',409);return unique[0];}
export async function setecfiJaguarV54(req,res,{user,profile,adminClient:db}){
 const query=req.query||{},body=req.body||{};
 if(!(req.method==='GET'&&query.mode==='setecfi_v54')&&!(req.method==='POST'&&/^setecfi_v5[47]_/.test(String(body.action||''))))return false;
 const role=profile.rol,manager=MANAGERS.has(role);
 if(!manager&&role!=='docente')throw fail('Acceso no autorizado.',403);
 const active=await cycle(db);
 if(req.method==='GET'){
  const q=db.from('setecfi_expedientes_v54').select('id,tipo,persona_nombre,persona_correo,docente_id,persona_auth_id,ciclo,motivo,materias_propuestas,fecha_inicio,fecha_fin,estado_direccion,direccion_motivo,direccion_en,estado_setecfi,setecfi_motivo,vigencia_hasta,folio,creado_en,solicitado_por,aplicado_en').order('creado_en',{ascending:false}).limit(150);
  if(!manager)q.eq('solicitado_por',user.id);
  const [cases,teachers]=await Promise.all([read(q),manager?read(db.from('docentes').select('id,nombre_completo,correo,auth_user_id,activo').order('nombre_completo').limit(1200)):read(db.from('docentes').select('id,nombre_completo,correo,auth_user_id,activo').eq('auth_user_id',user.id).limit(1))]);
  let vacancies=[],subjects=[];
  if(manager){
   [vacancies,subjects]=await Promise.all([
    read(db.from('setecfi_vacantes_v57').select('id,ciclo,materia_id,solicitado_por,creado_en,estado_direccion,direccion_motivo,estado_setecfi,expediente_id').order('creado_en',{ascending:false}).limit(160)),
    read(db.from('materias').select('id,nombre,clave,activa').eq('activa',true).order('nombre').limit(500))
   ]);
  }
  // Una identidad se revela a ITHLA únicamente después del dictamen favorable de SETECFI.
  const issued=vacancies.filter(v=>v.estado_setecfi==='aprobada'&&v.expediente_id).map(v=>v.expediente_id);
  if(issued.length){
   const people=await read(db.from('setecfi_expedientes_v54').select('id,persona_nombre,persona_correo,folio,vigencia_hasta,estado_setecfi').in('id',issued).eq('estado_setecfi','aprobado').limit(160));
   const names=new Map(people.map(x=>[x.id,x]));
   vacancies=vacancies.map(v=>({...v,resolucion:names.get(v.expediente_id)||null}));
  }
  return res.status(200).json({ok:true,data:{cycle:active,role,cases,teachers,vacancies,subjects}}),true;
 }
 checkOrigin(req);
 if(body.action==='setecfi_v57_solicitar_vacante'){
  if(role!=='servicios_docentes')throw fail('Sólo Servicios Docentes puede solicitar cobertura sin candidato.',403);
  const materiaId=nat(body.materia_id);if(!materiaId)throw fail('Selecciona una materia oficial.',400);
  const saved=await read(db.rpc('setecfi_solicitar_vacante_v57',{p_actor:user.id,p_ciclo:active,p_materia:materiaId}));
  return res.status(200).json({ok:true,data:{id:saved.id,estado_direccion:saved.estado_direccion},message:'Solicitud de materia enviada a Dirección Escolar, sin datos de ningún candidato.'}),true;
 }
 if(body.action==='setecfi_v57_direccion_vacante'){
  if(role!=='direccion_escolar')throw fail('Sólo Dirección Escolar puede revisar vacantes.',403);
  const xid=uuid(body.id),decision=cut(body.decision,20),motivo=cut(body.motivo,1200);
  if(!xid||!['aprobado','rechazado'].includes(decision)||motivo.length<15)throw fail('Revisión incompleta.');
  const saved=await read(db.rpc('setecfi_direccion_vacante_v57',{p_id:xid,p_actor:user.id,p_decision:decision,p_motivo:motivo}));
  return res.status(200).json({ok:true,data:{id:saved.id,estado_direccion:saved.estado_direccion},message:'Revisión de vacante registrada.'}),true;
 }
 if(body.action==='setecfi_v54_solicitar'){
  const tipo=cut(body.tipo,40),docenteId=nat(body.docente_id),target=uuid(body.persona_auth_id),motivo=cut(body.motivo),nombre=cut(body.persona_nombre,160),correo=cut(body.persona_correo,180),materias=Array.isArray(body.materias)?body.materias.slice(0,30).map(x=>cut(x,90)).filter(Boolean):[];
  if(tipo==='alta_docente')throw fail('Para altas nuevas solicita una vacante por materia sin identificar candidato.',409);
  if(!TYPES.has(tipo)||motivo.length<15||nombre.length<5)throw fail('Indica tipo, nombre y motivo (minimo 15 caracteres).');
  if(role==='docente'&&tipo!=='permiso_docente')throw fail('Un docente solo puede solicitar su permiso.',403);
  if(tipo.endsWith('_direccion')&&!['servicios_docentes','coordinacion_academica','control_escolar'].includes(role))throw fail('El tramite de Direccion debe prepararse independientemente.',403);
  if(docenteId){const doc=await read(db.from('docentes').select('id,auth_user_id,nombre_completo,correo').eq('id',docenteId).maybeSingle());if(!doc||role==='docente'&&doc.auth_user_id!==user.id)throw fail('Docente no autorizado.',403);if(doc.nombre_completo.trim().toLowerCase()!==nombre.toLowerCase())throw fail('El nombre debe coincidir con la ficha docente.',409);}
  const params={p_actor:user.id,p_tipo:tipo,p_nombre:nombre,p_correo:correo||null,p_docente:docenteId,p_persona:target,p_ciclo:active,p_motivo:motivo,p_materias:materias,p_inicio:body.fecha_inicio||null,p_fin:body.fecha_fin||null};
  const saved=await read(db.rpc('setecfi_solicitar_v54',params));return res.status(200).json({ok:true,data:{id:saved.id,estado_direccion:saved.estado_direccion},message:'Enviado a revision de Direccion Escolar.'}),true;
 }
 if(body.action==='setecfi_v54_direccion'){
  if(role!=='direccion_escolar')throw fail('Solo Direccion Escolar resuelve la primera etapa.',403);
  const expediente=uuid(body.id),decision=cut(body.decision,20),motivo=cut(body.motivo,1200);
  if(!expediente||!['aprobado','rechazado'].includes(decision)||motivo.length<15)throw fail('Revision incompleta.');
  const saved=await read(db.rpc('setecfi_direccion_decidir_v54',{p_id:expediente,p_actor:user.id,p_decision:decision,p_motivo:motivo}));
  return res.status(200).json({ok:true,data:{id:saved.id,estado_direccion:saved.estado_direccion},message:decision==='aprobado'?'Enviado a Portal SETECFI.':'Rechazado por Direccion Escolar.'}),true;
 }
 throw fail('Accion desconocida.');
}
