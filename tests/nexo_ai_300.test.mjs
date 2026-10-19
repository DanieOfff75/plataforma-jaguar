import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {replyNexoAI,clientHash} from '../lib/nexo_ai.js';
import {availableNexoProviders,resetNexoProviderCooldowns} from '../lib/nexo_providers.js';
beforeEach(()=>resetNexoProviderCooldowns());
const env={NEXO_AI_ENABLED:'true',NEXO_RATE_LIMIT_SECRET:'local-testing-secret',
 GROQ_API_KEY:'fake-groq', GEMINI_API_KEY:'fake-gemini',NEXO_GEMINI_FREE_CONFIRMED:'true',
 CLOUDFLARE_API_TOKEN:'fake-cloudflare',CLOUDFLARE_ACCOUNT_ID:'0123456789abcdef0123456789abcdef',NEXO_CLOUDFLARE_FREE_CONFIRMED:'true',
 OPENROUTER_API_KEY:'fake-openrouter'};
const settings={institucion:{siglas:'ITHLA'},nexo:{activo:true,preguntas:[{pregunta:'¿Cómo inscribirme?',respuesta:'Consulta Control Escolar.',fuente:'Manual público'}]}};
const req={headers:{'x-vercel-forwarded-for':'192.0.2.23'}};
const ok=(value)=>({ok:true,status:200,json:async()=>({choices:[{message:{content:value}}]})});
const error=(status)=>({ok:false,status,headers:{get:(header)=>header==='retry-after'?'20':null}});
async function ask(opts={}){
 return replyNexoAI({message:'¿Cuáles son los pasos de inscripción?',settings,req,env,
 acquireQuota:async()=>true,...opts});
}
test('los cuatro proveedores están disponibles en orden y con modalidad gratuita confirmada',()=>{
 assert.deepEqual(availableNexoProviders(env),['groq','gemini','cloudflare','openrouter']);
 assert.deepEqual(availableNexoProviders({...env,NEXO_GEMINI_FREE_CONFIRMED:'false',NEXO_CLOUDFLARE_FREE_CONFIRMED:'false'}),['groq','openrouter']);
 assert.deepEqual(availableNexoProviders({...env,CLOUDFLARE_ACCOUNT_ID:'http://malicious.invalid'}),['groq','gemini','openrouter']);
});
test('Groq disponible; no llama a los respaldos',async()=>{
 const calls=[];
 const result=await ask({fetchImpl:async(url,o)=>{calls.push([url,JSON.parse(o.body)]);return ok('¡Hola! 🐆')}});
 assert.equal(result.modo,'ia'); assert.equal(result.proveedor,'groq');
 assert.equal(calls.length,1);assert.equal(calls[0][1].model,'openai/gpt-oss-20b');
 assert.ok(!JSON.stringify(result).includes('fake-'));
});
test('cuando Groq devuelve 429, salta a Gemini sin perder conversación',async()=>{
 const calls=[];const result=await ask({history:[{role:'user',content:'Necesito ayuda'},{role:'assistant',content:'Claro'}],
 fetchImpl:async(url,o)=>{calls.push({url,body:JSON.parse(o.body)});return calls.length===1?error(429):ok('Claro, te ayudo ✨');}});
 assert.equal(result.proveedor,'gemini');assert.equal(calls.length,2);
 assert.match(calls[1].url,/generativelanguage.googleapis.com/);
 assert.equal(calls[1].body.messages[1].content,'Necesito ayuda');
});
test('Groq y Gemini fallan: Cloudflare sigue generando',async()=>{
 const urls=[];const result=await ask({fetchImpl:async(url,o)=>{urls.push(url);return urls.length<=2?error(429):ok('Respuesta desde Cloudflare')}});
 assert.equal(result.proveedor,'cloudflare');assert.match(urls[2],/cloudflare.com\/client\/v4\/accounts\//);
});
test('tres fallos consecutivos: OpenRouter Free responde',async()=>{
 let n=0;const result=await ask({fetchImpl:async(url,o)=>{n++;if(n===4){assert.equal(JSON.parse(o.body).model,'openrouter/free');return ok('Respuesta desde un modelo gratuito');}return error(429);}});
 assert.equal(result.proveedor,'openrouter');assert.equal(n,4);
});
test('cuatro proveedores fuera: orientación institucional sin error crítico',async()=>{
 let cnt=0,quota=0;
 const result=await ask({acquireQuota:async()=>{quota++;return true;},fetchImpl:async()=>{cnt++;return error(429)}});
 assert.ok(['orientacion','manual'].includes(result.modo));assert.equal(cnt,4);assert.equal(quota,1);
 assert.match(result.aviso,/todos los motores/i);
});
test('la cuota global interna denegada no envía datos a ningún proveedor',async()=>{
 const result=await ask({acquireQuota:async()=>false,fetchImpl:async()=>{throw Error('No llamarse')}});
 assert.ok(['orientacion','manual'].includes(result.modo));assert.match(result.aviso,/límite gratuito/);
});
test('prohíbe enviar identificadores personales y no registra intentos',async()=>{
 const result=await ask({message:'Mi correo es ejemplo@correo.mx',acquireQuota:async()=>{throw Error('Cuota no usada')},fetchImpl:async()=>{throw Error('No llamarse')}});
 assert.equal(result.modo,'privacidad');
});
test('usuario autenticado tiene hash individual frente a IP pública compartida',()=>{
 const publicHash=clientHash(req,'secret');
 assert.notEqual(clientHash(req,'secret','user-001'),publicHash);
 assert.notEqual(clientHash(req,'secret','user-002'),clientHash(req,'secret','user-001'));
 assert.equal(clientHash(req,'secret','user-001'),clientHash(req,'secret','user-001'));
});
test('modelo pago no se puede configurar por error; free router siempre free',()=>{
 const e={...env,GROQ_MODEL:'llama-3.3-70b-versatile',GEMINI_MODEL:'gemini-3.8-pro',CLOUDFLARE_AI_MODEL:'@cf/moonshotai/kimi-k2.6'};
 assert.deepEqual(availableNexoProviders(e),['openrouter']);
});
test('en ausencia de todos los motores, NEXO entrega orientación sin consumir cuota',async()=>{
 const r=await ask({env:{NEXO_AI_ENABLED:'true',NEXO_RATE_LIMIT_SECRET:'abc'},acquireQuota:async()=>{throw Error('Cuota no debería consumirse')}});
 assert.ok(['orientacion','manual'].includes(r.modo));
});
