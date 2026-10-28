/* ITHLA | Accesibilidad de contraseña, contador de sesión y renovación explícita. */
(()=>{'use strict';
function addPasswordToggle(input){
 if(!input||input.dataset.ithlaVisibleToggle)return;input.dataset.ithlaVisibleToggle='1';
 const wrapper=document.createElement('span');wrapper.className='j-password-wrap';
 input.parentNode.insertBefore(wrapper,input);wrapper.append(input);
 const button=document.createElement('button');button.type='button';button.className='j-show-password';button.textContent='Mostrar';button.setAttribute('aria-label','Mostrar contraseña');button.setAttribute('aria-pressed','false');
 button.addEventListener('click',()=>{const show=input.type==='password';input.type=show?'text':'password';button.textContent=show?'Ocultar':'Mostrar';button.setAttribute('aria-label',show?'Ocultar contraseña':'Mostrar contraseña');button.setAttribute('aria-pressed',String(show));input.focus();});
 wrapper.append(button);
}
function passwordWidgets(){['loginPassword','currentPassword','newPassword','newPassword2'].forEach(n=>addPasswordToggle(document.getElementById(n)));}
function ensureCounter(){
 if(!document.getElementById('app')||document.getElementById('j-session-counter'))return;
 const slot=document.querySelector('#app .j-context')||document.querySelector('#app .main>header');if(!slot)return;
 const node=document.createElement('button');node.id='j-session-counter';node.type='button';node.className='j-session-counter';node.title='Ver tiempo disponible y renovar inactividad (no modifica el vencimiento máximo)';node.setAttribute('aria-label','Tiempo restante de sesión; pulsa para renovar inactividad');node.textContent='Sesión · consultando…';
 node.addEventListener('click',async()=>{node.disabled=true;node.textContent='Renovando…';try{const s=await window.ithlaSessionGuard.renew();render(s);window.toast?.('Tiempo de inactividad renovado. El máximo absoluto no cambia.');}catch(e){window.toast?.(e.message);await window.ithlaSessionGuard.check().catch(()=>{});}finally{node.disabled=false;render();}});slot.prepend(node);
}
function clock(sec){if(sec==null)return '··:··';const m=Math.floor(Math.max(0,sec)/60),s=Math.max(0,sec)%60;return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');}
function render(s){const node=document.getElementById('j-session-counter');if(!node)return;const status=s||window.ithlaSessionGuard?.status?.();
 if(!status?.authenticated){node.hidden=true;return;}node.hidden=false;node.textContent='◷ Sesión '+clock(status.remainingSeconds);node.classList.toggle('j-session-soon',status.remainingSeconds!=null&&status.remainingSeconds<=120);
 node.setAttribute('aria-label','Sesión: '+clock(status.remainingSeconds)+' restantes. Pulsa para renovar la inactividad sin superar el vencimiento máximo.');}
function init(){passwordWidgets();ensureCounter();render();}
document.addEventListener('DOMContentLoaded',init);window.addEventListener('ithla:session',e=>{ensureCounter();render(e.detail);});
const obs=new MutationObserver(()=>{if(['loginPassword','currentPassword','newPassword','newPassword2'].some(n=>{const i=document.getElementById(n);return i&&!i.dataset.ithlaVisibleToggle;}))passwordWidgets();});
document.addEventListener('DOMContentLoaded',()=>{obs.observe(document.body,{childList:true,subtree:true});});
window.ithlaSessionUI={refresh:render};
})();
