/* NEXO AI 2.0 · Avatar expresivo para Jaguar, Admisiones y Centro.
   JS/CSS puro; toda la seguridad, cuotas y contexto se resuelven en el backend. */
(()=>{'use strict';
 if(document.getElementById('nexo-floating-root'))return;
 const current=document.currentScript;
 const site=current?.dataset?.site||'jaguar-public';
 const endpoint=current?.dataset?.endpoint||'/api/public';
 const avatar='/assets/nexo-avatar.png';
 const presets={
 'jaguar-public':{subtitle:'Portal institucional',welcome:'¡Holaaa! 👋 Soy NEXO, el asistente de ITHLA. Puedo orientarte sobre el instituto, admisiones y servicios. ¿Qué te gustaría saber? 💛',tips:['¿Qué es ITHLA?','¿Cómo funcionan las admisiones?','¿Dónde inicio sesión?']},
 'jaguar-session':{subtitle:'Tu compañero en Jaguar',welcome:'¡Qué gusto verte por aquí! 🐆✨ Soy NEXO. Si tienes sesión activa, puedo orientarte según tu rol y los módulos disponibles, sin consultar expedientes privados.',tips:['¿Qué puedo hacer con mi perfil?','Ayúdame a usar el sistema','¿Dónde consulto mis documentos?']},
 admisiones:{subtitle:'Tu guía de admisión',welcome:'¡Hey, futuro ITHLA! 🎓💛 Soy NEXO. Te explico los pasos de admisión y cómo revisar una solicitud. Nunca te pediré tu CURP ni datos privados aquí.',tips:['¿Cómo veo mi estatus?','¿Cuándo abren inscripciones?','¿Qué pasa si fui aceptado?']},
 'admisiones-admin':{subtitle:'Orientación de Control Escolar',welcome:'¡Hola, equipo de Admisiones! 📚 Soy NEXO. Puedo explicar el flujo administrativo y el alcance de tus permisos. No consulto expedientes ni hago modificaciones.',tips:['¿Cómo funciona la inscripción?','¿Qué hago con un aceptado?','¿Quién autoriza la convocatoria?']},
 control:{subtitle:'Gobierno institucional',welcome:'¡Hola, equipo ITHLA! ⚙️✨ Soy NEXO. Puedo guiarte sobre configuraciones, autorizaciones y seguridad según tu sesión verificada, sin ejecutar cambios.',tips:['¿Quién autoriza los cambios?','¿Cómo se administra el conocimiento?','¿Cómo cierro la convocatoria?']}
 };
 const info=presets[site]||presets['jaguar-public'];
 const root=document.createElement('div');root.id='nexo-floating-root';root.dataset.state='idle';
 const avatarHTML=`<span class="nx-avatar-wrap" aria-hidden="true"><span class="nx-orbit"></span><img src="${avatar}" alt=""></span>`;
 root.innerHTML=`<section id="nx-panel" role="dialog" aria-label="Chat con NEXO AI" hidden>
 <header id="nx-head">${avatarHTML}<div class="nx-title"><strong>NEXO AI <span aria-hidden="true">✨</span></strong><small>${info.subtitle}</small><span id="nx-status" aria-live="polite">Esperando para ayudarte</span></div><div id="nx-actions"><button id="nx-clear" type="button" title="Borrar conversación" aria-label="Borrar conversación">↻</button><button id="nx-close" type="button" title="Minimizar" aria-label="Minimizar NEXO">×</button></div></header>
 <div id="nx-messages" role="log" aria-live="polite" aria-relevant="additions"></div>
 <div id="nx-suggestions"></div>
 <form id="nx-form"><input id="nx-input" type="text" minlength="3" maxlength="420" autocomplete="off" placeholder="Cuéntame qué necesitas..." aria-label="Escribe tu pregunta a NEXO" required><button id="nx-send" type="submit">Enviar ➤</button></form><p id="nx-disclaimer">🔒 No compartas contraseñas, CURP ni datos personales.</p>
 </section><button id="nx-launcher" type="button" aria-controls="nx-panel" aria-expanded="false" aria-label="Abrir asistente NEXO">${avatarHTML}<span class="nx-launch-text">NEXO AI</span><span class="nx-unread" aria-hidden="true"></span></button>`;
 document.body.append(root);
 const $=id=>root.querySelector('#'+id);const panel=$('nx-panel'),launcher=$('nx-launcher'),input=$('nx-input'),send=$('nx-send'),messages=$('nx-messages'),status=$('nx-status');
 let busy=false,welcomed=false,history=[],typingTimer=null,finishedTimer=null;
 function mode(value,text){root.dataset.state=value;status.textContent=text||({idle:'Esperando para ayudarte',typing:'Te estoy escuchando ✍️',thinking:'Analizando tu pregunta 🧠',done:'¡Respuesta lista! ✨',error:'Modo de orientación disponible'}[value]||'NEXO AI')}
 function safeUrl(v){if(typeof v!=='string')return null;if(v.startsWith('/')&&!v.startsWith('//'))return v;try{const u=new URL(v);return u.protocol==='https:'?u.href:null}catch{return null}}
 function add(text,type,details){const row=document.createElement('div');row.className='nx-row '+(type==='bot'?'nx-bot':'nx-user');if(type==='bot'){const i=document.createElement('img');i.className='nx-mini-avatar';i.src=avatar;i.alt='';row.append(i)}const b=document.createElement('div');b.className='nx-msg';b.textContent=String(text||'');row.append(b);
 if(details){const meta=document.createElement('div');meta.className='nx-source';meta.textContent=details.modo==='ia'?('NEXO AI · '+({groq:'motor principal ⚡',gemini:'respaldo Gemini ✨',cloudflare:'respaldo Cloudflare ☁️',openrouter:'respaldo OpenRouter 🧠'}[details.proveedor]||'respuesta generada')):'NEXO · orientación';const refs=Array.isArray(details.fuentes)?details.fuentes:[];for(const r of refs.slice(0,2)){const href=safeUrl(r?.url);if(!href)continue;const a=document.createElement('a');a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=String(r.fuente||'Fuente');meta.append(a)}if(details.aviso){const note=document.createElement('div');note.textContent=String(details.aviso);meta.append(note)}b.append(meta)}
 messages.append(row);messages.scrollTop=messages.scrollHeight;return row}
 function welcome(){if(welcomed)return;add(info.welcome,'bot');welcomed=true;for(const suggestion of info.tips){const button=document.createElement('button');button.type='button';button.textContent=suggestion;button.addEventListener('click',()=>ask(suggestion));$('nx-suggestions').append(button)}}
 function open(){panel.hidden=false;launcher.setAttribute('aria-expanded','true');launcher.setAttribute('aria-label','Minimizar NEXO');welcome();input.focus()}
 function close(){panel.hidden=true;launcher.setAttribute('aria-expanded','false');launcher.setAttribute('aria-label','Abrir asistente NEXO');launcher.focus()}
 function clear(){if(busy)return;messages.replaceChildren();$('nx-suggestions').replaceChildren();history=[];welcomed=false;welcome();mode('idle')}
 launcher.addEventListener('click',()=>panel.hidden?open():close());$('nx-close').addEventListener('click',close);$('nx-clear').addEventListener('click',clear);
 root.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){e.preventDefault();close()}});
 input.addEventListener('input',()=>{if(busy)return;clearTimeout(typingTimer);if(input.value.trim())mode('typing');else mode('idle');typingTimer=setTimeout(()=>{if(!busy)mode('idle')},1250)});
 input.addEventListener('focus',()=>{if(!busy&&input.value.trim())mode('typing')});
 async function ask(text){const q=String(text||'').trim();if(busy||q.length<3||q.length>420)return;clearTimeout(typingTimer);clearTimeout(finishedTimer);welcome();add(q,'user');input.value='';busy=true;send.disabled=true;mode('thinking');const pending=add('Un momentito, estoy conectando las ideas… 🧠','bot');const dots=document.createElement('div');dots.className='nx-dots';dots.setAttribute('aria-label','NEXO está pensando');dots.innerHTML='<i></i><i></i><i></i>';pending.querySelector('.nx-msg').append(dots);
 try{let headers={'Content-Type':'application/json','Accept':'application/json'};if(typeof window.ithlaNexoAuth==='function'){const auth=await window.ithlaNexoAuth().catch(()=>null);if(auth?.token&&auth?.sid){headers.Authorization='Bearer '+auth.token;headers['X-ITHLA-Session']=auth.sid}}
 const body=endpoint==='/api/public'?{action:'nexo-chat',message:q,history:history.slice(-8),surface:site}:{message:q,history:history.slice(-8)};
 const response=await fetch(endpoint,{method:'POST',headers,cache:'no-store',credentials:'same-origin',body:JSON.stringify(body)});
 const payload=await response.json().catch(()=>({}));if(!response.ok)throw Error(payload.error||'La conexión no está disponible.');const data=payload.data||payload;if(!data.respuesta)throw Error('Sin respuesta de NEXO');pending.remove();add(data.respuesta,'bot',data);mode(data.modo==='ia'?'done':'idle');if(data.modo==='ia'||data.modo==='orientacion'){history.push({role:'user',content:q},{role:'assistant',content:String(data.respuesta).slice(0,420)});history=history.slice(-8)}
 }catch(e){pending.remove();add('Uy, no logré responder ahora 😅. Intenta de nuevo. Si tu sesión expiró, vuelve a iniciar sesión.','bot');mode('error')}
 finally{busy=false;send.disabled=false;finishedTimer=setTimeout(()=>{mode('idle')},2400);if(!panel.hidden)input.focus()}
 }
 $('nx-form').addEventListener('submit',e=>{e.preventDefault();ask(input.value)});
 window.NEXO={open,close,reset:clear};
})();
