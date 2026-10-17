/* Jaguar V5.5: interfaz adicional; no sustituye módulos heredados. */
const _j55={autoPreview:null,init:null,rooms:null,questions:[],exams:[],gm:0,period:0,gradeRows:[],gradePreview:null,roster:null,selectedSubject:0};
async function j55api(action,payload=null){
 if(!supabaseClient)throw Error('Inicia sesión antes de continuar.');
 const {data:{session}}=await supabaseClient.auth.getSession();if(!session)throw Error('La sesión expiró.');
 const method=payload===null?'GET':'POST';
 const url='/api/academic-tools'+(method==='GET'?'?action='+encodeURIComponent(action)+(_j55params[action]||''):'');
 const r=await fetch(url,{method,headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:payload?JSON.stringify({action,...payload}):undefined});
 const obj=await r.json().catch(()=>({error:'La API no devolvió JSON.'}));
 if(!r.ok||!obj.ok)throw Error(obj.error||'No se pudo completar la acción.');return obj.data;
}
const _j55params={};
async function j55get(action,params={}){_j55params[action]=Object.entries(params).map(([k,v])=>'&'+encodeURIComponent(k)+'='+encodeURIComponent(v)).join('');try{return await j55api(action);}finally{delete _j55params[action]}}
const j55s=s=>esc(s??'');
const j55opt=(rows,cb)=>rows.map(cb).join('');
function j55head(kicker,title,description){return `<div class="card"><span class="chip">${j55s(kicker)}</span><h2 class="text-2xl font-extrabold mt-3">${j55s(title)}</h2><p class="text-sm mt-2 text-[#8FA3B5]">${j55s(description)}</p></div>`;}
function j55err(e){toast(e?.message||'Error inesperado.');}
function j55require(roles){if(!roles.includes(S.role))return false;return true;}
function j55day(n){return ['', 'Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'][Number(n)]||n;}
function j55clearPreview(){_j55.gradePreview=null;const save=document.getElementById('j55_commit');if(save)save.disabled=true;}
function j55safeFilename(s){return String(s||'Jaguar').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,70);}

// AULAS · Coordinación y Dirección gestionan; las demás áreas académicas consultan.
async function jaguarAulasModule(){
 if(!j55require(['coordinacion_academica','direccion_escolar','control_escolar','control','servicios_docentes']))return '<div class="card">No autorizado.</div>';
 _j55.rooms=await j55get('rooms');const d=_j55.rooms,canEdit=['coordinacion_academica','direccion_escolar','servicios_docentes'].includes(S.role);
 const freeCount=(d.schedule||[]).filter(h=>!h.aula).length;
 const ordinary=d.rooms.filter(r=>r.activo&&r.tipo_espacio==='aula').length;
 const special=d.rooms.filter(r=>r.tipo_espacio!=='aula').length;
 return `<div class="space-y-5">${j55head('ORGANIZACIÓN ACADÉMICA','Aulas y espacios escolares','Inventario, capacidad real por grupo y reserva de salones sin choques de horarios.')}
 <div class="grid md:grid-cols-3 gap-4"><div class="card"><small>Aulas ordinarias disponibles</small><div class="metric">${ordinary}</div><small>${special} espacios especiales excluidos del reparto</small></div><div class="card"><small>Clases con horario</small><div class="metric">${d.schedule.length}</div></div><div class="card"><small>Por asignar</small><div class="metric">${freeCount}</div></div></div>
 ${canEdit?`<div class="card"><h3>Asignación automática · 18 grupos</h3><p class="text-sm text-[#8FA3B5] mt-2">Sólo participan los espacios con tipo <b>Aula ordinaria</b> y estado activo. Laboratorios, auditorios, oficinas y otros espacios nunca entran al reparto. Jaguar distribuye 9 grupos matutinos y 9 vespertinos, máximo dos grupos por aula, con vista previa y revisión de capacidad y horarios.</p><div class="flex flex-wrap gap-2 mt-3"><button class="btn primary" onclick="j55previewAutoRooms()">🎲 Preparar reparto aleatorio</button><button class="btn" id="j55_autocommit" disabled onclick="j55commitAutoRooms()">Confirmar asignaciones</button></div><div id="j55_autopreview" class="mt-3"></div></div><div class="card"><h3>Registrar o actualizar aula</h3><div class="grid md:grid-cols-3 gap-3 mt-3"><input type="hidden" id="j55_roomid"><input class="input" id="j55_roomcode" maxlength="24" placeholder="Clave: A-101"><input class="input" id="j55_roomname" maxlength="70" placeholder="Nombre del espacio"><input class="input" id="j55_roomcap" type="number" min="1" max="1000" placeholder="Capacidad"><input class="input" id="j55_roombuild" placeholder="Edificio (opcional)"><select class="input" id="j55_roomtype" required><option value="">Selecciona tipo de espacio</option><option value="aula">Aula ordinaria · asignable</option><option value="laboratorio">Laboratorio · excluido</option><option value="auditorio">Auditorio · excluido</option><option value="oficina">Oficina · excluida</option><option value="otro">Otro espacio · excluido</option></select><button class="btn primary" onclick="j55saveRoom()">Guardar espacio</button></div><p class="text-xs mt-2 text-[#8FA3B5]">No se pueden renombrar aulas con clases asignadas; la capacidad se verifica al reservar.</p></div>`:''}
 <div class="card"><h3>Inventario de aulas</h3><div class="scroll mt-3"><table class="table"><thead><tr><th>Clave</th><th>Aula</th><th>Capacidad</th><th>Edificio</th><th>Tipo</th><th>Estado</th>${canEdit?'<th>Acción</th>':''}</tr></thead><tbody>${d.rooms.map(r=>`<tr><td>${j55s(r.codigo)}</td><td>${j55s(r.nombre)}</td><td>${r.capacidad} lugares</td><td>${j55s(r.edificio||'—')}</td><td>${j55s(({aula:'Aula ordinaria',laboratorio:'Laboratorio',auditorio:'Auditorio',oficina:'Oficina',otro:'Otro'})[r.tipo_espacio]||'Sin clasificar')}</td><td>${r.activo?'Activa':'Inactiva'}</td>${canEdit?`<td><button class="btn" onclick="j55editRoom(${r.id})">Editar</button></td>`:''}</tr>`).join('')||'<tr><td colspan="6">No hay aulas; registra la primera para asignar horarios.</td></tr>'}</tbody></table></div></div>
 <div class="card"><div class="flex flex-wrap justify-between gap-2"><div><h3>Asignaciones de salones · ${j55s(d.cycle)}</h3><p class="text-xs mt-1 text-[#8FA3B5]">Las aulas asignadas aparecerán también en los horarios PDF existentes.</p></div><input class="input" id="j55_roomfilter" placeholder="Buscar grupo, aula o materia" oninput="j55filterRooms()"></div>
 <div class="scroll mt-3"><table class="table"><thead><tr><th>Grupo</th><th>Materia</th><th>Día y hora</th><th>Alumnos</th><th>Aula actual</th>${canEdit?'<th>Asignar</th>':''}</tr></thead><tbody id="j55_roomrows">${d.schedule.map(h=>j55roomRow(h,canEdit)).join('')||'<tr><td colspan="6">No hay clases programadas.</td></tr>'}</tbody></table></div></div></div>`;
}
function j55roomRow(h,editable){const g=h.grupo_materias||{},id=g.grupo_id||g.grupos?.id,existing=String(h.aula||'');const count=_j55.rooms.group_counts?.[id]||0;
 const compatible=_j55.rooms.rooms.filter(r=>r.activo&&r.tipo_espacio==='aula'&&r.capacidad>=count);const values=`${g.grupos?.clave||''} ${g.materias?.nombre||''} ${existing}`.toLowerCase();
 return `<tr data-roomsearch="${j55s(values)}"><td><b>${j55s(g.grupos?.clave||'—')}</b></td><td>${j55s(g.materias?.nombre||'—')}</td><td>${j55day(h.dia_semana)}<div class="text-xs">${j55s(h.hora_inicio?.slice(0,5))}–${j55s(h.hora_fin?.slice(0,5))}</div></td><td>${count}</td><td>${j55s(existing||'Sin asignar')}</td>${editable?`<td><select class="input" id="j55_assign_${h.id}"><option value="">Sin asignar</option>${compatible.map(r=>`<option value="${r.id}" ${existing===r.nombre?'selected':''}>${j55s(r.codigo)} · ${j55s(r.nombre)} (${r.capacidad})</option>`).join('')}</select><button class="btn mt-1" onclick="j55assign(${h.id})">Aplicar</button></td>`:''}</tr>`;}
function j55filterRooms(){const q=document.getElementById('j55_roomfilter')?.value.toLowerCase()||'';document.querySelectorAll('[data-roomsearch]').forEach(x=>x.style.display=x.dataset.roomsearch.includes(q)?'':'none');}
function j55editRoom(id){const r=_j55.rooms.rooms.find(x=>x.id===id);if(!r)return;[['roomid',r.id],['roomcode',r.codigo],['roomname',r.nombre],['roomcap',r.capacidad],['roombuild',r.edificio||''],['roomtype',r.tipo_espacio||'otro']].forEach(([k,v])=>{document.getElementById('j55_'+k).value=v;});document.getElementById('j55_roomname')?.focus();}
async function j55saveRoom(){try{const id=document.getElementById('j55_roomid').value;const room={id:id||undefined,codigo:document.getElementById('j55_roomcode').value,nombre:document.getElementById('j55_roomname').value,capacidad:document.getElementById('j55_roomcap').value,edificio:document.getElementById('j55_roombuild').value,tipo_espacio:document.getElementById('j55_roomtype').value};await j55api('saveRoom',{room});toast('Aula guardada.');await loadPage('aulas');}catch(e){j55err(e)}}
async function j55assign(id){try{const val=document.getElementById('j55_assign_'+id).value;const room=_j55.rooms.rooms.find(r=>String(r.id)===String(val));if(!confirm(room?`¿Asignar ${room.nombre} a esta clase? Se comprobarán choques y capacidad.`:'¿Quitar el salón de esta clase?'))return;await j55api('assignRoom',{horario_id:id,aula_id:val||null});toast('Aula actualizada y validada.');await loadPage('aulas');}catch(e){j55err(e)}}

async function j55previewAutoRooms(){try{
 _j55.autoPreview=null;const button=document.getElementById('j55_autocommit');if(button)button.disabled=true;
 const seed=1+Math.floor(Math.random()*2147483646);
 const d=await j55get('previewAutoRooms',{seed});_j55.autoPreview=d;
 const panel=document.getElementById('j55_autopreview');if(panel)panel.innerHTML=`<p class="text-sm mb-3">${d.pairs.length} grupos · ${d.actualizar} por asignar · ${d.conservadas} asignaciones conservadas. Revisa todos los salones antes de confirmar.</p><div class="scroll"><table class="table"><thead><tr><th>Grupo</th><th>Turno</th><th>Aula</th><th>Horarios</th><th>Estado</th></tr></thead><tbody>${d.pairs.map(p=>`<tr><td>${j55s(p.grupo)}</td><td>${j55s(p.turno)}</td><td>${j55s(p.aula)}</td><td>${p.horarios}</td><td>${p.conservada?'Conservada':'Nueva'}</td></tr>`).join('')}</tbody></table></div>`;
 if(button)button.disabled=d.actualizar===0;
}catch(e){j55err(e)}}
async function j55commitAutoRooms(){try{
 const p=_j55.autoPreview;if(!p)throw Error('Genera primero la vista previa.');
 if(!confirm(`¿Confirmas el reparto de ${p.pairs.length} grupos? Se actualizarán ${p.actualizar} grupos. Si ocurre un conflicto, no se guardará ningún cambio.`))return;
 const x=await j55api('commitAutoRooms',{seed:p.seed,preview_token:p.token,confirmar:true});
 toast(`Asignados ${x.horarios_asignados} horarios. El reparto se guardó como una sola operación.`);_j55.autoPreview=null;await loadPage('aulas');
}catch(e){j55err(e)}}

// EXÁMENES · banco privado del docente por asignatura.
async function jaguarExamenesModule(){
 if(S.role!=='docente')return '<div class="card">Sólo los docentes gestionan sus exámenes.</div>';
 _j55.init=await j55get('bootstrap');_j55.exams=await j55get('exams');
 const ass=_j55.init.assignments||[],gms=[...new Map(ass.map(a=>[a.grupo_materia_id,a.grupo_materias])).entries()];
 if(!_j55.gm||!gms.some(([id])=>Number(id)===Number(_j55.gm)))_j55.gm=gms[0]?.[0]||0;
 const gm=gms.find(([id])=>Number(id)===Number(_j55.gm))?.[1];_j55.selectedSubject=gm?.materia_id||0;
 if(_j55.selectedSubject)_j55.questions=await j55get('questions',{materia_id:_j55.selectedSubject});else _j55.questions=[];
 return `<div class="space-y-5">${j55head('EVALUACIÓN DOCENTE','Banco de preguntas y exámenes','Genera versiones propias en Word o PDF. Para Google Forms el archivo Apps Script sólo debe ejecutarse desde la cuenta de Servicios Docentes, que será propietaria; la creación integrada y la sincronización quedan pendientes de OAuth.')}
 <div class="card"><h3>Asignatura y grupo</h3><select class="input mt-3" id="j55_gm" onchange="j55changeExamGroup(this.value)">${gms.map(([id,g])=>`<option value="${id}" ${Number(id)===Number(_j55.gm)?'selected':''}>${j55s(g?.grupos?.clave)} · ${j55s(g?.materias?.nombre)}</option>`).join('')}</select></div>
 ${gm?`<div class="card"><h3>Nuevo reactivo</h3><div class="grid md:grid-cols-2 gap-3 mt-3"><select id="j55_qtype" class="input" onchange="j55questionType()"><option value="opcion_multiple">Opción múltiple</option><option value="verdadero_falso">Verdadero o falso</option><option value="abierta">Respuesta abierta</option></select><input class="input" id="j55_qpoints" type="number" min="1" max="100" value="1" placeholder="Puntos"></div><textarea id="j55_qtext" class="textarea mt-3" rows="3" maxlength="2500" placeholder="Enunciado del reactivo"></textarea><div id="j55_optionArea" class="mt-2"><textarea id="j55_qoptions" class="textarea" rows="3" placeholder="Una opción por línea; de 2 a 6"></textarea><label class="text-xs block mt-2">Número de la respuesta correcta (1, 2, 3...)</label><input id="j55_qanswer" class="input" type="number" value="1" min="1" max="6"></div><button class="btn primary mt-3" onclick="j55saveQuestion()">+ Guardar en banco</button></div>
 <div class="card"><h3>Componer examen</h3><div class="grid md:grid-cols-2 gap-3 mt-3"><input class="input" id="j55_examTitle" maxlength="160" placeholder="Título del examen"><input class="input" id="j55_examInstructions" maxlength="1500" placeholder="Instrucciones generales"></div><div class="scroll mt-3"><table class="table"><thead><tr><th>Seleccionar</th><th>Pregunta</th><th>Tipo</th><th>Puntos</th></tr></thead><tbody>${_j55.questions.map(q=>`<tr><td><input class="j55-qchecked" type="checkbox" value="${q.id}"></td><td>${j55s(q.enunciado)}</td><td>${j55s(q.tipo.replaceAll('_',' '))}</td><td>${q.puntos}</td></tr>`).join('')||'<tr><td colspan="4">Todavía no hay preguntas para esta asignatura.</td></tr>'}</tbody></table></div><button class="btn primary mt-4" onclick="j55saveExam()">Guardar examen con preguntas elegidas</button></div>`:'<div class="card">Primero asigna un grupo-materia al docente para habilitar el generador.</div>'}
 <div class="card"><h3>Mis exámenes guardados</h3><div class="scroll mt-3"><table class="table"><thead><tr><th>Título</th><th>Fecha</th><th>Reactivos</th><th>Descargas</th></tr></thead><tbody>${_j55.exams.map(e=>`<tr><td>${j55s(e.titulo)}</td><td>${j55s(new Date(e.creado_at).toLocaleDateString('es-MX'))}</td><td>${e.preguntas?.length||0}</td><td class="flex flex-wrap gap-1"><button class="btn" onclick="j55exportExam(${e.id},'pdf')">PDF</button><button class="btn" onclick="j55exportExam(${e.id},'docx')">Word</button><button class="btn" onclick="j55exportExam(${e.id},'forms')">Google Forms</button></td></tr>`).join('')||'<tr><td colspan="4">Sin exámenes guardados.</td></tr>'}</tbody></table></div><p class="text-xs mt-3 text-[#8FA3B5]">Google Forms se crea desde tu cuenta de Google ejecutando el archivo .gs descargado; no se crean formularios sin autorización.</p></div></div>`;
}
async function j55changeExamGroup(id){_j55.gm=Number(id);await loadPage('examenes');}
function j55questionType(){const tipo=document.getElementById('j55_qtype').value;const area=document.getElementById('j55_optionArea');area.innerHTML=tipo==='opcion_multiple'?'<textarea id="j55_qoptions" class="textarea" rows="3" placeholder="Una opción por línea; de 2 a 6"></textarea><label class="text-xs block mt-2">Número de la opción correcta</label><input id="j55_qanswer" class="input" type="number" value="1" min="1" max="6">':tipo==='verdadero_falso'?'<select class="input" id="j55_qanswer"><option value="true">Verdadero</option><option value="false">Falso</option></select>':'<p class="text-sm text-[#8FA3B5]">Respuesta abierta: se calificará manualmente.</p>';}
async function j55saveQuestion(){try{const tipo=document.getElementById('j55_qtype').value;let opciones=[],respuesta=null;if(tipo==='opcion_multiple'){opciones=document.getElementById('j55_qoptions').value.split('\n').map(x=>x.trim()).filter(Boolean);respuesta=Number(document.getElementById('j55_qanswer').value)-1;}else if(tipo==='verdadero_falso')respuesta=document.getElementById('j55_qanswer').value;await j55api('saveQuestion',{materia_id:_j55.selectedSubject,question:{tipo,enunciado:document.getElementById('j55_qtext').value,puntos:document.getElementById('j55_qpoints').value,opciones,respuesta}});toast('Reactivo guardado.');await loadPage('examenes');}catch(e){j55err(e)}}
async function j55saveExam(){try{const question_ids=[...document.querySelectorAll('.j55-qchecked:checked')].map(c=>Number(c.value));const r=await j55api('saveExam',{grupo_materia_id:_j55.gm,titulo:document.getElementById('j55_examTitle').value,instrucciones:document.getElementById('j55_examInstructions').value,question_ids});toast(`Examen #${r.id} guardado.`);await loadPage('examenes');}catch(e){j55err(e)}}
function j55download(base64,name,mime){const binary=atob(base64);const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:mime}));const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
async function j55exportExam(id,format){try{const r=await j55api('exportExam',{id,format});j55download(r.content,r.filename,r.mime);toast(format==='forms'?'Descargado. Abre script.google.com, pega el código y ejecuta crearExamenJaguar para crear Google Forms.':'Examen generado.');if(format==='forms')modal('Crear Google Forms sin costo','<p>Abre <b>script.google.com</b> con tu cuenta autorizada, crea un proyecto, pega el archivo .gs y ejecuta <b>crearExamenJaguar()</b>. Google solicitará permisos y mostrará las URLs del formulario en el registro.</p>');}catch(e){j55err(e)}}

// CARGA MASIVA · Registro oficial de periodo, validación previa en servidor y lote atómico.
async function jaguarCalificacionesMasivasModule(){
 if(!j55require(['control_escolar','control','direccion_escolar']))return '<div class="card">Sólo Control Escolar o Dirección.</div>';
 _j55.init=await j55get('bootstrap');const d=_j55.init;
 return `<div class="space-y-5">${j55head('CONTROL ACADÉMICO','Carga masiva de calificaciones','Importa una lista Excel por grupo, asignatura y periodo. Corrige errores antes de guardar; las notas cerradas mediante rúbricas están protegidas.')}
 <div class="card"><div class="grid md:grid-cols-2 gap-3"><div><label class="text-xs">Grupo y asignatura</label><select id="j55_gradegm" class="input mt-1" onchange="j55resetGrades()"><option value="">Selecciona grupo-materia</option>${j55opt(d.gms||[],g=>`<option value="${g.id}">${j55s(g.grupos?.clave||'—')} · ${j55s(g.materias?.nombre||'—')}</option>`)}</select></div><div><label class="text-xs">Periodo escolar · ${j55s(d.cycle)}</label><select id="j55_gradeperiod" class="input mt-1" onchange="j55resetGrades()"><option value="">Selecciona periodo</option>${j55opt(d.periods||[],p=>`<option value="${p.id}">${j55s(p.nombre)}</option>`)}</select></div></div>
 <div class="flex flex-wrap gap-2 mt-4"><button class="btn" onclick="j55downloadGradeTemplate()">1. Descargar plantilla Excel</button><input id="j55_gradefile" class="input" type="file" accept=".xlsx,.xls,.csv" onchange="j55readGradesFile(this)"><button class="btn" onclick="j55loadGradeRoster()">Ver alumnos del grupo</button></div>
 <div class="mt-4 flex items-center gap-2"><label><input id="j55_allow_updates" type="checkbox" onchange="j55clearPreview()"> Permitir rectificar notas previamente registradas (excepto rúbricas cerradas)</label></div><textarea class="textarea mt-2" id="j55_grade_motivo" rows="2" oninput="j55clearPreview()" placeholder="Motivo de rectificación (obligatorio al actualizar; mínimo 20 caracteres)"></textarea>
 <p class="text-xs mt-3 text-[#8FA3B5]">La plantilla utiliza MATRÍCULA · CALIFICACION · OBSERVACIONES. Admite notas de 0.0 a 10.0, hasta 250 filas por lote. Ningún registro cambia durante la vista previa.</p></div>
 <div class="card"><div class="flex gap-3 flex-wrap justify-between"><h3>2. Revisar y corregir</h3><button class="btn primary" onclick="j55previewGradeBatch()">Validar lote en servidor</button></div><div id="j55_grades_status" class="text-sm mt-2 text-[#8FA3B5]">Selecciona y lee un Excel para mostrar la vista previa.</div><div id="j55_grades_table" class="scroll mt-3"></div><button class="btn primary mt-4" id="j55_commit" onclick="j55commitGradeBatch()" disabled>3. Confirmar importación de todo el lote</button></div></div>`;
}
function j55resetGrades(){_j55.gradeRows=[];_j55.roster=null;j55clearPreview();const a=document.getElementById('j55_grades_table');if(a)a.innerHTML='';}
function j55gradeSelection(){const gm=Number(document.getElementById('j55_gradegm')?.value),period=Number(document.getElementById('j55_gradeperiod')?.value);if(!gm||!period)throw Error('Selecciona grupo-materia y periodo.');return {gm,period};}
async function j55loadGradeRoster(){try{const {gm,period}=j55gradeSelection();_j55.roster=await j55get('gradeRoster',{grupo_materia_id:gm,periodo_id:period});document.getElementById('j55_grades_status').textContent=`${_j55.roster.students.length} alumnos activos en ${_j55.roster.gm?.grupos?.clave}. ${_j55.roster.existing.length} calificaciones existentes.`;return _j55.roster;}catch(e){j55err(e);return null}}
async function j55downloadGradeTemplate(){try{if(!window.XLSX)throw Error('La biblioteca de Excel no está disponible.');const d=await j55loadGradeRoster();if(!d)return;const wb=XLSX.utils.book_new();const rows=[['MATRICULA','CALIFICACION','OBSERVACIONES'],...d.students.map(st=>[st.matricula,'',''])];const ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=[{wch:26},{wch:18},{wch:58}];ws['!freeze']='A2';XLSX.utils.book_append_sheet(wb,ws,'CALIFICACIONES');XLSX.writeFile(wb,'ITHLA-Carga-'+j55safeFilename(d.gm?.grupos?.clave)+'-'+j55safeFilename(d.gm?.materias?.nombre)+'.xlsx');toast('Plantilla descargada. Llena las notas sin modificar las matrículas.');}catch(e){j55err(e)}}
async function j55readGradesFile(el){try{
 j55clearPreview();const file=el.files?.[0];if(!file)return;
 if(file.size>5*1024*1024)throw Error('El archivo debe pesar menos de 5 MB.');
 if(!window.XLSX)throw Error('No se cargó la biblioteca de Excel.');j55gradeSelection();
 const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});
 if(wb.Sheets.JAGUAR_META)throw Error('Este Excel es una bitácora diaria, no una carga de calificaciones finales. Súbelo en Bitácora docente; para Control Escolar descarga aquí la plantilla CALIFICACIONES.');
 if(wb.Sheets.ITHLA_META)throw Error('Este Excel es de ponderaciones de rúbrica, no de notas finales. Impórtalo en Rúbricas y Evaluaciones o descarga la plantilla CALIFICACIONES de esta sección.');
 const normalize=x=>String(x??'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
 let match=null;
 for(const sheetName of ['CALIFICACIONES',...wb.SheetNames.filter(n=>n!=='CALIFICACIONES')]){
   const ws=wb.Sheets[sheetName];if(!ws)continue;
   const arr=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});
   for(let i=0;i<Math.min(15,arr.length);i++){
     const head=(arr[i]||[]).map(normalize),mi=head.indexOf('MATRICULA'),gi=head.indexOf('CALIFICACION'),oi=head.indexOf('OBSERVACIONES');
     if(mi>=0&&gi>=0){match={arr,headerRow:i,mi,gi,oi,sheetName};break;}
   }
   if(match)break;
 }
 if(!match)throw Error('No se encontró una tabla con las columnas MATRÍCULA y CALIFICACIÓN. Descarga la plantilla institucional; no uses una bitácora o rúbrica como archivo de notas finales.');
 const {arr,headerRow,mi,gi,oi}=match;
 const rows=arr.slice(headerRow+1).filter(r=>String(r?.[mi]??'').trim()).map(r=>({
   matricula:String(r[mi]??'').trim().toUpperCase(),
   calificacion:r[gi]??'',observaciones:oi>=0?String(r[oi]??''):''
 }));
 if(!rows.length)throw Error('No se encontraron matrículas con datos en el archivo.');
 if(rows.length>250)throw Error('Máximo 250 alumnos por lote.');
 _j55.gradeRows=rows;j55renderGradeRows();
 document.getElementById('j55_grades_status').textContent=`${rows.length} filas leídas de «${match.sheetName}». Puedes revisar y corregir antes de validar en el servidor.`;
}catch(e){j55err(e)}}
function j55renderGradeRows(results=null){const rows=results||_j55.gradeRows;document.getElementById('j55_grades_table').innerHTML=`<table class="table"><thead><tr><th>#</th><th>Matrícula</th><th>Alumno</th><th>Calificación</th><th>Observaciones</th><th>Validación</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td><td><input class="input" value="${j55s(r.matricula)}" oninput="j55editGrade(${i},'matricula',this.value)"></td><td>${j55s(r.nombre||'—')}</td><td><input class="input" type="number" step="0.1" min="0" max="10" value="${j55s(r.calificacion)}" oninput="j55editGrade(${i},'calificacion',this.value)"></td><td><input class="input" value="${j55s(r.observaciones||'')}" oninput="j55editGrade(${i},'observaciones',this.value)"></td><td><span class="chip">${j55s(r.status||'Sin validar')}</span><div class="text-xs">${j55s(r.detail||'')}</div></td></tr>`).join('')||'<tr><td colspan="6">No hay filas.</td></tr>'}</tbody></table>`;}
function j55editGrade(i,k,value){if(_j55.gradeRows[i])_j55.gradeRows[i][k]=value;j55clearPreview();const status=document.getElementById('j55_grades_status');if(status)status.textContent='Hay cambios sin validar. Haz clic en «Validar lote» antes de confirmar.';}
function j55GradeBody(){const {gm,period}=j55gradeSelection();return {grupo_materia_id:gm,periodo_id:period,rows:_j55.gradeRows,allow_updates:document.getElementById('j55_allow_updates')?.checked===true,motivo:document.getElementById('j55_grade_motivo')?.value||''};}
async function j55previewGradeBatch(){try{j55clearPreview();const result=await j55api('previewGrades',j55GradeBody());_j55.gradePreview=result;const s=result.summary;document.getElementById('j55_grades_status').innerHTML=`<b>Vista previa:</b> ${s.nuevas} nuevas, ${s.actualizar} correcciones, ${s.sin_cambio} sin cambios, <b>${s.errores} errores</b>. ${s.errores?'Corrige antes de registrar.':'Lista para confirmación.'}`;j55renderGradeRows(result.rows);document.getElementById('j55_commit').disabled=s.errores>0; }catch(e){j55err(e)}}
async function j55commitGradeBatch(){try{if(!_j55.gradePreview||_j55.gradePreview.summary.errores)throw Error('Primero valida el lote sin errores.');const s=_j55.gradePreview.summary;if(!confirm(`¿CONFIRMAR importación de ${s.nuevas} nuevas notas y ${s.actualizar} correcciones? Esta operación quedará auditada y no puede deshacerse desde aquí.`))return;const result=await j55api('commitGrades',{...j55GradeBody(),preview_token:_j55.gradePreview.token});j55clearPreview();document.getElementById('j55_commit').disabled=true;document.getElementById('j55_grades_status').textContent=`Guardadas: ${result.insertados} nuevas, ${result.actualizados} actualizadas, ${result.sin_cambio} sin cambios. Operación ${result.operacion_id}`;toast('Carga aplicada en una única transacción.');}catch(e){j55clearPreview();j55err(e)}}

// Añadir navegación sin reemplazar las existentes ni sus roles.
// Alias institucional equivalente a Control Escolar; mantener todas sus opciones.
if(!roleNav.control&&roleNav.control_escolar)roleNav.control=roleNav.control_escolar.map(x=>[...x]);
for(const role of ['coordinacion_academica','direccion_escolar','control_escolar','control','servicios_docentes']){
 if(roleNav[role]&&!roleNav[role].some(x=>x[0]==='aulas'))roleNav[role].push(['aulas','🏫 Aulas']);
}
if(!roleNav.control_escolar && Array.isArray(controlNav) && !controlNav.some(x=>x[0]==='aulas'))controlNav.push(['aulas','🏫 Aulas']);
if(roleNav.docente&&!roleNav.docente.some(x=>x[0]==='examenes'))roleNav.docente.push(['examenes','📝 Banco de exámenes']);
for(const role of ['control_escolar','control','direccion_escolar']){
 const target=roleNav[role]||(role==='control_escolar'?controlNav:null);
 if(target&&!target.some(x=>x[0]==='calificaciones_masivas'))target.push(['calificaciones_masivas','📤 Carga masiva']);
}
Object.assign(titles,{aulas:'Aulas y espacios',examenes:'Banco de exámenes',calificaciones_masivas:'Carga masiva de calificaciones'});
