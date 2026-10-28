/* Centro de Creación Didáctica. Depende de las utilidades y sesión ya disponibles en sistema.html. */
window._didacticState={proposals:[],selected:null,model:'',provider:'',groups:[],periods:[]};
const _dcFields=[['titulo','Título de la planeación'],['enfoque','Enfoque / metodología'],['proposito','Propósito didáctico'],['aprendizaje','Aprendizaje esperado / PDA'],['inicio','Inicio'],['desarrollo','Desarrollo'],['cierre','Cierre'],['evaluacion','Evaluación / evidencias'],['adecuaciones','Adecuaciones y barreras de aprendizaje'],['recursos','Recursos didácticos']];
function dcHtml(v){return typeof esc==='function'?esc(String(v??'')):String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');}
function dcStatus(value,type=''){const e=document.getElementById('dc-status');if(e){e.textContent=value;e.dataset.type=type;}}
function dcFormVal(id){return String(document.getElementById(id)?.value||'').trim()}
async function dcApi(action,payload={},binary=false){
 const {data:{session}}=await supabaseClient.auth.getSession();if(!session?.access_token)throw Error('Tu sesión expiró. Vuelve a iniciar sesión.');
 const resp=await fetch('/api/didactic-studio',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({action,...payload}),cache:'no-store'});
 if(binary){if(!resp.ok){const data=await resp.json().catch(()=>({}));throw Error(data.error||'No se pudo descargar el Word.')}return resp.blob()}
 const result=await resp.json().catch(()=>({error:'Respuesta inválida del servidor.'}));if(!resp.ok||!result.ok)throw Error(result.error||'No se pudo completar la operación.');return result.data;
}
async function jaguarDidacticPage(){
 if(S.role!=='docente')return '<div class="card">Este módulo requiere perfil docente activo.</div>';
 try{
  const {data:{session}}=await supabaseClient.auth.getSession();
  const r=await fetch('/api/didactic-studio',{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'}),result=await r.json();
  if(!r.ok||!result.ok)throw Error(result.error||'No fue posible cargar tus grupos.');
  const periods=await api('periods').catch(()=>[]);
  window._didacticState={proposals:[],selected:null,model:'',provider:'',groups:result.data.grupos||[],periods};
  const groups=(result.data.grupos||[]).map(x=>`<option value="${Number(x.id)}">${dcHtml(x.grupos?.clave||'—')} · ${dcHtml(x.materias?.nombre||'—')}</option>`).join('');
  const pd=(periods||[]).filter(x=>x.activo!==false).map(x=>`<option value="${Number(x.id)}">${dcHtml(x.nombre||x.ciclo_escolar||'Periodo')}</option>`).join('');
  return `<div id="dc-root" class="space-y-4"><header class="dc-hero"><span class="dc-kicker">ITHLA · Plataforma Jaguar · Docentes</span><h2>✦ Centro de Creación Didáctica</h2><p class="dc-sub">Convierte un tema, una página de libro o una planeación tuya en nuevas actividades de aprendizaje. Compara tres propuestas, personalízalas y guarda la que decidas en Planeaciones.</p><div class="dc-steps"><span class="dc-tag">01 · Material</span><span class="dc-tag">02 · Ideas de NEXO</span><span class="dc-tag">03 · Editar y descargar</span><span class="dc-tag">04 · Guardar borrador</span></div><a href="/assets/ITHLA_Formato_Planeacion_Didactica.docx" download class="dc-action" style="display:inline-block;text-decoration:none;background:#d4af37;color:#142c4e">↓ Descargar formato Word institucional</a></header>
  <div class="dc-workspace"><section class="dc-panel"><h3>01 · Cuéntale a NEXO qué enseñarás</h3><p class="dc-help">El docente mantiene el control de los materiales, el enfoque y el resultado final.</p>
  <div class="dc-field"><label class="dc-label" for="dc-gm">Grupo y materia asignados</label><select id="dc-gm">${groups||'<option value="">Sin asignaciones</option>'}</select></div>
  <div class="dc-grid"><div class="dc-field"><label class="dc-label" for="dc-period">Periodo</label><select id="dc-period">${pd||'<option value="">Sin periodos</option>'}</select></div><div class="dc-field"><label class="dc-label" for="dc-date">Fecha de aplicación</label><input id="dc-date" type="date"></div></div>
  <div class="dc-field"><label class="dc-label" for="dc-topic">Tema principal</label><input id="dc-topic" maxlength="180" placeholder="Ej. Ecuaciones de primer grado"></div>
  <div class="dc-field"><label class="dc-label" for="dc-objective">Aprendizaje esperado o propósito (opcional)</label><textarea id="dc-objective" maxlength="600" rows="2" placeholder="Qué quiero que el grupo comprenda o logre"></textarea></div>
  <div class="dc-field"><label class="dc-label" for="dc-material">Fragmento / contenido del libro</label><textarea id="dc-material" maxlength="6500" rows="5" placeholder="Pega aquí el texto, ideas del libro o instrucciones que tengas... sin nombres de alumnos"></textarea></div>
  <div class="dc-field"><label class="dc-label" for="dc-file">O adjunta una página o material (máx. 2 MB)</label><input id="dc-file" type="file" accept=".txt,.md,.pdf,.docx,.png,.jpg,.jpeg,.webp"><p class="dc-help">PDF con texto, Word, TXT, o foto JPG/PNG/WebP. Las imágenes usan Gemini Free para analizar los conceptos.</p></div>
  <label class="dc-check"><input type="checkbox" id="dc-consent"><span>Si adjunto una foto, confirmo que es material de trabajo sin información personal y autorizo su análisis por Gemini Free.</span></label>
  <div class="dc-grid"><div class="dc-field"><label class="dc-label">Enfoque pedagógico</label><select id="dc-method"><option value="activa">Aprendizaje activo</option><option value="proyectos">Proyectos</option><option value="colaborativa">Trabajo colaborativo</option><option value="inclusion">Inclusión / adaptaciones</option><option value="tradicional">Secuencia guiada</option></select></div><div class="dc-field"><label class="dc-label">Sesiones</label><input id="dc-sessions" type="number" min="1" max="15" value="1"></div></div>
  <div class="dc-field"><label class="dc-label">Minutos por sesión</label><input id="dc-minutes" type="number" min="20" max="180" value="50"></div>
  <div class="dc-field"><label class="dc-label">Enlaces educativos aportados por ti (opcional)</label><textarea id="dc-links" rows="2" placeholder="https://... (uno por línea)"></textarea><p class="dc-help">NEXO no inventará ligas específicas; utilizará las que aportes. Explora: <a href="https://es.khanacademy.org/" target="_blank" rel="noopener noreferrer">Khan Academy</a> · <a href="https://phet.colorado.edu/es/simulations" target="_blank" rel="noopener noreferrer">Simulaciones PhET</a>.</p></div>
  <label class="dc-check"><input id="dc-prior" type="checkbox"><span>Autorizo compartir con los motores IA extractos revisados de mis planeaciones anteriores del mismo grupo/materia (máximo tres; no incluir datos de alumnos).</span></label>
  <div class="dc-cardbuttons"><button id="dc-generate" class="dc-action" onclick="jaguarDidacticGenerate()">✦ Generar tres opciones con NEXO</button><button class="dc-secondary" onclick="loadPage('planeaciones')">Mis planeaciones</button></div>
  <p class="dc-legal">Sin expedientes, nombres de alumnos ni calificaciones. No se guarda ningún borrador hasta que pulses «Guardar».</p></section>
  <section class="dc-panel"><h3>02 · Propuestas didácticas</h3><p class="dc-help">Selecciona una idea para abrir el editor. Las propuestas son orientativas y requieren revisión del docente.</p><div id="dc-results" class="mt-4"><div class="dc-empty"><div><div class="dc-orbit">✦</div><b>Tu laboratorio de ideas está listo</b><p class="dc-help">NEXO generará tres caminos de aprendizaje diferentes.</p></div></div></div><p id="dc-status" role="status" aria-live="polite" class="dc-status"></p></section></div></div>`;
 }catch(e){return `<div class="card"><h3>No pude abrir el Centro de Creación Didáctica</h3><p class="mt-2">${dcHtml(e.message)}</p></div>`;}
}
async function dcReadBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||'').split(',')[1]||'');reader.onerror=()=>reject(Error('No se pudo leer el material.'));reader.readAsDataURL(file)});}
async function jaguarDidacticGenerate(){
 const b=document.getElementById('dc-generate');if(!b)return;
 try{
  b.disabled=true;dcStatus('NEXO está analizando el contenido y construyendo tres enfoques…');
  const file=document.getElementById('dc-file')?.files?.[0]||null;
  if(file?.size>2_000_000)throw Error('El archivo supera 2 MB. Adjunta solo el fragmento que necesites.');
  if(file&&file.type.startsWith('image/')&&!document.getElementById('dc-consent').checked)throw Error('Autoriza expresamente el análisis visual de la página sin datos personales.');
  const data=await dcApi('generate',{grupo_materia_id:Number(dcFormVal('dc-gm')),
   tema:dcFormVal('dc-topic'),objetivo:dcFormVal('dc-objective'),material:dcFormVal('dc-material'),
   metodologia:dcFormVal('dc-method'),sesiones:Number(dcFormVal('dc-sessions')),minutos:Number(dcFormVal('dc-minutes')),
   usar_planeaciones_previas:Boolean(document.getElementById('dc-prior')?.checked),
   autoriza_vision:Boolean(document.getElementById('dc-consent')?.checked),
   enlaces:dcFormVal('dc-links').split(/\r?\n/).map(x=>x.trim()).filter(Boolean),
   archivo:file?{data:await dcReadBase64(file),type:file.type||({pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',txt:'text/plain'}[file.name.split('.').pop().toLowerCase()]||'application/octet-stream')}:null});
  window._didacticState.proposals=data.opciones||[];window._didacticState.selected=null;window._didacticState.model=data.modelo;window._didacticState.provider=data.proveedor;
  document.getElementById('dc-results').innerHTML=`<div class="dc-tag">Responde: ${dcHtml(data.proveedor)} · ${dcHtml(data.modelo)}</div>${data.opciones.map((p,i)=>`<article class="dc-proposal"><span class="dc-badge">Propuesta ${i+1}</span><h4>${dcHtml(p.titulo)}</h4><p><b>Enfoque:</b> ${dcHtml(p.enfoque)}</p><p class="mt-2">${dcHtml(p.proposito)}</p><p class="mt-2"><b>Actividad:</b> ${dcHtml(p.desarrollo).slice(0,350)}</p><button class="dc-action mt-3" onclick="jaguarDidacticSelect(${i})">Elegir y editar esta opción</button></article>`).join('')}`;
  dcStatus('Opciones listas. Selecciona una: podrás corregir todos los apartados antes de guardar.');
 }catch(e){dcStatus(e.message,'error');}finally{b.disabled=false}
}
function jaguarDidacticSelect(index){
 const s=window._didacticState,p=s.proposals?.[Number(index)];if(!p)return;
 s.selected=Number(index);
 const editor=`<article class="dc-proposal" id="dc-editor"><div class="dc-badge">03 · Revisión docente · Opción ${s.selected+1}</div><h4>Personaliza tu planeación</h4><div class="dc-editor">${_dcFields.map(([key,title])=>`<div class="dc-field"><label class="dc-label" for="dc-edit-${key}">${title}</label><textarea id="dc-edit-${key}" rows="${key==='desarrollo'?6:key==='titulo'?2:3}">${dcHtml(p[key]||'')}</textarea></div>`).join('')}<div class="dc-field"><label class="dc-label">Enlaces proporcionados por el docente</label><textarea id="dc-edit-links" rows="2">${dcHtml((p.recursos_enlaces||[]).join('\n'))}</textarea></div></div><div class="dc-cardbuttons"><button class="dc-action" onclick="jaguarDidacticSave()">✓ Guardar en Planeaciones como borrador</button><button class="dc-secondary" onclick="jaguarDidacticWord()">↓ Descargar esta planeación en Word</button></div><p class="dc-legal">«Elaborada con apoyo de NEXO IA» se añadirá al documento. El docente conserva la edición, el envío y la responsabilidad académica.</p></article>`;
 document.getElementById('dc-editor')?.remove();
 document.getElementById('dc-results').insertAdjacentHTML('beforeend',editor);
 document.getElementById('dc-editor')?.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function dcEditedProposal(){
 if(window._didacticState.selected===null)throw Error('Elige primero una propuesta.');
 const p={};for(const [key] of _dcFields)p[key]=dcFormVal(`dc-edit-${key}`);
 p.recursos_enlaces=dcFormVal('dc-edit-links').split(/\r?\n/).map(x=>x.trim()).filter(x=>x.startsWith('https://')).slice(0,6);
 if(!p.titulo||!p.inicio||!p.desarrollo||!p.cierre)throw Error('Completa al menos título, inicio, desarrollo y cierre.');
 return p;
}
function dcSnapshot(p){return {origen:'nexo_ia',revision_docente:true,proveedor:window._didacticState.provider,modelo:window._didacticState.model,
  propuesta:p,recursos_enlaces:p.recursos_enlaces,texto:[`Planeación: ${p.titulo}`,..._dcFields.filter(x=>x[0]!=='titulo').map(([key,label])=>`${label}: ${p[key]}`),...
   p.recursos_enlaces.map(x=>`Enlace aportado por docente: ${x}`),'Elaborada con apoyo de NEXO IA. Revisada y seleccionada por el docente.'].join('\n\n')};}
async function jaguarDidacticSave(){
 try{
  const proposal=dcEditedProposal();if(!confirm('¿Guardar esta planeación como BORRADOR? Después podrás enviarla a revisión siguiendo el proceso oficial.'))return;
  const saved=await apiPost('saveTeacherPlanning',{grupo_materia_id:Number(dcFormVal('dc-gm')),periodo_id:Number(dcFormVal('dc-period'))||null,
   tipo:'periodo',fecha_planeada:dcFormVal('dc-date')||null,titulo:proposal.titulo,snapshot:dcSnapshot(proposal),ciclo_escolar:currentCycleLabel()});
  toast(`Planeación guardada como borrador (#${Number(saved.id)||'—'}).`);await loadPage('planeaciones');
 }catch(e){dcStatus(e.message,'error');toast(e.message)}
}
async function jaguarDidacticWord(){
 try{
  dcStatus('Preparando Word editable…');const p=dcEditedProposal();
  const blob=await dcApi('export',{grupo_materia_id:Number(dcFormVal('dc-gm')),propuesta:p,fecha:dcFormVal('dc-date'),modelo:window._didacticState.model},true);
  const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='ITHLA-Planeacion-NEXO.docx';a.click();setTimeout(()=>URL.revokeObjectURL(u),5000);dcStatus('Word descargado. Revisa y adapta el contenido antes de usarlo.');
 }catch(e){dcStatus(e.message,'error')}
}
