import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {finalizeGrade,gradeObservations} from '../lib/grade_precision.js';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('sql/ITHLA_CALIFICACIONES_REAPLICACION_2026.sql');
const api=read('api/data.js');const ui=read('sistema.html');
const p={minima_aprobatoria:6,permite_decimales:false,permitir_reprobatorias_inferiores:false};
test('piso conserva condición de reprobación; originales recuperables',()=>{
 const originals=[0,1,2,3,4,5,5.49,5.5,5.99,6,6.5,9.5];
 const official=originals.map(x=>finalizeGrade(x,p));assert.deepEqual(official,[5,5,5,5,5,5,5,5,5,6,7,10]);
 assert.deepEqual(originals.map(x=>finalizeGrade(x,{...p,permitir_reprobatorias_inferiores:true})),[0,1,2,3,4,5,5,5,5,6,7,10]);
 assert.equal(gradeObservations(3,'Observación docente',p),'REPROBADO. Observación docente');
 assert.equal(finalizeGrade(7.625,{...p,permite_decimales:true}),7.6);
});
test('protección SQL moderna, alcance autorizado y auditoría atómica (inspección estática)',()=>{
 assert.match(sql,/request\.jwt\.claims/);assert.match(sql,/request\.jwt\.claim\.role/);
 assert.match(sql,/p_alcance='todos' AND v_rol NOT IN \('control','control_escolar'\)/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.jaguar_aplicar_criterios_calificaciones[^;]+FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.jaguar_aplicar_criterios_calificaciones[^;]+TO service_role/);
 assert.match(sql,/LOCK TABLE public\.calificaciones IN SHARE ROW EXCLUSIVE MODE/);
 assert.match(sql,/IF p_previsualizar THEN RETURN/);assert.match(sql,/IF p_huella IS DISTINCT FROM v_huella/);
 assert.match(sql,/a\.transaccion=txid_current\(\)/);
 assert.match(sql,/coalesce\(g\.calificacion_original_politica,public\.jaguar_fuente_cierre_verificada\(/);
 assert.match(sql,/UPDATE public\.calificaciones g SET calificacion=a\.posterior/);
 assert.match(sql,/v_total<>\(v_resumen->>'registros_cambian'\)::bigint/);
 assert.doesNotMatch(sql,/DISABLE TRIGGER|UPDATE public\.jaguar_evaluacion_ventanas/i);
 assert.doesNotMatch(sql,/UPDATE public\.(evaluacion_notas|cierres_evaluacion|rubricas_evaluacion)/i);
});
test('el cierre conserva fuente original incluso en ajuste docente o rectificación',()=>{
 assert.match(api,/row\.calificacion_original_politica=raw/);
 assert.match(api,/row\.detalle_evaluacion\?\.calificacion_sin_redondeo\?\?row\.detalle_evaluacion\?\.valor_total_excel/);
 assert.match(api,/row\.calificacion_original_politica=a\.valor_original_ajuste/);
 assert.match(api,/calificacion:nueva, calificacion_original_politica:nueva/);
});
function uiContext(role='control_escolar',decision=true,scope='todos',allowed=false){
 const fields={jaguar_grade_precision:{value:'no'},jaguar_grade_pass:{value:'6'},jaguar_grade_fail_floor:{value:'piso'},jaguar_grade_reason:{value:'Acuerdo académico de prueba'},jaguar_grade_scope:{value:scope},jaguar_grade_save:{disabled:false}};
 const calls=[],msgs=[],downloads=[];const confirmMessages=[];
 const context=vm.createContext({S:{role},document:{getElementById:k=>fields[k]},esc:String,toast:x=>msgs.push(x),alert:x=>msgs.push(x),confirm:x=>(confirmMessages.push(x),decision),loadPage:async()=>{},jaguarDownloadGradePolicyOffice:async i=>downloads.push(i),api:async(resource,options)=>{
  if(options?.body){calls.push(options.body);return options.body.previsualizar?{execution_allowed:allowed,huella:'a'.repeat(32),ciclos:['2025-2026','2026-2027'],evaluadas:9,notas_cambian:3,suben:3,bajan:0,reprobadas:5,sin_original:9,registros_cambian:5}:{oficio_id:12,registros_actualizados:5};}
  return {periods:[],periodContext:{ciclo_escolar:'2026-2027'},gradePrecisionPolicy:{permite_decimales:false,version:1},gradePrecisionOffices:[]}[resource];
 }});
 vm.runInContext(ui.slice(ui.indexOf('async function jaguarSchoolCycleConfig(){'),ui.indexOf('async function jaguarDownloadGradePolicyOffice(')),context);
 return {context,calls,msgs,downloads,confirmMessages,fields};
}
test('Control Escolar consulta el histórico, nunca ejecuta desde el editor antiguo',async()=>{
 const {context,calls,downloads,msgs,confirmMessages,fields}=uiContext();
 assert.match(await context.jaguarSchoolCycleConfig(),/option value="todos"/);await context.jaguarSaveGradePrecision(1);
 assert.equal(calls.length,1);assert.equal(calls[0].previsualizar,true);assert.match(msgs[0],/SOLO CONSULTA/);assert.match(msgs[0],/Notas que cambian: 3/);assert.equal(confirmMessages.length,0);assert.deepEqual(downloads,[]);assert.equal(fields.jaguar_grade_save.disabled,false);
});
test('cancelar la confirmación de ciclo autorizado nunca aplica cambios',async()=>{
 const {context,calls,downloads}=uiContext('control_escolar',false,'ciclo',true);await context.jaguarSaveGradePrecision(1);assert.equal(calls.length,1);assert.equal(calls[0].previsualizar,true);assert.equal(downloads.length,0);
});
test('solo ciclo vigente autorizado permite enviar huella; vista bloqueada no ejecuta',async()=>{
 for(const allowed of [true,false]){const {context,calls,downloads}=uiContext('control_escolar',true,'ciclo',allowed);await context.jaguarSaveGradePrecision(1);assert.equal(calls.length,allowed?2:1);if(allowed){assert.equal(calls[1].huella,'a'.repeat(32));assert.deepEqual(downloads,[12]);}else assert.deepEqual(downloads,[]);}
 assert.match(sql,/execution_allowed',v_execution_allowed/);assert.match(sql,/IF v_execution_allowed IS DISTINCT FROM TRUE/);
});
test('Coordinación/Dirección no ven alcance histórico completo; API lo rechaza',async()=>{
 for(const role of ['coordinacion_academica','direccion_escolar']){const {context}=uiContext(role);assert.doesNotMatch(await context.jaguarSchoolCycleConfig(),/option value="todos"/);}
 assert.match(api,/alcance==='todos'&&role!=='control_escolar'/);assert.match(api,/role!=='control_escolar'&&decimals!==previous.permite_decimales/);
});
