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
 const response=await fetch('/api/jaguar360'+(method==='GET'?`?mode=${encodeURIComponent(mode)}${args.id?'&id='+encodeURIComponent(args.id):''}${args.cycle?'&cycle='+encodeURIComponent(args.cycle):''}`:''),{
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
 return `<section class="j360">${head('PLATAFORMA JAGUAR · ITHLA',student?'Mis trámites escolares':desk?'Bandeja departamental de trámites':'Supervisión institucional','Las solicitudes viajan al área responsable. Los documentos privados se entregan presencialmente.')}${counts}<div class="j360-layout">${student?form()+continuityPanel():''}<section class="j360-list"><div class="j360-list-header"><h3>${student?'Mis solicitudes':desk?'Solicitudes asignadas a mi departamento':'Solicitudes institucionales'}</h3><button type="button" class="btn" onclick="loadPage('tramites_360')">Actualizar</button></div>${rows.length?rows.map(ticket).join(''):blank(student?'Todavía no has iniciado solicitudes.':'No hay solicitudes asignadas.')}</section></div></section>`;
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
const NOTICE_ROLES={alumno:'Alumnos',docente:'Docentes',direccion_escolar:'Dirección Escolar',control_escolar:'Control Escolar',control:'Control (rol legado)',coordinacion_academica:'Coordinación Académica',servicios_docentes:'Servicios Docentes',servicios_estudiantiles:'Servicios Estudiantiles',prefectura:'Prefectura',archivo_escolar:'Archivo Escolar',recursos_monetarios:'Recursos Monetarios'};
let noticeBusy=false;
function noticesRender(d){
 const cards=(d.inbox||[]).map(r=>`<article class="card"><h4>${E(r.subject)}</h4><p>${E(r.reference)} · ${E(NOTICE_ROLES[r.senderRole]||r.senderRole)} · ${E(fmt(r.sentAt))}</p><p style="white-space:pre-wrap">${E(r.body)}</p>${r.ackAt?`<p>Acuse: ${E(fmt(r.ackAt))}</p>`:d.experimental&&/^\d+$/.test(r.id)?`<button type="button" class="btn" onclick="jaguar360.noticeAction('ack','${E(r.id)}')">Acusar recepción</button>`:''}</article>`).join('');
 const sent=(d.sent||[]).map(r=>`<article class="card"><h4>${E(r.subject)} · ${E(r.state)}</h4><p>${E(r.reference)} · ${E(r.roles.map(x=>NOTICE_ROLES[x]||x).join(', '))}</p><p style="white-space:pre-wrap">${E(r.body)}</p><p>${E(r.reason)} · ${E(r.resolutionReason||'')}</p><p>${E(r.acknowledged)} acuses de ${E(r.recipients)} receptores</p>${d.canResolve&&d.experimental&&r.state==='propuesta'&&/^\d+$/.test(r.id)?`<button class="btn primary" onclick="jaguar360.noticeAction('publish','${E(r.id)}')">Autorizar comunicado</button> <button class="btn" onclick="jaguar360.noticeAction('reject','${E(r.id)}')">Rechazar comunicado</button>`:''}</article>`).join('');
 return `<p>Comunicados internos. El acuse confirma recepción, no aceptación legal. No incluir datos personales ni adjuntar expedientes.</p><h4>Recibidos</h4>${cards||'<p>Sin comunicados.</p>'}${d.canPropose&&d.experimental?`<form class="card space-y-2" onsubmit="jaguar360.noticePropose(event)"><h4>Preparar comunicado</h4><label>Asunto<input id="jn_subject" class="input" required minlength="6" maxlength="180"></label><label>Contenido<textarea id="jn_body" class="input" required minlength="15" maxlength="6000" rows="4"></textarea></label><fieldset><legend>Alcance (perfiles activos al autorizar)</legend>${(d.roles||[]).filter(x=>NOTICE_ROLES[x]).map(x=>`<label style="display:block"><input type="checkbox" name="jn_role" value="${E(x)}"> ${E(NOTICE_ROLES[x])}</label>`).join('')}</fieldset><label>Referencia de oficio o documento<input id="jn_reference" class="input" required minlength="5" maxlength="300"></label><label>Motivo<textarea id="jn_reason" class="input" required minlength="15" maxlength="1500"></textarea></label><button type="submit" class="btn primary">Proponer comunicado interno</button></form>`:''}${d.canPropose||d.canResolve?`<h4>Historial de propuestas</h4>${sent||'<p>Sin propuestas.</p>'}`:''}`;
}
async function noticesRun(body){const target=document.getElementById('j360-notice-content');if(!target||noticeBusy)return;noticeBusy=true;try{const d=await api(body?'POST':'GET',body||{},'internal_notices');if(target.isConnected)target.innerHTML=noticesRender(d);}catch(e){if(target.isConnected)target.textContent=e.message;}finally{noticeBusy=false;}}
function notificationPanel(){return NOTICE_ROLES[S.role]?`<section class="card"><h3>Comunicados institucionales y acuses</h3><p>Los acuses se confirman individualmente. Marcar avisos personales como leídos no confirma la recepción de comunicados.</p><button type="button" class="btn" onclick="jaguar360.noticesRun()">Consultar comunicados</button><div id="j360-notice-content"></div></section>`:'';}
async function noticeAction(operation,id){const reason=operation==='ack'?null:prompt('Motivo de resolución (mínimo 15 caracteres)');if(operation!=='ack'&&!reason)return;if(!confirm(operation==='ack'?'¿Confirmar recepción de este comunicado? No implica aceptación.':'¿Registrar resolución documental en el entorno de prueba?'))return;await noticesRun({action:'internal_notice',operation,id,reason,confirmed:true});if(typeof jaguarRefreshNotificationBadge==='function')await jaguarRefreshNotificationBadge();}
async function noticePropose(e){e.preventDefault();const form=e.currentTarget,roles=new FormData(form).getAll('jn_role');if(!roles.length){alert('Selecciona al menos un perfil.');return;}const val=id=>document.getElementById(id)?.value;if(!confirm('¿Enviar propuesta interna para revisión de Dirección?'))return;await noticesRun({action:'internal_notice',operation:'propose',roles,subject:val('jn_subject'),body:val('jn_body'),reference:val('jn_reference'),reason:val('jn_reason'),confirmed:true});}
async function dashboard(){
 const links=LINKS[S.role]||[['avisos','Ver avisos'],['perfil','Mi perfil']];
 let summary='';
 if(isStudent()||isDesk()||['direccion_escolar','docente','coordinacion_academica','servicios_docentes'].includes(S.role)){
  try{const d=await api('GET',{},'dashboard');summary=`<div class="j360-dash-kpis"><span>${Number(d.summary?.open||0)} solicitudes en proceso</span><span>${Number(d.summary?.ready||0)} listas para recoger</span></div>${(d.insights||[]).map(x=>`<button class="j360-metric-link" onclick="loadPage('${E(x.page)}')">${E(x.label)} · <b>${Number(x.value)||0}</b> ↗</button>`).join('')}`}
  catch{summary='<small>La bandeja de trámites estará disponible cuando la instalación de Jaguar 360 se complete.</small>'}
 }
 return `<section class="j360 j360-dash"><div><span class="j360-kicker">JAGUAR 360 · CENTRO DE TRABAJO</span><h2>Accesos útiles para ${E(labels?.[S.role]||'tu perfil')}</h2><p>Solo se muestran funciones autorizadas para tu perfil.</p>${summary}${NOTICE_ROLES[S.role]?`<details class="card"><summary>Comunicados y acuses de recepción</summary><button type="button" class="btn" onclick="jaguar360.noticesRun()">Consultar comunicados</button><div id="j360-notice-content"></div></details>`:''}</div><div class="j360-quick">${links.map(([id,label])=>`<button type="button" class="j360-link" onclick="loadPage('${E(id)}')"><span>${E(label)}</span><span aria-hidden="true">↗</span></button>`).join('')}</div></section>`;
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
let continuityCache=null,continuityBusy=false;
function continuityPanel(){return `<details class="card"><summary>Confirmar continuidad escolar · experimental</summary><p>Consulta el dictamen registrado por Control Escolar. Confirmar no equivale a quedar inscrito ni a solicitar la baja.</p><label>Ciclo de origen <input id="j360-cont-cycle" class="input" placeholder="2026-2027" onchange="jaguar360.clearContinuity()"></label><button class="btn" type="button" onclick="jaguar360.loadContinuity()">Consultar continuidad</button><div id="j360-cont-result" aria-live="polite"></div></details>`;}
function clearContinuity(){continuityCache=null;const slot=document.getElementById('j360-cont-result');if(slot)slot.textContent='';}
async function loadContinuity(){clearContinuity();const input=document.getElementById('j360-cont-cycle'),slot=document.getElementById('j360-cont-result');if(!input||!slot)return;const cycle=input.value.trim();slot.textContent='Consultando…';try{const d=await api('GET',{cycle},'student_continuity');if(!slot.isConnected||input.value.trim()!==cycle)return;continuityCache={cycle,d};if(!d.decision){slot.textContent='Todavía no existe un dictamen de continuidad registrado para este ciclo.';return;}const labels={promotion_eligible:'Promoción elegible',repeat_grade:'Repetición completa',repeat_subjects:'Repetición de materias pendientes',provisional_eligible:'Continuidad provisional'};const confirmed=d.confirmation?.state==='confirmada';slot.innerHTML=`<p><b>${E(labels[d.decision.state]||'Revisión necesaria')}</b> · ${E(d.decision.targetCycle)} · grado ${E(d.decision.targetGrade)}</p><p>${confirmed?'Confirmación registrada':d.confirmation?.state==='retirada'?'Confirmación retirada':'Confirmación pendiente'}. ${d.enrolled?'Ya existe una reinscripción.':'Control Escolar debe revalidar las evidencias antes de formalizar la inscripción.'}</p>${d.canRespond?`<button type="button" class="btn" onclick="jaguar360.respondContinuity('${confirmed?'retirada':'confirmada'}')">${confirmed?'Retirar confirmación':'Confirmar continuidad'}</button>`:''}`;}catch(e){if(slot.isConnected&&input.value.trim()===cycle)slot.textContent=e.message;}}
async function respondContinuity(response){const t=continuityCache,input=document.getElementById('j360-cont-cycle');if(continuityBusy||!t?.d.canRespond||!input||input.value.trim()!==t.cycle||!confirm(response==='confirmada'?'¿Confirmar intención de continuar? No equivale a inscripción.':'¿Retirar la confirmación? No equivale a una baja.'))return;continuityBusy=true;try{await api('POST',{action:'student_continuity',cycle:t.cycle,decision:t.d.decision.id,response,confirmed:true});await loadContinuity();}catch(e){toast(e.message);await loadContinuity();}finally{continuityBusy=false;}}
window.jaguar360={clearContinuity,loadContinuity,respondContinuity,notificationPanel,noticesRun,noticeAction,noticePropose,create,cancel,update,history};
window.jaguar360Page=page;
window.jaguar360Dashboard=dashboard;
})();
