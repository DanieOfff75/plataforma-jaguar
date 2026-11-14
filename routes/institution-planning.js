import {calendarSessions} from '../lib/jaguar360_calendar_sessions.js';
import {generateWeek} from '../lib/jaguar360_week_generator.js';
import {projectCalendar} from '../lib/jaguar360_calendar_projection.js';
import {institutionalRequest} from '../lib/jaguar360_institution.js';
import {ordinarySchedule} from '../lib/jaguar360_ordinary_schedule.js';
import {validateCycle} from '../lib/jaguar_academic_lifecycle.js';
import {evidenceId} from '../lib/jaguar_history_evidence.js';
const fail=(m,status=400)=>Object.assign(Error(m),{status});
const validate=fn=>{try{return fn()}catch(e){throw fail(e.message)}};
async function rpc(db,n,args){const {data,error}=await db.rpc(n,args);if(error)throw fail(error.code==='42501'?'Sin atribución.':error.code==='P0001'?error.message:'No fue posible consultar o guardar. Comprueba V17.',error.code==='42501'?403:['P0001','55P03','23505'].includes(error.code)?409:503);return data;}
function guard(req){try{if(!req.headers?.origin||new URL(req.headers.origin).host!==(req.headers['x-forwarded-host']||req.headers.host))throw Error()}catch{throw fail('Origen no autorizado.',403)}}
const reason=v=>{if(typeof v!=='string'||v.trim().length<15||v.trim().length>1500)throw fail('Motivo requerido.');return v.trim()};
const reference=v=>{if(typeof v!=='string'||v.trim().length<5||v.trim().length>300)throw fail('Referencia requerida.');return v.trim()};
export async function institutionalPlanning(req,res,{user,profile,adminClient:db}){
 const b=req.body||{},q=req.query||{},role=profile.rol,post=req.method==='POST',get=req.method==='GET',experimental=process.env.JAGUAR360_TEST_SEALS==='true';
 const gov=get&&q.view==='governance'||post&&b.action==='governance';
 const schedule=get&&['ordinary_schedule','calendar_plans','schedule_publication'].includes(q.view)||post&&b.action==='ordinary_schedule';
 if(!gov&&!schedule)return false;
 if(gov&&!['direccion_escolar','control_escolar','control'].includes(role)||schedule&&!['direccion_escolar','coordinacion_academica'].includes(role))throw fail('Sin atribución.',403);
 if(post){guard(req);if(!experimental&&!(schedule&&['preview','generate','calendar_preview'].includes(b.operation)))throw fail('Solo entorno aislado de pruebas.',409);}
 let data;
 if(gov){const args={p_actor:user.id};if(post){const x=validate(()=>institutionalRequest(b));if(x.op==='propose'?!['control_escolar','control'].includes(role):role!=='direccion_escolar')throw fail('Sin atribución.',403);Object.assign(args,{p_op:x.op,p_id:x.id??null,p_version:x.version??null,p_record:x.record??null,p_reference:x.reference,p_reason:x.reason});}data=await rpc(db,'jaguar360_gobierno',args);}
 else{
  const cycle=validate(()=>validateCycle(post?b.cycle:q.cycle)),args={p_actor:user.id,p_ciclo:cycle};
  if(!post)data=await rpc(db,q.view==='schedule_publication'?'jaguar360_publicar_horario':q.view==='calendar_plans'?'jaguar360_calendario':'jaguar360_semana',args);
  else if(b.operation==='publish'){
   if(role!=='direccion_escolar'||b.confirmed!==true||typeof b.fingerprint!=='string'||! /^[a-f0-9]{32}$/.test(b.fingerprint))throw fail('Dirección, confirmación y huella requeridas.',403);
   data=await rpc(db,'jaguar360_publicar_horario',{...args,p_huella:b.fingerprint,p_referencia:reference(b.reference),p_motivo:reason(b.reason)});
  }
  else if(b.operation==='generate'){
   if(role!=='coordinacion_academica')throw fail('Solo Coordinación genera horarios.',403);
   const context=await rpc(db,'jaguar360_contexto_semana',args);data={generation:validate(()=>generateWeek(context,b.proposal||{})),fingerprint:context.fingerprint};
  }else if(['calendar_preview','calendar_save'].includes(b.operation)){
   const id=validate(()=>evidenceId(b.id)),state=await rpc(db,'jaguar360_semana',args),row=state.rows.find(x=>x.id===id&&x.current&&x.state==='reviewed');
   if(!row)throw fail('Selecciona una semana revisada vigente.',409);
   const projection=validate(()=>projectCalendar(state.context,row.proposal,b.calendar||{}));
   if(b.operation==='calendar_preview')data={projection,fingerprint:state.context.fingerprint};
   else{
    if(role!=='coordinacion_academica'||b.confirmed!==true)throw fail('Sin atribución o confirmación.',403);
    if(b.fingerprint!==state.context.fingerprint)throw fail('Catálogo modificado.',409);
    const events={suspensions:(b.calendar?.suspensions||[]).map(({date,reference})=>({date,reference:reference.trim()})).sort((a,b)=>a.date.localeCompare(b.date)),replacements:(b.calendar?.replacements||[]).map(({original,date,start,reference})=>({original,date,start,reference:reference.trim()})).sort((a,b)=>a.original.localeCompare(b.original))};
    const {rows,...snapshot}=projection;
    data=await rpc(db,'jaguar360_calendario',{...args,p_op:'save',p_week:id,p_fingerprint:b.fingerprint,p_proposal:{...snapshot,events},p_reference:reference(b.reference),p_reason:reason(b.reason)});
   }
  }else if(b.operation==='calendar_import'){
    if(role!=='coordinacion_academica'||b.confirmed!==true)throw fail('Sin atribución o confirmación.',403);
    const id=validate(()=>evidenceId(b.id)),cal=await rpc(db,'jaguar360_calendario',args),state=await rpc(db,'jaguar360_semana',args),row=cal.rows.find(x=>x.id===id),week=state.rows.find(x=>x.id===row?.week);
    if(!row||!week)throw fail('Calendario o semana fuera del listado vigente.',409);
    const evidence=validate(()=>calendarSessions(state.context,week,row,{withTeachers:true}));
    data=await rpc(db,'jaguar360_importar_calendario',{...args,p_calendario:id,p_huella:state.context.fingerprint,p_contenido:evidence,p_motivo:reason(b.reason)});
  }else if(['calendar_review','calendar_reject'].includes(b.operation)){
   if(role!=='direccion_escolar'||b.confirmed!==true)throw fail('Sin atribución o confirmación.',403);
   data=await rpc(db,'jaguar360_calendario',{...args,p_op:b.operation==='calendar_review'?'review':'reject',p_id:validate(()=>evidenceId(b.id)),p_reference:reference(b.reference),p_reason:reason(b.reason)});
  }else if(['preview','save'].includes(b.operation)){
   if(role!=='coordinacion_academica')throw fail('Solo Coordinación propone horarios.',403);
   const context=await rpc(db,'jaguar360_contexto_semana',args),proposal=validate(()=>ordinarySchedule(context,b.proposal));
   if(b.operation==='preview')data={proposal,fingerprint:context.fingerprint};
   else{if(b.confirmed!==true||!proposal.compatible||b.fingerprint!==context.fingerprint)throw fail('Propuesta incompatible o evidencia modificada. Consulta otra vez.',409);data=await rpc(db,'jaguar360_semana',{...args,p_op:'save',p_fingerprint:context.fingerprint,p_proposal:proposal,p_reason:reason(b.reason)});}
  }else if(['review','reject'].includes(b.operation)){
   if(role!=='direccion_escolar'||b.confirmed!==true)throw fail('Sin atribución o confirmación.',403);
   data=await rpc(db,'jaguar360_semana',{...args,p_op:b.operation,p_id:validate(()=>evidenceId(b.id)),p_reason:reason(b.reason)});
  }else throw fail('Operación inválida.');
 }
 res.status(200).json({ok:true,data:{...data,experimental}});return true;
}
