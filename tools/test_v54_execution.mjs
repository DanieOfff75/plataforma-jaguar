import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {departmentForPlanningRole,planningRejectReason} from '../lib/planeaciones_dictamen.js';
const source=await readFile(new URL('../api/data.js',import.meta.url),'utf8');
const match=source.match(/async function reviewTeacherPlanning\(admin,user,profile,body,req\)\{[\s\S]*?\n\}/);
assert(match);
const signature=Buffer.from('firma-ficticia-de-prueba');
const sha=crypto.createHash('sha256').update(signature).digest('hex');
let rpcCalls=[];
const admin={
  from(name){return {select(){return this},eq(){return this},async maybeSingle(){
    return {data:name==='planeaciones_docentes'?{id:32,estado:'enviada',docente_id:9}:{firma_path:'test/firma.png',firma_sha256:sha},error:null};
  }}} ,
  storage:{from(name){assert.equal(name,'firmas-institucionales');return {async download(){return {data:{async arrayBuffer(){return signature}},error:null}}}}},
  async rpc(name,args){assert.equal(name,'jaguar_firmar_dictamen_planeacion');rpcCalls.push(args);return {data:{estado:'enviada',aprobaciones:1},error:null}}
};
const ctx=vm.createContext({crypto,Buffer,Number,String,Object,Error,Date,departmentForPlanningRole,planningRejectReason,audit:async()=>{}});
vm.runInContext(match[0],ctx);
await assert.rejects(()=>ctx.reviewTeacherPlanning(admin,{id:'abc'},{rol:'archivo_escolar'},{id:32,dictamen:'aprobada'},{}),/cuatro departamentos/);
await assert.rejects(()=>ctx.reviewTeacherPlanning(admin,{id:'abc'},{rol:'control_escolar'},{id:32,dictamen:'rechazada',observaciones:'No'},{}),/30/);
const res=await ctx.reviewTeacherPlanning(admin,{id:'abc'},{rol:'control_escolar'},{id:32,dictamen:'aprobada',observaciones:'Correcta'},{});
assert.equal(res.aprobaciones,1);
assert.equal(rpcCalls.length,1);
assert.equal(rpcCalls[0].p_departamento,'control_escolar');
assert.equal(rpcCalls[0].p_firma_sha256,sha);
assert.equal(rpcCalls[0].p_firma_path,'test/firma.png');
console.log('PASS API execution: prohibited role, rejected vague reasons, verified signature SHA, RPC vote');
