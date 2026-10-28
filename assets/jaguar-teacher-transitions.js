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
function guide(){return `<div class="jtr-intro"><span class="jtr-icon">♜</span><div><h3>Continuidad académica sin perder historial</h3><p>La baja no borra calificaciones, planeaciones ni rúbricas. Los grupos sin sustituto quedan como <b>Pendientes de cobertura</b>. Solo se comparten materiales académicos autorizados.</p></div></div>`}
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
async function showHistoricalGrades(vacanteId){
 try{const session=(await supabaseClient.auth.getSession()).data.session;if(!session)throw Error('Inicia sesión nuevamente');
 const rsp=await fetch(`${apiPath}?mode=historial&vacante_id=${Number(vacanteId)}`,{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
 const result=await rsp.json();if(!rsp.ok||!result.ok)throw Error(result.error||'Historial no disponible');
 const d=result.data||{},names=new Map((d.students||[]).map(x=>[Number(x.id),x.nombre_completo]));
 const body=(d.rubrics||[]).map(rb=>`<div class="jtr-resource"><strong>${E(rb.titulo)} · ${E(rb.estado)}</strong><div class="scroll"><table class="table"><thead><tr><th>Alumno</th><th>Actividad</th><th>Calificación original</th></tr></thead><tbody>${(d.notes||[]).filter(n=>Number(n.rubrica_id)===Number(rb.id)).map(n=>`<tr><td>${E(names.get(Number(n.alumno_id))||'Registro histórico')}</td><td>${E((d.components||[]).find(c=>Number(c.id)===Number(n.componente_id))?.nombre||'Actividad')}</td><td>${E(n.valor)}</td></tr>`).join('')||'<tr><td colspan="3">Sin calificaciones individuales guardadas.</td></tr>'}</tbody></table></div></div>`).join('')||'No hay rúbricas históricas de este grupo.';
 modal('Calificaciones y actividades heredadas · Solo lectura',`<div class="jtr"><p class="jtr-muted">Este registro es histórico e inalterable. Para evaluaciones nuevas utiliza tus propias rúbricas y registra notas en los módulos docentes.</p>${body}</div>`);
 }catch(e){toast(e.message)}
}
async function showHistoricalExcel(vacanteId){
 try{
  const session=(await supabaseClient.auth.getSession()).data.session;if(!session)throw Error('Inicia sesión nuevamente');
  const rsp=await fetch(`${apiPath}?mode=bitacora&vacante_id=${Number(vacanteId)}`,{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
  const result=await rsp.json();if(!rsp.ok||!result.ok)throw Error(result.error||'Bitácoras no disponibles');
  const d=result.data||{}, students=d.students||[];
  const books=(d.booklets||[]).filter(b=>b.estado!=='reemplazado');const adopted=new Set((d.adoptions||[]).map(a=>Number(a.bitacora_origen_id)));
  const body=books.map(b=>{
   const state=b.snapshot||{}, acts=Array.isArray(state.activities)?state.activities:[], scores=Object.keys(state.activityScores||{}).length?state.activityScores:(state.scores||{});
   const cols=acts.slice(0,40);
   const rows=students.filter(st=>cols.some(a=>scores[`${st.id}|${a.key}`]!==undefined)).map(st=>`<tr><td>${E(st.nombre_completo)}</td>${cols.map(a=>`<td>${E(scores[`${st.id}|${a.key}`]??'—')}</td>`).join('')}</tr>`).join('');
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
 const canStart=['servicios_docentes','direccion_escolar'].includes(S.role);
 const create=canStart?card('Solicitud de baja','El acceso sigue habilitado hasta la autorización y ejecución.',`<div class="jtr-grid"><label>Docente<select class="select" id="jtr-teacher"><option value="">Elegir docente</option>${t.filter(x=>x.activo).map(x=>`<option value="${x.id}">${E(x.nombre_completo)}</option>`).join('')}</select></label><label>Fecha efectiva<input id="jtr-date" type="date" class="input" value="${today()}"></label></div><label class="jtr-block">Motivo administrativo<textarea id="jtr-reason" class="input" maxlength="1200" rows="3" placeholder="Describe las circunstancias de la baja sin información médica o personal innecesaria"></textarea></label><button class="btn primary" onclick="jaguarTransitions.makeRequest()">Solicitar baja</button>`):'';
 const pending=card('Expedientes de baja','Recibo docente y autorización independiente de Dirección; la confirmación de recepción no equivale a renuncia.',`<div class="jtr-stack">${(d.bajas||[]).map(b=>`<article class="jtr-line"><div><strong>${E(teachers.get(num(b.docente_id))?.nombre_completo||'Docente archivado')} · #${b.id}</strong><p>${E(b.motivo)}</p><small>Estado: ${E(b.estado)} · Efectiva: ${E(b.fecha_efectiva)}</small></div><div class="jtr-actions">${b.estado==='solicitada'&&canStart?`<button class="btn" onclick="jaguarTransitions.change('notificar',${b.id})">Notificar</button>`:''}${['notificada','conformidad'].includes(b.estado)&&S.role==='direccion_escolar'?`<button class="btn primary" onclick="jaguarTransitions.change('autorizar',${b.id})">Autorizar</button>`:''}${b.estado==='autorizada'&&canStart?`<button class="btn danger" onclick="jaguarTransitions.change('ejecutar',${b.id})">Ejecutar baja</button>`:''}${!['ejecutada','cancelada'].includes(b.estado)&&S.role==='direccion_escolar'?`<button class="btn" onclick="jaguarTransitions.change('cancelar',${b.id})">Cancelar</button>`:''}</div></article>`).join('')||'<p class="jtr-muted">Aún no hay solicitudes.</p>'}</div>`);
 const vacancies=card('Cobertura de grupos y materias','Si no hay sustituto, no se asigna a nadie: permanece pendiente. Se preservan horarios, notas, rúbricas y planeaciones históricas.',`<div class="jtr-stack">${vacant.map(v=>`<article class="jtr-vacancy"><div class="jtr-line"><div><b>${E(vacanteName(v,gmap))}</b><p>${E(v.ciclo_escolar)} · ${fmt(v.horas_asignadas)} horas · Anterior: ${E(teachers.get(num(v.docente_anterior_id))?.nombre_completo||'Docente histórico')}</p></div><span class="jtr-status ${v.estado==='pendiente'?'jtr-pending':'jtr-covered'}">${v.estado==='pendiente'?'Pendiente de cobertura':'Cubierta'}</span></div>${v.estado==='pendiente'?`<div class="jtr-grid"><select class="select" id="jtr-v-${v.id}"><option value="">Seleccionar sustituto</option>${t.filter(x=>x.activo&&num(x.id)!==num(v.docente_anterior_id)).map(x=>`<option value="${x.id}">${E(x.nombre_completo)} · ${E(x.especialidad||'')}</option>`).join('')}</select><button class="btn primary" onclick="jaguarTransitions.assign(${v.id})">Cubrir vacante</button></div>`:`<p class="jtr-muted">Nuevo responsable: ${E(teachers.get(num(v.docente_nuevo_id))?.nombre_completo||'')} · Recurso académico a compartir:</p>${S.role==='servicios_docentes'?`<div class="jtr-actions"><button class="btn" onclick="jaguarTransitions.classroom(${Number(v.id)},'classroom_actualizar')">🔄 Actualizar mismo Classroom</button><button class="btn" onclick="jaguarTransitions.classroom(${Number(v.id)},'classroom_invitar')">✉️ Invitar docente B</button></div>`:''}`}<div class="jtr-grid"><select class="select" id="jtr-type-${v.id}"><option value="planeacion">Planeación</option><option value="rubrica">Rúbrica</option><option value="actividad">Actividad</option><option value="nota_institucional">Nota institucional</option><option value="oficio_no_personal">Oficio no personal</option><option value="otro_material">Otro material</option></select><input class="input" id="jtr-title-${v.id}" placeholder="Título del recurso"></div><textarea class="input jtr-block" rows="2" id="jtr-desc-${v.id}" placeholder="Resumen de entrega, ubicación institucional o instrucciones sin datos privados"></textarea><button class="btn" onclick="jaguarTransitions.addResource(${v.id})">Autorizar material de relevo</button></article>`).join('')||'<p class="jtr-muted">Todavía no hay vacantes.</p>'}</div>`);
 return `<div class="jtr jtr-appear">${guide()}${totals}${create}${pending}${vacancies}</div>`;
}
async function mine(){const d=await call();const notices=(d.bajas||[]).filter(x=>x.estado==='notificada');const vac=(d.vacantes||[]);
 return `<div class="jtr jtr-appear">${guide()}${card('Avisos dirigidos a ti','Confirmar recepción no implica aceptación de condiciones laborales ni renuncia a derechos.',notices.map(x=>`<article class="jtr-line"><div><b>Notificación #${x.id}</b><p>${E(x.motivo)}</p></div><button class="btn primary" onclick="jaguarTransitions.change('enterado',${x.id},'mis_relevos')">Confirmar recepción</button></article>`).join('')||'<p class="jtr-muted">No tienes notificaciones pendientes.</p>')}${card('Mis relevos académicos','Los recursos aprobados del grupo están disponibles para continuar el trabajo. Consulta calificaciones en el módulo original, sin duplicar ni alterar registros.',vac.map(v=>`<article class="jtr-vacancy"><b>Grupo/materia #${v.grupo_materia_id} · Ciclo ${E(v.ciclo_escolar)}</b><p class="jtr-muted">Recursos compartidos:</p>${(d.resources||[]).filter(x=>num(x.vacante_id)===num(v.id)).map(x=>`<div class="jtr-resource"><b>${E(x.tipo)} · ${E(x.titulo)}</b><p>${E(x.descripcion)}</p></div>`).join('')||'<p class="jtr-muted">No hay materiales autorizados todavía.</p>'}<p class="jtr-muted">Planeaciones anteriores revisadas:</p>${(d.planes||[]).filter(x=>num(x.grupo_materia_id)===num(v.grupo_materia_id)&&num(x.docente_id)===num(v.docente_anterior_id)).map(x=>`<div class="jtr-resource">${E(x.titulo)} · ${E(x.fecha_planeada||'')} <button class="btn" onclick="jaguarTransitions.downloadApprovedPlan(${x.id})">Descargar archivo aprobado</button></div>`).join('')||'<p class="jtr-muted">Sin planeaciones aprobadas anteriores.</p>'}<button class="btn" onclick="jaguarTransitions.showHistoricalGrades(${v.id})">📊 Rúbricas y notas históricas</button> <button class="btn" onclick="jaguarTransitions.showHistoricalExcel(${v.id})">📗 Bitácoras Excel anteriores</button><p class="jtr-muted">Rúbricas anteriores (originales intactas):</p>${(d.rubrics||[]).filter(x=>num(x.grupo_materia_id)===num(v.grupo_materia_id)&&num(x.docente_id)===num(v.docente_anterior_id)).map(x=>`<div class="jtr-resource"><b>${E(x.titulo)}</b> · ${E(x.estado)}<div class="jtr-actions"><button class="btn" onclick="jaguarTransitions.rubricPDF(${Number(v.id)},${Number(x.id)},false)">👁️ Previsualizar PDF</button><button class="btn" onclick="jaguarTransitions.rubricPDF(${Number(v.id)},${Number(x.id)},true)">📄 Descargar PDF</button>${x.estado!=='cerrada'?`<button class="btn primary" onclick="jaguarTransitions.adopt(${v.id},${x.periodo_id})">✍️ Adoptar rúbrica editable</button>`:'<span class="jtr-muted">Cerrada: consulta histórica</span>'}</div></div>`).join('')||'<p class="jtr-muted">Sin rúbricas anteriores.</p>'}</article>`).join('')||'<p class="jtr-muted">Todavía no recibes grupos mediante relevo.</p>')}</div>`;
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
window.jaguarTransitions={makeRequest,change,assign,addResource,adopt,adoptActivities,rubricPDF,classroom,showHistoricalGrades,showHistoricalExcel,downloadApprovedPlan};
window.jaguarTeacherTransitionPage=()=>manager();
window.jaguarTeacherHandoverPage=()=>mine();
window.jaguarHoursPerSubjectPage=()=>hours();
})();
