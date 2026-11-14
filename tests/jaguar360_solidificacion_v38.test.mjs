import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {buildExcelGradeRows} from '../lib/evaluation_excel_rules.js';
import {gradeEntries,computeClassroomGrade,matchingTopic} from '../lib/classroom_periods.js';
import {gradeReport} from '../lib/classroom_grades.js';
import {finalizeGrade} from '../lib/grade_precision.js';
import {completeWithNexoProviders,resetNexoProviderCooldowns} from '../lib/nexo_providers.js';
import {readFileSync} from 'node:fs';
const input={students:[{id:1,matricula:'FICTICIA'}],components:[{id:2,nombre:'Actividad',ponderacion:100}],rows:[{alumno_id:1,valor_total:'5.999',aspectos:[{componente_id:2,valor:'5.9'}]}],rubric:{id:3},gmId:4,periodoId:5,teacherId:6};
test('Excel conserva fuente decimal y rechaza valores coercionados a 0 o 1',()=>{
 assert.equal(buildExcelGradeRows(input).gradeRows[0].calificacion,5.999);
 for(const invalid of ['   ',true,false,[],[5],{},'0x5','Infinity',null,undefined])assert.throws(()=>buildExcelGradeRows({...input,rows:[{...input.rows[0],valor_total:invalid}]}),/VALOR TOTAL/);
});
test('Excel valida evidencia y ponderaciones, no sólo total',()=>{
 for(const invalid of [' ',true,[],[5],'0x5'])assert.throws(()=>buildExcelGradeRows({...input,rows:[{...input.rows[0],aspectos:[{componente_id:2,valor:invalid}]}]}),/Falta el valor/);
 assert.throws(()=>buildExcelGradeRows({...input,components:[{id:2,ponderacion:110},{id:3,ponderacion:-10}]}),/Ponderación inválida/);
 assert.throws(()=>buildExcelGradeRows({...input,components:[{id:2,ponderacion:50},{id:2,ponderacion:50}]}),/identificadores repetidos/);
 assert.throws(()=>buildExcelGradeRows({...input,students:[input.students[0],input.students[0]]}),/identificadores repetidos/);
});
const work=[{id:'a',title:'Actividad',topicId:'p',workType:'ASSIGNMENT',state:'PUBLISHED',maxPoints:100}];
const submission={userId:'u',courseWorkId:'a',assignedGrade:59.99};
const topics=[{topicId:'p',name:'PRIMER PERIODO'}],period={numero_periodo:1};
test('Classroom no convierte 5.999 en una aprobación anticipada',()=>{
 const e=gradeEntries(work,[submission],'p');const g=computeClassroomGrade(e.work,e.rows,'u');assert(g.grade<6);assert.equal(finalizeGrade(g.grade,{minima_aprobatoria:6}),5);assert.equal(g.earned,59.99);assert.equal(g.possible,100);
});
test('Classroom distingue nota cero y nota pendiente',()=>{
 const a=gradeEntries(work,[{...submission,assignedGrade:0}],'p');assert.equal(computeClassroomGrade(a.work,a.rows,'u').grade,0);
 const b=gradeEntries(work,[{...submission,assignedGrade:null}],'p');assert.equal(computeClassroomGrade(b.work,b.rows,'u').grade,null);assert.deepEqual(computeClassroomGrade(b.work,b.rows,'u').unresolved,['a']);
});
test('Classroom bloquea temas, actividades, entregas y alumnos duplicados',()=>{
 assert.throws(()=>matchingTopic([...topics,{...topics[0],topicId:'otro'}],period),/temas duplicados/);
 assert.throws(()=>gradeEntries([...work,work[0]],[submission],'p'),/trabajos duplicados/);
 assert.throws(()=>gradeEntries(work,[submission,submission],'p'),/entregas duplicadas/);
 assert.throws(()=>gradeReport(work,[submission],topics,period,[{userId:'u'},{userId:'u'}],{excluded_ids:[],decisions:[]}),/alumnos duplicados/);
});
test('Classroom rechaza puntos de tipo incorrecto, negativos, superiores al máximo',()=>{for(const v of [true,'5',[],NaN,Infinity,-1,101])assert.throws(()=>gradeEntries(work,[{...submission,assignedGrade:v}],'p'),/puntos inválidos/);});
beforeEach(()=>resetNexoProviderCooldowns());
const env={GROQ_API_KEY:'mock',OPENROUTER_API_KEY:'mock'};
const response={ok:true,json:async()=>({choices:[{message:{content:'Orientación ficticia'}}]})};
test('NEXO usa respaldo si una petición no se resuelve incluso tras abortar',async()=>{
 const calls=[];const result=await completeWithNexoProviders({messages:[],env,budgetMs:120,fetchImpl:(url,opts)=>{calls.push({url,signal:opts.signal});return calls.length===1?new Promise(()=>{}):Promise.resolve(response);}});
 assert.equal(result.provider,'openrouter');assert(calls[0].signal.aborted);assert.deepEqual(result.errors,['groq:timeout']);
});
test('NEXO limita también la espera del cuerpo JSON',async()=>{
 const result=await completeWithNexoProviders({messages:[],env:{GROQ_API_KEY:'mock'},budgetMs:50,fetchImpl:async()=>({ok:true,json:()=>new Promise(()=>{})})});
 assert.equal(result.ok,false);assert.deepEqual(result.errors,['groq:timeout']);
});
test('NEXO no inicia más proveedores cuando vence el presupuesto total',async()=>{
 let clock=0,calls=0;const result=await completeWithNexoProviders({messages:[],env,budgetMs:100,now:()=>clock,fetchImpl:async()=>{calls++;clock=101;return {ok:false,status:429};}});assert.equal(calls,1);assert(result.errors.includes('deadline'));
});
test('UI de Classroom diferencia contexto, revisión y confirmación; la vista no redondea',()=>{
 const ui=readFileSync(new URL('../assets/jaguar-classroom-v56.js',import.meta.url),'utf8');assert.match(ui,/j574gradeContextChanged\(\)/);assert.match(ui,/revision!==J574.revision/);assert.match(ui,/if\(J574.committing\)return/);assert.match(ui,/Nota fuente \/10 \(sin redondear\)/);assert.match(ui,/j56esc\(String\(g.valor\)\)/);
});
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const admissions=process.env.JAGUAR_ADMISIONES_DIR||resolve(import.meta.dirname,'../../admisiones');
const center=process.env.JAGUAR_CENTRO_DIR||resolve(import.meta.dirname,'../../centro-control');
const admissionTime=await import(pathToFileURL(resolve(admissions,'lib/admission_time.js')));
const admissionMail=await import(pathToFileURL(resolve(admissions,'lib/admission_mail.js')));
test('Las citas se interpretan en horario institucional independientemente de TZ del servidor',()=>{
 const t=admissionTime.normalizeAdmissionDateTime;
 assert.equal(t('2026-11-14T09:30'),'2026-11-14T15:30:00.000Z');
 assert.equal(t('2026-11-14T09:30-06:00'),'2026-11-14T15:30:00.000Z');
 for(const v of ['2026-02-30T09:00','2026-11-14T24:00','mañana','2026-11-14',null])assert.equal(t(v),null);
 assert.match(admissionTime.formatAdmissionDateTime('2026-11-14T15:30:00Z'),/09:30.*hora del centro de México/);
});
test('Correo Admisiones valida acuse del proveedor, protege secretos y no reintenta resultados ambiguos',async()=>{
 const msg={to:'prueba@example.test',subject:'Aviso ficticio',html:'<p>Prueba</p>'},env={RESEND_API_KEY:'secret-fake',RESEND_FROM_EMAIL:'aviso@example.test'};
 let calls=0;
 const good=await admissionMail.sendAdmissionEmail(msg,{env,fetchImpl:async()=>{calls++;return{ok:true,json:async()=>({id:'ficticio'})}}});assert.equal(good.id,'ficticio');assert.equal(calls,1);
 assert.equal((await admissionMail.sendAdmissionEmail(msg,{env:{},fetchImpl:()=>{throw Error('No llamar')}})).configured,false);
 await assert.rejects(admissionMail.sendAdmissionEmail(msg,{env,fetchImpl:async()=>({ok:true,json:async()=>({})})}),e=>e.code==='EMAIL_UNCERTAIN');
 await assert.rejects(admissionMail.sendAdmissionEmail(msg,{env,fetchImpl:async()=>{throw Error('secret-fake')} }),e=>e.code==='EMAIL_UNCERTAIN'&&!e.message.includes('secret-fake'));
 let uncertain=0;await assert.rejects(admissionMail.sendAdmissionEmail(msg,{env,timeoutMs:15,fetchImpl:()=>{uncertain++;return new Promise(()=>{});}}),e=>e.code==='EMAIL_UNCERTAIN');assert.equal(uncertain,1);
 await assert.rejects(admissionMail.sendAdmissionEmail({...msg,to:'invalid'},{env,fetchImpl:()=>{throw Error('No llamar')}}),e=>e.code==='EMAIL_INVALID');
});
test('Los cuatro sitios consumen el mismo motor NEXO',()=>{
 const expected=readFileSync(new URL('../lib/nexo_providers.js',import.meta.url));
 for(const dir of [admissions,center])assert.deepEqual(readFileSync(resolve(dir,'lib/nexo_providers.js')),expected);
});
