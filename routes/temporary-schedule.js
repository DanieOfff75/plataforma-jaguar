import {createHash} from 'node:crypto';
import {evidenceId} from '../lib/jaguar_history_evidence.js';
import {temporaryRequest,proposeTemporarySchedule,validateTemporarySessions} from '../lib/jaguar360_temporary_schedule.js';
const fail=(m,status=400)=>Object.assign(Error(m),{status});
const check=fn=>{try{return fn()}catch(e){throw fail(e.message)}};
async function rpc(db,name,args){const {data,error}=await db.rpc(name,args);if(error)throw fail(error.code==='42501'?'Sin atribución.':error.code==='P0001'?error.message:error.code==='55P03'?'Operación concurrente; consulta nuevamente.':'Consulta no disponible; comprueba V11.',error.code==='42501'?403:['P0001','55P03'].includes(error.code)?409:503);return data;}
export async function temporarySchedule(req,res,{user,profile,adminClient:db}){
 const write=req.method==='POST'&&req.body?.action==='temporary_schedule',read=req.method==='GET'&&req.query?.view==='temporary_schedule';if(!write&&!read)return false;
 const experimental=process.env.JAGUAR360_TEST_SEALS==='true';
 if(write){if(profile.rol!=='coordinacion_academica')throw fail('Solo Coordinación registra propuestas.',403);try{if(!req.headers?.origin||new URL(req.headers.origin).host!==(req.headers['x-forwarded-host']||req.headers.host))throw Error()}catch{throw fail('Origen no autorizado.',403)}}
 const x=write?check(()=>temporaryRequest(req.body)):{call:check(()=>evidenceId(req.query.call))};
 const args={p_actor:user.id,p_call:x.call};let data;
 if(write&&x.operation==='cancel'){if(!experimental)throw fail('Escrituras deshabilitadas fuera de pruebas.',409);data=await rpc(db,'jaguar360_guardar_programacion_temporal',{...args,p_op:'cancel',p_version:x.version,p_reason:x.reason});}
 else{
  const source=await rpc(db,'jaguar360_fuentes_programacion_temporal',args);
  if(read)data={previous:source.previous,blocks:source.call.reglas.blocks,start:source.call.reglas.start,end:source.call.reglas.end,rosterCount:source.roster.length};
  else{
   const normalized=check(()=>validateTemporarySessions(source.call,x.sessions));let counter=0;
   // Stable tie-break for identical preview/save inputs, not a fresh draw on save.
   const seed=JSON.stringify([source.fingerprint,normalized,x.mode]);const pick=n=>createHash('sha256').update(seed+':'+counter++).digest().readUInt32BE(0)%n;
   const schedule=check(()=>proposeTemporarySchedule(source,normalized,x.mode,pick));
   if(x.operation==='preview')data={...schedule,fingerprint:source.fingerprint,version:source.previous?.version??0};
   else{if(!experimental)throw fail('Escrituras deshabilitadas fuera de pruebas.',409);if(x.fingerprint!==source.fingerprint||x.version!==(source.previous?.version??0)||schedule.state!=='proposed')throw fail('La propuesta cambió o no es viable; consulta nuevamente.',409);data=await rpc(db,'jaguar360_guardar_programacion_temporal',{...args,p_op:'save',p_version:x.version,p_reason:x.reason,p_fingerprint:x.fingerprint,p_schedule:schedule});}
  }
 }
 res.status(200).json({ok:true,data:{...data,experimental}});return true;
}
