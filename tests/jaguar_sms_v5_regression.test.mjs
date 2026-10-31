import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const here=new URL('../',import.meta.url);
const read=p=>readFileSync(new URL(p,here),'utf8');

test('la administración usa el rol técnico y la sesión protegida',()=>{
 const s=read('lib/jaguar_sms_gateway.js');
 assert.match(s,/requireRoles\(req,\['tecnico'\]\)/);
 assert.match(s,/checkLocalOrigin\(req\)/);
 assert.match(read('assets/jaguar-sms-admin.js'),/'X-ITHLA-Session'/);
});
test('no existe token global compartido ni secretos en la URL',()=>{
 const s=read('lib/jaguar_sms_gateway.js');
 assert.doesNotMatch(s,/JAGUAR_SMS_DEVICE_TOKEN/);
 assert.match(s,/randomBytes\(32\)\.toString\('base64url'\)/);
 assert.match(s,/token_hash:hash\(token\)/);
 assert.match(s,/PUBLIC_ORIGIN/);
});
test('el backend no concede permiso de SQL a anon ni authenticated',()=>{
 const s=read('sql/JAGUAR_SMS_GATEWAY_V5.sql');
 assert.match(s,/security definer/g);
 assert.match(s,/revoke all on function public\.jaguar_sms_v5_claim\(uuid\) from public,anon,authenticated;/);
 assert.match(s,/grant execute on function public\.jaguar_sms_v5_claim\(uuid\) to service_role;/);
 assert.match(s,/for update skip locked/);
 assert.match(s,/status='uncertain'/);
});
test('el panel no modifica el correo OTP y usa menú técnico',()=>{
 const s=read('sistema.html');
 assert.match(s,/roleNav=\{tecnico:\[\['inicio'/);
 assert.match(s,/jaguarSmsAdminMount\(\)/);
 assert.match(s,/jaguar-sms-admin\.js/);
 assert.doesNotMatch(read('assets/jaguar-sms-admin.js'),/localStorage/);
});
