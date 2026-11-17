/* NEXO 4.0 · UI sin dependencias, formato seguro, sesión real y estados expresivos. */
(()=>{'use strict';
 if(document.getElementById('nexo-floating-root'))return;
 const script=document.currentScript,site=script?.dataset?.site||'jaguar-public';
 const endpoint=script?.dataset?.endpoint||'/api/public',avatar='/assets/nexo-avatar.png';
 const protectedSite=['jaguar-session','admisiones-admin','control'].includes(site);
 const presets={
  'jaguar-public':{subtitle:'Orientación pública',welcome:'¡Hola! 👋 Soy NEXO, tu guía para acceder a Jaguar y conocer ITHLA. Para consultas internas tendrás que iniciar sesión. 💛',tips:['¿Cómo inicio sesión?','¿Cómo recupero mi acceso?','¿Qué es ITHLA?']},
  'jaguar-session':{subtitle:'Copiloto de tu sesión',welcome:'¡Qué gusto verte! 🐆 Soy NEXO, tu copiloto dentro de Jaguar. Puedo orientarte y consultar estadísticas agregadas autorizadas, sin modificar registros escolares.',tips:['¿Qué opciones hay en mi perfil?','Estadísticas de mi departamento','¿Cuánto tiempo me queda de sesión?','Ayúdame a renovar mi sesión']},
  admisiones:{subtitle:'Guía de aspirantes',welcome:'¡Hola, futuro ITHLA! 🎓 Soy NEXO. Puedo ayudarte a entender la convocatoria y los pasos para consultar tu estatus.',tips:['¿Dónde veo mi estatus?','¿Qué pasa si me aceptan?','¿Cómo funciona el registro?']},
  'admisiones-admin':{subtitle:'Asistencia administrativa',welcome:'¡Hola, equipo de Admisiones! 📚 Te oriento con los procesos de tu área y sus autorizaciones, sin acceder a expedientes.',tips:['¿Cómo se revisa una solicitud?','¿Quién confirma la inscripción?','¿Qué funciones tiene mi rol?']},
  control:{subtitle:'Asistente de gobierno técnico',welcome:'¡Hola, equipo ITHLA! ⚙️ Te oriento sobre NEXO, autorizaciones y el Centro de Control según tu sesión verificada.',tips:['¿Cómo se administra NEXO?','¿Quién aprueba los cambios académicos?','¿Qué puedo hacer en mi rol?']}
 };
 const info=presets[site]||presets['jaguar-public'];
 const root=document.createElement('div');root.id='nexo-floating-root';root.dataset.state='idle';root.dataset.site=site;
 const avatarHTML='<span class="nx-avatar-wrap" aria-hidden="true"><span class="nx-orbit"></span><span class="nx-orbit nx-orbit-second"></span><img src="'+avatar+'" alt=""></span>';
 root.innerHTML=`<section id="nx-panel" role="dialog" aria-label="Chat con NEXO AI" hidden>
 <header id="nx-head">${avatarHTML}<div class="nx-title"><strong>NEXO <span class="nx-ai-mark">AI</span> <span aria-hidden="true">✦</span></strong><small>${info.subtitle}</small><span id="nx-status" role="status" aria-live="polite">Listo para ayudarte</span></div><div id="nx-actions"><button id="nx-clear" type="button" title="Nueva conversación" aria-label="Borrar conversación">↻</button><button id="nx-close" type="button" title="Minimizar" aria-label="Minimizar NEXO">×</button></div></header>
 <div id="nx-messages" role="log" aria-live="polite" aria-relevant="additions"></div><div id="nx-suggestions" aria-label="Preguntas sugeridas"></div>
 <form id="nx-form"><label for="nx-input" class="nx-sr-only">Tu mensaje</label><input id="nx-input" type="text" minlength="3" maxlength="420" autocomplete="off" placeholder="Pregúntame lo que necesites…" aria-label="Escribe tu pregunta a NEXO" required><button id="nx-send" type="submit" title="Enviar mensaje" aria-label="Enviar mensaje">➤</button></form><p id="nx-disclaimer">🔒 Nunca escribas contraseñas, CURP o datos privados.</p></section>
 <button id="nx-launcher" type="button" aria-controls="nx-panel" aria-expanded="false" aria-label="Abrir asistente NEXO">${avatarHTML}<span class="nx-launch-text">NEXO <b>AI</b></span><span class="nx-unread" aria-hidden="true"></span></button>`;
 document.body.append(root);
 const $=id=>root.querySelector('#'+id),panel=$('nx-panel'),launcher=$('nx-launcher'),input=$('nx-input'),send=$('nx-send'),messages=$('nx-messages'),status=$('nx-status');
 let busy=false,welcomed=false,history=[],typingTimer,doneTimer,currentAbort=null;
 function mode(state,label){root.dataset.state=state;status.textContent=label||({idle:'Listo para ayudarte',typing:'Te estoy escuchando ✍️',thinking:'Conectando ideas… 🧠',done:'¡Listo! ✨',error:'Por ahora no pude conectarme'}[state]||'NEXO AI');}
 function safeUrl(url){if(typeof url!=='string')return null;if(url.startsWith('/')&&!url.startsWith('//'))return url;try{const u=new URL(url);return u.protocol==='https:'?u.href:null;}catch{return null;}}
 /* Analizador limitado a texto, listas, **negritas**, *cursivas* y `código`.
    Nunca interpreta HTML ni utiliza innerHTML para las respuestas de la IA. */
 function richInline(target,value){
  const normalized=String(value||'').replace(/\\\*/g,'*').replace(/\*{3,}/g,'**');
  const pattern=/(\*\*([^\n*]+)\*\*|__([^\n_]+)__|`([^\n`]+)`|\*([^\n*]+)\*)/g;
  let previous=0,match;
  while((match=pattern.exec(normalized))){
   if(match.index>previous)target.append(document.createTextNode(normalized.slice(previous,match.index)));
   const el=document.createElement(match[2]||match[3]?'strong':match[4]?'code':'em');
   el.textContent=match[2]||match[3]||match[4]||match[5];target.append(el);previous=pattern.lastIndex;
  }
  if(previous<normalized.length)target.append(document.createTextNode(normalized.slice(previous)));
 }
 function richText(target,value){
  const lines=String(value||'').replace(/\r\n?/g,'\n').split('\n');let list=null,kind=null,paragraph=null;
  for(const line of lines){
   const item=/^\s*(?:([-•])\s+|(\d+)\.)\s+(.+)$/.exec(line);
   if(item){paragraph=null;const tag=item[2]?'ol':'ul';if(kind!==tag){list=document.createElement(tag);list.className='nx-list';target.append(list);kind=tag;}
    const li=document.createElement('li');richInline(li,item[3]);list.append(li);continue;}
   list=null;kind=null;
   if(!line.trim()){paragraph=null;continue;}
   if(!paragraph){paragraph=document.createElement('p');paragraph.className='nx-paragraph';target.append(paragraph);}else paragraph.append(document.createElement('br'));
   richInline(paragraph,line.replace(/^#{1,4}\s+/,'').trim());
  }
 }
 function add(value,type,details){
  const row=document.createElement('div');row.className='nx-row '+(type==='bot'?'nx-bot':'nx-user');
  if(type==='bot'){const img=document.createElement('img');img.className='nx-mini-avatar';img.src=avatar;img.alt='';row.append(img);}
  const body=document.createElement('div');body.className='nx-msg';if(type==='bot')richText(body,value);else body.textContent=String(value||'');row.append(body);
  if(details){
   const meta=document.createElement('div');meta.className='nx-source';meta.textContent=details.modo==='ia'?'NEXO AI · '+({groq:'Groq ⚡',gemini:'Gemini ✨',cloudflare:'Cloudflare ☁️',openrouter:'OpenRouter 🧠'}[details.proveedor]||'motor conversacional'):'NEXO · guía institucional';
   for(const r of (Array.isArray(details.fuentes)?details.fuentes:[]).slice(0,2)){
    const href=safeUrl(r?.url);if(!href)continue;const a=document.createElement('a');a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=String(r.fuente||'Fuente');meta.append(a);
   }
   if(details.modo==='estadistica'&&details.statistics)body.append(statCharts(details.statistics));
   if(details.aviso){const note=document.createElement('div');note.textContent=String(details.aviso);meta.append(note);}body.append(meta);
   const copy=document.createElement('button');copy.className='nx-copy';copy.type='button';copy.textContent='Copiar respuesta';copy.title='Copiar texto';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(String(value||''));copy.textContent='¡Copiada! ✓';setTimeout(()=>{copy.textContent='Copiar respuesta';},1700);}catch{copy.textContent='No se pudo copiar';}});body.append(copy);
  }
  messages.append(row);messages.scrollTop=messages.scrollHeight;return row;
 }
 function welcome(){if(welcomed)return;add(info.welcome,'bot');welcomed=true;for(const tip of info.tips){const button=document.createElement('button');button.type='button';button.textContent=tip;button.addEventListener('click',()=>ask(tip));$('nx-suggestions').append(button);}}
 function open(){panel.hidden=false;launcher.setAttribute('aria-expanded','true');launcher.setAttribute('aria-label','Minimizar NEXO');welcome();input.focus();}
 function close(){panel.hidden=true;launcher.setAttribute('aria-expanded','false');launcher.setAttribute('aria-label','Abrir asistente NEXO');launcher.focus();}
 function clear(){if(busy)return;messages.replaceChildren();$('nx-suggestions').replaceChildren();history=[];welcomed=false;welcome();mode('idle');}
 launcher.addEventListener('click',()=>panel.hidden?open():close());$('nx-close').addEventListener('click',close);$('nx-clear').addEventListener('click',clear);
 root.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){e.preventDefault();close();}});
 input.addEventListener('input',()=>{if(busy)return;clearTimeout(typingTimer);mode(input.value.trim()?'typing':'idle');typingTimer=setTimeout(()=>{if(!busy)mode('idle');},1600);});
 async function ask(value){
  const q=String(value||'').trim();if(busy||q.length<3||q.length>420)return;
  if(site==='jaguar-session'&&/^(?:¿?Qué opciones hay en mi perfil\??|explorar mis módulos|mis módulos)$/i.test(q)){welcome();add(q,'user');input.value='';const row=add('Estos son los accesos del menú de tu sesión. Selecciona alguno para abrirlo.','bot');row.querySelector('.nx-msg').append(navigationPanel());return;}
  // Acción local con confirmación: la IA no recibe ni controla tokens, y la API decide los límites.
  if(site==='jaguar-session'&&/(?:renov|extend|ampli|prolong)(?:ar|er|ir|ando|aci[oó]n)?[^.!?]{0,45}sesi[oó]n|sesi[oó]n[^.!?]{0,45}(?:renov|extend|ampli|prolong)|(?:cu[aá]nto|tiempo|caduc|expir|vence|vencimiento)[^.!?]{0,45}sesi[oó]n|sesi[oó]n[^.!?]{0,45}(?:cu[aá]nto|tiempo|caduc|expir|vence|vencimiento)/i.test(q)){
    welcome();add(q,'user');input.value='';let detail='';try{const snap=await window.ithlaSessionGuard.check();detail='Tiempo restante: aproximadamente '+Math.ceil((snap.remainingSeconds||0)/60)+' minutos. ';}catch{detail='Necesitas una sesión activa y válida. ';}const card=add(detail+'Puedo ayudarte a renovar la inactividad. 🔐 El vencimiento máximo institucional no se modifica. Confírmalo con el botón:','bot');
    const b=document.createElement('button');b.type='button';b.className='nx-copy';b.textContent='Renovar mi sesión';b.addEventListener('click',async()=>{b.disabled=true;b.textContent='Verificando…';try{const state=await window.ithlaSessionGuard.renew();const mins=Math.ceil((state.remainingSeconds||0)/60);add('✅ Tiempo actualizado. Te quedan aproximadamente '+mins+' minutos, respetando el máximo permitido para tu perfil.','bot');b.remove();}catch(e){b.disabled=false;b.textContent='Reintentar renovación';add('No pude renovar tu sesión: '+String(e.message||'').slice(0,140),'bot');}});
    card.querySelector('.nx-msg').append(b);messages.scrollTop=messages.scrollHeight;return;
  }
  clearTimeout(typingTimer);clearTimeout(doneTimer);welcome();add(q,'user');input.value='';busy=true;send.disabled=true;mode('thinking');
  const pending=add('Estoy organizando la información…','bot');const dots=document.createElement('div');dots.className='nx-dots';dots.setAttribute('aria-label','NEXO está pensando');dots.innerHTML='<i></i><i></i><i></i>';pending.querySelector('.nx-msg').append(dots);
  try{
   const headers={'Content-Type':'application/json','Accept':'application/json'};
   if(protectedSite){
    const auth=typeof window.ithlaNexoAuth==='function'?await window.ithlaNexoAuth().catch(()=>null):null;
    if(!auth?.token||!auth?.sid)throw new Error('SESSION_REQUIRED');
    headers.Authorization='Bearer '+auth.token;headers['X-ITHLA-Session']=auth.sid;
   }
   const request=endpoint==='/api/public'?{action:'nexo-chat',message:q,history:history.slice(-8)}:{message:q,history:history.slice(-8)};
   currentAbort=new AbortController();
   const response=await fetch(endpoint,{method:'POST',headers,cache:'no-store',credentials:'same-origin',signal:currentAbort.signal,body:JSON.stringify(request)});
   const payload=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(response.status===401?'SESSION_REQUIRED':response.status===403?'FORBIDDEN':response.status===429?'QUOTA':response.status>=500?'SERVICE':'REQUEST');error.httpStatus=response.status;throw error;}
   const data=payload?.data||payload;if(!data.respuesta)throw new Error('EMPTY');
   pending.remove();add(data.respuesta,'bot',data);mode(data.modo==='ia'?'done':'idle');
   if(['ia','manual','orientacion'].includes(data.modo)){history.push({role:'user',content:q},{role:'assistant',content:String(data.respuesta).slice(0,420)});history=history.slice(-8);}
  }catch(error){pending.remove();
   const states={SESSION_REQUIRED:'🔐 Tu sesión institucional terminó. Vuelve a ingresar para continuar.',FORBIDDEN:'🛡️ Tu perfil no tiene autorización para consultar NEXO desde este panel.',QUOTA:'⏳ Llegamos al límite temporal de solicitudes. Podrás intentar nuevamente cuando se restablezca la cuota.',SERVICE:'⚠️ NEXO no pudo completar la consulta en el servidor institucional. Verifica el estado de /api/public en Red/Network; si persiste, consulta los registros de Vercel.',EMPTY:'🧭 El servidor respondió sin texto utilizable. No voy a inventar una respuesta.',REQUEST:'🧭 El servidor rechazó la solicitud. Intenta iniciar otra conversación.'};
   const explanation=states[error.message]||(error.name==='AbortError'?'⏳ La solicitud tardó demasiado. Inténtalo de nuevo más tarde.':'📡 No logramos conectar con el servidor. Comprueba tu conexión y vuelve a intentarlo.');
   add(explanation,'bot');mode('error');
   // Se registra código de estado, nunca tokens, historial ni contenido de la respuesta.
   console.warn('NEXO: fallo de solicitud',{tipo:error.message||error.name,status:error.httpStatus||null});
  }
  finally{currentAbort=null;busy=false;send.disabled=false;doneTimer=setTimeout(()=>mode('idle'),2400);if(!panel.hidden)input.focus();}
 }
 $('nx-form').addEventListener('submit',e=>{e.preventDefault();ask(input.value);});

 function elem(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=String(text);if(cls)el.className=cls;return el;}
 function btn(text,fn){const b=elem('button',text,'nx-stat-button');b.type='button';b.onclick=fn;return b;}
 const statRoles=['direccion_escolar','control_escolar','control','coordinacion_academica','servicios_docentes','servicios_estudiantiles','prefectura','docente','archivo_escolar','recursos_monetarios','tecnico'];
 async function staffRequest(action,data={}){const auth=await window.ithlaNexoAuth?.();if(!auth?.token||!auth?.sid)throw Error('Sesión institucional no disponible.');const response=await fetch('/api/public',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token,'X-ITHLA-Session':auth.sid},cache:'no-store',body:JSON.stringify({action,...data})});const r=await response.json();if(!response.ok||!r.ok)throw Error(r.error||'Consulta no disponible.');return r.data;}
 function statCharts(report){const box=elem('div',undefined,'nx-stat-charts');for(const chart of report.charts||[]){const section=elem('section',undefined,'nx-stat-chart');section.append(elem('h4',chart.title));const max=Math.max(1,...chart.data.map(x=>x.value));for(const x of chart.data){const row=elem('div',undefined,'nx-stat-bar-line'),track=elem('div',undefined,'nx-stat-track'),fill=elem('div',undefined,'nx-stat-fill');fill.style.width=Math.max(0,Math.min(100,100*x.value/max))+'%';track.append(fill);row.append(elem('span',x.label),track,elem('strong',x.value));section.append(row);}box.append(section);}return box;}
 function showStatistics(out,report){out.replaceChildren(elem('p',`Ciclo: ${report.ciclo} · periodo: ${report.periodo??'—'} · corte: ${report.fecha}`,'nx-stat-caption'));const grid=elem('div',undefined,'nx-stat-grid');for(const m of report.metrics){const c=elem('div',undefined,'nx-stat-kpi');c.append(elem('strong',m.value),elem('span',m.label));grid.append(c);}out.append(grid,statCharts(report),elem('h4','Recomendaciones verificables'));for(const r of report.recommendations)out.append(elem('p',r.text,'nx-stat-rec'));out.append(elem('p','Alcance: conteos autorizados. No son promedios finales, acreditación ni una auditoría completa.','nx-stat-caption'),btn('Descargar corte CSV',()=>{const csv='Indicador,Valor\r\n'+report.metrics.map(m=>'"'+m.label.replaceAll('"','""')+'",'+m.value).join('\r\n');const u=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));const a=elem('a');a.href=u;a.download='NEXO-corte.csv';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}));}
 function navigationPanel(){const box=elem('div',undefined,'nx-stat-chart');const search=elem('input');search.type='search';search.placeholder='Buscar en tu menú';search.setAttribute('aria-label','Buscar módulo');const list=elem('div',undefined,'nx-stat-actions');function draw(){list.replaceChildren();const entries=window.ithlaNexoMenu?.()||[];for(const x of entries.filter(x=>x[1].toLocaleLowerCase('es-MX').includes(search.value.toLocaleLowerCase('es-MX'))))list.append(btn(x[1],()=>{if(window.ithlaNexoMenu?.().some(r=>r[0]===x[0])){close();loadPage(x[0]);}}));if(!list.children.length)list.append(elem('p','Sin coincidencias.'));}search.oninput=draw;box.append(search,list);draw();return box;}
 function mountStatistics(container){if(site!=='jaguar-session'||typeof S==='undefined'||!statRoles.includes(S.role)||!container||container.querySelector('.nx-stat-home'))return;const box=elem('section',undefined,'nx-stat-home'),title=elem('div',undefined,'nx-stat-heading');title.append(elem('small','ITHLA · NEXO INTELLIGENCE'),elem('h3','Inteligencia de tu departamento'),elem('p','Datos autorizados de Jaguar · sólo lectura'));const out=elem('div'),controls=elem('div',undefined,'nx-stat-actions');const load=btn('Consultar indicadores actuales',async()=>{load.disabled=true;out.textContent='Consultando corte…';try{const d=await staffRequest('nexo-chat',{message:'Estadísticas de mi departamento'});if(!d.statistics)throw Error('El corte estadístico no está disponible.');if(box.isConnected)showStatistics(out,d.statistics);}catch(e){out.textContent=e.message;}finally{load.disabled=false;}});controls.append(load,btn('Explorar mis módulos',()=>out.replaceChildren(navigationPanel())));if(['direccion_escolar','coordinacion_academica'].includes(S.role)){controls.append(btn('Biblioteca curricular',()=>mountCurriculum(out)),btn('Revisar memoria docente',()=>mountMemoryReview(out)));}box.append(title,controls,out);container.append(box);}
 async function mountMemoryReview(out){out.textContent='Consultando solicitudes…';try{const d=await staffRequest('memory-review-list');out.replaceChildren(elem('h4','Extractos pendientes de revisión'),elem('p','Verifica que el contenido sea pedagógico y no contenga información personal.'));if(!d.notas.length)out.append(elem('p','Sin solicitudes pendientes.'));for(const n of d.notas){const card=elem('article',undefined,'nx-stat-rec');card.append(elem('strong',n.materia_nombre+' · '+n.tema),elem('p',n.extracto));for(const decision of ['aprobada','rechazada'])card.append(btn(decision==='aprobada'?'Aprobar extracto':'Rechazar extracto',async()=>{if(!confirm('¿Confirmar revisión?'))return;try{await staffRequest('memory-review',{id:String(n.id),decision,confirmacion:true});await mountMemoryReview(out);}catch(e){card.append(elem('p',e.message));}}));out.append(card);}}catch(e){out.textContent=e.message;}}
 async function mountCurriculum(out){out.textContent='Consultando biblioteca…';try{const d=await staffRequest('catalog-list');out.replaceChildren(elem('h4','Equivalencias curriculares · '+d.ciclo),elem('p','Las fuentes están localizadas. Revisa texto, vigencia aplicable y correspondencia antes de registrar un objetivo.'));const form=elem('form',undefined,'nx-curr-form'),fields={};function field(key,label,options){const wrap=elem('label',undefined,'nx-curr-field');wrap.append(elem('span',label));const e=options?elem('select'):elem(key==='objetivo'?'textarea':'input');e.required=true;if(options){for(const [v,t] of options)e.add(new Option(t,v));}else e.maxLength=key==='objetivo'?1800:200;fields[key]=e;wrap.append(e);form.append(wrap);}
 field('materia_id','Materia ITHLA',d.materias.map(m=>[String(m.id),m.nombre]));field('fuente_id','Fuente localizada',d.fuentes.map(f=>[f.id,f.titulo]));field('nivel','Nivel',d.niveles.map(x=>[x,x]));field('programa','Programa / generación');field('grado','Grado o semestre');field('edicion','Versión y fecha');field('localizador','Página / sección');field('objetivo','Objetivo revisado (resumen propio)');const link=elem('a','Consultar documento seleccionado');link.target='_blank';link.rel='noopener noreferrer';function setLink(){link.href=d.fuentes.find(f=>f.id===fields.fuente_id.value)?.url||'#';}fields.fuente_id.onchange=setLink;setLink();form.append(link);const label=elem('label'),check=elem('input');check.type='checkbox';check.required=true;label.append(check,document.createTextNode(' Confirmo revisión humana del objetivo y su aplicabilidad.'));form.append(label);const save=elem('button','Registrar vinculación','nx-stat-button');save.type='submit';form.append(save);const status=elem('p');form.append(status);form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{await staffRequest('catalog-add',{...Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.value])),confirmacion:check.checked});await mountCurriculum(out);}catch(e){status.textContent=e.message;}finally{save.disabled=false;}};out.append(form,elem('h4','Materias sin vínculo revisado'));out.append(elem('p',d.sin_vinculo.map(m=>m.nombre).join(' · ')||'Todas tienen al menos un vínculo; esto no certifica cobertura completa.'));out.append(elem('h4','Vínculos registrados'));for(const r of d.vinculos){const c=elem('article',undefined,'nx-stat-rec');c.append(elem('strong',r.materia_nombre+(r.obsoleto?' · Requiere revisión':'')),elem('p',`${r.nivel} · ${r.grado} · ${r.programa} · ${r.localizador}`),elem('p',r.objetivo),btn('Retirar vínculo',async()=>{if(!confirm('¿Retirar este vínculo?'))return;try{await staffRequest('catalog-retire',{id:String(r.id),confirmacion:true});await mountCurriculum(out);}catch(e){c.append(elem('p',e.message));}}));out.append(c);}}catch(e){out.textContent=e.message;}}

 window.NEXO={open,close,reset:clear,mountStatistics};
 if(site==='jaguar-session'&&typeof S!=='undefined'&&S.page==='inicio')mountStatistics(document.getElementById('content'));
})();
