/* V8 · Edición institucional dentro de Plataforma Jaguar. Sin claves en navegador. */
(()=>{'use strict';
const h=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
async function call(action,body){const auth=await window.ithlaNexoAuth?.();if(!auth?.sid||!auth.token)throw Error('La sesión protegida caducó. Vuelve a iniciar sesión.');const res=await fetch('/api/public'+(body?'':'?action='+encodeURIComponent(action)),{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token,'X-ITHLA-Session':auth.sid},cache:'no-store',body:body?JSON.stringify({...body,action}):undefined});const j=await res.json().catch(()=>({}));if(!res.ok||!j.ok)throw Error(j.error||'Error al administrar contenido.');return j.data;}
const dt=v=>{const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString('es-MX',{dateStyle:'medium',timeStyle:'short'}):'Sin fecha';};
async function panel(){
 try{
  const p=await call('admin-portal-data');
  window._ithlaPortalData=p;
  const events=(p.eventos||[]).map(x=>`<tr><td>${h(x.titulo)}</td><td>${h(dt(x.fecha_inicio))}</td><td><span class="chip">${h(x.estado)}</span></td><td>${x.estado!=='archivado'?`<button class="btn" onclick="ithlaPortalEditEvent('${h(x.id)}')">Editar</button> <button class="btn danger" onclick="ithlaPortalArchive('${h(x.id)}')">Archivar</button>`:''}</td></tr>`).join('');
  const slots=(p.horarios||[]).map(x=>`<tr><td>${h(x.departamento)}</td><td>${h(dt(x.inicio))}</td><td>${x.reservadas}/${x.capacidad}</td><td>${h(x.estado)}</td><td>${x.estado==='borrador'?`<button class="btn primary" onclick="ithlaPortalChangeSlot('${h(x.id)}','publicado')">Publicar</button>`:''} ${x.estado!=='cancelado'?`<button class="btn danger" onclick="ithlaPortalChangeSlot('${h(x.id)}','cancelado')">Cancelar</button>`:''}</td></tr>`).join('');
  const deps=(p.departamentos||[]).map(x=>`<div class="card"><b>${h(x.nombre)}</b><div class="flex gap-2 items-center mt-3"><span class="chip">${x.publicado?'Responsable visible':'Responsable privado'}</span>${p.puede_autorizar_directorio?`<button class="btn" onclick="ithlaPortalDirectory('${h(x.clave)}',${!x.publicado})">${x.publicado?'Ocultar nombre':'Autorizar nombre público'}</button>`:''}</div></div>`).join('');
  return `<div class="space-y-5"><div class="card"><span class="chip">GESTIÓN DESDE JAGUAR</span><h2 class="text-2xl font-extrabold mt-3">🌐 Portal institucional</h2><p class="text-sm text-[#A9BAC8] mt-2">Lo que publiques aquí llega al portal público. Los avisos se administran desde <b>Avisos</b>, eligiendo Solo Jaguar, Solo pública o Ambas.</p><a class="btn mt-3" href="/" target="_blank" rel="noopener">Ver sitio público ↗</a></div>
  <div class="card"><div class="flex flex-wrap gap-3 justify-between items-center"><h3>🗓️ Calendario editorial</h3><button class="btn primary" onclick="ithlaPortalEditEvent()">+ Crear evento</button></div><div class="scroll mt-3"><table class="table"><thead><tr><th>Evento</th><th>Fecha</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${events||'<tr><td colspan="4">Sin eventos.</td></tr>'}</tbody></table></div></div>
  <div class="card"><div class="flex flex-wrap gap-3 justify-between items-center"><h3>📅 Horarios de citas</h3><button class="btn primary" onclick="ithlaPortalNewSlot()">+ Preparar horario</button></div><p class="text-xs text-[#A9BAC8] mt-2">Cada horario inicia en borrador. Publicarlo exige autorización de agenda y aviso de privacidad. No puedes cancelar horarios que ya tengan reservas.</p><div class="scroll mt-3"><table class="table"><thead><tr><th>Departamento</th><th>Inicio</th><th>Reservas</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${slots||'<tr><td colspan="5">Sin horarios.</td></tr>'}</tbody></table></div></div>
  <div class="card"><h3>🔐 Habilitación pública de citas</h3><p class="text-xs text-[#A9BAC8] mt-2">La agenda permanece cerrada hasta que Dirección apruebe su publicación y configure el aviso de privacidad vigente.</p><p class="mt-3"><span class="chip">${p.citas_publicas_activas?'Agenda habilitada':'Agenda cerrada'}</span></p>${p.puede_autorizar_directorio?`<button class="btn mt-3" onclick="ithlaPortalAppointmentSettings()">Configurar agenda y privacidad</button>`:''}</div>
  <div class="card"><h3>🏛️ Responsables departamentales</h3><p class="text-xs text-[#A9BAC8] my-3">Los nombres provienen automáticamente de <b>responsables_departamento</b>, no se capturan aquí. Dirección Escolar aprueba qué áreas permiten mostrar su responsable en el sitio público.</p><div class="grid md:grid-cols-2 gap-3">${deps}</div></div>
  <div class="card"><h3>🎓 Convocatoria de aspirantes</h3><p class="text-sm text-[#A9BAC8] mt-2">Se administra por el procedimiento de Dirección Escolar de Jaguar; la web pública solo refleja su estado autorizado.</p><button class="btn mt-3" onclick="loadPage('admision_control')">Abrir control de convocatoria</button></div></div>`;
 }catch(e){return `<div class="card"><h3>Contenido público</h3><p class="text-rose-300 mt-2">${h(e.message)}</p><p class="text-xs mt-3">Verifica que ejecutaste las migraciones V7 y V8 en Supabase y que tu sesión sigue vigente.</p></div>`}
}
async function act(a,body){try{const data=await call(a,body);window.toast?.('Contenido actualizado correctamente.');window.loadPage?.('portal_publico');return data}catch(e){window.toast?.(e.message)||alert(e.message)}}
window.ithlaPublicPanel=panel;
function displayModal(title,inner,save){
 const dialog=document.createElement('dialog');dialog.className='ithla-v8-editor';
 const h1=document.createElement('h2');h1.textContent=title;dialog.append(h1);
 const subtitle=document.createElement('p');subtitle.textContent='Administración autorizada desde Plataforma Jaguar';dialog.append(subtitle);
 const form=document.createElement('form');form.className='ithla-v8-form';form.innerHTML=inner;dialog.append(form);
 const buttons=document.createElement('div');buttons.className='ithla-v8-actions';
 const cancel=document.createElement('button');cancel.type='button';cancel.className='btn';cancel.textContent='Cancelar';cancel.addEventListener('click',()=>dialog.close());
 const submit=document.createElement('button');submit.className='btn primary';submit.type='submit';submit.textContent='Guardar contenido';buttons.append(cancel,submit);form.append(buttons);
 form.addEventListener('submit',async e=>{e.preventDefault();if(!form.reportValidity())return;submit.disabled=true;submit.textContent='Guardando…';try{await save(new FormData(form));dialog.close()}finally{submit.disabled=false;submit.textContent='Guardar contenido'}});
 dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
}
const toLocal=v=>{if(!v)return '';const d=new Date(v);if(!Number.isFinite(d.getTime()))return '';const pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;};
window.ithlaPortalEditEvent=(id)=>{
 const old=window._ithlaPortalData?.eventos?.find(x=>x.id===id)||{};
 displayModal(old.id?'Editar evento':'Nuevo evento',`<label>Título<input name="titulo" maxlength="180" minlength="5" class="input" required value="${h(old.titulo||'')}"></label>
 <label>Descripción pública<textarea name="descripcion" class="textarea" rows="4" maxlength="1000">${h(old.descripcion||'')}</textarea></label>
 <label>Fecha y hora de inicio<input type="datetime-local" class="input" name="inicio" required value="${h(toLocal(old.fecha_inicio))}"></label>
 <label>Fecha y hora de término (opcional)<input type="datetime-local" class="input" name="fin" value="${h(toLocal(old.fecha_fin))}"></label>
 <label class="ithla-v8-check"><input type="checkbox" name="publicado" ${old.estado==='publicado'?'checked':''}> Publicar en el portal al guardar (sin datos privados)</label>
 <small>El formulario utiliza la zona horaria configurada en tu dispositivo.</small>`,async fd=>{
   const inicio=new Date(fd.get('inicio')).toISOString(),fin=fd.get('fin')?new Date(fd.get('fin')).toISOString():null;
   await act('admin-portal-event',{id:old.id,titulo:fd.get('titulo'),descripcion:fd.get('descripcion'),fecha_inicio:inicio,fecha_fin:fin,publicado:fd.has('publicado')});
 });
};
window.ithlaPortalArchive=id=>{if(confirm('¿Archivar este evento del sitio público?'))act('admin-portal-hide-event',{id})};
window.ithlaPortalNewSlot=()=>displayModal('Preparar horario de atención',`<label>Departamento responsable<input name="departamento" class="input" minlength="3" maxlength="90" required placeholder="Ej. Control Escolar"></label>
<label>Inicio de atención<input type="datetime-local" name="inicio" class="input" required></label>
<label>Fin de atención<input type="datetime-local" name="fin" class="input" required></label>
<label>Cupos<input name="capacidad" type="number" class="input" min="1" max="20" value="1" required></label>
<p>Primero se guarda como borrador. Debes publicarlo expresamente cuando esté autorizado.</p>`,async fd=>{
 await act('admin-portal-slot',{departamento:fd.get('departamento'),inicio:new Date(fd.get('inicio')).toISOString(),fin:new Date(fd.get('fin')).toISOString(),capacidad:Number(fd.get('capacidad'))});
});
window.ithlaPortalChangeSlot=(id,estado)=>{if(confirm(estado==='publicado'?'¿Publicar este horario para solicitudes de cita?':'¿Cancelar este horario? Solo podrá hacerse si no tiene reservas.'))act('admin-portal-slot-state',{id,estado})};
window.ithlaPortalAppointmentSettings=()=>{const p=window._ithlaPortalData||{};displayModal('Configurar agenda pública',`<label>URL oficial del aviso de privacidad<input name="url" class="input" type="url" placeholder="https://dominio-real/aviso-de-privacidad" value="${h(p.aviso_privacidad_url||'')}"></label><label class="ithla-v8-check"><input type="checkbox" name="active" ${p.citas_publicas_activas?'checked':''}> Activar solicitud pública de citas</label><p>Confirma que existe personal para atender los horarios publicados y que el aviso de privacidad corresponde al proceso de citas.</p>`,async fd=>{await act('admin-portal-settings',{aviso_privacidad_url:fd.get('url'),citas_publicas_activas:fd.has('active')})})};
window.ithlaPortalDirectory=(clave,visible)=>{if(confirm(visible?'¿Autorizar el nombre actual del encargado para exposición pública?':'¿Ocultar el nombre de este departamento?'))act('admin-portal-directory',{clave,visible})};
})();
