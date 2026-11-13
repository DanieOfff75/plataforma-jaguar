import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {finalizeGrade,displayFinalGrade,gradePolicyFromRow} from '../lib/grade_precision.js';
import {gradebookTotal} from '../lib/gradebook_weighting.js';

const root=path.resolve(import.meta.dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const ui=read('sistema.html'),api=read('api/data.js'),pdf=read('lib/jaguar_gradebook_pdf.js'),office=read('lib/grade_policy_office_pdf.js'),sql=read('sql/ITHLA_CALIFICACIONES_PRECISION_Y_OFICIOS_2026.sql');
const rubric=[{id:66,nombre:'LIBRETA',ponderacion:70},{id:67,nombre:'ACTIVIDADES CLASSROOM',ponderacion:15},{id:68,nombre:'PROYECTO FINAL',ponderacion:15}];

// Casos del docente y fronteras del redondeo de Excel.
test('sin decimales por defecto: 9.5->10, 9.4->9, 8.5->9, 0 y 10',()=>{
 assert.equal(finalizeGrade(9.5),10);
 assert.equal(finalizeGrade(9.4),9);
 assert.equal(finalizeGrade(9.499),9);
 assert.equal(finalizeGrade(8.5),9);
 assert.equal(finalizeGrade(0),0);
 assert.equal(finalizeGrade(10),10);
 assert.equal(finalizeGrade(null),null);
 assert.equal(displayFinalGrade(7.625),'8');
 assert.deepEqual(gradePolicyFromRow(null),{permite_decimales:false,version:0,ciclo_escolar:null});
});

test('con un decimal: redondeo convencional preservando precisión en fuentes',()=>{
 const p={permite_decimales:true};
 assert.equal(finalizeGrade(9.45,p),9.5);
 assert.equal(finalizeGrade(9.44,p),9.4);
 assert.equal(finalizeGrade(7.625,p),7.6);
 assert.equal(displayFinalGrade(7.625,p),'7.6');
 assert.equal(displayFinalGrade(10,p),'10.0');
 assert.throws(()=>finalizeGrade(10.5,p),/entre 0 y 10/);
 assert.throws(()=>finalizeGrade(-0.1,p),/entre 0 y 10/);
 assert.throws(()=>finalizeGrade(NaN,p),/entre 0 y 10/);
});

test('dato real de Excel: 5.60+0.90+1.125=7.625, en PDF es 8 o 7.6, sin doble ponderación',()=>{
 const snapshot={meta:{unidad_ponderaciones:'puntos_ponderados'},weightedValues:{'1|66':5.6,'1|67':0.9,'1|68':1.125}};
 const raw=gradebookTotal(snapshot,rubric,1);
 assert.equal(raw,7.625);
 assert.equal(displayFinalGrade(raw),'8');
 assert.equal(displayFinalGrade(raw,{permite_decimales:true}),'7.6');
 assert.match(pdf,/displayFinalGrade\(gradebookTotal\(state,components,st\.id\)/);
 assert.match(pdf,/VALORES PONDERACION/);
 assert.match(pdf,/extraHeaderRows:\[c=>c\.key,c=>compactDate\(c\.fecha\)\]/);
 assert.match(pdf,/c\.ponderacion\.toFixed\(2\)/);
});

test('Excel usa el formato visible 0 ó 0.0 y conserva el valor numérico bruto',()=>{
 assert.match(ui,/const totalGradeNumberFormat=d\.grade_precision\?\.permite_decimales\?'0\.0':'0'/);
 assert.match(ui,/\['permite_decimales',d\.grade_precision\?\.permite_decimales\?1:0\]/);
 assert.match(ui,/ROUND\(SUM\(D\$\{r\}:\$\{lastAspect\}\$\{r\}\),3\)/);
 assert.match(api,/permite_decimales:\(await currentGradePolicy\(admin,d\.period\.ciclo_escolar\)\)\.permite_decimales/);
});

test('regla oficial se usa también en cierre de rúbrica y adopción, sin reescribir historiales',()=>{
 assert.match(api,/async function currentGradePolicy\(/);
 assert.match(api,/finalizeGrade\(/);
 assert.match(api,/calificacion_sin_redondeo/);
 assert.match(sql,/before insert or update of calificacion on public\.calificaciones/);
 assert.match(sql,/new\.calificacion is not distinct from old\.calificacion/);
 assert.doesNotMatch(sql,/update public\.calificaciones set calificacion/);
});

test('la configuración ya existente de periodos es la única pantalla de decisión y solo Control Escolar puede editar',async()=>{
 assert.match(ui,/async function jaguarSchoolCycleConfig\(/);
 assert.match(ui,/S\.role==='control_escolar'/);
 assert.match(ui,/jaguar_grade_precision/);
 assert.match(ui,/jaguar_grade_reason/);
 const start=ui.indexOf('async function jaguarSchoolCycleConfig(){');
 const end=ui.indexOf('async function jaguarSetCurrentPeriod(',start);
 const msgs=[];
 const context=vm.createContext({S:{role:'control_escolar'},api:async key=>({periods:[],periodContext:{},gradePrecisionPolicy:{permite_decimales:false,version:0},gradePrecisionOffices:[]}[key]||[]),esc:x=>String(x),toast:m=>msgs.push(m),confirm:()=>false});
 vm.runInContext(ui.slice(start,end),context);
 const html=await context.jaguarSchoolCycleConfig();
 assert.match(html,/Sin decimales/);
 assert.match(html,/option value="no" selected/);
 assert.match(html,/Guardar criterio y comunicar por oficio/);
 assert.match(html,/Crear periodo/);
});

test('cambio se registra con oficio, motivo y aviso a personal activo, no a estudiantes, en una transacción',()=>{
 assert.match(sql,/create or replace function public\.jaguar_cambiar_precision_calificaciones/);
 assert.match(sql,/p_version_esperada/);
 assert.match(sql,/for update/);
 assert.match(sql,/insert into public\.jaguar_oficios_precision_calificaciones/);
 assert.match(sql,/insert into public\.notificaciones/);
 assert.match(sql,/p\.activo=true/);
 assert.match(sql,/p\.rol not in \('alumno','aspirante','padre','tutor'\)/);
 assert.match(sql,/service_role/);
 assert.match(api,/profile\.rol!=='control_escolar'/);
 assert.match(api,/\.rpc\('jaguar_cambiar_precision_calificaciones'/);
 assert.match(api,/motivo\.length<15\|\|motivo\.length>300/);
 assert.match(ui,/maxlength="300"/);
 assert.match(office,/prepareInstitutionalPdf\(/);
 assert.match(office,/OFICIO CIRCULAR DE CRITERIO DE CALIFICACIONES/);
 assert.match(office,/A TODO EL PERSONAL DEL INSTITUTO/);
 assert.match(office,/signature\(page,theme/);
});

test('descarga del oficio institucional integra autorización y contenido del folio histórico',()=>{
 const reports=read('api/reports.js');
 assert.match(reports,/if\(b\.action==='grade_policy_office_pdf'\)/);
 assert.match(reports,/buildGradePrecisionOfficePdf/);
 assert.match(reports,/oficio_id/);
 assert.match(reports,/\.eq\('id',id\)\.maybeSingle\(\)/);
 assert.match(ui,/jaguarDownloadGradePolicyOffice/);
 assert.match(ui,/oficio_precision_calificaciones/);
});
