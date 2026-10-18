/* NEXO AI 1.0: chat público con historial efímero; no lee datos escolares. */
(()=>{'use strict';
 if(document.getElementById('nexo-floating-root'))return;
 const styles=`
 #nexo-floating-root{--nx-navy:#12283e;--nx-gold:#d4af37;--nx-text:#20324a;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;position:fixed;right:max(18px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));z-index:40;color:#20324a}
 #nexo-floating-root *{box-sizing:border-box}
 #nexo-floating-root button,#nexo-floating-root input{font:inherit}
 #nx-bubble{display:flex;align-items:center;justify-content:center;width:62px;height:62px;border-radius:22px;border:2px solid #d4af37;color:#f6e6b8;background:#132c47;box-shadow:0 12px 42px #0006;cursor:pointer;font-size:25px;font-weight:900;letter-spacing:-.05em}
 #nx-bubble:hover,#nx-bubble:focus-visible{outline:3px solid #d4af3760;outline-offset:2px}
 #nx-bubble .nx-unread{position:absolute;right:0;top:0;width:13px;height:13px;border:2px solid #132c47;border-radius:50%;background:#31b29d}
 #nx-panel{display:flex;flex-direction:column;width:min(385px,calc(100vw - 24px));height:min(550px,calc(100dvh - 115px));min-height:290px;position:absolute;bottom:76px;right:0;border-radius:20px;overflow:hidden;background:#f9fbfe;box-shadow:0 24px 80px #0008;border:1px solid #c5d0db}
 #nx-panel[hidden]{display:none!important}
 #nx-head{background:linear-gradient(120deg,#10263e,#1e4261);color:white;padding:15px;display:flex;gap:11px;align-items:center;border-bottom:3px solid #d4af37}
 #nx-symbol{width:38px;height:38px;display:grid;place-items:center;border:1px solid #d4af37;border-radius:12px;color:#d4af37;font-size:23px;font-weight:900}
 #nx-head strong{display:block;letter-spacing:.09em;font-size:15px}#nx-head small{display:block;color:#d9e4ee;font-size:11px;margin-top:2px}
 #nx-head .nx-actions{margin-left:auto;display:flex;gap:5px}
 #nx-head .nx-actions button{width:33px;height:33px;border:1px solid #ffffff48;color:white;background:#ffffff14;border-radius:9px;cursor:pointer;font-size:18px}
 #nx-messages{padding:16px 13px;display:flex;flex-direction:column;gap:11px;overflow-y:auto;flex:1;overscroll-behavior:contain;color:#1b3047;font-size:13px;line-height:1.55}
 .nx-msg{max-width:92%;padding:11px 13px;border-radius:13px;overflow-wrap:anywhere;white-space:pre-wrap}
 .nx-bot{align-self:flex-start;background:white;border:1px solid #dae2ea;border-bottom-left-radius:3px}
 .nx-user{align-self:flex-end;background:#183750;color:white;border-bottom-right-radius:3px}
 .nx-src{font-size:11px;color:#526981;margin-top:8px;white-space:normal}
 .nx-src a{display:inline-block;margin-left:4px;text-decoration:underline;color:#176d75}
 #nx-examples{display:flex;gap:6px;padding:0 12px 9px;overflow-x:auto;min-height:36px}
 #nx-examples button{white-space:nowrap;border:1px solid #c8d4df;background:white;color:#244057;border-radius:30px;padding:5px 10px;font-size:11px;cursor:pointer}
 #nx-form{display:flex;gap:8px;padding:11px;background:white;border-top:1px solid #dbe2eb}
 #nx-input{min-width:0;flex:1;border:1px solid #bac8d6;background:#fff;color:#183149;border-radius:12px;padding:11px;font-size:13px}
 #nx-send{background:#152e48;color:white;border:0;border-radius:10px;padding:0 13px;cursor:pointer;font-size:12px;font-weight:700}
 #nx-disclaimer{margin:0;padding:0 14px 10px;background:white;color:#647487;font-size:10px;text-align:center}
 @media(max-width:460px){#nexo-floating-root{right:12px;bottom:max(12px,env(safe-area-inset-bottom))}#nx-panel{width:calc(100vw - 24px);height:min(550px,calc(100dvh - 94px));bottom:72px}}
 @media(prefers-reduced-motion:reduce){#nexo-floating-root *{scroll-behavior:auto!important;transition:none!important}}
 `;
 const sheet=document.createElement('style');sheet.textContent=styles;document.head.append(sheet);
 const root=document.createElement('div');root.id='nexo-floating-root';
 root.innerHTML=`<section id="nx-panel" hidden role="dialog" aria-label="Chat de orientación NEXO"><header id="nx-head"><div id="nx-symbol" aria-hidden="true">N</div><div><strong>NEXO AI</strong><small>Asistente inteligente · ITHLA</small></div><div class="nx-actions"><button type="button" id="nx-min" title="Minimizar" aria-label="Minimizar NEXO">−</button><button type="button" id="nx-close" title="Cerrar" aria-label="Cerrar NEXO">×</button></div></header><div id="nx-messages" role="log" aria-live="polite"></div><div id="nx-examples"><button type="button" data-question="¿Cómo solicito una constancia?">Constancias</button><button type="button" data-question="¿Cómo consulto mi boleta?">Calificaciones</button><button type="button" data-question="¿Cómo funcionan las admisiones?">Admisiones</button></div><form id="nx-form"><input id="nx-input" maxlength="420" autocomplete="off" aria-label="Tu pregunta" placeholder="Escribe tu pregunta..." required><button id="nx-send" type="submit">Enviar</button></form><p id="nx-disclaimer">No escribas contraseñas, CURP, matrículas ni datos sensibles.</p></section><button id="nx-bubble" type="button" aria-label="Abrir NEXO" aria-expanded="false" aria-controls="nx-panel">N<span class="nx-unread" aria-hidden="true"></span></button>`;
 document.body.append(root);
 const $=id=>root.querySelector('#'+id),bubble=$('nx-bubble'),panel=$('nx-panel'),messages=$('nx-messages'),input=$('nx-input'),send=$('nx-send');let busy=false,historyStarted=false,conversation=[];
 const isValidUrl=v=>typeof v==='string'&&(v.startsWith('/')&&!v.startsWith('//')||/^https:\/\/[a-z0-9.-]+(?:\/[^\s<>"'`]*)?$/i.test(v));
 function addMessage(value,who,details){const msg=document.createElement('div');msg.className='nx-msg '+(who==='bot'?'nx-bot':'nx-user');msg.textContent=String(value||'');if(details){const source=document.createElement('div');source.className='nx-src';source.textContent=String(details.modo==='ia'?'NEXO AI · respuesta generada':(details.fuente||'NEXO · orientación'));if(isValidUrl(details.url)){const a=document.createElement('a');a.href=details.url;a.textContent='Ver información ↗';a.rel='noopener noreferrer';source.append(a)}const links=Array.isArray(details.fuentes)?details.fuentes:[];for(const ref of links.slice(0,2)){if(isValidUrl(ref.url)){const a=document.createElement('a');a.href=ref.url;a.textContent=String(ref.fuente||'Fuente');a.rel='noopener noreferrer';source.append(a)}}if(details.aviso){const note=document.createElement('div');note.textContent=String(details.aviso);source.append(note)}msg.append(source)}messages.append(msg);messages.scrollTop=messages.scrollHeight;return msg}
 function open(){panel.hidden=false;bubble.setAttribute('aria-expanded','true');bubble.setAttribute('aria-label','Minimizar NEXO');if(!historyStarted){addMessage('¡Hola! Soy NEXO AI, tu asistente virtual del ITHLA. Puedes conversar conmigo y hacer preguntas de seguimiento. Para trámites, me baso en información institucional publicada; si algo no está confirmado, te lo diré.', 'bot');historyStarted=true;}input.focus()}
 function close(){panel.hidden=true;bubble.setAttribute('aria-expanded','false');bubble.setAttribute('aria-label','Abrir NEXO');bubble.focus()}
 bubble.addEventListener('click',()=>panel.hidden?open():close());$('nx-min').addEventListener('click',close);$('nx-close').addEventListener('click',()=>{close();messages.replaceChildren();historyStarted=false;conversation=[];});
 panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close()}});
 async function question(q){
  q=String(q||'').trim();if(busy||q.length<3||q.length>420)return;
  addMessage(q,'user');input.value='';const wait=addMessage('NEXO está pensando…','bot');busy=true;send.disabled=true;
  try{
    const r=await fetch('/api/public',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({action:'nexo-chat',message:q,history:conversation.slice(-8)})});
    const result=await r.json();if(!r.ok||!result?.data)throw Error('No se pudo consultar la información.');
    wait.remove();const d=result.data;
    addMessage(d.respuesta||'No encontré información suficiente.','bot',{modo:d.modo,fuente:d.fuente,url:d.url,fuentes:d.fuentes,aviso:d.aviso});
    if(d.modo==='ia'||d.modo==='orientacion'){
      conversation.push({role:'user',content:q},{role:'assistant',content:String(d.respuesta||'').slice(0,420)});
      conversation=conversation.slice(-8);
    }
  }catch{
    wait.remove();addMessage('No pude conectarme con NEXO ahora. Intenta de nuevo más tarde o consulta al departamento correspondiente.','bot');
  }finally{busy=false;send.disabled=false;input.focus()}
 }
 $('nx-form').addEventListener('submit',e=>{e.preventDefault();question(input.value)});
 root.querySelectorAll('[data-question]').forEach(b=>b.addEventListener('click',()=>question(b.dataset.question)));
 window.NEXO={open,close};
})();
