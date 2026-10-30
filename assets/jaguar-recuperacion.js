(()=>{'use strict';
  const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
  const forms=[$('#account-form'),$('#code-form'),$('#password-form'),$('#success')];
  const steps=[$('#step1'),$('#step2'),$('#step3')];
  let challenge='',proof='',deadline=0,canResendAt=0,lastAccount='',busy=false;
  function display(stage){forms.forEach((f,i)=>f.hidden=i!==stage);steps.forEach((s,i)=>s.classList.toggle('active',i===Math.min(stage,2)));message('');}
  function message(s,ok=false){const f=$('#feedback');f.textContent=s;f.classList.toggle('ok',ok);}
  async function request(action,extra){
    const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',credentials:'same-origin',body:JSON.stringify({action,...extra})});
    const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw Error(d.error||'No se pudo completar la operación.');return d;
  }
  async function withButton(form,job){if(busy)return;busy=true;const button=form.querySelector('button[type=submit]');if(button)button.disabled=true;message('');try{await job();}catch(e){message(e.message||'Ocurrió un error.');}finally{busy=false;if(button)button.disabled=false;}}
  function startTimers(){deadline=Date.now()+300000;canResendAt=Date.now()+65000;tick();}
  function tick(){
    const remain=Math.max(0,Math.ceil((deadline-Date.now())/1000));
    $('#remaining').textContent=remain?`Vence en ${String(Math.floor(remain/60)).padStart(2,'0')}:${String(remain%60).padStart(2,'0')}`:'Código vencido. Solicita uno nuevo.';
    const r=$('#resend'),secs=Math.max(0,Math.ceil((canResendAt-Date.now())/1000));r.disabled=secs>0||busy;r.textContent=secs?`Reenviar código en ${secs} s`:'Reenviar código';
  }
  setInterval(()=>{if(!forms[1].hidden)tick();},1000);
  async function send(){const r=await request('recovery_start',{identificador:lastAccount});challenge=r.id;proof='';startTimers();$$('#digits input').forEach(x=>x.value='');display(1);message(r.message,true);$('#digit0').focus();}
  $('#account-form').addEventListener('submit',e=>{e.preventDefault();withButton(e.currentTarget,async()=>{const email=$('#identifier').value.trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Escribe tu usuario institucional completo.');lastAccount=email;await send();});});
  const inputs=$$('#digits input');
  inputs.forEach((input,i)=>{
    input.addEventListener('input',()=>{const clean=input.value.replace(/\D/g,'');input.value=clean.slice(-1);if(clean&&i<5)inputs[i+1].focus();});
    input.addEventListener('keydown',e=>{if(e.key==='Backspace'&&!input.value&&i>0){inputs[i-1].focus();inputs[i-1].value='';}if(e.key==='ArrowLeft'&&i>0)inputs[i-1].focus();if(e.key==='ArrowRight'&&i<5)inputs[i+1].focus();});
    input.addEventListener('paste',e=>{const str=(e.clipboardData?.getData('text')||'').replace(/\D/g,'').slice(0,6);if(!str)return;e.preventDefault();inputs.forEach((it,j)=>it.value=str[j]||'');inputs[Math.min(str.length,5)].focus();});
  });
  $('#code-form').addEventListener('submit',e=>{e.preventDefault();withButton(e.currentTarget,async()=>{
    if(Date.now()>=deadline)throw Error('El código venció; solicita otro.');
    const code=inputs.map(x=>x.value).join('');if(!/^\d{6}$/.test(code))throw Error('Escribe los seis dígitos.');
    const r=await request('recovery_verify',{id:challenge,code});proof=r.proof;display(2);$('#new-password').focus();
  });});
  $('#resend').addEventListener('click',()=>{if(busy||Date.now()<canResendAt)return;withButton($('#code-form'),send);});
  $('#back-account').addEventListener('click',()=>{challenge='';proof='';display(0);});
  $$('.show-password').forEach(b=>b.addEventListener('click',()=>{const input=document.getElementById(b.dataset.target);const visible=input.type==='password';input.type=visible?'text':'password';b.textContent=visible?'Ocultar':'Ver';b.setAttribute('aria-label',visible?'Ocultar contraseña':'Mostrar contraseña');}));
  $('#password-form').addEventListener('submit',e=>{e.preventDefault();withButton(e.currentTarget,async()=>{
    const password=$('#new-password').value,confirm_password=$('#confirm-password').value;
    if (password.length < 8 || password.length > 128)
      throw Error('La contraseña debe tener entre 8 y 128 caracteres.');
    if(password!==confirm_password)throw Error('Las contraseñas no coinciden.');
    await request('recovery_complete',{id:challenge,proof,password,confirm_password});
    $('#new-password').value='';$('#confirm-password').value='';proof='';challenge='';display(3);
  });});
  const query=new URLSearchParams(location.search).get('usuario');if(query&&query.length<251)$('#identifier').value=query;
})();
