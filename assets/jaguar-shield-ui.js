/* Notificaciones Jaguar V2 · Modal OTP accesible, sin leer códigos desde NEXO.
 * Compatible con Jaguar Shield V1; no cambia las autorizaciones del servidor. */
(()=>{'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let activeDialog=false;
  const CANCELLED='Verificación cancelada.';
  const notify=message=>typeof toast==='function'?toast(message):console.warn(message);
  async function send(action,payload={}){
    if(typeof supabaseClient==='undefined'||!supabaseClient)throw Error('Debes iniciar sesión para continuar.');
    const {data:{session}}=await supabaseClient.auth.getSession();
    if(!session?.access_token)throw Error('Tu sesión ya no está disponible. Vuelve a iniciar sesión.');
    const response=await fetch('/api/shield',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({action,...payload}),cache:'no-store'});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.ok)throw Error(data.error||'No se pudo completar la verificación.');
    return data.data||data;
  }
  window.jaguarShieldRequest=send;

  function dialog({eyebrow='NOTIFICACIONES JAGUAR',title='Verifica tu identidad',description=''}){
    if(activeDialog)throw Error('Ya existe una verificación abierta. Termínala o cancélala primero.');
    activeDialog=true;
    const previouslyFocused=document.activeElement,oldOverflow=document.body.style.overflow;
    const root=document.createElement('div');root.className='nj-backdrop';root.setAttribute('data-nj-dialog','');
    root.innerHTML=`<section role="dialog" aria-modal="true" aria-labelledby="nj-title" aria-describedby="nj-description" class="nj-dialog" tabindex="-1">
      <div class="nj-decor"><span class="nj-brand-icon" aria-hidden="true">J</span><span class="nj-brand">Notificaciones Jaguar</span><button type="button" class="nj-close" aria-label="Cancelar verificación" data-nj-close>×</button></div>
      <div class="nj-inner"><div class="nj-kicker" id="nj-kicker">${esc(eyebrow)}</div><div class="nj-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="3"/><path d="M8 11V7a4 4 0 018 0v4"/></svg></div><h2 class="nj-heading" id="nj-title">${esc(title)}</h2><p id="nj-description" class="nj-description">${esc(description)}</p><div id="nj-content"></div><p class="nj-footnote">🔒 Nunca compartas tus códigos, tampoco con NEXO.</p></div>
      </section>`;
    document.body.appendChild(root);document.body.style.overflow='hidden';
    const card=root.querySelector('.nj-dialog'),content=root.querySelector('#nj-content');
    let onCancel=()=>{};let destroyed=false;
    const keyHandler=event=>{
      if(event.key==='Escape'){event.preventDefault();onCancel();}
      if(event.key!=='Tab')return;
      const nodes=[...root.querySelectorAll('button:not([disabled]),input:not([disabled]),a[href]')].filter(el=>el.getClientRects().length);
      if(!nodes.length)return;
      const first=nodes[0],last=nodes[nodes.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',keyHandler);
    root.querySelector('[data-nj-close]').addEventListener('click',()=>onCancel());
    root.addEventListener('mousedown',ev=>{if(ev.target===root)onCancel();});
    card.focus();
    return {content,root,card,setCancel(fn){onCancel=fn;},destroy(){if(destroyed)return;destroyed=true;document.removeEventListener('keydown',keyHandler);root.remove();document.body.style.overflow=oldOverflow;activeDialog=false;try{previouslyFocused?.focus?.();}catch{}}};
  }

  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function requestPassword(title='Confirma tu identidad'){
    return new Promise((resolve,reject)=>{
      let m;try{m=dialog({eyebrow:'VERIFICACIÓN DE CUENTA',title,description:'Por seguridad, confirma tu contraseña actual antes de continuar.'});}catch(e){reject(e);return;}
      m.content.innerHTML=`<form class="nj-form" autocomplete="off"><label class="nj-label" for="nj-current-password">Contraseña actual de Jaguar</label><div class="nj-password-wrap"><input id="nj-current-password" name="current-password" class="nj-text-input" autocomplete="current-password" type="password" required placeholder="Escribe tu contraseña"><button type="button" class="nj-password-eye" aria-label="Mostrar contraseña">Mostrar</button></div><div class="nj-feedback" role="alert" aria-live="polite"></div><button class="nj-primary" type="submit">Continuar</button></form>`;
      const input=m.content.querySelector('input'),form=m.content.querySelector('form'),eye=m.content.querySelector('.nj-password-eye'),feedback=m.content.querySelector('.nj-feedback');
      eye.onclick=()=>{const visible=input.type==='password';input.type=visible?'text':'password';eye.textContent=visible?'Ocultar':'Mostrar';eye.setAttribute('aria-label',visible?'Ocultar contraseña':'Mostrar contraseña');input.focus();};
      const stop=(reason,value)=>{m.destroy();reason?reject(reason):resolve(value);};
      m.setCancel(()=>stop(Error(CANCELLED)));
      form.addEventListener('submit',event=>{event.preventDefault();if(!input.value){feedback.textContent='Escribe tu contraseña para continuar.';return;}const value=input.value;input.value='';stop(null,value);});
      input.focus();
    });
  }

  function confirmChange(){
    return new Promise((resolve,reject)=>{
      let m;try{m=dialog({eyebrow:'ÚLTIMA CONFIRMACIÓN',title:'¿Confirmas el cambio?',description:'Verificaste ambas direcciones. Al guardar el correo nuevo se cerrarán tus sesiones para proteger tu cuenta.'});}catch(e){reject(e);return;}
      m.content.innerHTML='<div class="nj-actions"><button type="button" class="nj-secondary" data-nj-back>Cancelar</button><button type="button" class="nj-primary" data-nj-yes>Confirmar cambio</button></div>';
      const finish=answer=>{m.destroy();resolve(answer);};m.setCancel(()=>finish(false));
      m.content.querySelector('[data-nj-back]').onclick=()=>finish(false);
      m.content.querySelector('[data-nj-yes]').onclick=()=>finish(true);
      m.content.querySelector('[data-nj-yes]').focus();
    });
  }

  const PURPOSE_TITLES={enroll:'Verifica tu correo',change_old:'Confirma tu correo actual',change_new:'Confirma tu correo nuevo',eval_open:'Autoriza abrir evaluaciones',eval_close:'Autoriza cerrar evaluaciones'};
  async function challenge(purpose,payload={}){
    const m=dialog({eyebrow:'CÓDIGO DE SEGURIDAD',title:PURPOSE_TITLES[purpose]||'Verifica tu identidad',description:'Enviaremos un código temporal a tu correo registrado.'});
    let cancelled=false,issued=null,expiresAt=0,resendAt=0,ticker=null,busy=false,resolveDone,rejectDone;
    const done=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});
    const stop=(error,proof)=>{if(cancelled)return;cancelled=true;clearInterval(ticker);m.destroy();if(error)rejectDone(error);else resolveDone(proof);};
    m.setCancel(()=>stop(Error(CANCELLED)));
    function showFeedback(message,kind='error'){
      const p=m.content.querySelector('.nj-feedback');if(p){p.textContent=message;p.dataset.kind=kind;}
    }
    function setBusy(value){busy=value;m.content.querySelectorAll('.nj-code,.nj-primary').forEach(el=>el.disabled=value);const b=m.content.querySelector('[data-nj-verify]');if(b)b.textContent=value?'Comprobando código…':'Verificar y continuar';}
    function remaining(ms){const s=Math.max(0,Math.ceil(ms/1000));return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');}
    function tick(){
      if(cancelled)return;
      const remainingMs=expiresAt-Date.now(),cooldown=resendAt-Date.now();
      const clock=m.content.querySelector('[data-nj-clock]');if(clock){clock.textContent=remaining(remainingMs);clock.dataset.expired=remainingMs<=0?'true':'false';}
      const resend=m.content.querySelector('[data-nj-resend]');if(resend){resend.disabled=busy||cooldown>0;resend.textContent=cooldown>0?`Reenviar en ${remaining(cooldown)}`:'Reenviar otro código';}
      if(remainingMs<=0&&clock&&!clock.dataset.announced){showFeedback('Este código venció. Solicita uno nuevo para continuar.');clock.dataset.announced='1';}
    }
    const digits=()=>[...m.content.querySelectorAll('.nj-code')];
    function fill(value,start=0){const v=String(value).replace(/\D/g,'').slice(0,6-start);const boxes=digits();for(let i=0;i<v.length;i++)boxes[start+i].value=v[i];const next=boxes[Math.min(start+v.length,5)];next?.focus();showFeedback('','info');}
    async function verify(){
      if(busy||cancelled||!issued)return;
      if(Date.now()>=expiresAt){showFeedback('El código venció. Pulsa Reenviar otro código.');return;}
      const code=digits().map(x=>x.value).join('');if(!/^\d{6}$/.test(code)){showFeedback('Escribe los seis dígitos del código.');digits().find(x=>!x.value)?.focus();return;}
      setBusy(true);showFeedback('Comprobando con Jaguar…','info');
      try{const result=await send('verify',{id:issued.id,code});if(cancelled)return;digits().forEach(x=>x.value='');stop(null,result.proof);}
      catch(error){if(cancelled)return;setBusy(false);digits().forEach(x=>x.value='');showFeedback(error.message||'No pudimos comprobar el código.');digits()[0]?.focus();}
    }
    async function issue(first=false){
      if(busy||cancelled)return;
      busy=true;
      if(first){m.content.innerHTML='<div class="nj-loading"><span class="nj-spinner" aria-hidden="true"></span><span role="status">Enviando tu código de verificación…</span></div>';}
      else{const btn=m.content.querySelector('[data-nj-resend]');if(btn){btn.disabled=true;btn.textContent='Enviando…';}}
      try{
        const response=await send('start',{purpose,channel:'email',...payload});if(cancelled)return;
        issued=response;expiresAt=Date.now()+Math.min(300,Math.max(30,Number(response.expires_seconds)||300))*1000;
        resendAt=Date.now()+65000;
        // Nunca introducir datos personales sin escapar en innerHTML.
        m.content.innerHTML=`<div class="nj-destination">Enviamos un código a <strong>${esc(response.sent_to||'tu correo verificado')}</strong></div>
          <form class="nj-form" novalidate><label class="nj-label" for="nj-code-0">Código de seis dígitos</label><div class="nj-code-row" role="group" aria-label="Código de verificación de seis dígitos">${Array.from({length:6},(_,i)=>`<input id="nj-code-${i}" class="nj-code" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="${i===0?'one-time-code':'off'}" aria-label="Dígito ${i+1} de 6" spellcheck="false">`).join('')}</div>
          <div class="nj-meta"><span>Vence en <strong data-nj-clock aria-live="off">05:00</strong></span><span>Un solo uso</span></div><div class="nj-feedback" role="status" aria-live="polite"></div>
          <button type="submit" class="nj-primary" data-nj-verify>Verificar y continuar</button><button type="button" class="nj-resend" data-nj-resend disabled>Reenviar en 01:05</button></form>`;
        const form=m.content.querySelector('form'),boxes=digits();
        form.addEventListener('submit',ev=>{ev.preventDefault();void verify();});
        boxes.forEach((input,index)=>{
          input.addEventListener('input',()=>{
            const cleaned=input.value.replace(/\D/g,'');
            if(cleaned.length>1){input.value='';fill(cleaned,index);}
            else{input.value=cleaned;if(cleaned&&boxes[index+1])boxes[index+1].focus();}
            showFeedback('','info');
          });
          input.addEventListener('paste',event=>{const text=event.clipboardData?.getData('text')||'';if(/\d/.test(text)){event.preventDefault();fill(text,index);}});
          input.addEventListener('keydown',event=>{
            if(event.key==='Backspace'&&!input.value&&index>0){event.preventDefault();boxes[index-1].value='';boxes[index-1].focus();}
            if(event.key==='ArrowLeft'&&index>0){event.preventDefault();boxes[index-1].focus();}
            if(event.key==='ArrowRight'&&index<5){event.preventDefault();boxes[index+1].focus();}
          });
        });
        m.content.querySelector('[data-nj-resend]').addEventListener('click',()=>{if(Date.now()>=resendAt&&!busy)void issue(false);});
        clearInterval(ticker);ticker=setInterval(tick,1000);busy=false;tick();boxes[0].focus();
      }catch(error){if(cancelled)return;busy=false;if(first){stop(error);return;}showFeedback(error.message||'No se pudo reenviar el código.');resendAt=Date.now()+15000;tick();}
    }
    void issue(true);
    return done;
  }
  window.jaguarShieldChallenge=challenge;
  window.jaguarShieldEnroll=async()=>{
    try{
      const pass=await requestPassword('Verifica tu correo de recuperación');
      const proof=await challenge('enroll',{password:pass});
      await send('confirm_enroll',{proof});
      notify('Tu correo de recuperación se verificó correctamente.');
      await loadPage('perfil');
    }catch(e){if(e.message!==CANCELLED)notify(e.message);}
  };
  window.v22SaveRecovery=async()=>{
    try{
      const input=document.getElementById('rec_email');
      const next=String(input?.value||'').trim().toLowerCase();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next))throw Error('Escribe un correo válido.');
      const status=await send('status');if(!status.email_verified)throw Error('Primero verifica tu correo actual en Mi perfil.');
      const pass=await requestPassword('Confirma el cambio de correo');
      const oldProof=await challenge('change_old',{new_email:next,password:pass});
      const newProof=await challenge('change_new',{new_email:next,old_proof:oldProof});
      if(!await confirmChange())return;
      await send('change_recovery',{new_email:next,old_proof:oldProof,new_proof:newProof});
      notify('Correo actualizado. Por seguridad, inicia sesión nuevamente.');
      window.ithlaSessionGuard?.clear?.();await supabaseClient.auth.signOut();showLogin();
    }catch(e){if(e.message!==CANCELLED)notify(e.message);}
  };
  const prior=typeof v22Profile==='function'?v22Profile:null;
  if(prior){
    window.v22Profile=async function(...args){
      let html=await prior(...args),status;
      try{status=await send('status');}catch(e){status={error:e.message,email_enabled:false,email_verified:false,sms_enabled:false};}
      const verified=Boolean(status.email_verified);
      const title=verified?'Correo de recuperación verificado':'Verifica tu correo de recuperación';
      const student=typeof S!=='undefined'&&S.role==='alumno';
      const editor=student?`<div class="nj-profile-edit"><label for="rec_email">Correo de recuperación</label><input id="rec_email" class="input" type="email" autocomplete="email" placeholder="correo@ejemplo.com" value="${esc(S.profile?.correo_recuperacion||'')}"><button type="button" class="btn primary" onclick="v22SaveRecovery()">Cambiar correo con verificación</button></div>`:'';
      html+=`<section class="card max-w-3xl nj-profile" aria-label="Seguridad de mi cuenta"><div class="nj-profile-head"><span class="nj-profile-lock" aria-hidden="true">✉</span><div><span class="nj-profile-kicker">SEGURIDAD DE MI CUENTA</span><h3>${esc(title)}</h3><p>Protegemos tu identidad mediante códigos de un solo uso. El cambio de correo requiere verificar ambas direcciones.</p></div></div><div class="nj-profile-status"><span class="chip">${verified?'✓ Correo verificado':'! Verificación pendiente'}</span><span class="chip">${status.email_enabled?'✓ Correos disponibles':'! Configura el proveedor de correo'}</span><span class="chip">SMS próximamente</span></div>${status.error?`<p class="nj-profile-error">${esc(status.error)}</p>`:''}${editor}<button class="btn nj-profile-action" type="button" onclick="jaguarShieldEnroll()">${verified?'Volver a verificar correo':'Verificar mi correo'}</button><p class="nj-profile-note">NEXO puede explicarte cómo verificarte, pero nunca le envíes un código.</p></section>`;
      return html;
    };
  }
})();
