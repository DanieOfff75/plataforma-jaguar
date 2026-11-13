import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {gradebookUnit,gradebookTotal,gradebookToRubricNote} from '../lib/gradebook_weighting.js';

const root=path.resolve(import.meta.dirname,'..');
const html=fs.readFileSync(path.join(root,'sistema.html'),'utf8');
const api=fs.readFileSync(path.join(root,'api/data.js'),'utf8');
const pdf=fs.readFileSync(path.join(root,'lib/jaguar_gradebook_pdf.js'),'utf8');
const components=[{id:11,nombre:'Libreta',ponderacion:70},{id:22,nombre:'Classroom',ponderacion:15},{id:33,nombre:'Proyecto',ponderacion:15}];
const weightedValues={'101|11':5.6,'101|22':0.9,'101|33':1.1,'102|11':6.9,'102|22':1.5,'102|33':1.4};

test('PDF: deja de ponderar dos veces; valores reales en bitácora de ejemplo',()=>{
 const historical={weightedValues,rubric:{components}};
 assert.equal(gradebookUnit(historical,components),'puntos_ponderados');
 assert.equal(gradebookTotal(historical,components,101),7.6);
 assert.equal(gradebookTotal(historical,components,102),9.8);
 assert.notEqual(gradebookTotal(historical,components,101),4.2);
 assert.match(pdf,/gradebookTotal\(state,components,st\.id\)/);
});
test('Notas 0–10 se ponderan una sola vez; 0 se respeta; incompletas sin total',()=>{
 const raw={weightedValues:{'101|11':8,'101|22':6,'101|33':7.5},meta:{unidad_ponderaciones:'escala_0_10'}};
 assert.equal(gradebookTotal(raw,components,101),7.625);
 const zero={weightedValues:{'101|11':0,'101|22':0,'101|33':0},meta:{unidad_ponderaciones:'puntos_ponderados'}};
 assert.equal(gradebookTotal(zero,components,101),0);
 assert.equal(gradebookTotal({weightedValues:{'101|11':5.6}},components,101),null);
 assert.equal(gradebookToRubricNote(5.6,components[0],'puntos_ponderados'),8);
 assert.throws(()=>gradebookToRubricNote(8,components[0],'puntos_ponderados'),/supera/);
});
test('La hoja Excel de bitácora guarda fórmula SUM sin reponderar, metadatos de unidad y caps',()=>{
 assert.match(html,/\['unidad_ponderaciones',rubricUnit\]/);
 assert.match(html,/rubricUnit==='puntos_ponderados'\?`IF\(COUNT/);
 assert.match(html,/ROUND\(SUM\(D\$\{r\}:\$\{lastAspect\}\$\{r\}\),3\)/);
 assert.match(api,/unidad_ponderaciones:/);
});
test('No hay segundo Excel de evaluación ni escritura directa de total en Docente',()=>{
 assert.doesNotMatch(html,/function downloadEvaluationTemplate\(/);
 assert.doesNotMatch(html,/function evaluationWorkbook\(/);
 assert.doesNotMatch(html,/openEvaluationExportSelector\(/);
 assert.doesNotMatch(html,/saveTeacherGradesTable\(/);
 assert.match(api,/resource === 'saveTeacherGrades'[\s\S]{0,220}status\(409\)/);
 assert.match(html,/function openExcelGradeAdoption\(/);
 assert.match(html,/function openDailyGradebook\(/);
 assert.match(html,/situacion:situation/);
});
function makeImportFixture(){
 const errors=[],p={gmId:5,periodoId:7,current:{rubrica:{id:19,version:2},componentes:components,students:[{id:101,matricula:'ITH001',nombre_completo:'Persona Uno'},{id:102,matricula:'ITH002',nombre_completo:'Persona Dos'}],scores:[]},file:{name:'alumnos.xlsx'},sheetName:'NOTAS',data:[['nombre','matricula','Libreta','Classroom','Proyecto'],['A','ITH001',5.6,0.9,1.1],['B','ITH002',6.9,1.5,1.4]]};
 const vals={jx_first:'2',jx_last:'3',jx_head:'1',jx_mat:'B',jx_unit:'puntos_ponderados',jx_comp_11:'C',jx_comp_22:'D',jx_comp_33:'E'};
 const context=vm.createContext({window:{_jaguarExternalGrades:p},document:{getElementById(id){return {value:vals[id]}}},XLSX:{utils:{decode_col(s){let n=0;for(const c of String(s))n=n*26+c.charCodeAt(0)-64;return n-1;}}},dailyContributionToNote:gradebookToRubricNote,jaguarNombreInstitucional:s=>s.nombre_completo,showJaguarGradePromotionReview(){},toast:m=>errors.push(String(m))});
 const start=html.indexOf('function jaguarPreviewExternalGradeMapping(){');
 const end=html.indexOf('async function confirmDailyDraftToEvaluation(){',start);
 assert.ok(start>0&&end>start);
 vm.runInContext(html.slice(start,end),context);
 return {context,p,vals,errors};
}
test('Importar XLSX externo: selección hoja, filas, columnas, conversión y asociación por matrícula',()=>{
 const x=makeImportFixture();x.context.jaguarPreviewExternalGradeMapping();
 assert.deepEqual(x.errors,[]);
 const pending=x.context.window._pendingDailyPromotion;
 assert.equal(pending.proposals.length,6);
 assert.equal(pending.proposals.find(e=>e.alumno_id===101&&e.componente_id===11).valor,8);
 assert.equal(pending.source.hoja,'NOTAS');
 assert.equal(pending.source.columnas[11],'C');
});
test('Importación: filas fuera de grupo, matrículas repetidas y columnas compartidas se rechazan',()=>{
 const x=makeImportFixture();x.p.data[2][1]='OTRA-MATRICULA';x.context.jaguarPreviewExternalGradeMapping();assert.match(x.errors[0],/no pertenecen al grupo/);
 const y=makeImportFixture();y.p.data[2][1]='ITH001';y.context.jaguarPreviewExternalGradeMapping();assert.match(y.errors[0],/repetida/);
 const z=makeImportFixture();z.vals.jx_comp_33='D';z.context.jaguarPreviewExternalGradeMapping();assert.match(z.errors[0],/duplicados/);
});
test('Servidor comprueba permisos, origen Excel y bloquea cambios concurrentes',()=>{
 assert.match(api,/requireEvaluationOpen\(adminClient,req.body\?\.periodo_id\)/);
 assert.match(api,/row\.valor_anterior/);
 assert.match(api,/origin==='excel_externo'/);
 assert.match(api,/guardar_notas_rubrica/);
});
