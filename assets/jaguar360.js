/* Jaguar 360 — panel de trabajo y trámites presenciales. No modifica los módulos históricos. */
(()=>{'use strict';
const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const TYPES=[['constancia_estudios','Constancia de estudios','Control Escolar'],['boleta_certificada','Boleta certificada','Control Escolar'],['historial_academico','Historial académico','Archivo Escolar'],['aclaracion_documental','Aclaración documental','Archivo Escolar'],['credencial_reposicion','Reposición de credencial','Servicios Estudiantiles'],['consulta_taller','Consulta de taller','Servicios Estudiantiles'],['revision_pago','Revisión de pago','Recursos Monetarios'],['constancia_conducta','Constancia de conducta','Prefectura']];
const DESKS=new Set(['control_escolar','control','archivo_escolar','servicios_estudiantiles','recursos_monetarios','prefectura']);
const STAFF_LABEL={control_escolar:'Control Escolar',control:'Control Escolar',archivo_escolar:'Archivo Escolar',servicios_estudiantiles:'Servicios Estudiantiles',recursos_monetarios:'Recursos Monetarios',prefectura:'Prefectura'};
const STATES={recibida:'Recibida',en_revision:'En revisión',requiere_aclaracion:'Requiere aclaración',lista_para_recoger:'Lista para recoger',entregada:'Entregada presencialmente',rechazada:'Rechazada',cancelada:'Cancelada'};
const NEXT={recibida:['en_revision','requiere_aclaracion','rechazada'],en_revision:['requiere_aclaracion','lista_para_recoger','rechazada'],requiere_aclaracion:['en_revision','rechazada'],lista_para_recoger:['entregada']};
const isStudent=()=>S.role==='alumno';
const isDesk=()=>DESKS.has(S.role);
const fmt=d=>{try{return new Intl.DateTimeFormat('es-MX',{dateStyle:'medium',timeStyle:'short'}).format(new Date(d))}catch{return '—'}};
const typ=id=>TYPES.find(x=>x[0]===id)?.[1]||id;
let pending=false;
async function api(method='GET',args={},mode='list'){
 const {data:{session}}=await supabaseClient.auth.getSession();
 if(!session?.access_token)throw Error('Tu sesión terminó. Inicia sesión de nuevo.');
 const response=await fetch('/api/jaguar360'+(method==='GET'?`?mode=${encodeURIComponent(mode)}${args.id?'&id='+encodeURIComponent(args.id):''}`:''),{
 method,headers:{'Accept':'application/json', ...(method==='POST'?{'Content-Type':'application/json'}:{}),'Authorization':'Bearer '+session.access_token},
 ...(method==='POST'?{body:JSON.stringify(args)}:{})
 });
 const payload=await jaguarReadJson(response);
 if(!response.ok||!payload.ok)throw Error(payload.error||`No se pudo realizar la operación (${response.status}).`);
 return payload.data;
}
function head(kicker,title,sub){return `<header class="j360-hero"><div class="j360-kicker">${E(kicker)}</div><h2>${E(title)}</h2><p>${E(sub)}</p></header>`;}
function pill(state){return `<span class="j360-state j360-${E(state)}">${E(STATES[state]||state)}</span>`;}
function blank(text){return `<div class="j360-empty"><span aria-hidden="true">◇</span><p>${E(text)}</p></div>`;}
function actions(row){
 if(isStudent())return ['recibida','requiere_aclaracion'].includes(row.estado)?`<button class="btn j360-small" onclick="jaguar360.cancel('${E(row.id)}')">Cancelar solicitud</button>`:'';
 if(!isDesk())return '';
 return (NEXT[row.estado]||[]).map(next=>`<button class="btn j360-small ${next==='lista_para_recoger'?'primary':''}" onclick="jaguar360.update('${E(row.id)}','${next}')">${E(STATES[next])}</button>`).join('');
}
function ticket(row){return `<article class="j360-ticket"><div class="j360-ticket-top"><div><strong>${E(typ(row.tipo))}</strong><p>${E(row.folio)} · ${E(fmt(row.created_at))}</p></div>${pill(row.estado)}</div><p>${E(row.asunto)}</p>${!isStudent()&&row.detalle?`<p class="j360-detail">${E(row.detalle)}</p>`:''}${row.comentario_publico?`<div class="j360-comment">${E(row.comentario_publico)}</div>`:''}<div class="j360-ticket-bottom"><small>${E(STAFF_LABEL[row.departamento]||row.departamento)}</small><div class="j360-actions"><button type="button" class="btn j360-small" onclick="jaguar360.history('${E(row.id)}')">Historial</button>${actions(row)}</div></div></article>`;}
function form(){return `<div class="j360-form card"><h3>Nueva solicitud</h3><p>Selecciona el trámite; Jaguar lo enviará al departamento responsable. <b>No se descargará ningún documento privado.</b></p><form id="j360-request-form" onsubmit="jaguar360.create(event)"><label for="j360-type">Tipo de trámite</label><select id="j360-type" class="select" required>${TYPES.map(t=>`<option value="${E(t[0])}">${E(t[1])} · ${E(t[2])}</option>`).join('')}</select><label for="j360-subject">Asunto</label><input id="j360-subject" class="input" maxlength="140" minlength="6" required placeholder="Ej. Solicitud de constancia para trámite"><label for="j360-details">Indicaciones generales (opcional)</label><textarea id="j360-details" class="textarea" maxlength="1500" rows="3" placeholder="No incluyas CURP, contraseñas ni información médica"></textarea><p class="j360-notice">🔒 La solicitud se procesa internamente. Se entrega el documento exclusivamente de forma presencial, tras validar identidad en ventanilla.</p><button type="submit" class="btn primary" id="j360-create">Enviar al departamento</button></form></div>`;}
async function page(){
 const role=S.role,student=isStudent(),desk=isDesk();
 if(!student&&!desk&&role!=='direccion_escolar')return head('JAGUAR 360','Centro de trabajo','Las solicitudes privadas solo son visibles para el solicitante y su departamento.');
 const d=await api('GET',{},'list');
 const rows=d.rows||[];
 const counts=`<div class="j360-stats"><div class="j360-stat"><small>Solicitudes visibles</small><b>${Number(d.summary?.total)||0}</b></div><div class="j360-stat"><small>En proceso</small><b>${Number(d.summary?.open)||0}</b></div><div class="j360-stat"><small>Listas para recoger</small><b>${Number(d.summary?.ready)||0}</b></div></div>`;
 return `<section class="j360">${head('PLATAFORMA JAGUAR · ITHLA',student?'Mis trámites escolares':desk?'Bandeja departamental de trámites':'Supervisión institucional','Las solicitudes viajan al área responsable. Los documentos privados se entregan presencialmente.')}${counts}<div class="j360-layout">${student?form():''}<section class="j360-list"><div class="j360-list-header"><h3>${student?'Mis solicitudes':desk?'Solicitudes asignadas a mi departamento':'Solicitudes institucionales'}</h3><button type="button" class="btn" onclick="loadPage('tramites_360')">Actualizar</button></div>${rows.length?rows.map(ticket).join(''):blank(student?'Todavía no has iniciado solicitudes.':'No hay solicitudes asignadas.')}</section></div></section>`;
}
const LINKS={
 alumno:[['tramites_360','Mis trámites'],['horario','Mi horario'],['calificaciones','Mis calificaciones'],['asistencia','Mi asistencia']],
 docente:[['grupos','Mis grupos'],['planeaciones','Planeaciones'],['centro_didactico','Crear con NEXO'],['bitacora_calificaciones','Bitácora Excel']],
 direccion_escolar:[['tramites_360','Supervisar trámites'],['relevos_docentes','Cobertura docente'],['planeaciones','Planeaciones'],['estadisticas','Estadísticas']],
 control_escolar:[['tramites_360','Trámites escolares'],['alumnos','Alumnos'],['planeaciones','Planeaciones']],
 control:[['tramites_360','Trámites escolares'],['alumnos','Alumnos']],
 archivo_escolar:[['tramites_360','Bandeja de solicitudes'],['archivo','Expedientes']],
 servicios_docentes:[['relevos_docentes','Bajas y relevos'],['docentes','Docentes'],['planeaciones','Planeaciones']],
 servicios_estudiantiles:[['tramites_360','Bandeja de solicitudes'],['talleres','Talleres'],['credenciales','Credenciales']],
 prefectura:[['tramites_360','Bandeja de solicitudes'],['incidencias','Incidencias']],
 recursos_monetarios:[['tramites_360','Bandeja de solicitudes'],['recursos_monetarios','Recursos monetarios']],
 coordinacion_academica:[['planeaciones','Revisar planeaciones'],['horas_materias','Cobertura por materia'],['relevos_docentes','Bajas y relevos']]
};
async function dashboard(){
 const links=LINKS[S.role]||[['avisos','Ver avisos'],['perfil','Mi perfil']];
 let summary='';
 if(isStudent()||isDesk()||['direccion_escolar','docente','coordinacion_academica','servicios_docentes'].includes(S.role)){
  try{const d=await api('GET',{},'dashboard');summary=`<div class="j360-dash-kpis"><span>${Number(d.summary?.open||0)} solicitudes en proceso</span><span>${Number(d.summary?.ready||0)} listas para recoger</span></div>${(d.insights||[]).map(x=>`<button class="j360-metric-link" onclick="loadPage('${E(x.page)}')">${E(x.label)} · <b>${Number(x.value)||0}</b> ↗</button>`).join('')}`}
  catch{summary='<small>La bandeja de trámites estará disponible cuando la instalación de Jaguar 360 se complete.</small>'}
 }
 return `<section class="j360 j360-dash"><div><span class="j360-kicker">JAGUAR 360 · CENTRO DE TRABAJO</span><h2>Accesos útiles para ${E(labels?.[S.role]||'tu perfil')}</h2><p>Solo se muestran funciones autorizadas para tu perfil.</p>${summary}</div><div class="j360-quick">${links.map(([id,label])=>`<button type="button" class="j360-link" onclick="loadPage('${E(id)}')"><span>${E(label)}</span><span aria-hidden="true">↗</span></button>`).join('')}</div></section>`;
}
async function health(){
 const d=await api('GET',{},'health');
 return `<section class="j360">${head('JAGUAR 360 · DIAGNÓSTICO','Salud operativa de Jaguar','Comprobaciones básicas de tablas del sistema. Este panel no prueba a los proveedores externos de IA.')}<div class="j360-stats">${(d.checks||[]).map(x=>`<div class="j360-stat"><small>${E(x.name)}</small><b style="font-size:1.15rem">${x.ok?'✓ Disponible':'⚠ Revisar'}</b><small>${Number(x.latency_ms)||0} ms</small></div>`).join('')}</div><div class="j360-form card">Última comprobación: ${E(fmt(d.checked_at))}. Si falla un servicio, revisa su despliegue y las migraciones antes de continuar.</div></section>`;
}
window.jaguar360HealthPage=health;

async function history(id){
 const slot=document.querySelector(`[data-j360-history="${id}"]`);
 if(slot){slot.remove();return;}
 const ticket=[...document.querySelectorAll('.j360-ticket')].find(n=>n.querySelector(`[onclick*="history('${id}')"]`));
 if(!ticket)return;
 const div=document.createElement('div');div.dataset.j360History=id;div.className='j360-history';div.textContent='Consultando historial...';ticket.appendChild(div);
 try{const d=await api('GET',{id},'history');div.innerHTML=(d.events||[]).map(x=>`<div><b>${E(STATES[x.estado_nuevo]||x.estado_nuevo)}</b><small>${E(fmt(x.created_at))}</small><p>${E(x.descripcion||'Cambio registrado')}</p></div>`).join('')||'<small>Sin eventos todavía.</small>';}
 catch(err){div.textContent=err.message}
}
async function create(e){e.preventDefault();if(pending)return;pending=true;const btn=document.getElementById('j360-create');if(btn)btn.disabled=true;
 try{const tipo=document.getElementById('j360-type')?.value,asunto=document.getElementById('j360-subject')?.value,detalle=document.getElementById('j360-details')?.value;
 const d=await api('POST',{action:'create',tipo,asunto,detalle});toast('Solicitud '+d.folio+' registrada. Entrega presencial.');await loadPage('tramites_360');}
 catch(err){toast(err.message)}finally{pending=false;if(btn)btn.disabled=false}
}
async function cancel(id){if(!confirm('¿Cancelar esta solicitud? Esta acción quedará registrada.'))return;
 try{await api('POST',{action:'status',id,estado:'cancelada',comentario:'Cancelada por el solicitante'});await loadPage('tramites_360')}catch(e){toast(e.message)}
}
async function update(id,estado){const mandatory=['requiere_aclaracion','lista_para_recoger','entregada','rechazada'].includes(estado);
 const comentario=mandatory?prompt(estado==='lista_para_recoger'?'Indica lugar, horario y requisitos de entrega presencial (sin adjuntar documento):':'Registra una explicación para el alumno:',''):'';
 if(mandatory&&(comentario===null||String(comentario).trim().length<10)){toast('Escribe al menos diez caracteres para esta operación.');return;}
 if(!confirm('¿Confirmas el cambio a «'+(STATES[estado]||estado)+'»?'))return;
 try{await api('POST',{action:'status',id,estado,comentario});toast('Estado registrado con historial de auditoría.');await loadPage('tramites_360')}catch(e){toast(e.message)}
}
window.jaguar360={create,cancel,update,history};
window.jaguar360Page=page;
window.jaguar360Dashboard=dashboard;
})();
