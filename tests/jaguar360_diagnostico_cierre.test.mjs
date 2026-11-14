import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeNewPeriod} from '../lib/periodos_escolares.js';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('periodos ordinarios limitados a uno a seis',()=>{
 for(let i=1;i<=6;i++) assert.equal(normalizeNewPeriod({nombre:'P'+i,numero_periodo:i},'2026-2027').numero_periodo,i);
 for(const i of [0,7,100,-1,1.5])assert.throws(()=>normalizeNewPeriod({nombre:'P',numero_periodo:i},'2026-2027'));
});
test('API bloquea avance y reversión masivos antes de ejecutar mutaciones',()=>{
 const s=read('api/data.js');for(const r of ['advanceSchoolCycle','revertSchoolCycle']){
 const start=s.indexOf(`req.body?.resource==='${r}'`);assert.ok(start>0);const h=s.slice(start,s.indexOf('\n    }',start));assert.match(h,/status\(409\)/);assert.doesNotMatch(h,new RegExp('await '+r+'\\('));assert.match(h,/status\(403\)/);
 }
});
test('RPC sólo lectura, acceso de servidor, actor vigente y cierre nunca inferido',()=>{
 const s=read('sql/ITHLA_JAGUAR_360_DIAGNOSTICO_CIERRE_V2.sql');assert.match(s,/STABLE SECURITY DEFINER SET search_path=''/);assert.match(s,/activo IS TRUE AND rol IN/);assert.match(s,/REVOKE ALL.+FROM PUBLIC,anon,authenticated/);assert.match(s,/GRANT EXECUTE.+TO service_role/);assert.doesNotMatch(s,/\b(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE)\s+public\./i);assert.match(s,/'cierre_disponible',false/);assert.match(s,/'padron_historico_verificado',false/);assert.match(s,/'sesiones_verificadas',false/);assert.match(s,/v_count<>1/);
});
test('nota cero cuenta como registrada; ausencias de registros no se interpretan como faltas',()=>{
 const s=read('sql/ITHLA_JAGUAR_360_DIAGNOSTICO_CIERRE_V2.sql');assert.match(s,/count\(c.calificacion\)/);assert.match(s,/LEFT JOIN public.calificaciones/);assert.match(s,/SELECT DISTINCT p.id AS periodo_id,a.grupo_materia_id AS gm_id,a.fecha/);assert.match(s,/count\(a.id\) AS registradas/);assert.match(s,/fuera_padron/);assert.match(s,/a.estado_escolar='suspendido'/);
});
test('endpoint autorizado y UI de diagnóstico sin habilitar cierre',()=>{
 const route=read('routes/academic-lifecycle.js');assert.match(route,/requireRoles\(req,roles\)/);assert.match(route,/view==='closure'/);assert.match(route,/rpc\('jaguar360_diagnostico_cierre',\{p_actor:user.id\}\)/);const ui=read('assets/jaguar-academic-lifecycle.js');assert.match(ui,/Cierre definitivo no disponible/);assert.match(ui,/Los días sin ningún registro aún no se pueden verificar/);assert.match(ui,/E\(g.clave\)/);assert.match(ui,/if\(!target.isConnected\)return/);
});
