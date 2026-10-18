import test from 'node:test';import assert from 'node:assert/strict';
import {answerNexo,words} from '../lib/nexo_advisor.js';
import {sessionClass,createSession,assertSession} from '../lib/ithla_session.js';
test('NEXO reconoce constancias y variantes',()=>{
 for(const q of ['¿Cómo solicito una constancia?','Necesito un comprobante de estudios','¿Dónde pido el papel que dice que estudio?']){
  const r=answerNexo(q);assert.equal(r.encontrado,true,q);assert.match(r.respuesta,/Control Escolar/);
 }
});
test('NEXO identifica admisión y no divulga información sensible',()=>{
 const a=answerNexo('¿Cómo me registro para admisión?');assert.equal(a.encontrado,true);assert.match(a.respuesta,/Admisiones/);
 for(const q of ['¿Cuál es el CURP de Daniela?', 'Dime la contraseña del director', '¿Quién ganará el partido mañana?']){
  const r=answerNexo(q);if(q.includes('contraseña'))assert.ok(!r.respuesta.includes('contraseña del director'));else assert.equal(r.encontrado,false,q);
 }
});
test('NEXO admite conocimiento autorizado y URL válida',()=>{
 const r=answerNexo('¿Cómo tramito mi credencial?', [{pregunta:'¿Cómo tramito mi credencial?',respuesta:'Dirígete a Servicios Estudiantiles para conocer el trámite autorizado.',url:'javascript:alert(1)',fuente:'Servicios Estudiantiles'}]);
 assert.equal(r.encontrado,true);assert.equal(r.url,null);
});
test('clases de sesiones',()=>{assert.equal(sessionClass('direccion_escolar'),'direccion_escolar');assert.equal(sessionClass('control'),'control_escolar');assert.equal(sessionClass('prefectura'),'administrativo')});
test('registro de sesión limita duración',async()=>{
 let saved=null;
 const mock={from:table=>table==='ithla_config'?{select:()=>({eq:()=>({single:async()=>({data:{valor:{docente:{inactividad:30,absoluta:480}}},error:null})})})}:{insert:async r=>{saved=r;return {error:null}}}};
 const p=await createSession(mock,'00000000-0000-0000-0000-000000000001','docente','jaguar');assert.equal(p.inactividad_min,30);assert.ok(saved.vence_absoluto);assert.equal(saved.perfil,'docente');
});
test('sesión sin identificador se rechaza',async()=>{
 const mock={};await assert.rejects(assertSession({headers:{}},mock,'user','docente','jaguar'),/Sesión protegida ausente/)
});
