import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx=vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../assets/jaguar-workspaces.js',import.meta.url),'utf8'),ctx);
const W=ctx.JaguarWorkspaces;
const norm=x=>JSON.parse(JSON.stringify(x));
test('Grouped menu preserves every valid existing route, by role, including unknown future modules',()=>{
 const items=[['inicio','Inicio'],['notificaciones','Notificaciones'],['grupos','Grupos'],['asistencia','Asistencia'],['config','Configuración'],['modulo_futuro','Futuro'],['grupos','Duplicado']];
 for(const role of ['docente','alumno','direccion_escolar','control_escolar','coordinacion_academica','servicios_docentes','servicios_estudiantiles','prefectura','archivo_escolar','recursos_monetarios','tecnico','control']){
  const sections=norm(W.organize(items,role)),flat=sections.flatMap(s=>s.entries.map(x=>x[0]));
  assert.equal(new Set(flat).size,flat.length);assert.deepEqual(flat.sort(),[...new Set(items.map(x=>x[0]))].sort());assert.equal(sections.at(-1).id==='otros',true);
 }
});
test('Suspended student navigation contains only the five supplied routes',()=>{
 const items=['inicio','revision_acceso_alumno','notificaciones','avisos','perfil'].map(x=>[x,x]);
 assert.deepEqual(norm(W.organize(items,'alumno')).flatMap(s=>s.entries.map(x=>x[0])).sort(),items.map(x=>x[0]).sort());
});
test('Assignment context is explicit and teacher-only; invalid or general routes have no context',()=>{
 for(const page of ['grupos','asistencia','calificaciones','bitacora_calificaciones','examenes','classroom']){
  assert.equal(W.workspaceId('docente',page,{gmId:101}),101);assert.equal(W.workspaceId('control_escolar',page,{gmId:101}),0);
 }
 for(const bad of [NaN,-1,1.5,0,Infinity,'malicioso',undefined])assert.equal(W.workspaceId('docente','grupos',{gmId:bad}),0);
 assert.equal(W.workspaceId('docente','perfil',{gmId:101}),0);assert.equal(W.workspaceId('docente','grupos'),0);
});
test('Teacher group navigation reuses existing API handlers and no save path is added',()=>{
 const html=fs.readFileSync(new URL('../sistema.html',import.meta.url),'utf8');
 const block=html.slice(html.indexOf('async function teacherGroupsModule('),html.indexOf('async function teacherRosterModal('));
 assert.match(block,/api\('teacherGroups'\)/);assert.match(block,/unique\.find/);assert.match(block,/teacherRosterModal/);assert.match(block,/openTeacherEvaluationHub/);assert.doesNotMatch(block,/apiPost\(|method:'POST'/);
 for(const route of ['asistencia','calificaciones','bitacora_calificaciones','classroom','examenes'])assert.ok(block.includes(`loadPage('${route}',{gmId:`));
});
test('Attendance saves a snapshot of the selected list and guards against navigation during lookup',()=>{
 const html=fs.readFileSync(new URL('../sistema.html',import.meta.url),'utf8');
 const block=html.slice(html.indexOf('async function saveTeacherAttendanceTable('),html.indexOf('async function teacherScheduleModule('));
 assert.match(block,/const values=new Map/);assert.match(block,/!region\.isConnected/);assert.match(block,/values\.get\(Number\(st\.id\)\)/);assert.doesNotMatch(block,/\|\|'falta'/);
});
