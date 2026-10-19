/** NEXO Academia pública v7: hechos observables, jamás credenciales/expedientes ni nombres inventados. */
const norm=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function publicPortalFacts(settings={}){
 const p=settings.portal||{},a=settings.admisiones||{},i=settings.institucion||{};
 return {
  sitio_publico_jaguar:{secciones:['Inicio (#inicio)','Noticias (#avisos)','Agenda de eventos (#calendario)','Responsables publicados (#departamentos)','Solicitud de cita (#citas)','Admisiones (#admisiones)','Servicios (#servicios)','NEXO (#nexo)'],autenticacion:'La cuenta escolar requiere correo institucional y contraseña. El sitio público se puede leer sin iniciar sesión.',citas:'Las citas solo están disponibles cuando el instituto publica horarios; se confirman al obtener una referencia en el formulario oficial, no dentro del chat.'},
  admisiones:{estado:['abierto','pausado','cerrado'].includes(a.estado)?a.estado:'sin_confirmar',fecha_inicio:a.fecha_inicio||null,fecha_fin:a.fecha_fin||null,nota:'Aceptación no equivale a inscripción final; Control Escolar debe confirmarla.'},
  publicacion:{avisos:(Array.isArray(p.avisos)?p.avisos:[]).slice(0,8).map(x=>({titulo:String(x.titulo||'').slice(0,100),fecha:String(x.fecha||'').slice(0,35)})),eventos:(Array.isArray(p.eventos)?p.eventos:[]).slice(0,8).map(x=>({titulo:String(x.titulo||'').slice(0,100),fecha:String(x.fecha||x.fecha_inicio||'').slice(0,35)})),responsables:(Array.isArray(p.directorio_publico)?p.directorio_publico:[]).filter(x=>x.publicado===true).slice(0,12).map(x=>({nombre:String(x.nombre||'').slice(0,90),departamento:String(x.departamento||'').slice(0,80),cargo:String(x.cargo||'').slice(0,80)}))},
  contacto_publicado:{telefono:i.telefono||null}
 };
}
export function publicSiteQuickAnswer(q,settings={},trusted={}){
 const s=norm(q);if(trusted.session_verificada||trusted.aplicacion!=='jaguar')return null;
 const facts=publicPortalFacts(settings);
 const result=(message,tag)=>({encontrado:true,modo:'manual',respuesta:message,fuentes:[{fuente:'Portal público institucional — sección publicada',guia:tag}]});
 if(/(agendar|agendo|solicitar|reservar|programar|sacar|pedir).{0,30}(cita|entrevista)|cita.{0,30}(agenda|horario|departamento)/.test(s))
  return result('📅 En el portal público de Jaguar abre **«Citas»** (`#citas`), selecciona uno de los horarios publicados y completa el formulario. Solo tendrás una cita registrada si el sistema devuelve una **referencia de confirmación**. Si no hay horarios publicados, no se pueden reservar citas desde NEXO.', 'citas-v7');
 if(/(quien|nombre|encargad|responsable|directorio|jefe).{0,35}(departamento|direccion|control escolar|servicios|prefectura|archivo)/.test(s)){
  const people=facts.publicacion.responsables;
  if(!people.length)return result('🏛️ El **directorio de responsables** todavía no tiene nombres aprobados para publicación. Puedes visitar `#departamentos`; no debo adivinar quién ocupa cada puesto.','directorio-v7');
  const term=s.includes('control escolar')?'control escolar':s.includes('direccion')?'direccion':s.includes('prefectura')?'prefectura':s.includes('archivo')?'archivo':null;
  const filtered=term?people.filter(p=>norm(p.departamento).includes(term)):people;
  if(!filtered.length)return result('🏛️ No hay un responsable publicado para esa área. Consulta el directorio `#departamentos` o solicita orientación institucional.','directorio-v7');
  return result('🏛️ Responsables publicados:\n'+filtered.map(p=>`- **${p.departamento}:** ${p.nombre} (${p.cargo||'responsable'})`).join('\n'),'directorio-v7');
 }
 if(/(avisos|noticias|comunicado|publicacion)/.test(s)&&/(hay|ultim|actual|donde|ver|consult|que)/.test(s)){
  const items=facts.publicacion.avisos;
  return result(items.length?'📰 Los últimos títulos publicados son:\n'+items.slice(0,4).map(x=>`- ${x.titulo}${x.fecha?` (${x.fecha})`:''}`).join('\n')+'\nLee el texto oficial en `#avisos`.':'📰 Por ahora no hay avisos aprobados en el portal. Consulta `#avisos` cuando se publiquen.','avisos-v7');
 }
 if(/(calendario|evento|fechas importantes|actividades)/.test(s)&&/(cuando|que|cual|hay|donde|ver|consulta)/.test(s)){
  const items=facts.publicacion.eventos;
  return result(items.length?'📅 Actividades publicadas:\n'+items.slice(0,4).map(x=>`- ${x.titulo}${x.fecha?` (${x.fecha})`:''}`).join('\n')+'\nConsulta `#calendario`.':'📅 Todavía no aparecen fechas institucionales autorizadas. Consulta `#calendario`; no puedo inventar un calendario.','eventos-v7');
 }
 return null;
}
