import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluationWindow,requireEvaluationOpen} from '../lib/jaguar_evaluation_window.js';
import {googleRenameTeacher,googleInviteReplacement} from '../lib/google_classroom_oauth.js';
const fakeDb=({enabled=false,periodActive=true,error=false}={})=>({from(table){return {select(){return this},eq(){return this},maybeSingle(){return Promise.resolve(table==='periodos_escolares'?{data:{id:2,nombre:'Segundo',activo:periodActive},error:null}:{data:enabled?{periodo_id:2,habilitada:true}:null,error:error?{message:'table missing'}:null})}}}});
test('cerrado por defecto incluso cuando no exista una fila',async()=>{
 const r=await evaluationWindow(fakeDb(),2);assert.equal(r.habilitada,false);
 await assert.rejects(()=>requireEvaluationOpen(fakeDb(),2),/Dirección Escolar/);
});
test('abierto autoriza; periodo inactivo siempre cerrado',async()=>{
 assert.equal((await requireEvaluationOpen(fakeDb({enabled:true}),2)).habilitada,true);
 assert.equal((await evaluationWindow(fakeDb({enabled:true,periodActive:false}),2)).habilitada,false);
});
test('falta de migración detiene la captura en vez de autorizarla',async()=>{
 await assert.rejects(()=>requireEvaluationOpen(fakeDb({error:true}),2),/migración/);
});
test('Google Classroom actualiza solo metadatos docentes, nunca crea un curso',async()=>{
 const old=globalThis.fetch;let url,options;globalThis.fetch=async(u,o)=>{url=u;options=o;return {ok:true,json:async()=>({id:'1234567',section:'PROF. NUEVO'})}};
 try{await googleRenameTeacher('token','1234567','PROF. NUEVO');assert.match(url,/courses\/1234567\?updateMask=/);assert.match(url,/section,descriptionHeading,description/);assert.equal(options.method,'PATCH');const payload=JSON.parse(options.body);assert.equal(payload.section,'PROF. NUEVO');assert.equal(Object.hasOwn(payload,'ownerId'),false);assert.equal(Object.hasOwn(payload,'name'),false);}finally{globalThis.fetch=old;}
});
test('Invita como TEACHER a una clase existente sin reclutar alumnos',async()=>{
 const old=globalThis.fetch;let options;globalThis.fetch=async(u,o)=>{options=o;assert.match(u,/\/invitations$/);return {ok:true,json:async()=>({id:'invite123'})}};
 try{await googleInviteReplacement('token','1234567','profesor@gmail.com');const body=JSON.parse(options.body);assert.deepEqual(body,{courseId:'1234567',userId:'profesor@gmail.com',role:'TEACHER'});}finally{globalThis.fetch=old;}
});
test('Boleta conserva autoría anterior y muestra nota histórica pequeña en gris',()=>{
 const report=readFileSync(new URL('../api/reports.js',import.meta.url),'utf8');const pdf=readFileSync(new URL('../lib/boleta_visual15.js',import.meta.url),'utf8');
 assert.match(report,/jaguar_vacantes_docentes/);assert.match(report,/gradeTeachersFromGroup/);assert.match(report,/teacherProfiles\.push\(\{name:.*history\}/);
 assert.match(pdf,/Antes:/);assert.match(pdf,/rgb\(\.48,\.51,\.55\)/);
});
test('SQL cierra por defecto y bloquea escritura incluso sin controles UI',()=>{
 const sql=readFileSync(new URL('../sql/ITHLA_JAGUAR_EVALUACIONES_360_V1.sql',import.meta.url),'utf8');
 for(const t of ['evaluacion_notas','calificaciones','cierres_evaluacion'])assert.match(sql,new RegExp('before insert or update or delete on public\\.'+t));
 assert.match(sql,/habilitada boolean not null default false/);
 assert.match(sql,/revoke all on public.jaguar_evaluacion_ventanas from public,anon,authenticated/);
});

test('Curso legado con nombre anterior puede normalizarse sin tocar ownerId',async()=>{
 const old=globalThis.fetch;let req;globalThis.fetch=async(u,o)=>{req={u,o};return {ok:true,json:async()=>({id:'courseXYZ'})}};
 try{await googleRenameTeacher('token','courseXYZ','PROFA. SUSTITUTA','2°B | ESPAÑOL');assert.match(req.u,/name/);assert.equal(JSON.parse(req.o.body).name,'2°B | ESPAÑOL');assert.equal(Object.hasOwn(JSON.parse(req.o.body),'ownerId'),false);}finally{globalThis.fetch=old;}
});
test('Separa módulos sensibles y no desbloquea notas desde el navegador',()=>{
 const page=readFileSync(new URL('../sistema.html',import.meta.url),'utf8');
 const route=readFileSync(new URL('../routes/evaluation-window.js',import.meta.url),'utf8');
 const data=readFileSync(new URL('../api/data.js',import.meta.url),'utf8');
 assert.match(page,/jaguarEvaluationDirectionPage/);assert.match(page,/jaguarLoadAttendanceHistory/);assert.match(page,/teacherGradesModule/);
 assert.match(route,/profile\.rol!=='direccion_escolar'/);assert.match(route,/jaguar_abrir_cerrar_evaluacion/);
 for(const resource of ['saveEvaluationScores','prepareEvaluationUpload','submitEvaluationPeriod','commitTeacherDailyUpload']){
  const position=data.indexOf("resource === '"+resource+"'");
  assert.ok(position>0,resource+' no encontrado');
  assert.match(data.slice(position,position+250),/requireEvaluationOpen/);
 }
});
