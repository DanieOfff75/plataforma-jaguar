/* Jaguar Shield V1 · Interfaz adicional para TODOS los perfiles.
 * Los códigos NUNCA se envían al chat NEXO ni se almacenan en localStorage. */
(()=>{'use strict';
  const escapeText=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function send(action,payload={}){
    if(typeof supabaseClient==='undefined'||!supabaseClient)throw Error('El inicio de sesión todavía no está disponible.');
    const {data:{session}}=await supabaseClient.auth.getSession();
    if(!session?.access_token)throw Error('Necesitas iniciar sesión nuevamente.');
    const response=await fetch('/api/shield',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({action,...payload}),cache:'no-store'});
    const result=await response.json().catch(()=>({}));
    if(!response.ok||!result.ok)throw Error(result.error||'No se pudo verificar la operación.');
    return result.data||result;
  }
  window.jaguarShieldRequest=send;
  async function challenge(purpose,payload={}){
    const issued=await send('start',{purpose,channel:'email',...payload});
    const code=prompt(`Jaguar Shield 🔐\nEnviamos un código a ${issued.sent_to}.\nVálido durante 5 minutos.\n\nEscribe el código de 6 dígitos:`);
    if(code===null)throw Error('Verificación cancelada.');
    if(!/^\d{6}$/.test(code.trim()))throw Error('El código debe tener seis dígitos.');
    const response=await send('verify',{id:issued.id,code:code.trim()});
    return response.proof;
  }
  window.jaguarShieldChallenge=challenge;
  window.jaguarShieldEnroll=async()=>{
    try{
      const pass=prompt('Para verificar tu correo de recuperación, escribe tu CONTRASEÑA ACTUAL de Jaguar:');
      if(pass===null)return;
      if(!pass)throw Error('La contraseña es obligatoria.');
      const proof=await challenge('enroll',{password:pass});
      await send('confirm_enroll',{proof});
      toast('Correo de recuperación verificado con Jaguar Shield.');
      await loadPage('perfil');
    }catch(e){toast(e.message);}
  };
  window.v22SaveRecovery=async()=>{
    try{
      const input=document.getElementById('rec_email');
      const next=String(input?.value||'').trim().toLowerCase();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next))throw Error('Escribe un correo válido.');
      const status=await send('status');
      if(!status.email_verified)throw Error('Primero pulsa Verificar correo actual en Jaguar Shield.');
      const pass=prompt('Escribe tu CONTRASEÑA ACTUAL antes de cambiar el correo de recuperación:');
      if(pass===null)return;
      const oldProof=await challenge('change_old',{new_email:next,password:pass});
      const newProof=await challenge('change_new',{new_email:next,old_proof:oldProof});
      if(!confirm('Ambos correos se verificaron. ¿Confirmas cambiar el correo de recuperación? Se cerrarán tus sesiones.'))return;
      await send('change_recovery',{new_email:next,old_proof:oldProof,new_proof:newProof});
      alert('Correo actualizado y verificado. Por seguridad, vuelve a iniciar sesión.');
      window.ithlaSessionGuard?.clear?.();
      await supabaseClient.auth.signOut();
      showLogin();
    }catch(e){toast(e.message);}
  };
  const prior=typeof v22Profile==='function'?v22Profile:null;
  if(prior){
    window.v22Profile=async function(...args){
      let html=await prior(...args);
      let status;
      try{status=await send('status');}catch(e){status={error:e.message,email_enabled:false,email_verified:false,sms_enabled:false};}
      const statusText=status.email_verified?'🟢 Correo de recuperación verificado':'⚠️ Correo de recuperación todavía sin verificar';
      const emailStatus=status.email_enabled?'Correo electrónico disponible':'Se requiere configurar el remitente de correo';
      const isStudent=typeof S!=='undefined'&&S.role==='alumno';
      const editor=isStudent?`<div class="mt-3"><label for="rec_email">Nuevo correo de recuperación</label><input id="rec_email" class="input mt-2" type="email" autocomplete="email" placeholder="correo@ejemplo.com" value="${escapeText(S.profile?.correo_recuperacion||'')}"><button class="btn primary mt-3" type="button" onclick="v22SaveRecovery()">Cambiar correo con doble verificación</button></div>`:'';
      html+=`<section class="card max-w-3xl jaguar-shield-panel" aria-label="Jaguar Shield"><div class="flex flex-wrap items-center gap-3"><span class="jaguar-shield-lock">🔐</span><div><h3 class="text-xl">Jaguar Shield · Seguridad de mi cuenta</h3><p class="text-sm">${escapeText(statusText)}</p></div></div><p class="text-sm mt-3">Verifica tu correo antes de utilizar operaciones sensibles. Para cambiarlo, se comprueban tanto el correo anterior como el nuevo.</p><div class="flex flex-wrap gap-2 mt-3"><span class="chip">✉️ ${escapeText(emailStatus)}</span><span class="chip">📱 SMS · Laboratorio, desactivado</span></div>${status.error?`<p class="text-sm mt-2">${escapeText(status.error)}</p>`:''}${editor}<button class="btn mt-4" type="button" onclick="jaguarShieldEnroll()">${status.email_verified?'Volver a verificar mi correo':'Verificar mi correo actual'}</button><p class="text-xs mt-3">NEXO puede ayudarte con los pasos, pero nunca debes escribirle un código. El tiempo de sesión no reemplaza esta verificación.</p></section>`;
      return html;
    };
  }
})();
