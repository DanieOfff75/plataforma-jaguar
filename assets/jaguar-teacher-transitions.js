/* Jaguar · Gestión Académica: baja, cobertura y entrega de recursos, sin documentos personales. */
(()=>{'use strict';
const apiPath='/api/teacher-transition';
const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=x=>Number(x)||0;
const fmt=n=>Number(n||0).toLocaleString('es-MX',{maximumFractionDigits:1});
const today=()=>new Date().toLocaleDateString('en-CA');
async function call(data){const session=(await supabaseClient.auth.getSession()).data.session;
 if(!session?.access_token)throw Error('Sesión caducada. Vuelve a iniciar sesión.');
 const resp=await fetch(apiPath+(data? '':'?view=1'),{method:data?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:data?JSON.stringify(data):undefined,cache:'no-store'});
 const raw=await resp.json().catch(()=>({ok:false,error:'Respuesta inválida del servidor'}));if(!resp.ok||!raw.ok)throw Error(raw.error||'No se completó la operación');return raw.data;}
const card=(title,desc,body)=>`<section class="card jtr-card"><h3>${E(title)}</h3><p class="jtr-muted">${E(desc)}</p>${body}</section>`;
function supportPanel(){return card('Programa de docentes de apoyo','Participación voluntaria y validación de Servicios Docentes. Todavía no concede asignaciones ni acceso temporal.',`<label>Ciclo escolar<input id="jtr_support_cycle" class="input" pattern="[0-9]{4}-[0-9]{4}(?:/[1-9])?" placeholder="2027-2028"></label><button type="button" class="btn" onclick="jaguarTransitions.supportLoad()">Consultar programa de apoyo</button><div id="jtr_support_result"></div>`);}
let supportBusy=false,supportContext=null;
const supportValue=id=>document.getElementById(id)?.value;
const validSupportId=v=>typeof v==='string'&&/^[1-9]\d{0,18}$/.test(v);
async function supportApi(cycle,body){const session=(await supabaseClient.auth.getSession()).data.session;if(!session?.access_token)throw Error('Sesión caducada.');const res=await fetch(apiPath+(body?'':'?mode=support_teacher&cycle='+encodeURIComponent(cycle)),{method:body?'POST':'GET',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const raw=await res.json();if(!res.ok||!raw.ok)throw Error(raw.error||'Programa no disponible.');return raw.data;}
async function supportLoad(){if(supportBusy)return;const el=document.getElementById('jtr_support_result'),cycle=supportValue('jtr_support_cycle')?.trim();if(!el)return;supportContext=null;supportBusy=true;el.textContent='Consultando…';try{if(!/^\d{4}-\d{4}(?:\/[1-9])?$/.test(cycle||''))throw Error('Indica el ciclo escolar.');const d=await supportApi(cycle);if(!el.isConnected||supportValue('jtr_support_cycle')?.trim()!==cycle)return;supportContext={cycle,data:d};const names=new Map(d.subjects.map(x=>[x.id,x.name]));const canSubmit=d.experimental&&S.role==='docente'&&!d.rows.some(x=>['solicitado','validado'].includes(x.state));el.innerHTML=d.rows.map(r=>`<div class="card"><p><b>${E(r.name)}</b> · ${E(r.state)}${r.active?'':' · Docente no activo'}</p><p>${E(r.application.subjects.map(id=>names.get(id)||id).join(', '))} · ${E(r.application.maxMinutes)} minutos semanales propuestos</p>${r.application.slots.map(z=>`<small>Día ${E(z.day)}: ${supportClock(z.start)}–${supportClock(z.end)}</small><br>`).join('')}${(r.events||[]).map(ev=>`<p>${E(ev.estado)} · ${E(ev.actor_nombre)} · ${E(ev.motivo)}${ev.referencia?' · '+E(ev.referencia):''}</p>`).join('')}${d.experimental&&validSupportId(r.id)&&Number.isSafeInteger(r.version)?(S.role==='docente'&&['solicitado','validado'].includes(r.state)?supportButton(r,'withdraw','Retirar candidatura'):S.role==='servicios_docentes'&&r.state==='solicitado'?supportButton(r,'approve','Validar')+supportButton(r,'reject','Rechazar'):S.role==='servicios_docentes'&&r.state==='validado'?supportButton(r,'revoke','Revocar validación'):''):''}</div>`).join('')+(canSubmit?`<form onsubmit="jaguarTransitions.supportSubmit(event)" class="card space-y-2"><h4>Solicitar incorporación voluntaria</h4><label>Materias (selección múltiple)<select multiple size="6" class="input" id="jtr_support_subjects" required>${d.subjects.filter(x=>validSupportId(x.id)).map(x=>`<option value="${E(x.id)}">${E(x.name)}</option>`).join('')}</select></label><p>Disponibilidad semanal: una franja por línea, formato 1 08:00 10:00 (lunes = 1, domingo = 7).</p><label>Franjas<textarea id="jtr_support_slots" class="input" rows="4" required placeholder="1 08:00 10:00"></textarea></label><label>Minutos máximos semanales para apoyo<input id="jtr_support_max" class="input" type="number" min="1" max="10080" required></label><label>Motivo<textarea id="jtr_support_reason" class="input" minlength="15" maxlength="1500" required></textarea></label><button class="btn primary" type="submit">Presentar candidatura de apoyo</button></form>`:'')+(!d.rows.length&&!canSubmit?'<p>Sin candidaturas.</p>':'')+(!d.experimental?'<p>Escrituras deshabilitadas fuera de pruebas.</p>':'');}catch(e){if(el.isConnected)el.textContent=e.message;}finally{supportBusy=false;}}
function supportClock(n){return E(String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0'));}
function supportButton(r,op,label){return `<button type="button" class="btn" onclick="jaguarTransitions.supportTransition('${r.id}',${r.version},'${op}')">${label}</button>`;}
async function supportSubmit(event){event.preventDefault();try{const slots=supportValue('jtr_support_slots').trim().split(/\n/).map(line=>{const m=/^([1-7])\s+([0-2]\d):([0-5]\d)\s+([0-2]\d):([0-5]\d)$/.exec(line.trim());if(!m||Number(m[2])>23||Number(m[4])>24||Number(m[4])===24&&Number(m[5])!==0)throw Error('Franja inválida.');return {day:Number(m[1]),start:Number(m[2])*60+Number(m[3]),end:Number(m[4])*60+Number(m[5])};});const subjects=Array.from(document.getElementById('jtr_support_subjects').selectedOptions,x=>x.value);await supportMutation({operation:'submit',application:{subjects,slots,maxMinutes:Number(supportValue('jtr_support_max'))},reason:supportValue('jtr_support_reason')});}catch(e){toast(e.message);}}
async function supportTransition(id,version,operation){const reason=prompt('Motivo de la decisión (mínimo 15 caracteres)');if(!reason||reason.trim().length<15)return;const reference=operation==='approve'?prompt('Referencia documental de competencias y disponibilidad'):null;if(operation==='approve'&&(!reference||reference.trim().length<5))return;await supportMutation({id,version,operation,reason,reference});}
async function supportMutation(body){if(supportBusy||!supportContext||supportValue('jtr_support_cycle')?.trim()!==supportContext.cycle)return;if(!confirm('¿Registrar esta decisión sin conceder asignaciones ni permisos?'))return;supportBusy=true;try{await supportApi(supportContext.cycle,{action:'support_teacher',cycle:supportContext.cycle,confirmed:true,...body});toast('Registro de apoyo actualizado.');}catch(e){toast(e.message);return;}finally{supportBusy=false;}await supportLoad();}
function guide(){return `<div class="jtr-intro"><span class="jtr-icon">♜</span><div><h3>Continuidad académica sin perder historial</h3><p>La baja no borra calificaciones, planeaciones ni rúbricas. Los grupos sin sustituto quedan como <b>Pendientes de cobertura</b>. Solo se comparten materiales académicos autorizados. Antes de ejecutar una baja o solicitar un permiso, registra el expediente en SETECFI.</p><button class="btn" onclick="loadPage('setecfi_gestion')">Abrir solicitudes SETECFI</button></div></div>`}
async function run(payload,page='relevos_docentes'){
 try{const data=await call(payload);if(data?.warning)toast(data.warning);else toast('✓ Operación guardada.');await loadPage(page);}catch(e){toast(e.message)}
}
async function makeRequest(){
 const id=num(document.getElementById('jtr-teacher')?.value),motivo=document.getElementById('jtr-reason')?.value||'',fecha=document.getElementById('jtr-date')?.value||'';
 if(!id||motivo.trim().length<20)return toast('Selecciona docente y explica el motivo con 20 caracteres.');
 if(!confirm('Se creará una solicitud formal. No se desactivará todavía al docente. ¿Continuar?'))return;
 return run({action:'solicitar',docente_id:id,motivo,fecha_efectiva:fecha});
}
async function change(action,id,page){
 let motivo_sin_firma='';
 if(action==='autorizar'){
  motivo_sin_firma=prompt('Si el docente no confirmó recepción, escribe aquí la justificación de Dirección (mínimo 20 caracteres). Si sí confirmó, deja vacío.','')||'';
 }
 if(action==='ejecutar'&&!confirm('CONFIRMACIÓN: se desactivará el acceso del docente y sus asignaciones. Los grupos quedarán sin titular hasta cubrir cada vacante. Se conservará todo el historial. ¿Ejecutar?'))return;
 if(!['autorizar','ejecutar'].includes(action)&&!confirm('¿Confirmar esta acción institucional?'))return;
 await run({action,id,motivo_sin_firma},page);
}
async function assign(id){const docente_id=num(document.getElementById('jtr-v-'+id)?.value);if(!docente_id)return toast('Selecciona un sustituto.');if(!confirm('Se asignará el grupo/materia al sustituto. El historial anterior NO se modificará. ¿Confirmas?'))return;return run({action:'cubrir',id,docente_id});}
async function addResource(id){const tipo=document.getElementById('jtr-type-'+id)?.value,titulo=document.getElementById('jtr-title-'+id)?.value,descripcion=document.getElementById('jtr-desc-'+id)?.value;
 if(!titulo||titulo.trim().length<3)return toast('Escribe el nombre del material.');
 if(!confirm('¿Confirmas que este material es institucional y NO contiene datos personales?'))return;
 return run({action:'recurso',id,tipo,titulo,descripcion,referencia:''});}
async function downloadApprovedPlan(planId){
 try{const session=(await supabaseClient.auth.getSession()).data.session;if(!session)throw Error('Vuelve a iniciar sesión');
 const rsp=await fetch(`${apiPath}?mode=planeacion&planeacion_id=${Number(planId)}`,{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
 const out=await rsp.json();if(!rsp.ok||!out.ok)throw Error(out.error||'No se pudo autorizar la descarga');
 window.location.assign(out.data.url);
 }catch(e){toast(e.message)}
}
// Orden institucional solo para relaciones de alumnos; mantiene IDs para adoptar notas.
const _surnameCollator = new Intl.Collator('es-MX',{sensitivity:'base',numeric:true});
function displayStudentName(row){
 const p=String(row?.apellido_paterno||'').trim(),m=String(row?.apellido_materno||'').trim(),n=String(row?.nombres||'').trim();
 if(p||m)return [p,m,n].filter(Boolean).join(' ');
 const raw=String(row?.nombre_completo||'').replace(/\s+/g,' ').trim();
 if(!raw)return 'Sin nombre';
 if(raw.includes(',')){const t=raw.split(',');return `${t[0].trim()} ${t.slice(1).join(' ').trim()}`.trim();}
 const w=raw.split(' ');if(w.length<3)return raw;
 const pop=()=>{const end=[w.pop()];while(w.length&&['DE','DEL','LA','LAS','LOS','SAN','SANTA'].includes(w[w.length-1].toUpperCase())){const part=w.pop();end.unshift(part);if(['LA','LOS','LAS'].includes(part.toUpperCase())&&w[w.length-1]?.toUpperCase()==='DE')end.unshift(w.pop());}return end.join(' ');};
 const mat=pop(),pat=pop();return [pat,mat,w.join(' ')].filter(Boolean).join(' ');
}
function sortRoster(rows){return [...(rows||[])].sort((a,b)=>_surnameCollator.compare(displayStudentName(a),displayStudentName(b))||_surnameCollator.compare(String(a.id||''),String(b.id||'')));}
async function showHistoricalGrades(vacanteId){
 try{const session=(await supabaseClient.auth.getSession()).data.session;if(!session)throw Error('Inicia sesión nuevamente');
 const rsp=await fetch(`${apiPath}?mode=historial&vacante_id=${Number(vacanteId)}`,{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
 const result=await rsp.json();if(!rsp.ok||!result.ok)throw Error(result.error||'Historial no disponible');
 const d=result.data||{},names=new Map(sortRoster(d.students||[]).map(x=>[Number(x.id),displayStudentName(x)]));
 const body=(d.rubrics||[]).map(rb=>`<div class="jtr-resource"><strong>${E(rb.titulo)} · ${E(rb.estado)}</strong><div class="scroll"><table class="table"><thead><tr><th>Alumno</th><th>Actividad</th><th>Calificación original</th></tr></thead><tbody>${(d.notes||[]).filter(n=>Number(n.rubrica_id)===Number(rb.id)).sort((a,b)=>_surnameCollator.compare(names.get(Number(a.alumno_id))||'',names.get(Number(b.alumno_id))||'')).map(n=>`<tr><td>${E(names.get(Number(n.alumno_id))||'Registro histórico')}</td><td>${E((d.components||[]).find(c=>Number(c.id)===Number(n.componente_id))?.nombre||'Actividad')}</td><td>${E(n.valor)}</td></tr>`).join('')||'<tr><td colspan="3">Sin calificaciones individuales guardadas.</td></tr>'}</tbody></table></div></div>`).join('')||'No hay rúbricas históricas de este grupo.';
 modal('Calificaciones y actividades heredadas · Solo lectura',`<div class="jtr"><p class="jtr-muted">Este registro es histórico e inalterable. Para evaluaciones nuevas utiliza tus propias rúbricas y registra notas en los módulos docentes.</p>${body}</div>`);
 }catch(e){toast(e.message)}
}
async function showHistoricalExcel(vacanteId){
 try{
  const session=(await supabaseClient.auth.getSession()).data.session;if(!session)throw Error('Inicia sesión nuevamente');
  const rsp=await fetch(`${apiPath}?mode=bitacora&vacante_id=${Number(vacanteId)}`,{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
  const result=await rsp.json();if(!rsp.ok||!result.ok)throw Error(result.error||'Bitácoras no disponibles');
  const d=result.data||{}, students=sortRoster(d.students||[]);
  const books=(d.booklets||[]).filter(b=>b.estado!=='reemplazado');const adopted=new Set((d.adoptions||[]).map(a=>Number(a.bitacora_origen_id)));
  const body=books.map(b=>{
   const state=b.snapshot||{}, acts=Array.isArray(state.activities)?state.activities:[], scores=Object.keys(state.activityScores||{}).length?state.activityScores:(state.scores||{});
   const cols=acts.slice(0,40);
   const rows=students.filter(st=>cols.some(a=>scores[`${st.id}|${a.key}`]!==undefined)).map(st=>`<tr><td>${E(displayStudentName(st))}</td>${cols.map(a=>`<td>${E(scores[`${st.id}|${a.key}`]??'—')}</td>`).join('')}</tr>`).join('');
   return `<section class="jtr-resource"><b>${E(b.fecha_clase||'Bitácora')} · Periodo ${E(b.periodo_id)} · Versión ${E(b.version)}</b><p class="jtr-muted">Puedes adoptar una copia de las actividades y calificaciones. El registro histórico permanece inalterado.</p><div class="jtr-actions">${adopted.has(Number(b.id))?'<span class="jtr-status jtr-covered">✓ Ya adoptada</span>':`<button class="btn primary" onclick="jaguarTransitions.adoptActivities(${Number(vacanteId)},${Number(b.id)})">📥 Adoptar ${cols.length} actividades y notas</button>`}</div><div class="scroll"><table class="table"><thead><tr><th>Alumno</th>${cols.map(a=>`<th>${E(a.nombre||'Actividad')}</th>`).join('')}</tr></thead><tbody>${rows||'<tr><td colspan="41">No hay calificaciones de actividades en esta bitácora.</td></tr>'}</tbody></table></div></section>`;
  }).join('');
  modal('Bitácoras Excel · Adoptar o consultar',`<div class="jtr"><p class="jtr-muted">Adoptar copia conserva las notas originales, identifica su procedencia y permite continuar la bitácora. La rúbrica original no cambia.</p>${body||'<p>No se encontraron bitácoras Excel para esta asignatura.</p>'}</div>`);
 }catch(e){toast(e.message)}
}
async function rubricPDF(vacanteId,rubricaId,download=false){
 let popup=null;
 if(!download)popup=window.open('about:blank','_blank');
 try{
  const session=(await supabaseClient.auth.getSession()).data.session;
  if(!session?.access_token)throw Error('Sesión caducada. Inicia sesión de nuevo.');
  const url=`${apiPath}?mode=rubrica_pdf&vacante_id=${num(vacanteId)}&rubrica_id=${num(rubricaId)}${download?'&download=1':''}`;
  const rsp=await fetch(url,{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
  if(!rsp.ok){const result=await rsp.json().catch(()=>({}));throw Error(result.error||'No se pudo generar el PDF');}
  if(!(rsp.headers.get('content-type')||'').includes('application/pdf'))throw Error('El servidor no devolvió un PDF');
  const blob=await rsp.blob(),objectUrl=URL.createObjectURL(blob);
  if(download){const a=document.createElement('a');a.href=objectUrl;a.download=`ITHLA_Rubrica_Relevo_${num(rubricaId)}.pdf`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),30000);}
  else if(popup&&!popup.closed){popup.location.replace(objectUrl);setTimeout(()=>URL.revokeObjectURL(objectUrl),180000);}
  else {const a=document.createElement('a');a.href=objectUrl;a.download=`ITHLA_Rubrica_Relevo_${num(rubricaId)}.pdf`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),30000);toast('El navegador bloqueó la pestaña; se descargó el PDF.');}
 }catch(e){if(popup&&!popup.closed)popup.close();toast(e.message)}
}
async function classroom(vacanteId,action){
 const message=action==='classroom_actualizar'?'¿Actualizar el responsable que aparece en la misma clase de Classroom, sin recrearla?':'¿Invitar a docente B como colaborador de esta clase? Google pedirá su aceptación.';
 if(!confirm(message))return;
 try{const d=await call({action,vacante_id:num(vacanteId),confirmado:true});toast(action==='classroom_invitar'?'Invitación enviada; el docente B deberá aceptarla.':'Responsable de la clase actualizado.');}
 catch(e){toast(e.message)}
}
async function adoptActivities(vacanteId,bitacoraId){
 if(!confirm('Se añadirán actividades y calificaciones heredadas a tu bitácora, conservando los registros originales del docente anterior. ¿Adoptar?'))return;
 try{const result=await call({action:'adoptar_actividades',vacante_id:num(vacanteId),bitacora_id:num(bitacoraId)});
   toast(`Adoptadas ${num(result?.actividades)} actividades y ${num(result?.notas_heredadas)} notas. Abre Bitácora Excel para continuar.`);
   closeModal();await loadPage('mis_relevos');
 }catch(e){toast(e.message)}
}
async function adopt(id,periodo_id){if(!confirm('Se creará una copia nueva y editable de la rúbrica abierta; las originales y sus calificaciones no cambiarán. ¿Continuar?'))return;return run({action:'adoptar_rubrica',vacante_id:id,periodo_id},'mis_relevos')}
function vacanteName(v,gmap){const gm=gmap.get(num(v.grupo_materia_id));return gm?`${gm.grupos?.clave||'Grupo'} · ${gm.materias?.nombre||'Materia'}`:`Grupo/materia ${v.grupo_materia_id}`}
async function manager(){const d=await call(),t=d.teachers||[],gmap=new Map((d.groupSubjects||[]).map(x=>[num(x.id),x]));
 const teachers=new Map(t.map(x=>[num(x.id),x]));const vacant=d.vacantes||[];
 const opened=(d.bajas||[]).filter(x=>!['cancelada','ejecutada'].includes(x.estado));
 const totals=`<div class="jtr-stats"><div><b>${opened.length}</b><span>Solicitudes activas</span></div><div><b>${vacant.filter(x=>x.estado==='pendiente').length}</b><span>Materias por cubrir</span></div><div><b>${vacant.filter(x=>x.estado==='cubierta').length}</b><span>Relevos cubiertos</span></div></div>`;
 const eligibleFor=v=>{const reserve=(d.reservas_sugeridas||[]).filter(x=>num(x.grupo_materia_id)===num(v.grupo_materia_id)&&x.ciclo===v.ciclo_escolar).sort((a,b)=>num(a.prioridad)-num(b.prioridad));const ranks=new Map(reserve.map(x=>[num(x.docente_id),num(x.prioridad)]));return t.filter(x=>x.activo&&num(x.id)!==num(v.docente_anterior_id)).sort((a,b)=>(ranks.get(num(a.id))||99)-(ranks.get(num(b.id))||99)||String(a.nombre_completo).localeCompare(String(b.nombre_completo),'es')).map(x=>({...x,reserva_rango:ranks.get(num(x.id))||null}));};
 const canStart=['servicios_docentes','direccion_escolar'].includes(S.role);
 const create=canStart?card('Solicitud de baja','El acceso sigue habilitado hasta la autorización y ejecución.',`<div class="jtr-grid"><label>Docente<select class="select" id="jtr-teacher"><option value="">Elegir docente</option>${t.filter(x=>x.activo).map(x=>`<option value="${x.id}">${E(x.nombre_completo)}</option>`).join('')}</select></label><label>Fecha efectiva<input id="jtr-date" type="date" class="input" value="${today()}"></label></div><label class="jtr-block">Motivo administrativo<textarea id="jtr-reason" class="input" maxlength="1200" rows="3" placeholder="Describe las circunstancias de la baja sin información médica o personal innecesaria"></textarea></label><button class="btn primary" onclick="jaguarTransitions.makeRequest()">Solicitar baja</button>`):'';
 const pending=card('Expedientes de baja','Recibo docente y autorización independiente de Dirección; la confirmación de recepción no equivale a renuncia.',`<div class="jtr-stack">${(d.bajas||[]).map(b=>`<article class="jtr-line"><div><strong>${E(teachers.get(num(b.docente_id))?.nombre_completo||'Docente archivado')} · #${b.id}</strong><p>${E(b.motivo)}</p><small>Estado: ${E(b.estado)} · Efectiva: ${E(b.fecha_efectiva)}</small></div><div class="jtr-actions">${b.estado==='solicitada'&&canStart?`<button class="btn" onclick="jaguarTransitions.change('notificar',${b.id})">Notificar</button>`:''}${['notificada','conformidad'].includes(b.estado)&&S.role==='direccion_escolar'?`<button class="btn primary" onclick="jaguarTransitions.change('autorizar',${b.id})">Autorizar</button>`:''}${b.estado==='autorizada'&&canStart?`<button class="btn danger" onclick="jaguarTransitions.change('ejecutar',${b.id})">Ejecutar baja</button>`:''}${!['ejecutada','cancelada'].includes(b.estado)&&S.role==='direccion_escolar'?`<button class="btn" onclick="jaguarTransitions.change('cancelar',${b.id})">Cancelar</button>`:''}</div></article>`).join('')||'<p class="jtr-muted">Aún no hay solicitudes.</p>'}</div>`);
 const vacancies=card('Cobertura de grupos y materias','Si no hay sustituto, no se asigna a nadie: permanece pendiente. Se preservan horarios, notas, rúbricas y planeaciones históricas.',`<div class="jtr-stack">${vacant.map(v=>`<article class="jtr-vacancy"><div class="jtr-line"><div><b>${E(vacanteName(v,gmap))}</b><p>${E(v.ciclo_escolar)} · ${fmt(v.horas_asignadas)} horas · Anterior: ${E(teachers.get(num(v.docente_anterior_id))?.nombre_completo||'Docente histórico')}</p></div><span class="jtr-status ${v.estado==='pendiente'?'jtr-pending':'jtr-covered'}">${v.estado==='pendiente'?'Pendiente de cobertura':'Cubierta'}</span></div>${v.estado==='pendiente'?`<div class="jtr-grid"><select class="select" id="jtr-v-${v.id}"><option value="">Seleccionar sustituto</option>${eligibleFor(v).map(x=>`<option value="${x.id}">${x.reserva_rango?`Reserva #${x.reserva_rango} · `:''}${E(x.nombre_completo)} · ${E(x.especialidad||'')}</option>`).join('')}</select><button class="btn primary" onclick="jaguarTransitions.assign(${v.id})">Cubrir vacante</button></div>`:`<p class="jtr-muted">Nuevo responsable: ${E(teachers.get(num(v.docente_nuevo_id))?.nombre_completo||'')} · Recurso académico a compartir:</p>${S.role==='servicios_docentes'?`<div class="jtr-actions"><button class="btn" onclick="jaguarTransitions.classroom(${Number(v.id)},'classroom_actualizar')">🔄 Actualizar mismo Classroom</button><button class="btn" onclick="jaguarTransitions.classroom(${Number(v.id)},'classroom_invitar')">✉️ Invitar docente B</button></div>`:''}`}<div class="jtr-grid"><select class="select" id="jtr-type-${v.id}"><option value="planeacion">Planeación</option><option value="rubrica">Rúbrica</option><option value="actividad">Actividad</option><option value="nota_institucional">Nota institucional</option><option value="oficio_no_personal">Oficio no personal</option><option value="otro_material">Otro material</option></select><input class="input" id="jtr-title-${v.id}" placeholder="Título del recurso"></div><textarea class="input jtr-block" rows="2" id="jtr-desc-${v.id}" placeholder="Resumen de entrega, ubicación institucional o instrucciones sin datos privados"></textarea><button class="btn" onclick="jaguarTransitions.addResource(${v.id})">Autorizar material de relevo</button></article>`).join('')||'<p class="jtr-muted">Todavía no hay vacantes.</p>'}</div>`);
 return `<div class="jtr jtr-appear">${guide()}${supportPanel()}${totals}${create}${pending}${vacancies}</div>`;
}
async function mine(){const d=await call();const notices=(d.bajas||[]).filter(x=>x.estado==='notificada');const vac=(d.vacantes||[]);
 return `<div class="jtr jtr-appear">${guide()}${supportPanel()}${card('Avisos dirigidos a ti','Confirmar recepción no implica aceptación de condiciones laborales ni renuncia a derechos.',notices.map(x=>`<article class="jtr-line"><div><b>Notificación #${x.id}</b><p>${E(x.motivo)}</p></div><button class="btn primary" onclick="jaguarTransitions.change('enterado',${x.id},'mis_relevos')">Confirmar recepción</button></article>`).join('')||'<p class="jtr-muted">No tienes notificaciones pendientes.</p>')}${card('Mis relevos académicos','Los recursos aprobados del grupo están disponibles para continuar el trabajo. Consulta calificaciones en el módulo original, sin duplicar ni alterar registros.',vac.map(v=>`<article class="jtr-vacancy"><b>Grupo/materia #${v.grupo_materia_id} · Ciclo ${E(v.ciclo_escolar)}</b><p class="jtr-muted">Recursos compartidos:</p>${(d.resources||[]).filter(x=>num(x.vacante_id)===num(v.id)).map(x=>`<div class="jtr-resource"><b>${E(x.tipo)} · ${E(x.titulo)}</b><p>${E(x.descripcion)}</p></div>`).join('')||'<p class="jtr-muted">No hay materiales autorizados todavía.</p>'}<p class="jtr-muted">Planeaciones anteriores revisadas:</p>${(d.planes||[]).filter(x=>num(x.grupo_materia_id)===num(v.grupo_materia_id)&&num(x.docente_id)===num(v.docente_anterior_id)).map(x=>`<div class="jtr-resource">${E(x.titulo)} · ${E(x.fecha_planeada||'')} <button class="btn" onclick="jaguarTransitions.downloadApprovedPlan(${x.id})">Descargar archivo aprobado</button></div>`).join('')||'<p class="jtr-muted">Sin planeaciones aprobadas anteriores.</p>'}<button class="btn" onclick="jaguarTransitions.showHistoricalGrades(${v.id})">📊 Rúbricas y notas históricas</button> <button class="btn" onclick="jaguarTransitions.showHistoricalExcel(${v.id})">📗 Bitácoras Excel anteriores</button><p class="jtr-muted">Rúbricas anteriores (originales intactas):</p>${(d.rubrics||[]).filter(x=>num(x.grupo_materia_id)===num(v.grupo_materia_id)&&num(x.docente_id)===num(v.docente_anterior_id)).map(x=>`<div class="jtr-resource"><b>${E(x.titulo)}</b> · ${E(x.estado)}<div class="jtr-actions"><button class="btn" onclick="jaguarTransitions.rubricPDF(${Number(v.id)},${Number(x.id)},false)">👁️ Previsualizar PDF</button><button class="btn" onclick="jaguarTransitions.rubricPDF(${Number(v.id)},${Number(x.id)},true)">📄 Descargar PDF</button>${x.estado!=='cerrada'?`<button class="btn primary" onclick="jaguarTransitions.adopt(${v.id},${x.periodo_id})">✍️ Adoptar rúbrica editable</button>`:'<span class="jtr-muted">Cerrada: consulta histórica</span>'}</div></div>`).join('')||'<p class="jtr-muted">Sin rúbricas anteriores.</p>'}</article>`).join('')||'<p class="jtr-muted">Todavía no recibes grupos mediante relevo.</p>')}</div>`;
}
async function hours(){if(!['coordinacion_academica','direccion_escolar','servicios_docentes'].includes(S.role))return '<div class="card">Sin autorización.</div>';
 const d=await call(),groups=d.groupSubjects||[],subs=new Map((d.subjects||[]).map(x=>[num(x.id),x]));
 const covered=new Set((d.assignments||[]).map(x=>num(x.grupo_materia_id)));
 const vacancy=new Set((d.vacantes||[]).filter(x=>x.estado==='pendiente').map(x=>num(x.grupo_materia_id)));
 const mapped=new Map();for(const gm of groups){const mid=num(gm.materia_id),sub=subs.get(mid);if(!sub)continue;
 const o=mapped.get(mid)||{name:sub.nombre,total:0,covered:0,missing:0,hours:0,need:0};const h=num(gm.horas_semana)||num(gm.materias?.horas_semana)||num(sub.horas_semana);o.total++;o.need+=h;
 if(covered.has(num(gm.id))){o.covered++;o.hours+=h;}else{o.missing++;}mapped.set(mid,o);}
 return `<div class="jtr jtr-appear">${card('Horas por materia · cobertura real','Las horas previstas se comparan con grupos que tengan asignación activa. Una vacante no desaparece del plan de estudios.',`<div class="scroll"><table class="table"><thead><tr><th>Materia</th><th>Grupos</th><th>Con docente</th><th>Pendientes</th><th>Horas previstas</th><th>Horas cubiertas</th><th>Estado</th></tr></thead><tbody>${[...mapped.values()].sort((a,b)=>a.name.localeCompare(b.name,'es')).map(x=>`<tr><td><b>${E(x.name)}</b></td><td>${x.total}</td><td>${x.covered}</td><td>${x.missing}</td><td>${fmt(x.need)}</td><td>${fmt(x.hours)}</td><td><span class="jtr-status ${x.missing?'jtr-pending':'jtr-covered'}">${x.missing?'Requiere cobertura':'Completa'}</span></td></tr>`).join('')}</tbody></table></div>`)}${card('Atención a materias sin docente','La suspensión operativa se refleja como vacante: nadie puede capturar nuevas evaluaciones desde una asignación inactiva. Los datos históricos se conservan.',`<p class="jtr-muted">${vacancy.size} materias/grupos con vacante formal pendiente.</p><button class="btn" onclick="loadPage('relevos_docentes')">Abrir gestión de relevos</button>`)}</div>`;
}
window.jaguarTransitions={supportLoad,supportSubmit,supportTransition,makeRequest,change,assign,addResource,adopt,adoptActivities,rubricPDF,classroom,showHistoricalGrades,showHistoricalExcel,downloadApprovedPlan};
window.jaguarTeacherTransitionPage=()=>manager();
window.jaguarTeacherHandoverPage=()=>mine();
window.jaguarHoursPerSubjectPage=()=>hours();
})();
