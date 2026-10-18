/* Guardia de interfaz: complementa, NO sustituye, la validación del servidor. */
(()=>{
  const KEY='ithla.session.jaguar';let activeAt=Date.now(),policy=null,logout=null,tokenProvider=null,notifying=false,logoutBusy=false;
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async(input,init={})=>{
    const url=typeof input==='string'?input:input?.url||'';
    const path=new URL(url,location.href).pathname;
    if(!path.startsWith('/api/'))return nativeFetch(input,init);
    const opts={...init,headers:new Headers(init.headers|| (typeof input!=='string'?input.headers:undefined)||{})};
    const id=sessionStorage.getItem(KEY);if(id)opts.headers.set('X-ITHLA-Session',id);
    const result=await nativeFetch(input,opts);
    if(result.status===401 && id && path!=='/api/auth' && !logoutBusy){
      try{const body=await result.clone().json();if(/sesi[oó]n.*(expir|caduc)|sesi[oó]n protegida/i.test(body.error||''))void end();}catch{}
    }
    return result;
  };
  async function end(){if(logoutBusy)return;logoutBusy=true;sessionStorage.removeItem(KEY);clearInterval(interval);document.getElementById('ithla-session-notice')?.remove();if(logout)await logout();else location.assign('/sistema.html');}
  function activate(data){if(!data?.id)throw Error('El servidor no registró la sesión protegida.');sessionStorage.setItem(KEY,data.id);policy=data;activeAt=Date.now();logoutBusy=false;notifying=false;}
  function setup(opts){logout=opts.logout;tokenProvider=opts.tokenProvider;}
  let heartbeatAt=0;
  async function tick(){if(!policy||logoutBusy||!sessionStorage.getItem(KEY))return;
    const idle=Date.now()-activeAt,limit=policy.inactividad_min*60000;
    if(idle>=limit){await end();return;}
    const remaining=limit-idle;
    if(remaining<120000 && !notifying){notifying=true;
      const node=document.createElement('div');node.id='ithla-session-notice';node.setAttribute('role','alert');
      node.style.cssText='position:fixed;z-index:10000;bottom:18px;left:18px;max-width:340px;padding:16px;background:#14263b;color:white;border:2px solid #d4af37;border-radius:14px;box-shadow:0 12px 30px #0008;font:14px system-ui';
      node.innerHTML='<strong>Tu sesión caducará pronto</strong><p>Guarda tus cambios. Si no realizas ninguna actividad, tendrás que volver a ingresar.</p><button id="ithla-continue" style="background:#d4af37;border:0;padding:8px 12px;border-radius:8px">Continuar trabajando</button>';
      document.body.append(node);node.querySelector('button').addEventListener('click',()=>{activeAt=Date.now();node.remove();notifying=false;});
    }else if(remaining>=120000&&notifying){document.getElementById('ithla-session-notice')?.remove();notifying=false;}
    if(Date.now()-heartbeatAt>60000 && Date.now()-activeAt<120000 && tokenProvider && !document.hidden){
      heartbeatAt=Date.now();try{const token=await tokenProvider();if(token){const r=await window.fetch('/api/auth?mode=heartbeat',{headers:{Authorization:'Bearer '+token}});if(r.status===401)await end();}}catch{}
    }
  }
  const interval=setInterval(tick,10000);
  ['pointerdown','keydown','touchstart','input'].forEach(type=>document.addEventListener(type,()=>{activeAt=Date.now();},{passive:true}));
  window.ithlaSessionGuard={activate,setup,end,getId:()=>sessionStorage.getItem(KEY),clear:()=>sessionStorage.removeItem(KEY)};
})();
