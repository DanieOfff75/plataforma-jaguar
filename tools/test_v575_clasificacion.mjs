import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeWorkTypes,classifiedWork,excludedFromClassification,parseFormId} from '../lib/classroom_classification.js';
import {gradeEntries} from '../lib/classroom_periods.js';
import {gradeReport,gradeSelection,gradeProof} from '../lib/classroom_grades.js';
const t=[
{id:'a1',title:'Actividad 1',topicId:'p1',state:'PUBLISHED',workType:'ASSIGNMENT',maxPoints:10},
{id:'e1',title:'Evaluación final',topicId:'p1',state:'PUBLISHED',workType:'ASSIGNMENT',maxPoints:20},
{id:'e2',title:'Examen vía Forms',topicId:'p1',state:'PUBLISHED',workType:'ASSIGNMENT',maxPoints:10},
{id:'x1',title:'Repetición del examen',topicId:'p1',state:'PUBLISHED',workType:'ASSIGNMENT',maxPoints:10}];
const students=[{userId:'u1',profile:{name:{fullName:'Alumno Prueba'}}}];
const submissions=t.map(w=>({courseWorkId:w.id,userId:'u1',assignedGrade:w.id==='a1'?9:10,state:'RETURNED'}));
const topic=[{topicId:'p1',name:'PRIMER PERIODO'}],period={numero_periodo:1,topic_name:'PRIMER PERIODO'};
const raw=gradeEntries(t,submissions,'p1').work;
const types=normalizeWorkTypes([
{work_id:'a1',tipo:'actividad'},
{work_id:'e1',tipo:'examen',fuente_examen:'classroom'},
{work_id:'e2',tipo:'examen',fuente_examen:'forms',google_form_id:'https://docs.google.com/forms/d/e/1FAIpQLSejemplo123456789/viewform'},
{work_id:'x1',tipo:'excluir'},
],raw);
assert.equal(types.length,4);
assert.equal(types.find(x=>x.google_work_id==='e1').fuente_examen,'classroom');
assert.equal(types.find(x=>x.google_work_id==='e2').google_form_id,'1FAIpQLSejemplo123456789');
const marked=classifiedWork(raw,types);const excluded=excludedFromClassification(marked);
assert.deepEqual(excluded,['e1','e2','x1']);
const selection=gradeSelection({excluded_ids:excluded,decisions:[]},marked,students);
assert.deepEqual(selection.excluded,excluded);
const report=gradeReport(t,submissions,topic,period,students,{excluded_ids:excluded,decisions:[]},marked);
assert.equal(report.grades[0].grade,9);
assert.equal(report.grades[0].possible,10);
assert.throws(()=>gradeSelection({excluded_ids:['x1'],decisions:[]},marked,students),/exámenes/);
assert.throws(()=>gradeSelection({excluded_ids:excluded,decisions:[]},classifiedWork(raw,types.slice(0,3)),students),/Clasifica/);
assert.throws(()=>normalizeWorkTypes([{work_id:'a1',tipo:'actividad'}],raw),/todos/);
assert.throws(()=>normalizeWorkTypes(types.map(x=>({...x,work_id:x.google_work_id,tipo:x.tipo,fuente_examen:x.fuente_examen})).map(x=>({...x,tipo:x.work_id==='e1'?'examen':x.tipo,fuente_examen:x.work_id==='e1'?'':x.fuente_examen})),raw),/Indica/);
assert.throws(()=>normalizeWorkTypes([
{work_id:'a1',tipo:'actividad'},
{work_id:'e1',tipo:'examen',fuente_examen:'forms',google_form_id:'1FAIpQLSejemplo123456789'},
{work_id:'e2',tipo:'examen',fuente_examen:'forms',google_form_id:'1FAIpQLSejemplo123456789'},
{work_id:'x1',tipo:'excluir'},
],raw),/mismo formulario/);
assert.throws(()=>parseFormId('https://evil.example/forms/d/e/1FAIpQLSejemplo123456789/viewform'),/docs.google.com/);
assert.notEqual(gradeProof({work:marked},'clave-segura'),gradeProof({work:classifiedWork(raw,[{google_work_id:'a1',tipo:'excluir'}])},'clave-segura'));
const route=fs.readFileSync(new URL('../routes/google-classroom.js',import.meta.url),'utf8');
assert(route.includes("action==='save_work_types'"));
assert(route.includes('const work=classifiedWork(rawWork,savedTypes)'));
assert(route.includes('gradeReport(coursework,submissions,topics,{...period,topic_name},students,req.body,work)'));
const ui=fs.readFileSync(new URL('../assets/jaguar-classroom-v56.js',import.meta.url),'utf8');
assert(ui.includes('j575saveClassifications'));
assert(ui.includes('Abrir Evaluaciones → Excel del primer periodo'));
console.log('✓ V5.7.5: clasificación examen/Forms/Classroom/manual, sin doble conteo, validaciones y guía docente.');
