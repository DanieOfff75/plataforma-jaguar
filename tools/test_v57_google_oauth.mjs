import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {signState,verifyState,seal,unseal,authUrl,googleConfig,GOOGLE_SCOPES,projectCourse} from '../lib/google_classroom_oauth.js';
const results=[];
function test(name,fn){fn();results.push(name);}
const secret=randomBytes(48).toString('hex'),key=randomBytes(32);
const base=Date.now();
test('Estado firmado válido por 10 minutos',()=>{const s=signState('fake-user-id',secret,base);assert.equal(verifyState(s.state,s.nonce,secret,base+599000),'fake-user-id');});
test('No acepta cookie de otro navegador',()=>{const s=signState('fake-user-id',secret,base);assert.throws(()=>verifyState(s.state,'nonce-inventado',secret,base+1000));});
test('No acepta estados expirados',()=>{const s=signState('fake-user-id',secret,base);assert.throws(()=>verifyState(s.state,s.nonce,secret,base+600001));});
test('No acepta firma adulterada',()=>{const s=signState('fake-user-id',secret,base);assert.throws(()=>verifyState(s.state.slice(0,-2)+'aa',s.nonce,secret,base));});
test('Cifrado AES-GCM reversible',()=>{const t='token-super-secreto-de-prueba';assert.equal(unseal(seal(t,key),key),t);});
test('Cifrado AES-GCM no incluye texto claro',()=>{assert.equal(seal('secret',key).includes('secret'),false);});
test('Cifrado autenticado detecta manipulación',()=>{const token=seal('secret',key);assert.throws(()=>unseal(token.slice(0,-3)+'AAA',key));});
test('Cifrado no permite otra clave',()=>{const token=seal('secret',key);assert.throws(()=>unseal(token,randomBytes(32)));});
const cfg={clientId:'fake.apps.googleusercontent.com',redirectUri:'https://plataforma-jaguar.vercel.app/api/google-oauth-callback',ownerEmail:'cuenta@example.com'};
test('OAuth usa redirect exacto y scope mínimo',()=>{const url=new URL(authUrl(cfg,'estado'));assert.equal(url.searchParams.get('redirect_uri'),cfg.redirectUri);assert.equal(url.searchParams.get('access_type'),'offline');assert.equal(url.searchParams.get('state'),'estado');assert.equal(url.searchParams.get('scope'),GOOGLE_SCOPES.join(' '));});
test('Las clases externas se reducen a datos públicos del curso',()=>{const c=projectCourse({id:'123',name:'Matemáticas',enrollmentCode:'abcd12',alternateLink:'https://classroom.google.com/c/123',extraSecret:'NO'});assert.equal(c.nombre,'Matemáticas');assert.equal('extraSecret' in c,false);});
const envKeys=['GOOGLE_OAUTH_CLIENT_ID','GOOGLE_OAUTH_CLIENT_SECRET','GOOGLE_OAUTH_REDIRECT_URI','GOOGLE_SERVICIOS_EMAIL','GOOGLE_OAUTH_STATE_SECRET','GOOGLE_TOKEN_KEY'];
const old=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
try{
 Object.assign(process.env,{GOOGLE_OAUTH_CLIENT_ID:'fake',GOOGLE_OAUTH_CLIENT_SECRET:'fake',GOOGLE_OAUTH_REDIRECT_URI:cfg.redirectUri,GOOGLE_SERVICIOS_EMAIL:cfg.ownerEmail,GOOGLE_OAUTH_STATE_SECRET:secret,GOOGLE_TOKEN_KEY:key.toString('base64')});
 test('Configuración válida se carga en servidor',()=>{assert.equal(googleConfig().origin,'https://plataforma-jaguar.vercel.app');});
 process.env.GOOGLE_OAUTH_REDIRECT_URI='http://example.com/api/google-oauth-callback';
 test('No se permite redirect inseguro',()=>{assert.throws(()=>googleConfig());});
 process.env.GOOGLE_OAUTH_REDIRECT_URI=cfg.redirectUri;
 process.env.GOOGLE_TOKEN_KEY='wrong';
 test('Rechaza clave de cifrado inválida',()=>{assert.throws(()=>googleConfig());});
} finally {for(const k of envKeys){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}}
console.log(`✓ ${results.length} pruebas de Google OAuth V5.7 pasaron`);
