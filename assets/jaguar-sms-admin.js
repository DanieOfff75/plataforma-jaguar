/* Panel SMS de Jaguar: usa los estilos .card, .btn, .input existentes; sin acceso a claves. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let run=0,qrTimeout;
async function call(action,data={}){
  const auth=await window.ithlaNexoAuth?.();
  if(!auth?.token||!auth?.sid)throw Error('Tu sesión técnica caducó. Vuelve a iniciar sesión.');
  const r=await fetch('/api/sms-gateway?action='+encodeURIComponent(action),{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token,'X-ITHLA-Session':auth.sid},body:JSON.stringify(data)});
  const body=await r.json().catch(()=>({}));
  if(!r.ok||!body.ok)throw Error(body.error||`Error HTTP ${r.status}`);
  return body;
}
const status=(m,kind='')=>{const node=$('jsms-status');if(node){node.textContent=m;node.className=kind==='error'?'text-rose-300 text-sm':'text-sm text-[#A9BAC8]';}};
const date=v=>v?new Date(v).toLocaleString('es-MX'):'Sin conexión';
const online=v=>v&&Date.now()-Date.parse(v)<90_000;
async function list(){
  const [d,j]=await Promise.all([call('admin-devices'),call('admin-jobs')]);
  const area=$('jsms-devices'),jobs=$('jsms-jobs');if(!area)return;
  area.replaceChildren();
  if(!d.devices.length)area.textContent='Todavía no hay celulares registrados.';
  for(const device of d.devices){
    const card=document.createElement('div');card.className='card space-y-2';
    const heading=document.createElement('div');heading.className='flex flex-wrap gap-2 items-center justify-between';
    const title=document.createElement('strong');title.textContent=device.label;
    const badge=document.createElement('span');badge.className='chip';badge.textContent=`${device.status}${online(device.last_seen_at)?' · En línea':' · Sin conexión'}`;
    heading.append(title,badge);card.append(heading);
    const p=document.createElement('p');p.className='text-xs text-[#A9BAC8]';
    p.textContent=`${[device.manufacturer,device.model,device.android_version].filter(Boolean).join(' · ')||'Modelo pendiente'} · Batería ${device.battery_percent??'—'}% · Señal ${device.signal_level??'—'}/4 · Último contacto ${date(device.last_seen_at)}`;
    card.append(p);
    if(device.status!=='revoked'){
      const row=document.createElement('div');row.className='flex flex-wrap gap-2 items-center';
      const button=(label,fn,isDanger=false)=>{const b=document.createElement('button');b.className='btn'+(isDanger?' danger':'');b.textContent=label;b.addEventListener('click',fn);row.append(b);};
      button(device.status==='pending'?'Aprobar teléfono':device.status==='active'?'Pausar':'Reactivar',async()=>{try{await call('admin-device-state',{id:device.id,status:device.status==='active'?'paused':'active'});await list();}catch(err){status(err.message,'error');}});
      button('Revocar',async()=>{if(!confirm(`Revocar permanentemente «${device.label}»? Deberá volver a vincularse.`))return;try{await call('admin-device-state',{id:device.id,status:'revoked'});await list();}catch(err){status(err.message,'error');}},true);
      const limit=document.createElement('input');limit.className='input';limit.type='number';limit.min='1';limit.max='100';limit.value=String(device.max_per_hour);limit.style.maxWidth='100px';limit.setAttribute('aria-label','Límite de SMS por hora');row.append(limit);
      button('Guardar límite',async()=>{try{await call('admin-device-limit',{id:device.id,max_per_hour:Number(limit.value)});status('Límite guardado.');await list();}catch(err){status(err.message,'error');}});
      card.append(row);
    }
    area.append(card);
  }
  if(jobs){jobs.replaceChildren();if(!j.jobs.length)jobs.textContent='Todavía no hay trabajos registrados.';
    for(const job of j.jobs){const row=document.createElement('div');row.className='flex flex-wrap justify-between gap-2 py-2 border-b border-white/10 text-sm';
      const left=document.createElement('span');left.textContent=`${job.kind.toUpperCase()} · ${job.destination} · ${date(job.created_at)}`;
      const right=document.createElement('span');right.className='chip';right.textContent=job.status;
      row.append(left,right);jobs.append(row);
    }
  }
}
window.jaguarSmsAdminPage=()=>`<div class="space-y-5" id="jsms-root"><div class="card flex flex-wrap justify-between gap-4 items-center"><div><span class="chip">ADMINISTRACIÓN TÉCNICA · JAGUAR</span><h2 class="text-2xl font-extrabold mt-3">Pasarela SMS institucional</h2><p class="text-sm text-[#A9BAC8] mt-2">Vinculación segura, distribución entre equipos y control de envíos. El correo OTP continúa independiente.</p></div><button class="btn" id="jsms-refresh">↻ Actualizar</button></div><section class="card space-y-3"><h3 class="font-bold text-lg">Vincular un dispositivo</h3><p class="text-sm text-[#A9BAC8]">Instala la APK Jaguar en el teléfono, abre «Escanear QR» y autoriza el permiso de SMS. El QR vence en tres minutos y solo sirve una vez. Después debes aprobar el teléfono en la lista, tras comprobar su modelo.</p><div class="flex flex-wrap gap-3"><input id="jsms-label" class="input" style="max-width:330px" maxlength="80" placeholder="Ej. Motorola Moto G7 Power" aria-label="Nombre del equipo"><button class="btn primary" id="jsms-pair">Generar QR temporal</button></div><div id="jsms-qr" class="flex flex-col gap-3 items-start"></div></section><section class="card space-y-3"><div class="flex flex-wrap justify-between gap-2"><h3 class="font-bold text-lg">Celulares registrados</h3><span class="chip">Solo personal técnico autorizado</span></div><div id="jsms-devices" class="grid gap-3">Cargando…</div></section><section class="card space-y-3"><h3 class="font-bold text-lg">Prueba de envío controlada</h3><p class="text-sm text-[#A9BAC8]">Solo envía al número de prueba establecido en la variable segura JAGUAR_SMS_TEST_NUMBER. Máximo cinco pruebas por día.</p><button class="btn" id="jsms-test">Crear SMS de prueba</button><div id="jsms-jobs" class="space-y-1"></div></section><p role="status" id="jsms-status" class="text-sm text-[#A9BAC8]"></p></div>`;
window.jaguarSmsAdminMount=()=>{
  const current=++run;
  clearTimeout(qrTimeout);
  $('jsms-refresh')?.addEventListener('click',()=>list().catch(err=>status(err.message,'error')));
  $('jsms-pair')?.addEventListener('click',async()=>{
    const button=$('jsms-pair');button.disabled=true;
    try{
      const d=await call('admin-pair',{label:$('jsms-label')?.value});
      if(current!==run)return;
      const holder=$('jsms-qr');holder.replaceChildren();
      if(!/^data:image\/png;base64,/.test(d.qr))throw Error('El servidor no generó un QR válido.');
      const img=document.createElement('img');img.src=d.qr;img.alt='Código QR temporal para vincular el celular';img.width=288;img.height=288;img.style.background='white';img.style.padding='10px';img.style.borderRadius='14px';holder.append(img);
      const note=document.createElement('span');note.className='text-sm text-[#A9BAC8]';holder.append(note);
      function tick(){if(current!==run||!document.contains(note))return;const remaining=Math.max(0,Math.ceil((Date.parse(d.expires_at)-Date.now())/1000));note.textContent=remaining?`Escanea este QR. Vence en ${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}.`:'QR vencido. Genera uno nuevo.';if(!remaining){img.removeAttribute('src');img.remove();}else qrTimeout=setTimeout(tick,1000);}
      tick();status('Código temporal generado. No compartas capturas del QR.');
    }catch(err){status(err.message,'error');}finally{button.disabled=false;}
  });
  $('jsms-test')?.addEventListener('click',async()=>{if(!confirm('¿Crear un SMS de prueba al número autorizado en Vercel?'))return;try{const d=await call('admin-test');status(`Prueba encolada para ${d.recipient}.`);await list();}catch(err){status(err.message,'error');}});
  list().catch(err=>status(err.message,'error'));
};
})();
