import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderOtpNotification} from '../lib/jaguar_notifications_email.js';
const read=(file)=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const auth=read('api/auth.js'), recovery=read('lib/jaguar_recovery.js'), sql=read('sql/ITHLA_NOTIFICACIONES_JAGUAR_RECUPERACION_V1.sql');
const html=read('recuperar.html'),ui=read('assets/jaguar-recuperacion.js'),main=read('sistema.html');

test('Notificaciones Jaguar tiene OTP de recuperación con plantilla y sin enlace localhost',()=>{
 const message=renderOtpNotification({purpose:'password_reset',code:'015738'});
 assert.match(message.subject,/Notificaciones Jaguar/);assert.match(message.html,/015738/);
 assert.doesNotMatch(message.html,/localhost|http:\/\//);
});
test('El botón del login abre la página de recuperación y no solicita enlaces de Supabase',()=>{
 assert.match(main,/window.location.assign\('\/recuperar\.html'/);
 assert.match(auth,/action==='recovery_start'/);
 assert.doesNotMatch(auth,/resetPasswordForEmail/);
});
test('La página no necesita sesión y ofrece correo y SMS marcado como no disponible',()=>{
 assert.match(html,/id="account-form"/);assert.match(html,/id="code-form"/);assert.match(html,/id="password-form"/);
 assert.match(html,/aria-disabled="true"/);assert.match(html,/SMS/);
 assert.match(ui,/recovery_start/);assert.match(ui,/recovery_verify/);assert.match(ui,/recovery_complete/);
 assert.match(ui,/clipboardData/);assert.match(ui,/setInterval/);
});
test('La recuperación requiere correo ya verificado y mantiene respuestas no enumerables',()=>{
 assert.match(recovery,/shield_correo_verificado_at/);
 assert.match(recovery,/const eligible=/);
 assert.match(recovery,/p_actor:eligible\?p\.id:null/);
 assert.match(recovery,/return res\.status\(200\)\.json\(\{ok:true,id,message:generic/);
 assert.doesNotMatch(recovery,/console\.(log|info)\([^\n]*code/);
});
test('RLS y funciones de recuperación restringidas a service_role',()=>{
 for(const table of ['jaguar_recuperacion_codigos','jaguar_recuperacion_intentos'])assert.match(sql,new RegExp('ALTER TABLE public\\.'+table+' ENABLE ROW LEVEL SECURITY'));
 for(const fn of ['emitir','verificar','consumir']){
  assert.match(sql,new RegExp('REVOKE ALL ON FUNCTION public\\.jaguar_recuperacion_'+fn));
  assert.match(sql,new RegExp('GRANT EXECUTE ON FUNCTION public\\.jaguar_recuperacion_'+fn));
 }
 assert.match(sql,/intentos>=5/);
 assert.match(sql,/15 minutes/);
 assert.match(sql,/consumido_at IS NULL/);
});
test('La prueba se consume una sola vez y se cierran sesiones protegidas',()=>{
 assert.match(sql,/UPDATE public\.jaguar_recuperacion_codigos r SET consumido_at=now\(\)/);
 assert.match(recovery,/jaguar_recuperacion_consumir/);
 assert.match(recovery,/ithla_sesiones/);
 assert.ok(recovery.indexOf('ithla_sesiones')<recovery.indexOf('updateUserById'));
 assert.match(recovery,/p\.length>=12/);
});
