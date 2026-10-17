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
 const googlePanel=manager?`<div class="card"><h3>Conexión con Google · Servicios Docentes</h3><p class="text-sm mt-2">La conexión permite consultar las clases de Classroom existentes sin crear clases nuevas ni modificar calificaciones.</p>
  <div class="mt-3 text-sm"><b>Estado:</b> ${googleStatus?.connected?'Conectada: '+j56esc(googleStatus.correo):(googleStatus?.configured?'Pendiente de conectar':'Faltan variables privadas o la migración de Google OAuth en el servidor')}</div>
  ${googleStatus?.connected?`<div class="flex flex-wrap gap-3 mt-3"><button class="btn primary" onclick="j57list()">Consultar mis Classroom</button><button class="btn" onclick="j57disconnect()">Desconectar Google</button></div><div id="j57list" class="mt-3"></div>`:
  `<button class="btn primary mt-3" ${!googleStatus?.configured?'disabled':''} onclick="j57connect()">Conectar Gmail de Servicios Docentes</button>`}
  <p class="text-xs mt-2">Propiedad institucional centralizada. Las clases se relacionan con Jaguar sólo después de seleccionar y confirmar su materia-grupo.</p>
  </div>`:'';
 const page=`<div class="space-y-5"><div class="card"><span class="chip">SERVICIOS DOCENTES · CLASSROOM</span><h2 class="text-2xl font-extrabold mt-3">Directorio institucional de Google Classroom</h2><p class="text-sm mt-2">Una clase por materia, grupo y ciclo escolar. Propiedad prevista: la cuenta Gmail de Servicios Docentes. El acceso a códigos es interno.</p><div class="mt-3 text-sm"><b>Ciclo:</b> ${j56esc(J56.catalog.cycle)} · <b>Modalidad:</b> Registro manual y sincronización supervisada con Google</div></div>
 ${googlePanel}
 <div class="grid md:grid-cols-3 gap-3"><div class="card"><small>Clases previstas</small><div class="metric">${displayed}</div></div><div class="card"><small>Clases registradas</small><div class="metric">${registered}</div></div><div class="card"><small>Pendientes</small><div class="metric">${pending}</div></div></div>
 ${manager&&first?`<div class="card" id="j56editor"><h3>Crear o actualizar registro de una clase</h3><p class="text-xs mt-2">La clase debe existir en Google Classroom para disponer de código y enlace. Esta pantalla no crea una clase en Google.</p><div class="grid md:grid-cols-2 gap-3 mt-4"><label class="text-sm">Grupo y materia<select id="j56gm" class="input mt-1" onchange="j56selectGroupMatter(this.value)">${j56gmOptions()}</select></label><label class="text-sm">Docente asignado<select id="j56teacher" class="input mt-1"></select></label><label class="text-sm">Nombre de Classroom<input id="j56name" class="input mt-1" maxlength="150" placeholder="Ej. Historia I · 1F"></label><label class="text-sm">Código de unión<input id="j56code" class="input mt-1" maxlength="15" placeholder="Ej. abc12345"></label><label class="text-sm">Enlace del Classroom<input id="j56url" class="input mt-1" type="url" maxlength="500" placeholder="https://classroom.google.com/c/..."></label><label class="text-sm">ID de Google (opcional)<input id="j56gid" class="input mt-1" maxlength="70" placeholder="ID de curso si lo conoces"></label><label class="text-sm">Estado<select id="j56status" class="input mt-1"><option value="pendiente">Pendiente</option><option value="registrada">Registrada</option><option value="archivada">Archivada</option></select></label><label class="text-sm">Datos generales<input id="j56desc" class="input mt-1" maxlength="800" placeholder="Indicaciones, turno, observaciones"></label></div><p id="j56source" class="text-xs mt-3 text-[#8FA3B5]">Registro manual.</p><button id="j56save" class="btn primary mt-4" onclick="j56save()">Guardar clase</button></div>`:''}
 <div class="card"><div class="flex flex-wrap gap-3 justify-between items-center"><div><h3>Clases por grupo y asignatura</h3><p class="text-xs mt-1">Muestra los datos autorizados, incluidas las clases pendientes.</p></div><input class="input" style="max-width:270px" placeholder="Filtrar grupo o materia" oninput="j56search(this.value)"></div>
 <div class="scroll mt-3"><table class="table"><thead><tr><th>Grupo</th><th>Materia</th><th>Docente</th><th>Estado</th><th>Código</th><th>Enlace</th>${manager?'<th>Acción</th>':''}</tr></thead><tbody id="j56rows">${j56renderRows()}</tbody></table></div></div>
 ${S.role!=='docente'?`<div class="card"><h3>PDF institucional de códigos de unión</h3><p class="text-sm mt-2">Documento privado por grupo: materia, docente y código; incluye las asignaturas que todavía no tienen Classroom.</p><div class="flex flex-wrap gap-3 mt-3"><select class="input" id="j56groupPDF" style="max-width:270px">${groups.map(([id,g])=>`<option value="${id}">${j56esc(g?.clave||id)}</option>`).join('')}</select><button class="btn primary" onclick="j56download()">Descargar directorio PDF</button></div></div>`:''}</div>`;
 if(manager&&first)setTimeout(()=>{if(document.getElementById('j56gm'))j56selectGroupMatter(first.id)},0);
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
