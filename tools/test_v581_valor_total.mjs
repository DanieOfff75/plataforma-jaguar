import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildExcelGradeRows} from '../lib/evaluation_excel_rules.js';
const fixture=JSON.parse(fs.readFileSync('/mnt/data/excel_scores_test.json','utf8'));
const students=fixture.map((_,i)=>({id:i+1,matricula:'PRUEBA-'+(i+1),nombre_completo:'Alumno '+(i+1)}));
const comps=[{id:12,nombre:'ACTIVIDADES',ponderacion:50},{id:13,nombre:'PROYECTO',ponderacion:40},{id:14,nombre:'COMPROMISO',ponderacion:10}];
const rubric={id:3,version:1};
const rows=fixture.map((x,i)=>({alumno_id:i+1,valor_total:x[3],aspectos:comps.map((c,j)=>({componente_id:c.id,valor:x[j]}))}));
const build=(rs)=>buildExcelGradeRows({students,components:comps,rows:rs,rubric,gmId:375,periodoId:1,teacherId:9});
const result=build(rows);
assert.equal(result.gradeRows.length,39);assert.equal(result.gradeRows[0].calificacion,10);assert.equal(result.gradeRows[1].calificacion,9);
assert.equal(result.gradeRows[0].detalle_evaluacion.valor_total_excel,10);
assert.equal(result.gradeRows[0].detalle_evaluacion.actividades[0].puntos_obtenidos,5);
assert.equal(result.gradeRows[0].detalle_evaluacion.fuente,'excel_valor_total');
for(let i=0;i<39;i++)assert.equal(result.gradeRows[i].calificacion,fixture[i][3]);
const changed=structuredClone(rows); changed[0].valor_total=9.7;
assert.equal(build(changed).gradeRows[0].calificacion,9.7,'no se debe recalcular desde otros aspectos');
for(const change of [r=>r.pop(), r=>r[1].alumno_id=1, r=>r[1].aspectos[0].valor=8, r=>r[0].valor_total=null]){
 const bad=structuredClone(rows);change(bad);assert.throws(()=>build(bad));
}
console.log('OK: 39 filas reales, totales sin recálculo, 4 casos rechazados');
