/* Jaguar Classroom V5.7 · Registro manual + Google OAuth solo lectura + vínculo supervisado. */
const J56={catalog:null,records:new Map(),selectedGm:null,filter:''};
const j56esc=v=>esc(String(v??''));
async function j56api(action,payload){
 const {data:{session}}=await supabaseClient.auth.getSession();if(!session)throw Error('Inicia sesión antes de continuar.');
 const method=payload?'POST':'GET';
 const url='/api/classroom'+(method==='GET'?'?action='+encodeURIComponent(action):'');
 const r=await fetch(url,{method,headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:payload?JSON.stringify({action,...payload}):undefined});
 const d=await r.json().catch(()=>({error:'Respuesta inesperada del servidor.'}));
 if(!r.ok||!d.ok)throw Error(d.error||'No fue posible completar la operación.');return d.data;
}
const J57={googleCourses:[]};
async function j57api(endpoint,action,payload){
 const {data:{session}}=await supabaseClient.auth.getSession();if(!session)throw Error('Debes iniciar sesión.');
 const method=payload===undefined?'GET':'POST';
 const route='/api/'+endpoint+(method==='GET'?'?action='+encodeURIComponent(action):'');
 const r=await fetch(route,{method,headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:method==='POST'?JSON.stringify({action,...payload}):undefined,cache:'no-store'});
 const d=await r.json().catch(()=>({error:'Respuesta desconocida del servidor.'}));
 if(!r.ok||!d.ok)throw Error(d.error||'No se pudo consultar Google.');
 return d.data;
}
async function j57connect(){
 try{
  const data=await j57api('google-oauth','start',{});
  if(!data.url||!data.url.startsWith('https://accounts.google.com/'))throw Error('Google no proporcionó una dirección de autorización válida.');
  window.location.assign(data.url);
 }catch(e){toast(e.message||'No fue posible conectar Google.');}
}
async function j57disconnect(){
 if(!confirm('¿Desconectar el Gmail de Servicios Docentes? Los registros de clases en Jaguar permanecerán, pero no se podrán actualizar desde Google hasta volver a conectar.'))return;
 try{await j57api('google-oauth','disconnect',{});toast('Google desconectado del servidor.');await loadPage('classroom');}
 catch(e){toast(e.message);}
}
// Creación en Google: formato de clase, sección y descripción confirmado por Servicios Docentes.
function j57creationGms(){
 const linked=new Set((J56.catalog?.rows||[]).filter(r=>r.google_course_id).map(r=>Number(r.grupo_materia_id)));
 return (J56.catalog?.gms||[]).filter(g=>!linked.has(Number(g.id))&&g.grupos?.activo!==false);
}
function j57creationSelectChanged(){
 const gmId=Number(document.getElementById('j57createGm')?.value||0);
 const teachers=j56teachersFor(gmId);
 const el=document.getElementById('j57createTeacher');if(!el)return;
 el.innerHTML='<option value="">Seleccionar docente</option>'+teachers.map(t=>`<option value="${Number(t.id)}">${j56esc(t.nombre_completo)}</option>`).join('');
 if(teachers.length===1)el.value=String(teachers[0].id);
 j57previewCreate();
}
function j57previewCreate(){
 const preview=document.getElementById('j57createPreview'),submit=document.getElementById('j57createButton');
 if(!preview||!submit)return;
 submit.disabled=true;
 const gm=J56.catalog?.gms?.find(g=>Number(g.id)===Number(document.getElementById('j57createGm')?.value||0));
 const tid=Number(document.getElementById('j57createTeacher')?.value||0);
 const name=j56teacherName(tid).trim();
 const pref=document.getElementById('j57treatment')?.value||'';
 if(!gm||!name||!pref){preview.textContent='Selecciona una materia, su docente y el tratamiento PROF. o PROFA.';return;}
 const key=String(gm.grupos?.clave||'').replace(/\s+/g,'').toLocaleUpperCase('es-MX');
 const match=key.match(/^(\d{1,2})(?:[°º.\-])?([A-ZÑ]{1,3})$/u);
 if(!match){preview.textContent='La clave del grupo debe tener formato 1F, 1°F o equivalente. Revisa la ficha del grupo.';return;}
 const full=`${match[1]}°${match[2]} | ${j56matter(gm).trim().toLocaleUpperCase('es-MX')}`;
 const teacher=`${pref} ${name.toLocaleUpperCase('es-MX')}`;
 if(full.length>150||teacher.length>800){preview.textContent='Datos demasiado largos para Google Classroom.';return;}
 preview.innerHTML=`<b>Nombre de clase:</b> ${j56esc(full)}<div class="mt-1"><b>Sección y descripción:</b> ${j56esc(teacher)}</div><div class="text-xs mt-2">Se creará pendiente de activación con el Gmail de Servicios Docentes. No modifica las 9 clases existentes.</div>`;
 preview.dataset.nombre=full;preview.dataset.docente=teacher;submit.disabled=false;
}
async function j57create(){
 const preview=document.getElementById('j57createPreview'),button=document.getElementById('j57createButton');
 if(!preview?.dataset.nombre||!preview?.dataset.docente||button?.disabled)return;
 const gmId=Number(document.getElementById('j57createGm')?.value||0),tid=Number(document.getElementById('j57createTeacher')?.value||0);
 const treatment=document.getElementById('j57treatment')?.value||'';
 if(!confirm(`¿Crear esta clase en GOOGLE CLASSROOM?\n\n${preview.dataset.nombre}\n${preview.dataset.docente}\n\nSe creará pendiente de activación y no se duplicarán clases vinculadas.`))return;
 button.disabled=true;
 try{
  const result=await j57api('google-classroom','create',{grupo_materia_id:gmId,docente_id:tid,tratamiento:treatment,nombre_confirmado:preview.dataset.nombre,docente_confirmado:preview.dataset.docente,confirmado:true});
  let topicMessage='';
  try{const topics=await j57api('google-classroom','ensure_topics',{grupo_materia_id:gmId,confirmado:true});topicMessage=` Se verificaron ${topics.total} temas de periodo.`;}
  catch(e){topicMessage=' Los temas quedaron pendientes: '+e.message+' Activa la clase y utiliza Preparar temas.';}
  toast('Google creó la clase. Abre Classroom con Servicios Docentes y actívala.'+topicMessage);
  await loadPage('classroom');
 }catch(e){toast(e.message||'No se pudo crear Classroom.');button.disabled=false;}
}
function j57googleRows(){
 const gm=J56.catalog?.gms||[];
 const linked=new Map((J56.catalog?.rows||[]).filter(r=>r.google_course_id).map(r=>[String(r.google_course_id),Number(r.grupo_materia_id)]));
 const options=gm.map(g=>`<option value="${Number(g.id)}">${j56esc(j56group(g))} · ${j56esc(j56matter(g))}</option>`).join('');
 return J57.googleCourses.map(c=>{
  const tied=linked.get(String(c.id))||c.grupo_materia_id;
  const linkedText=tied?`<span class="chip">Vinculada a ${j56esc(j56group(gm.find(g=>Number(g.id)===Number(tied))||{}))}</span>`:'';
  const select=tied?`${linkedText} <button class="btn" onclick="j57resync('${j56esc(c.id)}',${Number(tied)})">Actualizar datos</button>`:`<select id="j57gm_${j56esc(c.id)}" class="input" style="max-width:250px"><option value="">Seleccionar grupo y materia</option>${options}</select> <button class="btn" onclick="j57link('${j56esc(c.id)}')">Vincular</button>`;
  return `<tr><td><strong>${j56esc(c.nombre)}</strong><div class="text-xs">${j56esc(c.seccion)}</div></td><td>${j56esc(c.codigo||'Pendiente')}</td><td>${j56esc(c.estado)}</td><td>${select}</td></tr>`;
 }).join('')||'<tr><td colspan="4">No se encontraron clases accesibles desde el Gmail conectado.</td></tr>';
}
async function j57list(){
 try{
  const el=document.getElementById('j57list');if(!el)return;
  el.innerHTML='<p class="text-sm">Consultando clases de Google…</p>';
  const data=await j57api('google-classroom','list');
  J57.googleCourses=data.classes||[];
  const total=J57.googleCourses.length;
  if(!total){
   el.innerHTML=`<div class="card mt-3"><p><b>Google respondió correctamente, pero no devolvió clases accesibles.</b></p><p class="text-sm mt-2">Comprueba que el correo mostrado arriba sea el mismo con el que ves tus clases en <a href="https://classroom.google.com/" target="_blank" rel="noopener noreferrer">Google Classroom</a>. Revisa el perfil de Google activo y si las clases pertenecen a otra cuenta. Jaguar no ha modificado ni eliminado ninguna clase.</p><p class="text-xs mt-2">Si ese Gmail es el correcto y tienes clases visibles, consulta los registros de Vercel de la ruta /api/google-classroom y comparte únicamente el mensaje de error, nunca tokens ni credenciales.</p></div>`;
   return;
  }
  el.innerHTML=`<p class="text-sm mb-2">Se encontraron ${total} clases accesibles para el Gmail conectado (incluidas las archivadas, si Google las devuelve). La vinculación <b>no modifica Google Classroom</b>. Comprueba el grupo y la materia antes de guardar.</p><div class="scroll"><table class="table"><thead><tr><th>Clase Google</th><th>Código</th><th>Estado</th><th>Asociación en Jaguar</th></tr></thead><tbody>${j57googleRows()}</tbody></table></div>`;
 }catch(e){const el=document.getElementById('j57list');if(el)el.textContent=e.message||'No se pudo consultar Google.';}
}
async function j57resync(courseId,gmId){
 if(!confirm('¿Actualizar el código, nombre y enlace de este Classroom desde Google? No se cambiarán las calificaciones.'))return;
 try{await j57api('google-classroom','link',{google_course_id:courseId,grupo_materia_id:gmId});toast('Datos de Classroom actualizados.');await loadPage('classroom');}
 catch(e){toast(e.message||'No se pudo actualizar.');}
}
async function j57link(courseId){
 const id=Number(document.getElementById('j57gm_'+courseId)?.value||0);
 if(!id)return toast('Selecciona el grupo y la materia.');
 const course=J57.googleCourses.find(c=>String(c.id)===String(courseId));
 const gm=J56.catalog?.gms?.find(g=>Number(g.id)===id);
 if(!confirm(`¿Vincular "${course?.nombre||courseId}" con ${j56group(gm)} · ${j56matter(gm)}? Verifica que sean la misma clase. Esta acción reemplaza los datos manuales de esa materia.`))return;
 try{await j57api('google-classroom','link',{google_course_id:courseId,grupo_materia_id:id});toast('Classroom vinculado.');await loadPage('classroom');}
 catch(e){toast(e.message||'No se pudo vincular el curso.');}
}
function j56group(gm){return gm.grupos?.clave||'Grupo';}
function j56matter(gm){return gm.materias?.nombre||'Materia';}
function j56teacherName(id){return J56.catalog?.teachers?.find(t=>Number(t.id)===Number(id))?.nombre_completo||'';}
function j56teachersFor(gmId){return [...new Set((J56.catalog?.assignments||[]).filter(x=>Number(x.grupo_materia_id)===Number(gmId)).map(x=>Number(x.docente_id)))].map(id=>J56.catalog.teachers.find(t=>Number(t.id)===id)).filter(Boolean);}
function j56getRecord(gmId){return J56.records.get(Number(gmId));}
function j56gmOptions(){return (J56.catalog?.gms||[]).map(g=>`<option value="${Number(g.id)}">${j56esc(j56group(g))} · ${j56esc(j56matter(g))}</option>`).join('');}
function j56teacherOptions(gmId,selected){const t=j56teachersFor(gmId);return `<option value="">Sin docente titular confirmado</option>`+t.map(x=>`<option value="${Number(x.id)}" ${Number(x.id)===Number(selected)?'selected':''}>${j56esc(x.nombre_completo)}</option>`).join('');}
function j56status(r){return r?.estado==='registrada'?'Registrada':r?.estado==='archivada'?'Archivada':'Pendiente';}
function j56renderRows(){
 const gm=(J56.catalog?.gms||[]).filter(g=>j56group(g).toLowerCase().includes(J56.filter)||j56matter(g).toLowerCase().includes(J56.filter));
 const manager=S.role==='servicios_docentes';
 return gm.map(g=>{const r=j56getRecord(g.id),teacher=r?.docente_id?j56teacherName(r.docente_id):j56teachersFor(g.id).map(t=>t.nombre_completo).join(' / ');
  return `<tr><td>${j56esc(j56group(g))}</td><td><b>${j56esc(j56matter(g))}</b></td><td>${j56esc(teacher||'Por asignar')}</td><td><span class="chip">${j56status(r)}</span></td><td>${j56esc(r?.codigo_union||'—')}</td><td>${r?.enlace_clase?`<a href="${j56esc(r.enlace_clase)}" target="_blank" rel="noopener noreferrer">Abrir clase ↗</a>`:'—'}</td>${manager?`<td><button class="btn" onclick="j56edit(${Number(g.id)})">${r?'Editar':'Registrar'}</button></td>`:''}</tr>`;
 }).join('')||`<tr><td colspan="${manager?7:6}">No hay materias/grupos que mostrar.</td></tr>`;
}
function j56drawRows(){const t=document.getElementById('j56rows');if(t)t.innerHTML=j56renderRows();}
function j56search(v){J56.filter=String(v||'').toLowerCase().trim();j56drawRows();}
function j56selectGroupMatter(id){
 const gm=J56.catalog.gms.find(x=>Number(x.id)===Number(id));if(!gm)return;
 J56.selectedGm=Number(id);const r=j56getRecord(id)||{};
 const tf=document.getElementById('j56teacher');tf.innerHTML=j56teacherOptions(id,r.docente_id);
 document.getElementById('j56name').value=r.nombre||`${j56matter(gm)} · ${j56group(gm)} · ${J56.catalog.cycle}`;
 document.getElementById('j56desc').value=r.descripcion||'';
 document.getElementById('j56code').value=r.codigo_union||'';
 document.getElementById('j56url').value=r.enlace_clase||'';
 document.getElementById('j56gid').value=r.google_course_id||'';
 document.getElementById('j56status').value=r.estado||'pendiente';
 const editGoogle=r.origen==='google';
 for(const id of ['j56code','j56url','j56gid'])document.getElementById(id).disabled=editGoogle;
 document.getElementById('j56source').textContent=editGoogle?'Esta clase está vinculada con Google: sus datos se sincronizarán desde la conexión autorizada.':'Registro manual; puedes vincular clases Google desde el panel superior.';
}
function j56edit(id){const sel=document.getElementById('j56gm');if(!sel)return;sel.value=String(id);j56selectGroupMatter(id);document.getElementById('j56editor')?.scrollIntoView({block:'start',behavior:'smooth'});}
async function j56save(){
 try{
  const fields={grupo_materia_id:Number(document.getElementById('j56gm').value),docente_id:document.getElementById('j56teacher').value||null,nombre:document.getElementById('j56name').value,descripcion:document.getElementById('j56desc').value,codigo_union:document.getElementById('j56code').value,enlace_clase:document.getElementById('j56url').value,google_course_id:document.getElementById('j56gid').value,estado:document.getElementById('j56status').value};
  const b=document.getElementById('j56save');b.disabled=true;
  try{await j56api('save',{record:fields});toast('Clase registrada correctamente.');await loadPage('classroom');}
  finally{b.disabled=false;}
 }catch(e){toast(e.message||'No se pudo guardar la clase.');}
}
async function j56download(){try{
 const groupId=Number(document.getElementById('j56groupPDF').value);
 if(!groupId)throw Error('Selecciona un grupo.');
 const d=await j56getPDF(groupId);
 downloadPdf(d.content,d.filename);
 toast('Directorio PDF generado. Incluye las clases pendientes.');
 }catch(e){toast(e.message||'No se pudo descargar el PDF.');}
}
async function j56getPDF(groupId){
 const {data:{session}}=await supabaseClient.auth.getSession();if(!session)throw Error('Sesión expirada.');
 const r=await fetch('/api/classroom?action=pdf&grupo_id='+encodeURIComponent(groupId),{headers:{Authorization:'Bearer '+session.access_token}});
 const d=await r.json().catch(()=>({error:'PDF no disponible.'}));if(!r.ok||!d.ok)throw Error(d.error||'Error al generar PDF.');return d.data;
}
async function jaguarClassroomModule(){
 if(!['servicios_docentes','docente','coordinacion_academica','control_escolar','control','direccion_escolar'].includes(S.role))return '<div class="card">No autorizado.</div>';
 J56.catalog=await j56api('bootstrap');J56.records=new Map((J56.catalog.rows||[]).map(r=>[Number(r.grupo_materia_id),r]));
 const manager=S.role==='servicios_docentes';const googleStatus=manager?await j57api('google-oauth','status').catch(e=>({configured:false,connected:false,detail:e.message})):null;const groups=[...new Map(J56.catalog.gms.map(g=>[Number(g.grupo_id),g.grupos])).entries()].sort((a,b)=>String(a[1]?.clave).localeCompare(String(b[1]?.clave),'es'));
 const registered=(J56.catalog.rows||[]).filter(r=>r.estado==='registrada').length;
 const displayed=J56.catalog.gms.length;const pending=displayed-registered;
 const first=J56.catalog.gms[0];
 const googlePanel=manager?`<div class="card"><h3>Conexión con Google · Servicios Docentes</h3><p class="text-sm mt-2">Sincroniza y crea clases; también prepara los temas de evaluación y permite importar notas al componente Classroom de la rúbrica, con revisión y confirmación del docente.</p>
  <div class="mt-3 text-sm"><b>Estado:</b> ${googleStatus?.connected?'Conectada: '+j56esc(googleStatus.correo):(googleStatus?.configured?'Pendiente de conectar':'Faltan variables privadas o la migración de Google OAuth en el servidor')}</div>
  ${googleStatus?.connected?`<div class="flex flex-wrap gap-3 mt-3"><button class="btn primary" onclick="j57list()">Consultar mis Classroom</button><button class="btn" onclick="j57disconnect()">Desconectar Google</button></div><div id="j57list" class="mt-3"></div>`:
  `<button class="btn primary mt-3" ${!googleStatus?.configured?'disabled':''} onclick="j57connect()">Conectar Gmail de Servicios Docentes</button>`}
  <p class="text-xs mt-2">Propiedad institucional centralizada. Las clases se relacionan con Jaguar sólo después de seleccionar y confirmar su materia-grupo.</p>
  </div>`:'';
 const toCreate=manager&&googleStatus?.connected?j57creationGms():[];
 const creationPanel=manager&&googleStatus?.connected?`<div class="card"><h3>Crear clase en Google Classroom</h3><p class="text-sm mt-2">El nombre y los datos del docente se generan con el formato institucional. Sólo se puede crear una clase si esa materia y grupo aún no tienen Google Classroom vinculado. Las clases nuevas requieren activación desde Google.</p>
 <div class="grid md:grid-cols-3 gap-3 mt-4"><label class="text-sm">Grupo y materia<select id="j57createGm" class="input mt-1" onchange="j57creationSelectChanged()"><option value="">Seleccionar materia y grupo</option>${toCreate.map(g=>`<option value="${Number(g.id)}">${j56esc(j56group(g))} · ${j56esc(j56matter(g))}</option>`).join('')}</select></label>
 <label class="text-sm">Docente asignado<select id="j57createTeacher" class="input mt-1" onchange="j57previewCreate()"><option value="">Seleccionar materia primero</option></select></label>
 <label class="text-sm">Tratamiento<select id="j57treatment" class="input mt-1" onchange="j57previewCreate()"><option value="">Seleccionar</option><option value="PROF.">PROF.</option><option value="PROFA.">PROFA.</option></select></label></div>
 <div id="j57createPreview" class="text-sm mt-3" style="padding:12px;border:1px solid rgba(160,178,196,.25);border-radius:8px">Selecciona materia, docente y tratamiento para ver el nombre exacto.</div>
 <button id="j57createButton" class="btn primary mt-3" onclick="j57create()" disabled>Crear clase en Google</button>
 <p class="text-xs mt-2">Si acabas de habilitar la creación, desconecta y vuelve a conectar Google para autorizar el permiso nuevo. La cuenta Gmail personal no puede crear cursos directamente en estado ACTIVO mediante la API.</p></div>`:'';
 const page=`<div class="space-y-5"><div class="card"><span class="chip">SERVICIOS DOCENTES · CLASSROOM</span><h2 class="text-2xl font-extrabold mt-3">Directorio institucional de Google Classroom</h2><p class="text-sm mt-2">Una clase por materia, grupo y ciclo escolar. Propiedad prevista: la cuenta Gmail de Servicios Docentes. El acceso a códigos es interno.</p><div class="mt-3 text-sm"><b>Ciclo:</b> ${j56esc(J56.catalog.cycle)} · <b>Modalidad:</b> Registro, sincronización y creación supervisada con Google</div></div>
 ${googlePanel}
 ${creationPanel}
 ${manager&&googleStatus?.connected?`<div class="card"><h3>Crear todas las materias de un grupo</h3><p class="text-sm mt-2">Solo crea las que selecciones; nunca vuelve a crear materias ya vinculadas. Revisa docentes y PROF./PROFA. antes de confirmar.</p><select id="j574batchGroup" class="input mt-3" onchange="j574batchGroupChanged()"><option value="">Seleccionar grupo</option>${groups.map(([id,g])=>`<option value="${id}">${j56esc(g.clave)}</option>`).join('')}</select><div class="scroll mt-3"><table class="table"><thead><tr><th>Materia</th><th>Docente</th><th>Tratamiento</th><th>Crear</th></tr></thead><tbody id="j574batchRows"></tbody></table></div><div class="flex flex-wrap gap-3 mt-3"><button id="j574batchButton" class="btn primary" onclick="j574batchCreate()">Crear clases seleccionadas</button><button class="btn" onclick="j574ensureGroupTopics()">Preparar temas de todo el grupo</button></div><div id="j574batchStatus" class="text-sm mt-3"></div></div>
 <div class="card"><h3>Preparar temas por periodo</h3><p class="text-sm mt-2">Genera PRIMER PERIODO, SEGUNDO PERIODO, etc. desde los periodos oficiales de Jaguar. También sirve para las clases creadas manualmente.</p><select id="j574topicGm" class="input mt-3" onchange="j574topicClassChanged()"><option value="">Seleccionar clase vinculada</option>${(J56.catalog.rows||[]).filter(r=>r.google_course_id).map(r=>`<option value="${Number(r.grupo_materia_id)}">${j56esc(r.nombre)}</option>`).join('')}</select><p id="j574topicInfo" class="text-xs mt-2"></p><button id="j574topicButton" class="btn primary mt-3" onclick="j574ensureTopics()">Preparar temas</button><div id="j574topicResults" class="text-sm mt-3"></div></div>
 <div class="card"><h3>Relacionar cuentas Google con matrículas</h3><p class="text-sm mt-2">Servicios Docentes comprueba la identidad antes de que las notas puedan pasar a las rúbricas.</p><select id="j574rosterGm" class="input mt-3"><option value="">Seleccionar clase vinculada</option>${(J56.catalog.rows||[]).filter(r=>r.google_course_id).map(r=>`<option value="${Number(r.grupo_materia_id)}">${j56esc(r.nombre)}</option>`).join('')}</select><button class="btn primary mt-3" onclick="j574loadRoster()">Consultar alumnos y matrículas</button><div id="j574rosterResult" class="mt-3"></div></div>`:''}
 ${(manager&&googleStatus?.connected)||S.role==='docente'?`<div class="card"><h3>Calificaciones de Google Classroom por periodo</h3><p class="text-sm mt-2">Sólo actividades del tema académico correspondiente. El docente clasifica cada trabajo como Actividad, Examen o Excluir y elige la fuente de los exámenes. Sólo las actividades entran al componente Classroom; la rúbrica se confirma por separado.</p><div class="grid md:grid-cols-2 gap-3 mt-3"><label>Grupo y materia<select id="j574gradeGm" class="input mt-1" onchange="j574gradeChanged()"><option value="">Seleccionar</option>${J56.catalog.gms.filter(g=>J56.records.get(Number(g.id))?.google_course_id).map(g=>`<option value="${Number(g.id)}">${j56esc(j56group(g))} · ${j56esc(j56matter(g))}</option>`).join('')}</select></label><label>Periodo<select id="j574gradePeriod" class="input mt-1" onchange="j574gradeChanged()"><option value="">Cargando periodos…</option></select></label></div><button class="btn primary mt-3" onclick="j574loadGrades()">Consultar actividades y notas</button>${manager?'<button class="btn mt-3 ml-2" onclick="j587checkSchema()">Diagnosticar tablas de Classroom</button><div id="j587schemaResult" class="mt-3"></div>':''}<div id="j574gradeResult" class="mt-3"></div>${S.role==='docente'?`<div class="card mt-4"><h4>¿Tu primer periodo fue sin Classroom?</h4><p class="text-sm mt-2">Ya puedes subir el Excel de la rúbrica tradicional desde Evaluaciones. No necesitas vincular alumnos de Google ni crear actividades ficticias. Si la rúbrica está cerrada, solicita revisión a Control Escolar.</p><button class="btn primary mt-3" onclick="openTeacherEvaluationHub()">Abrir Evaluaciones → Excel del primer periodo</button></div>`:''}</div>`:''}
 <div class="grid md:grid-cols-3 gap-3"><div class="card"><small>Clases previstas</small><div class="metric">${displayed}</div></div><div class="card"><small>Clases registradas</small><div class="metric">${registered}</div></div><div class="card"><small>Pendientes</small><div class="metric">${pending}</div></div></div>
 ${manager&&first?`<div class="card" id="j56editor"><h3>Crear o actualizar registro de una clase</h3><p class="text-xs mt-2">Registra manualmente una clase existente aquí. Para crear una clase nueva utiliza el panel «Crear clase en Google Classroom».</p><div class="grid md:grid-cols-2 gap-3 mt-4"><label class="text-sm">Grupo y materia<select id="j56gm" class="input mt-1" onchange="j56selectGroupMatter(this.value)">${j56gmOptions()}</select></label><label class="text-sm">Docente asignado<select id="j56teacher" class="input mt-1"></select></label><label class="text-sm">Nombre de Classroom<input id="j56name" class="input mt-1" maxlength="150" placeholder="Ej. Historia I · 1F"></label><label class="text-sm">Código de unión<input id="j56code" class="input mt-1" maxlength="15" placeholder="Ej. abc12345"></label><label class="text-sm">Enlace del Classroom<input id="j56url" class="input mt-1" type="url" maxlength="500" placeholder="https://classroom.google.com/c/..."></label><label class="text-sm">ID de Google (opcional)<input id="j56gid" class="input mt-1" maxlength="70" placeholder="ID de curso si lo conoces"></label><label class="text-sm">Estado<select id="j56status" class="input mt-1"><option value="pendiente">Pendiente</option><option value="registrada">Registrada</option><option value="archivada">Archivada</option></select></label><label class="text-sm">Datos generales<input id="j56desc" class="input mt-1" maxlength="800" placeholder="Indicaciones, turno, observaciones"></label></div><p id="j56source" class="text-xs mt-3 text-[#8FA3B5]">Registro manual.</p><button id="j56save" class="btn primary mt-4" onclick="j56save()">Guardar clase</button></div>`:''}
 <div class="card"><div class="flex flex-wrap gap-3 justify-between items-center"><div><h3>Clases por grupo y asignatura</h3><p class="text-xs mt-1">Muestra los datos autorizados, incluidas las clases pendientes.</p></div><input class="input" style="max-width:270px" placeholder="Filtrar grupo o materia" oninput="j56search(this.value)"></div>
 <div class="scroll mt-3"><table class="table"><thead><tr><th>Grupo</th><th>Materia</th><th>Docente</th><th>Estado</th><th>Código</th><th>Enlace</th>${manager?'<th>Acción</th>':''}</tr></thead><tbody id="j56rows">${j56renderRows()}</tbody></table></div></div>
 ${S.role!=='docente'?`<div class="card"><h3>PDF institucional de códigos de unión</h3><p class="text-sm mt-2">Documento privado por grupo: materia, docente y código; incluye las asignaturas que todavía no tienen Classroom.</p><div class="flex flex-wrap gap-3 mt-3"><select class="input" id="j56groupPDF" style="max-width:270px">${groups.map(([id,g])=>`<option value="${id}">${j56esc(g?.clave||id)}</option>`).join('')}</select><button class="btn primary" onclick="j56download()">Descargar directorio PDF</button></div></div>`:''}</div>`;
 if(manager&&first)setTimeout(()=>{if(document.getElementById('j56gm'))j56selectGroupMatter(first.id)},0);
 setTimeout(()=>{if(document.getElementById('j574gradePeriod'))j574loadPeriods();},0);
 return page;
}
// Agregar nueva opción sin sustituir ninguna entrada del menú.
if(typeof roleNav!=='undefined'){
 for(const role of ['servicios_docentes','docente','coordinacion_academica','control_escolar','direccion_escolar']){
  const entries=roleNav[role];if(entries&&!entries.some(x=>x[0]==='classroom')){
   const idx=entries.findIndex(x=>x[0]==='planeaciones');entries.splice(idx<0?entries.length:idx+1,0,['classroom','🏫 Google Classroom']);
  }
 }
}
if(typeof titles!=='undefined')titles.classroom='Classroom institucional';

async function j574get(action,params={}){
 const {data:{session}}=await supabaseClient.auth.getSession();if(!session)throw Error('Inicia sesión antes de consultar Classroom.');
 const query=new URLSearchParams({action,...Object.fromEntries(Object.entries(params).map(([k,v])=>[k,String(v)]))});
 const response=await fetch('/api/google-classroom?'+query.toString(),{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
 const body=await response.json().catch(()=>({error:'Google no devolvió una respuesta válida.'}));
 if(!response.ok||!body.ok)throw Error(body.error||'Consulta no disponible.');return body.data;
}
/* V5.7.4: batch creation, official period topics and supervised grade import. */
const J574={grade:null,proof:null,periods:[],batchBusy:false};
function j574gmsForGroup(groupId){return (J56.catalog?.gms||[]).filter(g=>Number(g.grupo_id)===Number(groupId)).sort((a,b)=>j56matter(a).localeCompare(j56matter(b),'es'));}
function j574batchGroupChanged(){
 const groupId=Number(document.getElementById('j574batchGroup')?.value||0);
 const root=document.getElementById('j574batchRows');if(!root)return;
 const linked=new Set((J56.catalog?.rows||[]).filter(r=>r.google_course_id).map(r=>Number(r.grupo_materia_id)));
 root.innerHTML=j574gmsForGroup(groupId).map(g=>{
  const id=Number(g.id),existing=linked.has(id),teachers=j56teachersFor(id);
  return `<tr><td>${j56esc(j56matter(g))}</td><td>${existing?'<b>Ya vinculada</b>':teachers.length===1?j56esc(teachers[0].nombre_completo):`<select class="input" id="j574teacher_${id}"><option value="">Seleccionar docente</option>${teachers.map(t=>`<option value="${Number(t.id)}">${j56esc(t.nombre_completo)}</option>`).join('')}</select>`}</td><td>${existing?'—':`<select class="input" id="j574treatment_${id}"><option value="">Seleccionar</option><option value="PROF.">PROF.</option><option value="PROFA.">PROFA.</option></select>`}</td><td>${existing?'Se conserva':`<input type="checkbox" data-batch-gm="${id}" ${teachers.length===1?'checked':''}/>`}</td></tr>`;
 }).join('')||'<tr><td colspan="4">Selecciona un grupo con materias.</td></tr>';
}
async function j574batchCreate(){
 if(J574.batchBusy)return;
 const ids=[...document.querySelectorAll('#j574batchRows [data-batch-gm]:checked')].map(x=>Number(x.dataset.batchGm));
 if(!ids.length)return toast('Marca al menos una materia sin Classroom vinculado.');
 const payloads=[];
 for(const id of ids){const gm=J56.catalog.gms.find(g=>Number(g.id)===id),teachers=j56teachersFor(id);
  const teacher=teachers.length===1?teachers[0].id:Number(document.getElementById('j574teacher_'+id)?.value||0);
  const pref=document.getElementById('j574treatment_'+id)?.value;
  if(!teacher||!pref)return toast('Selecciona el docente y PROF./PROFA. en todas las materias marcadas.');
  const key=String(gm.grupos?.clave||'').replace(/\s+/g,'').toLocaleUpperCase('es-MX');
  const match=key.match(/^(\d{1,2})(?:[°º.\-])?([A-ZÑ]{1,3})$/u);
  if(!match)return toast('Revisa el formato de la clave del grupo.');
  payloads.push({grupo_materia_id:id,docente_id:Number(teacher),tratamiento:pref,nombre_confirmado:`${match[1]}°${match[2]} | ${j56matter(gm).trim().toLocaleUpperCase('es-MX')}`,docente_confirmado:`${pref} ${j56teacherName(teacher).trim().toLocaleUpperCase('es-MX')}`,confirmado:true});
 }
 if(!confirm(`¿Crear ${payloads.length} clases en Google Classroom?\n\n${payloads.map(p=>p.nombre_confirmado+' — '+p.docente_confirmado).join('\n')}\n\nLas clases ya vinculadas no se modificarán. Las nuevas pueden requerir activación en Classroom.`))return;
 J574.batchBusy=true;const button=document.getElementById('j574batchButton'),status=document.getElementById('j574batchStatus');if(button)button.disabled=true;
 const results=[];
 for(let i=0;i<payloads.length;i++){
  const p=payloads[i];if(status)status.textContent=`Creando ${i+1}/${payloads.length}: ${p.nombre_confirmado}`;
  try{
   await j57api('google-classroom','create',p);
   let topics='';
   try{const r=await j57api('google-classroom','ensure_topics',{grupo_materia_id:p.grupo_materia_id,confirmado:true});topics=` · ${r.total} temas verificados`;}catch(e){topics=` · temas pendientes (${e.message})`;}
   results.push(`✓ ${p.nombre_confirmado}${topics}`);
  }catch(e){results.push(`✗ ${p.nombre_confirmado}: ${e.message}`);}
 }
 if(status)status.innerHTML=`<b>Resultado de la creación:</b><div style="white-space:pre-wrap">${results.map(j56esc).join('\n')}</div><p>Si alguna materia falló, corrígela y vuelve a consultar Classroom antes de reintentar. Nunca se crearán duplicados automáticamente.</p>`;
 J574.batchBusy=false;if(button)button.disabled=false;toast('Lote terminado. Consulta los resultados antes de volver a crear.');
}
function j574topicClassChanged(){
 const el=document.getElementById('j574topicGm');const r=(J56.catalog?.rows||[]).find(x=>Number(x.grupo_materia_id)===Number(el?.value||0));
 const label=document.getElementById('j574topicInfo');if(label)label.textContent=r?`${r.nombre} · ID Google ${r.google_course_id}`:'Selecciona una clase vinculada.';
}
async function j574ensureTopics(){
 const gmId=Number(document.getElementById('j574topicGm')?.value||0);if(!gmId)return toast('Selecciona una clase vinculada.');
 const r=J56.catalog.rows.find(x=>Number(x.grupo_materia_id)===gmId);
 if(!confirm(`¿Preparar los temas PRIMER PERIODO, SEGUNDO PERIODO, etc. en «${r?.nombre||''}»? Los temas existentes se conservarán.`))return;
 const b=document.getElementById('j574topicButton');if(b)b.disabled=true;
 try{const data=await j57api('google-classroom','ensure_topics',{grupo_materia_id:gmId,confirmado:true});
  toast(`Temas revisados: ${data.created.length} creados y ${data.existing.length} ya existían.`);
  const el=document.getElementById('j574topicResults');if(el)el.textContent=`Creados: ${data.created.join(', ')||'ninguno'}. Existentes: ${data.existing.join(', ')||'ninguno'}.`;
 }catch(e){toast(e.message);}finally{if(b)b.disabled=false;}
}
async function j574ensureGroupTopics(){
 const groupId=Number(document.getElementById('j574batchGroup')?.value||0);
 if(!groupId)return toast('Selecciona un grupo en el panel de creación masiva.');
 const linked=(J56.catalog.rows||[]).filter(r=>r.google_course_id && J56.catalog.gms.some(g=>Number(g.id)===Number(r.grupo_materia_id)&&Number(g.grupo_id)===groupId));
 if(!linked.length)return toast('Este grupo todavía no tiene Classroom vinculados.');
 if(!confirm(`¿Crear o verificar los temas académicos en ${linked.length} clases vinculadas del grupo? No se crearán duplicados.`))return;
 const output=document.getElementById('j574batchStatus');
 const results=[];for(const [i,r] of linked.entries()){
  if(output)output.textContent=`Preparando temas ${i+1}/${linked.length}: ${r.nombre}`;
  try{const d=await j57api('google-classroom','ensure_topics',{grupo_materia_id:r.grupo_materia_id,confirmado:true});results.push(`✓ ${r.nombre}: ${d.created.length} nuevos, ${d.existing.length} existentes`);}
  catch(e){results.push(`✗ ${r.nombre}: ${e.message}`);}
 }
 if(output)output.innerHTML=`<b>Resultados de temas por grupo:</b><pre style="white-space:pre-wrap">${results.map(j56esc).join('\n')}</pre>`;
}
async function j574loadPeriods(){
 try{const d=await j57api('google-classroom','periods');J574.periods=d.periods||[];
  const select=document.getElementById('j574gradePeriod');if(select)select.innerHTML='<option value="">Seleccionar periodo</option>'+J574.periods.map(p=>`<option value="${Number(p.id)}">${j56esc(p.topic_name)} · ${j56esc(p.nombre)}</option>`).join('');
 }catch(e){const el=document.getElementById('j574gradeResult');if(el)el.textContent=e.message;}
}
async function j574loadRoster(){
 const id=Number(document.getElementById('j574rosterGm')?.value||0),el=document.getElementById('j574rosterResult');if(!id||!el)return;
 el.textContent='Consultando alumnos y matrículas…';
 try{const d=await j574get('roster',{grupo_materia_id:id});
  el.innerHTML=`<p class="text-sm mt-2">Vincula la cuenta Google con la matrícula correcta. Verifica personalmente los datos antes de guardar.</p><div class="scroll"><table class="table"><thead><tr><th>Alumno Google</th><th>Matrícula Jaguar</th><th>Acción</th></tr></thead><tbody>${d.students.map((s,i)=>`<tr><td>${j56esc(s.name)}<div class="text-xs">${j56esc(s.email)}</div></td><td><select class="input" id="j574map_${i}"><option value="">Seleccionar matrícula</option>${d.alumnos.map(a=>`<option value="${Number(a.id)}" ${Number(s.alumno_id)===Number(a.id)?'selected':''}>${j56esc(a.matricula)} · ${j56esc(a.nombre_completo)}</option>`).join('')}</select></td><td><button class="btn" onclick="j574map('${j56esc(s.google_user_id)}',${i})">Guardar</button></td></tr>`).join('')}</tbody></table></div>`;
 }catch(e){el.textContent=e.message;}
}
async function j574map(googleId,i){
 const gm=Number(document.getElementById('j574rosterGm')?.value||0),studentId=Number(document.getElementById('j574map_'+i)?.value||0);
 if(!studentId)return toast('Selecciona una matrícula.');
 if(!confirm('¿Confirmar que esta cuenta de Google corresponde a la matrícula seleccionada?'))return;
 try{await j57api('google-classroom','map_student',{grupo_materia_id:gm,google_user_id:googleId,alumno_id:studentId});toast('Matrícula vinculada.');await j574loadRoster();}catch(e){toast(e.message);}
}
async function j574loadGrades(){
 const gm=Number(document.getElementById('j574gradeGm')?.value||0),period=Number(document.getElementById('j574gradePeriod')?.value||0),el=document.getElementById('j574gradeResult');
 J574.grade=null;J574.proof=null;if(!el||!gm||!period)return toast('Selecciona la materia y el periodo.');
 el.textContent='Consultando trabajos y calificaciones de Google…';
 try{
  const data=await j574get('grades',{grupo_materia_id:gm,periodo_id:period});J574.grade=data;
  const canClassify=S.role==='docente'&&!data.closed;
  const workRows=data.work.map((w,i)=>{
   const selected=(w.classification&&w.classification!=='pendiente')?w.classification:'';
   const suggested=/\b(examen|exámen|exam|prueba)\b/i.test(w.title)?'Sugerencia: examen':'';
   const options=[['','Sin clasificar'],['actividad','Actividad Classroom'],['examen','Examen'],['excluir','Excluir']].map(([val,label])=>`<option value="${val}" ${selected===val?'selected':''}>${label}</option>`).join('');
   const source=[['','Seleccionar origen'],['classroom','Calificación de Classroom'],['forms','Google Forms'],['manual','Captura manual']].map(([val,label])=>`<option value="${val}" ${w.exam_source===val?'selected':''}>${label}</option>`).join('');
   return `<tr><td><b>${j56esc(w.title)}</b><div class="text-xs">${w.max_points} puntos ${j56esc(suggested)}</div></td><td><select class="input" data-j575-type="${i}" onchange="j575classChanged(${i})" ${!canClassify?'disabled':''}>${options}</select></td><td><select class="input" data-j575-source="${i}" onchange="j575classChanged(${i})" ${!canClassify||selected!=='examen'?'disabled':''}>${source}</select></td><td><input class="input" data-j575-form="${i}" placeholder="ID o enlace Forms (requerido)" value="${j56esc(w.google_form_id||'')}" maxlength="400" ${!canClassify||selected!=='examen'||w.exam_source!=='forms'?'disabled':''} oninput="j574gradeChanged()"></td></tr>`;
  }).join('');
  const included=data.work.map((w,i)=>({...w,index:i})).filter(w=>w.classification==='actividad');
  const exams=data.work.filter(w=>w.classification==='examen');
  el.innerHTML=`<p class="text-sm mt-2">Tema: <b>${j56esc(data.topic.name)}</b>. Un trabajo sólo puede pertenecer a Actividad Classroom, Examen o Excluir.</p>
   <h4 class="mt-3">Clasificación de trabajos del periodo</h4>
   <p class="text-xs mt-2">El título puede sugerir «Examen», pero la clasificación nunca se confirma automáticamente. Indica de dónde proviene la nota del examen: Classroom, Forms o captura manual. Las notas de examen NO entran al componente de actividades Classroom.</p>
   <div class="scroll mt-3"><table class="table"><thead><tr><th>Trabajo</th><th>Tipo</th><th>Fuente del examen</th><th>Formulario (si usa Forms)</th></tr></thead><tbody>${workRows||'<tr><td colspan="4">Sin trabajos puntuables en este tema.</td></tr>'}</tbody></table></div>
   ${canClassify?`<div class="flex flex-wrap gap-2 mt-3"><button class="btn" onclick="j575allActivities()">Proponer todas como actividades</button><button class="btn primary" onclick="j575saveClassifications()">Guardar clasificación verificada</button></div>`:'<p class="text-xs mt-2">Sólo el docente asignado puede clasificar trabajos en un periodo abierto.</p>'}
   <p id="j575classStatus" class="text-xs mt-2">${data.work.filter(w=>w.classification==='pendiente').length} trabajos sin clasificar. Después de cambiar la clasificación, guarda antes de importar notas.</p>
   <h4 class="mt-4">Revisión por alumno · sólo actividades Classroom</h4>
   <p class="text-xs mt-2">Sin calificación: el docente decide Cero o No contar; nunca se asignan ceros automáticamente.</p>
   <div class="scroll mt-3"><table class="table"><thead><tr><th>Alumno</th>${included.map(w=>`<th>${j56esc(w.title)}</th>`).join('')}<th>Matrícula</th></tr></thead><tbody>${data.students.map((st,si)=>`<tr><td>${j56esc(st.name)}</td>${included.map(w=>{const row=data.rows.find(x=>x.google_user_id===st.google_user_id&&x.work_id===w.id);return `<td>${row?.points!=null?`${row.points}/${w.max_points}`:`<select class="input" data-j574-zero="${si}|${w.index}" onchange="j574gradeChanged()"><option value="">Revisar</option><option value="zero">Cero</option><option value="exclude">No contar</option></select>`}</td>`;}).join('')}<td>${st.alumno_id?j56esc(data.alumnos.find(a=>Number(a.id)===Number(st.alumno_id))?.matricula||'Vinculada'):'Sin vincular'}</td></tr>`).join('')}</tbody></table></div>
   ${exams.length?`<div class="card mt-4"><h4>Exámenes separados (${exams.length})</h4><p class="text-xs mt-2">${exams.map(w=>`${j56esc(w.title)} — ${j56esc(w.exam_source==='classroom'?'Nota de Classroom':w.exam_source==='forms'?'Google Forms':'Captura manual')}`).join(' · ')}</p><p class="text-xs mt-2">La elección de la fuente documenta de dónde obtener la nota. Esta versión todavía no descarga respuestas de Forms ni copia automáticamente estos exámenes al componente Examen: regístralos mediante Rúbricas y Evaluaciones para evitar dobles cargas.</p></div>`:''}
   ${S.role==='docente'?`<button class="btn primary mt-3" onclick="j574gradePreview()" ${data.closed?'disabled':''}>Calcular y revisar importación de actividades Classroom</button><div id="j574gradePreview" class="mt-3"></div>`:'<p class="text-sm mt-2">Servicios Docentes vincula matrículas; el docente confirma su propia rúbrica.</p>'}
   ${data.closed?'<p class="text-sm mt-2">Periodo cerrado: consulta únicamente. Las notas oficiales no pueden modificarse desde aquí.</p>':''}`;
 }catch(e){el.textContent=e.message;}
}
function j574gradeChanged(){
 J574.proof=null;
 const preview=document.getElementById('j574gradePreview');if(preview)preview.textContent='Hay cambios. Revisa y calcula de nuevo antes de importar.';
}
function j575classChanged(i){
 const type=document.querySelector(`[data-j575-type="${i}"]`)?.value;
 const source=document.querySelector(`[data-j575-source="${i}"]`);
 const form=document.querySelector(`[data-j575-form="${i}"]`);
 if(source){source.disabled=type!=='examen';if(type!=='examen')source.value='';}
 if(form){form.disabled=type!=='examen'||source?.value!=='forms';if(form.disabled)form.value='';}
 j574gradeChanged();
 const status=document.getElementById('j575classStatus');if(status)status.textContent='Clasificación sin guardar. Confírmala antes de importar.';
}
function j575allActivities(){
 if(!confirm('¿Proponer Actividad para todos los trabajos? Revisa los exámenes y cámbialos antes de guardar.'))return;
 for(let i=0;i<(J574.grade?.work?.length||0);i++){
  const sel=document.querySelector(`[data-j575-type="${i}"]`);if(sel){sel.value='actividad';j575classChanged(i);}
 }
}
async function j575saveClassifications(){
 const gm=Number(document.getElementById('j574gradeGm')?.value||0),period=Number(document.getElementById('j574gradePeriod')?.value||0);
 const d=J574.grade;if(!d)return toast('Consulta primero los trabajos.');
 const trabajos=d.work.map((w,i)=>({
  work_id:w.id,
  tipo:document.querySelector(`[data-j575-type="${i}"]`)?.value||'',
  fuente_examen:document.querySelector(`[data-j575-source="${i}"]`)?.value||'',
  google_form_id:document.querySelector(`[data-j575-form="${i}"]`)?.value||''
 }));
 if(trabajos.some(w=>!w.tipo))return toast('Clasifica todos los trabajos como Actividad, Examen o Excluir.');
 if(trabajos.some(w=>w.tipo==='examen'&&!w.fuente_examen))return toast('Selecciona Forms, Classroom o captura manual para cada examen.');
 if(trabajos.some(w=>w.tipo==='examen'&&w.fuente_examen==='forms'&&!w.google_form_id.trim()))return toast('Pega el ID o enlace del formulario de cada examen de Forms para evitar duplicados.');
 if(!confirm(`¿Guardar la clasificación de ${trabajos.length} trabajos? Las notas de los exámenes no contarán en Actividades Classroom.`))return;
 try{
  await j57api('google-classroom','save_work_types',{grupo_materia_id:gm,periodo_id:period,trabajos});
  toast('Clasificación guardada y verificada.');await j574loadGrades();
 }catch(e){toast(e.message||'No se guardó la clasificación.');}
}
function j574selection(){
 const d=J574.grade;if(!d)throw Error('Consulta primero las calificaciones.');
 if(d.work.some(w=>!['actividad','examen','excluir'].includes(w.classification)))throw Error('Clasifica y guarda todos los trabajos antes de importar.');
 const excluded=d.work.filter(w=>w.classification!=='actividad').map(w=>String(w.id));
 const decisions=[];
 for(const el of document.querySelectorAll('#j574gradeResult [data-j574-zero]')){
  if(!el.value)continue;const [si,wi]=el.dataset.j574Zero.split('|').map(Number);
  decisions.push({google_user_id:d.students[si].google_user_id,work_id:d.work[wi].id,action:el.value});
 }
 return {excluded_ids:excluded,decisions};
}
async function j574gradePreview(){
 const gm=Number(document.getElementById('j574gradeGm')?.value||0),period=Number(document.getElementById('j574gradePeriod')?.value||0),el=document.getElementById('j574gradePreview');if(!el)return;
 J574.proof=null;
 try{const p=await j57api('google-classroom','grade_preview',{grupo_materia_id:gm,periodo_id:period,...j574selection()});
  J574.proof=p.proof;el.innerHTML=`<p class="text-sm">Componente <b>${j56esc(p.component.nombre)}</b>: ${p.component.ponderacion}% del periodo. Vista previa: ${p.grades.length} alumnos.</p><div class="scroll"><table class="table"><thead><tr><th>Matrícula</th><th>Nota Classroom /10</th></tr></thead><tbody>${p.grades.map(g=>`<tr><td>${j56esc(J574.grade.alumnos.find(a=>Number(a.id)===Number(g.alumno_id))?.matricula||g.alumno_id)}</td><td>${Number(g.valor).toFixed(2)}</td></tr>`).join('')}</tbody></table></div><button class="btn primary mt-3" onclick="j574commitGrades()">Confirmar e importar al componente Classroom</button><p class="text-xs mt-2">No cierra el periodo ni reemplaza la nota final. El docente deberá cerrar su evaluación mediante el proceso habitual de rúbricas.</p>`;
 }catch(e){el.textContent=e.message;}
}
async function j574commitGrades(){
 if(!J574.proof)return toast('Calcula la vista previa antes de confirmar.');
 const gm=Number(document.getElementById('j574gradeGm')?.value||0),period=Number(document.getElementById('j574gradePeriod')?.value||0);
 if(!confirm('¿Importar estas notas únicamente al componente Classroom de tu rúbrica del periodo? Esta acción actualizará ese componente; no modifica exámenes ni la nota final cerrada.'))return;
 try{const d=await j57api('google-classroom','grade_commit',{grupo_materia_id:gm,periodo_id:period,...j574selection(),proof:J574.proof,confirmado:true});
  toast(`Se importaron ${d.imported} calificaciones al componente ${d.component}.`);J574.proof=null;const el=document.getElementById('j574gradePreview');if(el)el.textContent='Importación registrada. Consulta tu rúbrica para verificar los valores.';
 }catch(e){toast(e.message);}
}

/* V5.8.7: diagnóstico de lectura, sin tocar notas ni autorizaciones de Google. */
async function j587checkSchema(){
 const el=document.getElementById('j587schemaResult');if(!el)return;
 el.textContent='Comprobando acceso a las tres tablas de Classroom…';
 try {
  const d=await j574get('schema_status');
  el.innerHTML='<div class="card"><b>Estado de Supabase · Classroom</b><div class="mt-2">'+
   (d.tables||[]).map(t=>`<p class="text-sm mt-2">${t.ok?'✓':'✗'} <b>${j56esc(t.table)}</b>: ${j56esc(t.ok?'Disponible':t.status)}</p>`).join('')+
   '<p class="text-xs mt-2">La función de importación se comprueba mediante la consulta SQL de diagnóstico; esta acción no escribe calificaciones.</p></div>';
 } catch(e) {el.textContent=e.message;}
}
