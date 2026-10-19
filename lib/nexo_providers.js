/**
 * NEXO AI 3.0 - selección estricta de un proveedor principal y tres respaldos GRATUITOS.
 * Versión 3.2 unificada de cuatro motores, probada en diagnóstico local.
 * Todas las URLs están fijadas en servidor, los modelos están en listas permitidas,
 * y ninguna clave o petición privada se devuelve al navegador.
 */
const endpoints={
 groq:'https://api.groq.com/openai/v1/chat/completions',
 gemini:'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
 openrouter:'https://openrouter.ai/api/v1/chat/completions'
};
const modelAllow={
 groq:new Set(['openai/gpt-oss-20b','openai/gpt-oss-120b']),
 gemini:new Set(['gemini-3.5-flash-lite','gemini-3.1-flash-lite']),
 cloudflare:new Set(['@cf/zai-org/glm-4.7-flash','@cf/google/gemma-4-26b-a4b-it']),
 openrouter:new Set(['openrouter/free'])
};
// Cloudflare tardó 19.55 s en una prueba real; se otorgan 26 s por defecto.
// Límite conservador para producción, ampliable sólo en el diagnóstico.
const TIMEOUT_MS={groq:6500,gemini:9000,cloudflare:26000,openrouter:13000};
function timeoutFor(p,env){
 if(p.name==='openrouter'){
  const custom=Number(env.NEXO_OPENROUTER_TIMEOUT_MS);
  return Number.isFinite(custom)&&custom>=6500&&custom<=40000
   ? Math.round(custom):TIMEOUT_MS.openrouter;
 }
 if(p.name==='cloudflare'){
  const custom=Number(env.NEXO_CLOUDFLARE_TIMEOUT_MS);
  return Number.isFinite(custom)&&custom>=7000&&custom<=30000
   ? Math.round(custom):TIMEOUT_MS.cloudflare;
 }
 return TIMEOUT_MS[p.name];
}
const cache=new Map(); // Sólo enfriamiento oportunista por instancia. No guarda preguntas.
function enabledProviders(env){
 const e=[];
 if(env.GROQ_API_KEY)e.push({name:'groq',key:env.GROQ_API_KEY,url:endpoints.groq,model:env.GROQ_MODEL||'openai/gpt-oss-20b'});
 // En Gemini Free los mensajes pueden utilizarse para mejorar productos. Sólo orientación pública.
 if(env.GEMINI_API_KEY&&env.NEXO_GEMINI_FREE_CONFIRMED==='true')
  e.push({name:'gemini',key:env.GEMINI_API_KEY,url:endpoints.gemini,model:env.GEMINI_MODEL||'gemini-3.5-flash-lite'});
 // No activar con un plan Workers Paid: no podemos imponer cuotas de facturación desde esta API.
 if(env.CLOUDFLARE_API_TOKEN&&env.CLOUDFLARE_ACCOUNT_ID&&env.NEXO_CLOUDFLARE_FREE_CONFIRMED==='true')
  e.push({name:'cloudflare',key:env.CLOUDFLARE_API_TOKEN,
   url:`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`,
   model:env.CLOUDFLARE_AI_MODEL||'@cf/zai-org/glm-4.7-flash'});
 if(env.OPENROUTER_API_KEY)e.push({name:'openrouter',key:env.OPENROUTER_API_KEY,url:endpoints.openrouter,model:'openrouter/free'});
 return e.filter(x=>modelAllow[x.name].has(x.model)
  &&(x.name!=='cloudflare'||/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID)));
}
export function availableNexoProviders(env={}){
 return enabledProviders(env).map(x=>x.name);
}
export async function completeWithNexoProviders({messages,env={},fetchImpl=fetch,now=()=>Date.now()}){
 const providers=enabledProviders(env);
 const errors=[];
 for(const p of providers){
  const cool=cache.get(p.name)||0;
  if(now()<cool){errors.push(`${p.name}:cooldown`);continue;}
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),timeoutFor(p,env));
  try{
   const extra=p.name==='groq'?{reasoning_effort:'low',include_reasoning:false}:{};
   const response=await fetchImpl(p.url,{
    method:'POST',signal:controller.signal,
    headers:{Authorization:`Bearer ${p.key}`,'Content-Type':'application/json',
      ...(p.name==='openrouter'?{'X-Title':'ITHLA NEXO AI'}:{})},
    body:JSON.stringify({model:p.model,messages,temperature:0.3,
      ...(p.name==='groq'?{max_completion_tokens:650}:{max_tokens:650}),stream:false,...extra})
   });
   if(!response?.ok){
    const status=Number(response?.status)||503;
    errors.push(`${p.name}:${status}`);
    if([401,403,404,429,500,502,503,504].includes(status)){
     const retry=Number(response.headers?.get?.('retry-after'))||0;
     const cooldown=status===429?Math.max(15,Math.min(300,retry||30)):
      [401,403,404].includes(status)?120:12;
     cache.set(p.name,now()+cooldown*1000);
    }
    continue;
   }
   const result=await response.json();
   const content=result?.choices?.[0]?.message?.content;
   // Las respuestas vacías también permiten ir al siguiente proveedor.
   const text=typeof content==='string'?content:Array.isArray(content)?content.filter(x=>x.type==='text').map(x=>x.text).join(''):'';
   if(!text.trim()){errors.push(`${p.name}:empty`);continue;}
   cache.delete(p.name);
   return {ok:true,content:text.trim(),provider:p.name,model:p.model,errors};
  }catch(err){
   errors.push(`${p.name}:${err?.name==='AbortError'?'timeout':'network'}`);
   cache.set(p.name,now()+12000);
  }finally{clearTimeout(timeout);}
 }
 return {ok:false,errors,configured:providers.length};
}
// Solo uso en tests para evitar que el enfriamiento en memoria contamine escenarios.
export function resetNexoProviderCooldowns(){cache.clear();}
