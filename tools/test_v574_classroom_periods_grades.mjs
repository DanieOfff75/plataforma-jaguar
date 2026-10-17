import assert from 'node:assert/strict';
import {topicForPeriod,matchingTopic,gradeEntries,computeClassroomGrade} from '../lib/classroom_periods.js';
import {gradeSelection,gradeReport,gradeProof,verifyProof} from '../lib/classroom_grades.js';
import {GOOGLE_SCOPES} from '../lib/google_classroom_oauth.js';
let count=0;const test=(fn)=>{fn();count++;};
for(const [n,name] of [['1','PRIMER PERIODO'],['2','SEGUNDO PERIODO'],['3','TERCER PERIODO'],['4','CUARTO PERIODO'],['5','QUINTO PERIODO'],['6','SEXTO PERIODO']])test(()=>assert.equal(topicForPeriod({numero_periodo:n}),name));
test(()=>assert.throws(()=>topicForPeriod({nombre:'final',numero_periodo:0}),/número válido/));
const topics=[{topicId:'p1',name:'PRIMER PERIODO'},{topicId:'p2',name:'SEGUNDO PERIODO'}],period={numero_periodo:1,topic_name:'PRIMER PERIODO'};
test(()=>assert.equal(matchingTopic(topics,period).topicId,'p1'));
const work=[{id:'a',title:'Actividad 1',topicId:'p1',workType:'ASSIGNMENT',state:'PUBLISHED',maxPoints:10},
{id:'b',title:'Proyecto',topicId:'p1',workType:'ASSIGNMENT',state:'PUBLISHED',maxPoints:20},
{id:'e',title:'EXÁMEN FINAL',topicId:'p1',workType:'ASSIGNMENT',state:'PUBLISHED',maxPoints:30},
{id:'q',title:'Ejercicio corto',topicId:'p1',workType:'SHORT_ANSWER_QUESTION',state:'PUBLISHED',maxPoints:10},
{id:'otro',title:'Otro periodo',topicId:'p2',workType:'ASSIGNMENT',state:'PUBLISHED',maxPoints:10},
{id:'draft',title:'Borrador',topicId:'p1',workType:'ASSIGNMENT',state:'DRAFT',maxPoints:10}];
const submissions=[{courseWorkId:'a',userId:'u1',assignedGrade:8,state:'RETURNED'},
{courseWorkId:'b',userId:'u1',assignedGrade:15,state:'RETURNED'},
{courseWorkId:'q',userId:'u1',assignedGrade:9,state:'TURNED_IN'},
{courseWorkId:'e',userId:'u1',assignedGrade:30,state:'RETURNED'},
{courseWorkId:'otro',userId:'u1',assignedGrade:0,state:'RETURNED'},
{courseWorkId:'a',userId:'u2',assignedGrade:10,state:'RETURNED'},
{courseWorkId:'b',userId:'u2',state:'CREATED'},
{courseWorkId:'q',userId:'u2',assignedGrade:10,state:'RETURNED'},
{courseWorkId:'e',userId:'u2',assignedGrade:0,state:'RETURNED'}];
const students=[{userId:'u1',profile:{name:{fullName:'Estudiante Uno'}}},{userId:'u2',profile:{name:{fullName:'Estudiante Dos'}}}];
const entries=gradeEntries(work,submissions,'p1');
test(()=>assert.equal(entries.work.length,4));
test(()=>assert(entries.work.find(w=>w.id==='e').auto_exclude));
test(()=>assert.equal(entries.rows.length,8));
test(()=>assert.throws(()=>gradeSelection({excluded_ids:[],decisions:[]},entries.work,students),/exámenes/));
const selection={excluded_ids:['e'],decisions:[{google_user_id:'u2',work_id:'b',action:'zero'}]};
test(()=>assert.deepEqual(gradeSelection(selection,entries.work,students),{excluded:['e'],decisions:selection.decisions}));
const report=gradeReport(work,submissions,topics,period,students,selection);
test(()=>assert.equal(report.grades[0].grade,8)); // (8 +15 +9) / (10+20+10)=8
// second: (10 +0 +10)/(10+20+10)=5
 test(()=>assert.equal(report.grades[1].grade,5));
test(()=>assert.deepEqual(report.grades[1].unresolved,[]));
const pending=gradeReport(work,submissions,topics,period,students,{excluded_ids:['e'],decisions:[]});
test(()=>assert.deepEqual(pending.grades[1].unresolved,['b']));
const omitted=gradeReport(work,submissions,topics,period,students,{excluded_ids:['e'],decisions:[{google_user_id:'u2',work_id:'b',action:'exclude'}]});
test(()=>assert.equal(omitted.grades[1].grade,10));
test(()=>assert.throws(()=>gradeSelection({excluded_ids:['e','x'],decisions:[]},entries.work,students),/ajenas/));
test(()=>assert.throws(()=>gradeSelection({excluded_ids:['e'],decisions:[{google_user_id:'???',work_id:'b',action:'zero'}]},entries.work,students),/inválida/));
const sig=gradeProof({grades:report.grades},'secure-secret');test(()=>assert(verifyProof(sig,gradeProof({grades:report.grades},'secure-secret'))));test(()=>assert(!verifyProof(sig,gradeProof({grades:pending.grades},'secure-secret'))));
for(const scope of ['classroom.topics','classroom.coursework.students.readonly','classroom.rosters.readonly'])test(()=>assert(GOOGLE_SCOPES.includes(`https://www.googleapis.com/auth/${scope}`)));
console.log(`✓ Jaguar V5.7.4: ${count} pruebas de temas, examen excluido, notas pendientes, puntos, permisos y huellas aprobadas.`);
