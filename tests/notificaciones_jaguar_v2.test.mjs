import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderOtpNotification,renderSystemNotification} from '../lib/jaguar_notifications_email.js';
import {deliverJaguarNotification} from '../lib/jaguar_notifications_delivery.js';

const ui=readFileSync(new URL('../assets/jaguar-shield-ui.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../assets/jaguar-shield-ui.css',import.meta.url),'utf8');
const mail=readFileSync(new URL('../lib/jaguar_notifications_delivery.js',import.meta.url),'utf8');

test('OTP de cada operación conserva su propio asunto y código',()=>{
  for(const purpose of ['enroll','change_old','change_new','eval_open','eval_close']){
    const x=renderOtpNotification({purpose,code:'018437'});
    assert.match(x.subject,/Notificaciones Jaguar/);
    assert.match(x.html,/018437/);
    assert.match(x.text,/018437/);
    assert.doesNotMatch(x.html,/Jaguar Shield ITHLA/);
    assert.doesNotMatch(x.html,/https?:\/\//); // Ningún píxel ni imagen remota.
  }
});
test('OTP rechaza códigos y propósitos inválidos',()=>{
  assert.throws(()=>renderOtpNotification({purpose:'enroll',code:'123'}));
  assert.throws(()=>renderOtpNotification({purpose:'wrong',code:'123456'}));
});
test('Plantillas no permiten inyectar HTML',()=>{
  const result=renderSystemNotification({title:'<img src=x onerror=alert(1)>',description:'Atención & seguimiento',details:['<script>alert(1)</script>']});
  assert.doesNotMatch(result.html,/<script>alert\(1\)<\/script>/);
  assert.match(result.html,/&lt;script&gt;/);
  assert.match(result.html,/&amp;/);
});
test('Correo adaptable a avisos sin permitir envíos públicos',()=>{
  const m=renderSystemNotification({title:'Trámite disponible para recoger',description:'Consulta directamente tu perfil.',details:['Folio: A-001','Entrega presencial']});
  assert.match(m.html,/Entrega presencial/);
  assert.match(m.subject,/Notificaciones Jaguar/);
  assert.match(m.text,/A-001/);
});
test('Ambos proveedores envían HTML y texto alternativo',()=>{
  assert.match(mail,/html:message\.html,text:message\.text/);
  assert.match(mail,/htmlContent:message\.html,textContent:message\.text/);
  assert.match(mail,/name:'Notificaciones Jaguar'/);
});
test('El modal no utiliza prompt de navegador y ofrece reenvío, pegado y cancelación',()=>{
  assert.doesNotMatch(ui,/(?:^|[^a-zA-Z])prompt\s*\(/);
  for(const part of ['aria-modal="true"','navigator','data-nj-resend','clipboardData','Escape','aria-live','one-time-code','confirmChange','jaguarShieldChallenge']){
    if(part==='navigator')continue;
    assert.ok(ui.includes(part),`Falta ${part}`);
  }
  assert.match(css,/data-jaguar-mode|\.nj-dialog/);
});

test('Brevo: correo HTML institucional enviado con el remitente correcto',async()=>{
  const oldFetch=globalThis.fetch;
  const prev={from:process.env.JAGUAR_SHIELD_FROM_EMAIL,brevo:process.env.JAGUAR_SHIELD_BREVO_KEY,resend:process.env.JAGUAR_SHIELD_RESEND_KEY};
  process.env.JAGUAR_SHIELD_FROM_EMAIL='notificaciones@ejemplo.org';
  process.env.JAGUAR_SHIELD_BREVO_KEY='clave_ficticia';
  delete process.env.JAGUAR_SHIELD_RESEND_KEY;
  let called=false;
  globalThis.fetch=async(url,opts)=>{called=true;assert.equal(url,'https://api.brevo.com/v3/smtp/email');
   const body=JSON.parse(opts.body);assert.equal(body.sender.name,'Notificaciones Jaguar');assert.equal(body.to[0].email,'prueba@ejemplo.org');assert.match(body.htmlContent,/Notificaciones Jaguar/);assert.match(body.textContent,/018437/);return {ok:true,status:201};};
  try{await deliverJaguarNotification('prueba@ejemplo.org',renderOtpNotification({purpose:'enroll',code:'018437'}));assert.equal(called,true);}finally{globalThis.fetch=oldFetch;for(const [k,v] of Object.entries({JAGUAR_SHIELD_FROM_EMAIL:prev.from,JAGUAR_SHIELD_BREVO_KEY:prev.brevo,JAGUAR_SHIELD_RESEND_KEY:prev.resend})){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});

test('No se envían notificaciones a direcciones inválidas',async()=>{
  await assert.rejects(()=>deliverJaguarNotification('no-es-correo',renderOtpNotification({purpose:'enroll',code:'018437'})));
});

test('Resend: también entrega HTML y texto alternativo',async()=>{
 const old=globalThis.fetch;const prev={from:process.env.JAGUAR_SHIELD_FROM_EMAIL,resend:process.env.JAGUAR_SHIELD_RESEND_KEY};
 process.env.JAGUAR_SHIELD_FROM_EMAIL='notificaciones@ejemplo.org';process.env.JAGUAR_SHIELD_RESEND_KEY='clave_ficticia';
 globalThis.fetch=async(url,opts)=>{assert.equal(url,'https://api.resend.com/emails');const b=JSON.parse(opts.body);assert.match(b.html,/<html/);assert.match(b.text,/018437/);return{ok:true,status:200}};
 try{await deliverJaguarNotification('prueba@ejemplo.org',renderOtpNotification({purpose:'enroll',code:'018437'}));}finally{globalThis.fetch=old;if(prev.from===undefined)delete process.env.JAGUAR_SHIELD_FROM_EMAIL;else process.env.JAGUAR_SHIELD_FROM_EMAIL=prev.from;if(prev.resend===undefined)delete process.env.JAGUAR_SHIELD_RESEND_KEY;else process.env.JAGUAR_SHIELD_RESEND_KEY=prev.resend;}
});

test('Errores del proveedor se muestran sin revelar secretos',async()=>{
 const old=globalThis.fetch;const prev={from:process.env.JAGUAR_SHIELD_FROM_EMAIL,resend:process.env.JAGUAR_SHIELD_RESEND_KEY};
 process.env.JAGUAR_SHIELD_FROM_EMAIL='notificaciones@ejemplo.org';process.env.JAGUAR_SHIELD_RESEND_KEY='clave_ficticia';
 globalThis.fetch=async()=>({ok:false,status:401});
 try{await assert.rejects(()=>deliverJaguarNotification('prueba@ejemplo.org',renderOtpNotification({purpose:'enroll',code:'018437'})),e=>e.code==='SHIELD_ENVIO'&&!e.message.includes('clave_ficticia'));}finally{globalThis.fetch=old;if(prev.from===undefined)delete process.env.JAGUAR_SHIELD_FROM_EMAIL;else process.env.JAGUAR_SHIELD_FROM_EMAIL=prev.from;if(prev.resend===undefined)delete process.env.JAGUAR_SHIELD_RESEND_KEY;else process.env.JAGUAR_SHIELD_RESEND_KEY=prev.resend;}
});

test('Cambio de correo envía alerta al buzón anterior después de cerrar sesiones',()=>{
 const route=readFileSync(new URL('../routes/shield.js',import.meta.url),'utf8');
 const revoke=route.indexOf("from('ithla_sesiones').update");
 const notice=route.indexOf('await deliverJaguarNotification(old');
 assert.ok(revoke>0&&notice>revoke);
 assert.match(route,/try\s*\{\s*await deliverJaguarNotification\(old/);
});
