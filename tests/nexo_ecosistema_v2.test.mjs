import {test} from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {replyNexoAI,containsPrivateData} from '../lib/nexo_ai.js';
import {nexoTrustedContext} from '../lib/nexo_context.js';

test('orienta sobre la CURP sin bloquear preguntas genéricas y protege datos reales',()=>{
 assert.equal(containsPrivateData('¿Qué es la CURP?'),false);
 assert.equal(containsPrivateData('¿Cómo consulto mi boleta?'),false);
 assert.equal(containsPrivateData('¿Puedes consultar mis calificaciones?'),true);
 assert.equal(containsPrivateData('Escríbeme a alguien@example.com'),true);
});
test('contexto administrativo confiable llega como información y no le otorga permiso para modificar',async()=>{
 const context=nexoTrustedContext('jaguar','docente');
 assert.equal(context.rol_verificado,'docente');assert.ok(context.modulos_orientativos.includes('Planeaciones'));
 let prompt;
 const settings={institucion:{nombre_institucion:'ITHLA'},admisiones:{estado:'cerrado'},nexo:{activo:true,preguntas:[]}};
 const response=await replyNexoAI({message:'¿Dónde veo mis planeaciones?',settings,trustedContext:context,
 env:{GROQ_API_KEY:'prueba',NEXO_AI_ENABLED:'true',NEXO_RATE_LIMIT_SECRET:'test'},
 req:{headers:{'x-vercel-forwarded-for':'127.0.0.1'}},acquireQuota:async()=>true,
 fetchImpl:async(_,options)=>{const body=JSON.parse(options.body);prompt=body.messages[0].content;return {ok:true,json:async()=>({choices:[{message:{content:'Abre Planeaciones desde tu menú de docente. ✨'}}]})}}});
 assert.equal(response.modo,'ia');assert.match(prompt,/rol_verificado/);assert.match(prompt,/docente/);assert.match(prompt,/No afirmes haberlas consultado/);
});
test('superficies incluidas en diseño y formularios protegidos de admisiones',()=>{
 const home=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const session=readFileSync(new URL('../sistema.html',import.meta.url),'utf8');
 assert.match(home,/nexo-companion\.js/);assert.match(home,/eco-public/);
 assert.match(session,/data-site="jaguar-session"/);assert.match(session,/ithlaNexoAuth/);
});
