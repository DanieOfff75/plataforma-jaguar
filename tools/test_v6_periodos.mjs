import assert from 'node:assert/strict';
import {normalizeNewPeriod} from '../lib/periodos_escolares.js';
const cycle='2026-2027';
const row=normalizeNewPeriod({nombre:' Segundo periodo ',numero_periodo:'2',fecha_inicio:'2026-11-05',fecha_fin:'2027-02-26'},cycle);
assert.equal(row.ciclo_escolar,cycle);
assert.equal(row.numero_periodo,2);
assert.equal(row.nombre,'Segundo periodo');
assert.equal(row.activo,true);
assert.equal(row.es_periodo_actual,false);
for(const data of [{nombre:'',numero_periodo:1},{nombre:'Otro',numero_periodo:0},{nombre:'Otro',numero_periodo:'1.2'},{nombre:'Otro',numero_periodo:2,ciclo_escolar:'2027-2028'},{nombre:'Otro',numero_periodo:2,fecha_inicio:'2027-05-20',fecha_fin:'2027-05-19'},{nombre:'Otro',numero_periodo:2,fecha_inicio:'2027-02-30'}]){
  assert.throws(()=>normalizeNewPeriod(data,cycle));
}
assert.throws(()=>normalizeNewPeriod({nombre:'Periodo',numero_periodo:1},''));
console.log('OK: 8 casos de normalización de periodos.');
