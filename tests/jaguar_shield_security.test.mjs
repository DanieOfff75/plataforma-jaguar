import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {newCode,newProof,otpDigest,proofDigest,maskEmail,validEmail,secret} from '../lib/jaguar_shield_crypto.js';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const read=f=>readFileSync(join(root,f),'utf8');
process.env.JAGUAR_SHIELD_SECRET='TEST-ONLY-SECRET-STRING-NOT-FOR-PRODUCTION-0123456789';

test('código OTP es siempre de seis dígitos',()=>{for(let i=0;i<500;i++)assert.match(newCode(),/^\d{6}$/);});
test('un mismo código no sirve para otro desafío',()=>assert.notEqual(otpDigest('id-a','123456'),otpDigest('id-b','123456')));
test('código no se guarda en texto plano en token de prueba',()=>assert.notEqual(proofDigest('abc'),otpDigest('abc','abc')));
test('comprobantes son aleatorios, largos y distintos',()=>{const a=newProof(),b=newProof();assert.ok(a.length>=40);assert.notEqual(a,b);});
test('sin secreto fuerte no genera hashes',()=>{const old=process.env.JAGUAR_SHIELD_SECRET;delete process.env.JAGUAR_SHIELD_SECRET;assert.throws(()=>secret(),/32 caracteres/);process.env.JAGUAR_SHIELD_SECRET=old;});
test('correo se normaliza y oculta parcialmente',()=>assert.equal(maskEmail(' Persona@Ejemplo.com '),'pe••••@ejemplo.com'));
test('no se admiten correos inválidos',()=>{assert.equal(validEmail('a@b.com'),true);assert.equal(validEmail('x@y'),false);});
test('la apertura de evaluaciones exige prueba de un solo uso',()=>{
 const f=read('routes/evaluation-window.js');assert.match(f,/await consumeProof\(/);assert.match(f,/shield_proof/);
});
test('la ruta vieja de recuperación no permite cambios directos',()=>{
 const f=read('api/data.js');assert.match(f,/resource==='saveRecoveryEmail'[\s\S]{0,200}status\(403\)/);
});
test('first_access exige nueva verificación si se configura correo por primera vez',()=>{
 const f=read('api/auth.js');assert.match(f,/await consumeProof\(adminClient,user.id,sessionId\(req\),'enroll',recovery/);
});
test('no existe una opción de SMS automático activo en backend',()=>{
 const f=read('lib/jaguar_shield.js');assert.match(f,/channel==='sms'\)throw/);
});
test('la UI entrega un código a la operación por canal no chat',()=>{
 const f=read('assets/jaguar-shield-ui.js');assert.match(f,/shield_proof|jaguarShieldChallenge/);
 assert.doesNotMatch(f,/nexo\.submit\(/i);
});
test('migración mantiene RLS y funciones SQL de un solo uso',()=>{
 const f=read('sql/ITHLA_JAGUAR_SHIELD_V1.sql');for(const word of ['ENABLE ROW LEVEL SECURITY','jaguar_shield_verificar','jaguar_shield_consumir','jaguar_shield_cambiar_correo','5 minutes','FOR UPDATE'])assert.ok(f.includes(word),word);
});
test('ediciones directas de perfiles no pueden validar su correo',()=>{
 const f=read('sql/ITHLA_JAGUAR_SHIELD_V1.sql');assert.match(f,/CREATE TRIGGER jaguar_shield_proteger_perfil_trg/);
 assert.match(f,/current_user NOT IN/);
});
