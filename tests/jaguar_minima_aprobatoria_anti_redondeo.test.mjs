import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {finalizeGrade,displayFinalGrade,gradeStatus,gradePolicyFromRow,gradeObservations} from '../lib/grade_precision.js';

const root=path.resolve(import.meta.dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('sistema.html');

test('Mínima 6, enteros: ni 5.5 ni 5.99 pueden convertirse en 6',()=>{
 for(const n of [0,1,2,3,4,4.8,5,5.4,5.5,5.9,5.95,5.999999]){
   assert.ok(finalizeGrade(n)<6,`${n} no debe aprobar por redondeo`);
   assert.equal(gradeStatus(n),'Reprobado');
 }
 assert.equal(finalizeGrade(5.99),5);
 assert.equal(finalizeGrade(6),6);
 assert.equal(finalizeGrade(6.5),7);
 assert.equal(finalizeGrade(9.5),10);
});

test('Mínima 6, decimal: ninguna nota reprobatoria puede subir a 6.0',()=>{
 const p={permite_decimales:true};
 assert.equal(finalizeGrade(5.95,p),5.9);
 assert.equal(finalizeGrade(5.99,p),5.9);
 assert.equal(finalizeGrade(5.55,p),5.6);
 assert.equal(finalizeGrade(6,p),6);
 assert.equal(displayFinalGrade(5.999,p),'5.9');
});

test('Con piso activado, notas debajo de 5 pasan a 5; con decimal 5.6 permanece reprobada',()=>{
 const p={minima_aprobatoria:6,permitir_reprobatorias_inferiores:false};
 assert.deepEqual([0,1,2,3.2,4.9,5.4,5.5,5.99].map(n=>finalizeGrade(n,p)),[5,5,5,5,5,5,5,5]);
 assert.equal(finalizeGrade(5.55,{...p,permite_decimales:true}),5.6);
 assert.equal(finalizeGrade(4.8,{...p,permite_decimales:true}),5);
});

test('Mínima configurable: 7 y 8 protegen el salto de reprobado a aprobado',()=>{
 for(const min of [7,8,10]){
   const p={minima_aprobatoria:min};
   assert.equal(finalizeGrade(min-0.01,p),min-1);
   assert.equal(finalizeGrade(min,p),min);
   assert.equal(finalizeGrade(min-0.001,{...p,permite_decimales:true}),min-0.1);
 }
});

test('Estabilidad: todas las notas fraccionarias jamás cruzan la mínima si están debajo',()=>{
 for(const min of [1,2,6,7,8,9,10]){
   for(const decimals of [true,false]){
     for(const floor of [true,false]){
       const p={minima_aprobatoria:min,permite_decimales:decimals,permitir_reprobatorias_inferiores:floor};
       for(let i=0;i<=10000;i++){
         const value=i/1000;
         const result=finalizeGrade(value,p);
         if(value<min)assert.ok(result<min,`Valor ${value}, mínima ${min}, decimales ${decimals}, inferiores ${floor}, resultado ${result}`);
       }
     }
   }
 }
});

test('Estado y observación: etiqueta Reprobado; aprobación remueve sólo prefijo oficial',()=>{
 assert.equal(gradeObservations(5.9,'Cotejar con docente.'),'REPROBADO. Cotejar con docente.');
 assert.equal(gradeObservations(7,'REPROBADO. Cotejar con docente.'),'Cotejar con docente.');
 assert.equal(gradeObservations(5.9,'REPROBADO. Cotejar con docente.'),'REPROBADO. Cotejar con docente.');
 assert.equal(gradePolicyFromRow(null).minima_aprobatoria,6);
 assert.throws(()=>finalizeGrade(11),/entre 0 y 10/);
});

test('Importador UI muestra la misma nota oficial que el servidor',()=>{
 const start=html.indexOf('function jaguarOfficialPreviewGrade(');
 const end=html.indexOf('function jaguarReviewOfficialTotals()',start);
 assert.ok(start>-1&&end>start);
 const context=vm.createContext({});vm.runInContext(html.slice(start,end),context);
 for(const p of [
   {permite_decimales:false,minima_aprobatoria:6,permitir_reprobatorias_inferiores:true},
   {permite_decimales:true,minima_aprobatoria:6,permitir_reprobatorias_inferiores:false},
   {permite_decimales:false,minima_aprobatoria:8,permitir_reprobatorias_inferiores:false}
 ]){
   for(const n of [0,2.1,4.8,5.5,5.9,5.99,6,6.5,7.625,8.5,9.5,10]){
     assert.equal(context.jaguarOfficialPreviewGrade(n,p),displayFinalGrade(n,p),JSON.stringify({n,p}));
   }
 }
});

test('SQL protege todos los caminos de escritura y conserva cierres históricos',()=>{
 const sql=read('sql/ITHLA_CALIFICACIONES_PRECISION_Y_OFICIOS_2026.sql');
 assert.match(sql,/v_original<v_minima/);
 assert.match(sql,/least\(v_final,v_max_reprobatorio\)/);
 assert.match(sql,/greatest\(v_final,v_minima-1\)/);
 assert.match(sql,/new\.observaciones:=v_prefijo/);
 assert.match(sql,/before insert or update of calificacion on public\.calificaciones/);
 assert.match(sql,/new\.calificacion is not distinct from old\.calificacion/);
 assert.doesNotMatch(sql,/update public\.calificaciones\s+set calificacion/);
 assert.match(sql,/insert into public\.notificaciones/);
});

test('Un único panel, permisos diferenciados: Dirección y Coordinación configuran mínima, CE decimales',()=>{
 const api=read('api/data.js');
 assert.match(api,/\['control_escolar','coordinacion_academica','direccion_escolar'\]\.includes\(role\)/);
 assert.match(api,/role!=='control_escolar'&&decimals!==previous.permite_decimales/);
 assert.match(html,/id="jaguar_grade_pass"/);
 assert.match(html,/id="jaguar_grade_fail_floor"/);
 assert.match(api,/row\.observaciones=gradeObservations\(raw,row\.observaciones,gradePrecision\)/);
 assert.match(html,/modo_origen:'excel_valor_total'/);
 assert.match(read('lib/grade_policy_office_pdf.js'),/MÍNIMA APROBATORIA/);
});

test('Coordinación Académica ve configuración de mínima, pero NO puede editar decimales o periodos',async()=>{
 const start=html.indexOf('async function jaguarSchoolCycleConfig(){');
 const end=html.indexOf('async function jaguarSetCurrentPeriod(',start);
 const context=vm.createContext({S:{role:'coordinacion_academica'},api:async resource=>({periods:[],periodContext:{ciclo_escolar:'2026-2027',periodos:[],total_periodos:0},gradePrecisionPolicy:{permite_decimales:false,minima_aprobatoria:6,permitir_reprobatorias_inferiores:true,version:1},gradePrecisionOffices:[]}[resource]||[]),esc:x=>String(x)});
 vm.runInContext(html.slice(start,end),context);
 const rendered=await context.jaguarSchoolCycleConfig();
 assert.match(rendered,/id="jaguar_grade_precision" class="input mt-1" disabled/);
 assert.match(rendered,/id="jaguar_grade_pass" class="input mt-1"/);
 assert.match(rendered,/Guardar criterio y comunicar por oficio/);
 assert.doesNotMatch(rendered,/\+ Crear periodo/);
});

test('Los oficios llegan a bandeja real de notificaciones del personal, sin abrir otros reportes',()=>{
 const reports=read('api/reports.js');
 assert.match(html,/Notificaciones y oficios/);
 assert.match(html,/else if\(page==='notificaciones'\)c\.innerHTML=await jaguarNotificationsModule\(\)/);
 assert.match(html,/oficio_precision_calificaciones/);
 assert.match(reports,/req\.body\?\.action==='grade_policy_office_pdf'\?/);
 assert.match(reports,/allowedRoleIds/);
 assert.match(reports,/buildGradePrecisionOfficePdf/);
});
