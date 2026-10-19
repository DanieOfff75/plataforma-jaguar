/** V8: Only public, explicitly approved DB fields may leave this module. */
const ADMIN_ROLES=new Set(['direccion_escolar','control_escolar','control','servicios_docentes','servicios_estudiantiles','prefectura','coordinacion_academica','archivo_escolar','recursos_monetarios']);
const safe=(v,n=300)=>String(v??'').trim().slice(0,n);
export const canManagePublic=(role)=>ADMIN_ROLES.has(String(role||''));
export const isPublicNotice=(notice)=>Boolean(notice?.activo===true && notice?.publicado!==false && ['publica','ambas'].includes(notice?.destino_publicacion));
export function publicNotice(x){return {id:x.id,titulo:safe(x.titulo,180),contenido:safe(x.contenido,10000),descripcion:safe(x.contenido,300),fecha_publicacion:x.fecha_publicacion,responsable_nombre:safe(x.responsable_nombre,130)};}
export async function publicEditorial(db){
 const [n,e,d,dept,owners]=await Promise.all([
  db.from('avisos').select('id,titulo,contenido,fecha_publicacion,activo,publicado,destino_publicacion,responsable_nombre').in('destino_publicacion',['publica','ambas']).eq('activo',true).order('fecha_publicacion',{ascending:false}).limit(40),
  db.from('ithla_eventos_publicos').select('id,titulo,descripcion,fecha_inicio,fecha_fin').eq('estado','publicado').order('fecha_inicio',{ascending:true}).limit(80),
  db.from('ithla_public_directory_optin').select('departamento_clave').eq('visible',true),
  db.from('departamentos').select('id,clave,nombre,activo').eq('activo',true),
  db.from('responsables_departamento').select('departamento_id,nombre_responsable,cargo,activo,es_director').eq('activo',true).limit(150)
 ]);
 for(const [name,r] of [['avisos',n],['eventos',e],['directorio-autorizacion',d],['departamentos',dept],['responsables',owners]])if(r.error)throw Object.assign(new Error('Falta configurar o consultar '+name),{status:503});
 const consent=new Set((d.data||[]).map(x=>x.departamento_clave));
 const departments=new Map((dept.data||[]).filter(x=>consent.has(x.clave)).map(x=>[String(x.id),x]));
 const names=(owners.data||[]).filter(x=>departments.has(String(x.departamento_id))&&safe(x.nombre_responsable).length>1);
 const byDept=new Map();for(const x of names){const k=String(x.departamento_id);if(!byDept.has(k)||x.es_director)byDept.set(k,x)}
 return {avisos:(n.data||[]).filter(isPublicNotice).map(publicNotice),
   eventos:(e.data||[]).map(x=>({id:x.id,titulo:safe(x.titulo,180),descripcion:safe(x.descripcion,1000),fecha_inicio:x.fecha_inicio,fecha_fin:x.fecha_fin})),
   directorio_publico:[...byDept.entries()].map(([id,x])=>({departamento:departments.get(id)?.nombre||'',nombre:safe(x.nombre_responsable,130),cargo:safe(x.cargo,130),publicado:true}))};
}
function validDate(v){const d=new Date(v);return Number.isFinite(d.getTime())?d.toISOString():null}
function bad(message,status=400){throw Object.assign(new Error(message),{status})}
export async function adminEditorialAction(db,user,profile,action,payload={}){
 if(!canManagePublic(profile?.rol))bad('Este perfil no puede administrar el portal público.',403);
 const role=profile.rol;
 if(action==='admin-portal-data'){
  const [events,slots,departments,optin,portalCfg]=await Promise.all([
   db.from('ithla_eventos_publicos').select('id,titulo,descripcion,fecha_inicio,fecha_fin,estado').order('fecha_inicio',{ascending:false}).limit(100),
   db.from('ithla_cita_horarios').select('id,departamento,inicio,fin,capacidad,reservadas,estado').order('inicio',{ascending:false}).limit(100),
   db.from('departamentos').select('clave,nombre,activo').eq('activo',true),
   db.from('ithla_public_directory_optin').select('departamento_clave,visible'),
   db.from('ithla_config').select('valor,revision').eq('clave','portal').maybeSingle()
  ]);
  for(const r of [events,slots,departments,optin,portalCfg])if(r.error)throw Object.assign(new Error('Instala la migración V8 antes de administrar el portal.'),{status:503});
  return {eventos:events.data||[],horarios:slots.data||[],departamentos:(departments.data||[]).map(x=>({...x,publicado:(optin.data||[]).some(y=>y.departamento_clave===x.clave&&y.visible)})),puede_autorizar_directorio:role==='direccion_escolar',citas_publicas_activas:portalCfg.data?.valor?.citas_publicas_activas===true,aviso_privacidad_url:safe(portalCfg.data?.valor?.aviso_privacidad_url,400)};
 }
 if(action==='admin-portal-event'){
  const titulo=safe(payload.titulo,180),descripcion=safe(payload.descripcion,1000),inicio=validDate(payload.fecha_inicio),fin=payload.fecha_fin?validDate(payload.fecha_fin):null;
  if(titulo.length<5||!inicio||(fin&&fin<inicio))bad('Título y fechas de evento inválidas.');
  const estado=payload.publicado===true?'publicado':'borrador';
  const row={titulo,descripcion,fecha_inicio:inicio,fecha_fin:fin,estado,publicado_por:user.id};
  const query=payload.id?db.from('ithla_eventos_publicos').update(row).eq('id',payload.id):db.from('ithla_eventos_publicos').insert(row);
  const r=await query.select('id,estado').single();if(r.error)bad('No se pudo guardar el evento.',409);return r.data;
 }
 if(action==='admin-portal-hide-event'){
  const r=await db.from('ithla_eventos_publicos').update({estado:'archivado'}).eq('id',String(payload.id||'')).select('id').maybeSingle();
  if(r.error||!r.data)bad('No se pudo archivar el evento.',409);return {id:r.data.id,estado:'archivado'};
 }
 if(action==='admin-portal-slot'){
  const dept=safe(payload.departamento,90),inicio=validDate(payload.inicio),fin=validDate(payload.fin),capacity=Number(payload.capacidad);
  if(dept.length<3||!inicio||!fin||fin<=inicio||new Date(inicio)<new Date(Date.now()+30*60000)||!Number.isInteger(capacity)||capacity<1||capacity>20)bad('Horario, departamento o capacidad inválidos.');
  // create draft, then approve explicitly from Jaguar
  const r=await db.from('ithla_cita_horarios').insert({departamento:dept,inicio,fin,capacidad:capacity,estado:'borrador'}).select('id,estado').single();
  if(r.error)bad('No se pudo crear el horario.',409);return r.data;
 }
 if(action==='admin-portal-slot-state'){
  const id=safe(payload.id,60),estado=payload.estado;
  if(!['publicado','cancelado'].includes(estado))bad('Estado inválido.');
  const {data:row,error:re}=await db.from('ithla_cita_horarios').select('id,estado,reservadas,inicio').eq('id',id).maybeSingle();
  if(re||!row)bad('Horario no encontrado.',404);
  if(estado==='cancelado'&&row.reservadas>0)bad('Hay citas reservadas: primero resuélvelas y avisa a las personas afectadas.',409);
  if(estado==='publicado'&&(row.estado!=='borrador'||new Date(row.inicio)<new Date(Date.now()+30*60000)))bad('Solo puedes publicar horarios futuros en borrador.',409);
  const r=await db.from('ithla_cita_horarios').update({estado}).eq('id',id).eq('estado',row.estado).select('id,estado').maybeSingle();
  if(r.error||!r.data)bad('El horario cambió. Actualiza el panel.',409);return r.data;
 }
 if(action==='admin-portal-settings'){
  if(role!=='direccion_escolar')bad('Solo Dirección Escolar puede activar la agenda pública.',403);
  const active=payload.citas_publicas_activas===true,url=safe(payload.aviso_privacidad_url,400);
  if(active&&!/^https:\/\/[a-z0-9.-]+\//i.test(url))bad('La agenda requiere un enlace HTTPS real al aviso de privacidad.');
  const {data:current,error:ce}=await db.from('ithla_config').select('valor,revision').eq('clave','portal').maybeSingle();
  if(ce||!current)bad('Configuración editorial de portal no encontrada.',409);
  const value={...(current.valor||{}),citas_publicas_activas:active,aviso_privacidad_url:url};
  const {data:changed,error:ue}=await db.from('ithla_config').update({valor:value}).eq('clave','portal').eq('revision',current.revision).select('revision').maybeSingle();
  if(ue||!changed)bad('El portal cambió desde otra sesión. Actualiza y vuelve a intentar.',409);
  return {citas_publicas_activas:active};
 }
 if(action==='admin-portal-directory'){
  if(role!=='direccion_escolar')bad('Solo Dirección Escolar puede autorizar nombres públicos.',403);
  const clave=safe(payload.clave,40).toUpperCase(),visible=payload.visible===true;
  const {data:dep,error:de}=await db.from('departamentos').select('clave').eq('clave',clave).eq('activo',true).maybeSingle();
  if(de||!dep)bad('Departamento no válido.',404);
  const r=await db.from('ithla_public_directory_optin').upsert({departamento_clave:clave,visible,aprobado_por:user.id,actualizado_en:new Date().toISOString()},{onConflict:'departamento_clave'}).select('departamento_clave,visible').single();
  if(r.error)bad('No se pudo autorizar la publicación.',409);return r.data;
 }
 bad('Acción administrativa no reconocida.',404);
}
