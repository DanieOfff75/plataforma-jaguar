/* Módulo exclusivo Dirección Escolar. Autorización FINAL en servidor (no en el botón). */
async function jaguarAdmissionDirectorModule(){
 if((typeof S==='undefined'||S.role!=='direccion_escolar'))return '<div class="card">Acceso no permitido.</div>';
 const {data:{session}}=await supabaseClient.auth.getSession();
 if(!session)throw Error('Debes iniciar sesión nuevamente.');
 const r=await fetch('/api/public?action=director-status',{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
 const j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||'No se pudo consultar el periodo de admisión.');
 const d=j.data.valor||{},status=String(d.estado||'cerrado');
 return `<div class="space-y-5"><div class="card"><span class="chip">DIRECCIÓN ESCOLAR</span><h2 class="text-2xl mt-3">Convocatoria institucional</h2><p class="text-sm text-[#A9BAC8] mt-2">Este control gobierna también el portal externo de Admisiones mediante la misma base Supabase. El cambio se audita y sólo Dirección Escolar puede autorizarlo.</p></div>
 <div class="card"><h3>Estado actual: <strong>${esc(status.toUpperCase())}</strong></h3><p class="text-sm mt-2">${esc(d.mensaje||'')}</p><p class="text-sm mt-2 text-[#A9BAC8]">Inicio programado: ${esc(d.fecha_inicio||'Sin fecha')} · Fin programado: ${esc(d.fecha_fin||'Sin fecha')}</p><div class="flex flex-wrap gap-3 mt-4"><button class="btn primary" onclick="jaguarAdmissionChange('abierto')">✓ Abrir / reabrir</button><button class="btn" onclick="jaguarAdmissionChange('pausado')">⏸ Pausar</button><button class="btn danger" onclick="jaguarAdmissionChange('cerrado')">✕ Finalizar periodo</button></div><p class="text-xs mt-3 text-[#A9BAC8]">Al reabrir manualmente se retiran las fechas anteriores; para programar una convocatoria nueva se utiliza una propuesta del Centro de Control.</p></div>
 <div class="card"><h3>Accesos al ecosistema</h3><p class="text-sm mt-2">La autorización de la convocatoria se realiza aquí. La revisión de expedientes sigue en el portal de Admisiones, con inicio de sesión independiente.</p><div class="flex gap-3 flex-wrap mt-4"><a class="btn" href="https://registro-escolar-virid.vercel.app/admin/" target="_blank" rel="noopener noreferrer">Revisar aspirantes ↗</a><a class="btn" href="https://controlcentersisjaguar.vercel.app/" target="_blank" rel="noopener noreferrer">Centro de Control ↗</a></div></div>
 <div class="card"><h3>Inscripciones pendientes</h3><p class="text-sm mt-2">Control Escolar confirma documentos y enlaza con el padrón real de Jaguar antes de asignar matrícula. Aceptar un expediente no significa inscripción automática.</p></div></div>`;
}
async function jaguarAdmissionChange(estado){
 if((typeof S==='undefined'||S.role!=='direccion_escolar'))return;
 const etiquetas={abierto:'ABRIR',pausado:'PAUSAR',cerrado:'FINALIZAR'};
 const motivo=prompt(`Motivo institucional para ${etiquetas[estado]} las admisiones (mínimo 12 caracteres):`,'');
 if(!motivo||motivo.trim().length<12){toast('Indica un motivo institucional de al menos 12 caracteres.');return;}
 if(!confirm(`¿Confirmas ${etiquetas[estado]} la convocatoria del instituto? El portal de Admisiones actualizará el estado.`))return;
 try{
  const {data:{session}}=await supabaseClient.auth.getSession();
  if(!session)throw Error('Debes iniciar sesión nuevamente.');
  const r=await fetch('/api/public',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({action:'set-admissions',estado,motivo:motivo.trim()})});
  const j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||'No se pudo actualizar la convocatoria.');
  toast('Decisión autorizada y registrada.');await loadPage('admision_control');
 }catch(e){toast(e.message||'Error de autorización.');}
}

/* Jaguar V6.0.2: el módulo de Admisiones no depende de una sola definición antigua del menú.
 * La autorización REAL se realiza en el servidor: esta integración sólo hace visible la ruta.
 */
(function(){
 'use strict';
 const KEY='admision_control',LABEL='🎓 Admisiones y convocatorias';
 function isDirector(){return typeof S!=='undefined'&&S.role==='direccion_escolar';}
 function attach(){
  if(!isDirector()||typeof roleNav==='undefined'||!roleNav.direccion_escolar)return;
  const list=roleNav.direccion_escolar;
  if(!list.some(row=>row[0]===KEY))list.splice(1,0,[KEY,LABEL]);
  const nav=document.getElementById('nav');
  if(nav&&!nav.querySelector('[data-jaguar-adm]')&&!nav.querySelector('[onclick*="admision_control"]')){
   const btn=document.createElement('button');btn.type='button';btn.className='nav';
   btn.dataset.jaguarAdm='1';btn.textContent=LABEL;
   btn.onclick=()=>window.loadPage?.(KEY);
   nav.prepend(btn);
  }
  const content=document.getElementById('content');
  if(content&&S.page==='inicio'&&!content.querySelector('#jaguarAdmShortcut')){
   const box=document.createElement('div');box.id='jaguarAdmShortcut';box.className='card mb-3';
   const title=document.createElement('strong');title.textContent='Dirección Escolar · Admisiones';
   const subtitle=document.createElement('p');subtitle.className='text-sm mt-2';
   subtitle.textContent='Gestiona la apertura, pausa y cierre de la convocatoria institucional.';
   const btn=document.createElement('button');btn.className='btn primary mt-3';btn.textContent='Administrar convocatoria';
   btn.onclick=()=>window.loadPage?.(KEY);
   box.append(title,subtitle,btn);content.prepend(box);
  }
 }
 // Jaguar crea el panel después de la autenticación; observamos sólo el contenedor.
 const app=document.getElementById('app');
 let pending=false;
 if(app)new MutationObserver(()=>{if(pending)return;pending=true;queueMicrotask(()=>{pending=false;attach()})})
  .observe(app,{attributes:true,attributeFilter:['class'],childList:true,subtree:true});
 document.addEventListener('DOMContentLoaded',attach);
 setTimeout(attach,250);
})();
