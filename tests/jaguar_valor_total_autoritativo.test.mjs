import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {buildExcelGradeRows} from '../lib/evaluation_excel_rules.js';
import {gradebookTotal} from '../lib/gradebook_weighting.js';
import {finalizeGrade} from '../lib/grade_precision.js';

const components=[{id:66,nombre:'LIBRETA',ponderacion:70},{id:67,nombre:'ACTIVIDADES CLASSROOM',ponderacion:15},{id:68,nombre:'PROYECTO FINAL',ponderacion:15}];
const rubric={id:19,version:2};
const students=Array.from({length:40},(_,i)=>({id:i+1,matricula:`PRUEBA-${i+1}`,nombre_completo:`Estudiante ${i+1}`}));
const rows=students.map((st,i)=>({alumno_id:st.id,valor_total:i===0?7.625:8.1,aspectos:[{componente_id:66,valor:5.6},{componente_id:67,valor:0.9},{componente_id:68,valor:1.125}]}));
const evaluate=input=>buildExcelGradeRows({students,components,rows:input,rubric,gmId:378,periodoId:13,teacherId:5,now:'2026-11-12T00:00:00Z'});

test('40 filas oficiales: VALOR TOTAL prevalece sobre aportes, sin reponderación',()=>{
 const result=evaluate(rows);
 assert.equal(result.gradeRows.length,40);
 assert.equal(result.gradeRows[0].calificacion,7.625);
 assert.equal(result.gradeRows[1].calificacion,8.1);
 assert.equal(result.gradeRows[0].detalle_evaluacion.actividades[2].puntos_obtenidos,1.125);
 assert.equal(result.gradeRows[0].detalle_evaluacion.modo_calculo,'valor_total_de_excel_sin_reponderacion');
 assert.equal(finalizeGrade(result.gradeRows[0].calificacion,{permite_decimales:false}),8);
 assert.equal(finalizeGrade(result.gradeRows[0].calificacion,{permite_decimales:true}),7.6);
});
test('VALOR TOTAL sigue siendo oficial aunque no haya desglose seleccionado',()=>{
 const simple=rows.map(x=>({...x,aspectos:[]}));
 const result=evaluate(simple);
 assert.equal(result.gradeRows.length,40);
 assert.equal(result.gradeRows[0].detalle_evaluacion.actividades.length,0);
 assert.equal(result.gradeRows[0].calificacion,7.625);
});
test('El cierre rechaza filas faltantes, matrículas duplicadas, total vacío y aportes fuera del máximo',()=>{
 assert.throws(()=>evaluate(rows.slice(1)),/exactamente 40/);
 assert.throws(()=>evaluate(rows.map((x,i)=>i===1?{...x,alumno_id:1}:x)),/más de una vez/);
 assert.throws(()=>evaluate(rows.map((x,i)=>i===1?{...x,valor_total:''}:x)),/VALOR TOTAL numérico/);
 assert.throws(()=>evaluate(rows.map((x,i)=>i===1?{...x,aspectos:[{componente_id:66,valor:7.01}]}:x)),/entre 0 y 7/);
});
test('El respaldo y PDF consultan VALOR TOTAL si existe; nunca redondean las columnas individuales',()=>{
 const state={totalValues:{'1':7.625},weightedValues:{'1|66':5.6,'1|67':0.9,'1|68':1.125}};
 assert.equal(gradebookTotal(state,components,1),7.625);
 const root=path.resolve(import.meta.dirname,'..');
 const pdf=fs.readFileSync(path.join(root,'lib/jaguar_gradebook_pdf.js'),'utf8');
 const api=fs.readFileSync(path.join(root,'api/data.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'sistema.html'),'utf8');
 assert.match(pdf,/originalContribution\(state\.weightedValues/);
 assert.match(api,/totalValues:state\?\.totalValues\|\|\{\}/);
 assert.match(html,/const rawTotal=vr\[r\]\?\.\[3\+rubric\.components\.length\]/);
 assert.match(html,/modo_origen:'excel_valor_total'/);
 assert.match(html,/jaguarOpenDailyOfficialTotals\(/);
});
