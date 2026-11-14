import {validateCycle} from '../lib/jaguar_academic_lifecycle.js';
import {evidenceId} from '../lib/jaguar_history_evidence.js';
import {projectVerifiedRecord,validateCall,summarizeTeacherSchedule} from '../lib/jaguar360_operations.js';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
function checked(fn){try{return fn()}catch(e){throw fail(e.message)}}
const version=(v,zero=false)=>{if(!Number.isInteger(v)||v<(zero?0:1)||v>2147483647)throw fail('Versión inválida.');return v};
async function rpc(db,name,args){const {data,error}=await db.rpc(name,args);if(error)throw fail(error.code==='42501'?'Sin atribución.':error.code==='P0001'?error.message:'No se pudo consultar o guardar. Comprueba la migración V7.',error.code==='42501'?403:error.code==='P0001'?409:503);return data}
export async function academicOperations(req,res,{user,profile,adminClient:db}){
 const b=req.body||{},view=req.query?.view;
 if(req.method==='GET'&&['calls','projection','teacher_workload'].includes(view)){
  const cycle=checked(()=>validateCycle(req.query.cycle));
  const args={p_actor:user.id,p_ciclo:cycle};let data;
  if(view==='calls')data=await rpc(db,'jaguar360_consultar_convocatorias',args);
  if(view==='projection'){
   const source=await rpc(db,'jaguar360_fuentes_acreditacion',{...args,p_alumno:checked(()=>evidenceId(req.query.student))});
   data={...checked(()=>projectVerifiedRecord(source.plan,source.periods)),cycle,planVersion:source.version,periods:source.periods.map(r=>({number:r.number,verified:r.verified})),mapping:'Catálogo existente como referencia. No acredita oficialmente ni confirma equivalencias históricas.'};
  }
  if(view==='teacher_workload'){
   if(!['direccion_escolar','coordinacion_academica'].includes(profile.rol))throw fail('Sin atribución.',403);
   const source=await rpc(db,'jaguar360_fuentes_carga_docente',args);
   data={...checked(()=>summarizeTeacherSchedule(source.rows)),unscoped:source.unscoped,cycle};
  }
  res.status(200).json({ok:true,data});return true;
 }
 if(req.method!=='POST'||b.action!=='regularization_call')return false;
 if(profile.rol!=='coordinacion_academica')throw fail('Solo Coordinación gestiona convocatorias.',403);
 const origin=req.headers?.origin,host=req.headers?.['x-forwarded-host']||req.headers?.host;
 try{if(!origin||!host||new URL(origin).host!==host)throw Error()}catch{throw fail('Origen no autorizado.',403)}
 const cycle=checked(()=>validateCycle(b.cycle)),op=b.operation;
 if(!['proponer','autorizar','cancelar'].includes(op)||b.confirmed!==true||typeof b.reason!=='string'||b.reason.trim().length<15||b.reason.length>1500)throw fail('Acción o motivo inválido.');
 let rules=null,planVersion=null,id=null;
 if(op==='proponer'){
  planVersion=version(b.planVersion);
  const {data,error}=await db.from('jaguar360_planes_ciclo').select('plan').eq('ciclo',cycle).eq('version',planVersion).eq('estado','validada_para_planificacion').maybeSingle();
  if(error||!data)throw fail('Plan validado no disponible.',409);
  const effective=await rpc(db,'jaguar360_plan_con_modos',{p_plan:data.plan,p_ciclo:cycle});
  rules=checked(()=>validateCall(b.rules,effective));
 }else id=checked(()=>evidenceId(b.id));
 const data=await rpc(db,'jaguar360_registrar_convocatoria',{p_actor:user.id,p_ciclo:cycle,p_plan_version:planVersion,p_accion:op,p_id:id,p_version:version(b.version,op==='proponer'),p_reglas:rules,p_motivo:b.reason.trim()});
 res.status(200).json({ok:true,data});return true;
}
