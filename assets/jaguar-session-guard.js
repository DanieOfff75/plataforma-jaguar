/* ITHLA · Guardia de sesión. El servidor manda sobre el vencimiento. */
(()=>{'use strict';
const KEY='ithla.session.jaguar';
let activeAt=Date.now(),policy=null,logout=null,tokenProvider=null,logoutBusy=false,notifying=false,heartbeatAt=0;
let clockDeadline=0,lastStatusAt=0,loadingStatus=false,extending=false,reportedExpiry=null,reportedAbsolute=null;
const nativeFetch=window.fetch.bind(window);
const id=()=>{try{return sessionStorage.getItem(KEY);}catch{return null;}};
function fire(){window.dispatchEvent(new CustomEvent('ithla:session',{detail:statusLocal()}));}
function statusLocal(){return {authenticated:!!id(),remainingSeconds:clockDeadline?Math.max(0,Math.ceil((clockDeadline-Date.now())/1000)):null,expiresAt:reportedExpiry,absoluteExpiresAt:reportedAbsolute,canExtend:!logoutBusy&&!!id()&&!!clockDeadline&&clockDeadline>Date.now()};}
window.fetch=async(input,init={})=>{
 const url=typeof input==='string'?input:input?.url||'';
 const path=new URL(url,location.href).pathname;
 if(!path.startsWith('/api/'))return nativeFetch(input,init);
 const opts={...init,headers:new Headers(init.headers|| (typeof input!=='string'?input.headers:undefined)||{})};
 const sid=id();if(sid)opts.headers.set('X-ITHLA-Session',sid);
 const result=await nativeFetch(input,opts);
 if(result.status===401&&sid&&!logoutBusy){
  try{const body=await result.clone().json();if(/sesi[oó]n.*(expir|caduc|protegida|no est[aá] disponible)/i.test(body.error||''))void end();}catch{}
 }
 return result;
};
async function end(){if(logoutBusy)return;logoutBusy=true;sessionStorage.removeItem(KEY);policy=null;clockDeadline=0;document.getElementById('ithla-session-notice')?.remove();fire();try{if(logout)await logout();else location.assign('/sistema.html');}catch{location.assign('/sistema.html');}}
function applyServerStatus(data){if(!data||!Number.isFinite(Number(data.remaining_seconds)))throw Error('Respuesta de sesión incompleta.');
 clockDeadline=Date.now()+Math.max(0,Number(data.remaining_seconds))*1000;
 reportedExpiry=data.expires_at||null;reportedAbsolute=data.absolute_expires_at||null;
 policy={...(policy||{}),inactividad_min:Number(data.idle_minutes)||policy?.inactividad_min||15,absoluta_min:Number(data.absolute_minutes)||policy?.absoluta_min||240};
 lastStatusAt=Date.now();fire();return statusLocal();}
async function credentials(){const sid=id();if(!sid||!tokenProvider)throw Error('Inicia sesión para continuar.');const token=await tokenProvider();if(!token)throw Error('Debes volver a iniciar sesión.');return {sid,token};}
async function check(){if(loadingStatus||logoutBusy||!id())return statusLocal();loadingStatus=true;try{
 const {token}=await credentials();const response=await window.fetch('/api/auth?mode=session-status',{method:'GET',headers:{Authorization:'Bearer '+token},cache:'no-store'});
 const data=await response.json().catch(()=>({}));if(!response.ok||!data.ok){if(response.status===401)await end();throw Error(data.error||'No se pudo consultar la sesión.');}return applyServerStatus(data.session);
 }finally{loadingStatus=false;}}
async function renew(){if(extending)throw Error('Ya se está renovando la sesión.');if(logoutBusy)throw Error('La sesión ya terminó.');extending=true;try{
 const {token}=await credentials();const response=await window.fetch('/api/auth',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'extend-session'}),cache:'no-store'});
 const data=await response.json().catch(()=>({}));if(!response.ok||!data.ok){if(response.status===401)await end();throw Error(data.error||'No fue posible extender la sesión.');}
 activeAt=Date.now();notifying=false;document.getElementById('ithla-session-notice')?.remove();return applyServerStatus(data.session);
 }finally{extending=false;}}
function activate(data){if(!data?.id)throw Error('El servidor no registró la sesión protegida.');sessionStorage.setItem(KEY,data.id);policy=data;activeAt=Date.now();logoutBusy=false;notifying=false;clockDeadline=Date.now()+Number(data.inactividad_min||15)*60000;reportedAbsolute=new Date(Date.now()+Number(data.absoluta_min||240)*60000).toISOString();fire();void check().catch(()=>{});}
function setup(opts){logout=opts.logout;tokenProvider=opts.tokenProvider; if(id())setTimeout(()=>{if(!logoutBusy)void check().catch(()=>{});},200);}
function clear(){sessionStorage.removeItem(KEY);policy=null;clockDeadline=0;reportedExpiry=null;reportedAbsolute=null;fire();}
function notice(){if(notifying)return;notifying=true;const node=document.createElement('div');node.id='ithla-session-notice';node.setAttribute('role','alert');
 node.innerHTML='<strong>Tu sesión está por vencer</strong><p>Guarda tus cambios y renueva tu tiempo de actividad.</p><button type="button" id="ithla-continue">Renovar sesión</button>';
 document.body.append(node);node.querySelector('button').addEventListener('click',()=>{void renew().catch(e=>{node.querySelector('p').textContent=e.message;});});}
async function tick(){if(logoutBusy||!id())return;
 if(clockDeadline&&Date.now()>=clockDeadline){ // confirmar con el servidor antes de cerrar (otras llamadas pudieron renovar la actividad)
   try{await check();}catch{await end();return;}if(clockDeadline&&Date.now()>=clockDeadline){await end();return;}
 }
 const remaining=clockDeadline-Date.now();if(clockDeadline&&remaining<120000&&remaining>0)notice();
 else if(remaining>=120000&&notifying){document.getElementById('ithla-session-notice')?.remove();notifying=false;}
 if(Date.now()-lastStatusAt>30000&&!document.hidden){void check().catch(()=>{});}
 if(policy&&Date.now()-heartbeatAt>60000&&Date.now()-activeAt<120000&&tokenProvider&&!document.hidden){
  heartbeatAt=Date.now();try{const token=await tokenProvider();if(token){const response=await window.fetch('/api/auth?mode=heartbeat',{headers:{Authorization:'Bearer '+token},cache:'no-store'});if(response.status===401)await end();else if(response.ok)void check().catch(()=>{});}}catch{}
 }fire();
}
const timer=setInterval(tick,1000);
['pointerdown','keydown','touchstart','input'].forEach(type=>document.addEventListener(type,()=>{activeAt=Date.now();},{passive:true}));
window.ithlaSessionGuard={activate,setup,end,getId:id,clear,check,renew,status:statusLocal};
})();
