import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sessionStatus,renewSession} from '../lib/ithla_session.js';
const sid='11111111-2222-4333-8444-555555555555';
function mockSession({id=sid,lastAgo=4,absoluteIn=60,role='docente',revoked=false}={}){
 const now=Date.now();const row={id,usuario_id:'U',aplicacion:'jaguar',ultimo_uso:new Date(now-lastAgo*60000).toISOString(),vence_absoluto:new Date(now+absoluteIn*60000).toISOString(),revocada_en:revoked?new Date(now).toISOString():null};let updates=0;
 const admin={from(table){if(table==='ithla_config')return {select(){return this},eq(){return this},async single(){return {data:{valor:{}},error:null}}};
  if(table!=='ithla_sesiones')throw Error('Unexpected table');
  const query={
   update(changes){this.changes=changes;updates++;return this},select(){return this},eq(k,v){this.filters??=[];this.filters.push([k,v]);return this},is(k,v){this.filters??=[];this.filters.push([k,v]);return this},gt(k,v){this.checks??=[];this.checks.push([k,v]);return this},
   async maybeSingle(){if(this.filters?.some(([k,v])=>row[k]!==v)||row.revocada_en||this.checks?.some(([k,v])=>Date.parse(row[k])<=Date.parse(v)))return {data:null,error:null};
    if(this.changes)Object.assign(row,this.changes);return {data:{...row},error:null};}
  };return query;}};
 return {admin,row,get updates(){return updates}};
}
const req={headers:{'x-ithla-session':sid}};
test('consultar estado no prolonga la sesión',async()=>{const m=mockSession({lastAgo:8,absoluteIn:60});const r=await sessionStatus(req,m.admin,'U','docente','jaguar');assert.equal(m.updates,0);assert.ok(r.remaining_seconds>21*60&&r.remaining_seconds<=22*60);});
test('renovar actualiza inactividad sin superar el máximo absoluto',async()=>{const m=mockSession({lastAgo:20,absoluteIn:2});const original=m.row.vence_absoluto;const r=await renewSession(req,m.admin,'U','docente','jaguar');assert.equal(m.row.vence_absoluto,original);assert.ok(r.remaining_seconds<=120);assert.ok(m.updates===1);});
test('deniega sesión vencida por inactividad',async()=>{const m=mockSession({lastAgo:31,absoluteIn:90});await assert.rejects(()=>renewSession(req,m.admin,'U','docente','jaguar'),e=>e.status===401);});
test('deniega sesión vencida por máximo absoluto',async()=>{const m=mockSession({lastAgo:1,absoluteIn:-1});await assert.rejects(()=>sessionStatus(req,m.admin,'U','docente','jaguar'),e=>e.status===401);});
test('deniega id de sesión falso',async()=>{const m=mockSession();await assert.rejects(()=>sessionStatus({headers:{'x-ithla-session':'invalida'}},m.admin,'U','docente','jaguar'),e=>e.status===401);});
test('deniega identidad y aplicación diferentes',async()=>{const m=mockSession();await assert.rejects(()=>sessionStatus(req,m.admin,'otra','docente','jaguar'),e=>e.status===401);await assert.rejects(()=>sessionStatus(req,m.admin,'U','docente','admisiones'),e=>e.status===401);});
