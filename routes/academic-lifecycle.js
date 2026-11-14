import {subjectEvaluationPreview} from './subject-evaluation-preview.js';
import {schoolMovement} from './school-movement.js';
import {recoveryWorkflow} from './recovery-workflow.js';
import {recoveryCandidateRoute} from './recovery-candidate.js';
import {cycleOpening} from "./cycle-opening.js";
import {reenrollmentRoute} from "./reenrollment.js";
import {egressRoute} from './egress.js';
import {institutionalPlanning} from './institution-planning.js';
import {continuityRoute} from './continuity-review.js';
import {lateEntryObligations} from '../lib/jaguar360_continuity.js';
import {previewGradeRules} from '../lib/jaguar360_grade_policy.js';
import {trajectoryRoute} from "./trajectory-review.js";
import {temporaryResolution} from './temporary-resolution.js';
import {temporaryGroup} from './temporary-group.js';
import {temporarySchedule} from './temporary-schedule.js';
import {regularizationRoster} from './regularization-roster.js';
import {evaluateRegularization} from '../lib/jaguar360_regularization_results.js';
import {academicSeal} from './academic-seal.js';
import {academicOperations} from './academic-operations.js';
import {requireRoles} from '../lib/_admin.js';
import {validateEvidence,evidenceId} from '../lib/jaguar_history_evidence.js';
import {validatePlan,validatePolicy,validateCycle,accreditation,draftFromTemplate,repetitionDecision,unifiedGrade,curriculumAccreditation} from '../lib/jaguar_academic_lifecycle.js';
const roles=['direccion_escolar','coordinacion_academica','control_escolar','control'];
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
async function read(q){const {data,error}=await q;if(error)throw fail(error.code==='42P01'||error.code==='PGRST202'?'Instala primero la migración de planificación.':'No fue posible consultar la planificación.',503);return data}
function validate(fn){try{return fn()}catch(e){throw fail(e.message)}}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 try{
 const auth=await requireRoles(req,roles);
 const {user,profile,adminClient:db}=auth;
 if(await subjectEvaluationPreview(req,res,auth))return;
 if(await schoolMovement(req,res,auth))return;
 if(await cycleOpening(req,res,auth))return;
 if(await institutionalPlanning(req,res,auth))return;
 if(await egressRoute(req,res,auth))return;
 if(await reenrollmentRoute(req,res,auth))return;
 if(await continuityRoute(req,res,auth))return;
 if(await trajectoryRoute(req,res,auth))return;
 if(await temporaryResolution(req,res,auth))return;
 if(await temporaryGroup(req,res,auth))return;
 if(await temporarySchedule(req,res,auth))return;
 if(await recoveryWorkflow(req,res,auth))return;
 if(await recoveryCandidateRoute(req,res,auth))return;
 if(await regularizationRoster(req,res,auth))return;
 if(await academicSeal(req,res,auth))return;
 if(await academicOperations(req,res,auth))return;
 if(req.method==='GET'){
  if(req.query?.view==='curriculum_catalog'){
   const rows=await read(db.from('materias').select('id::text,nombre,clave,grado,grados,activa,horas_semana').eq('activa',true).order('nombre').limit(500));
   return res.status(200).json({ok:true,data:rows.map(r=>({...r,id:String(r.id)}))});
  }
  if(req.query?.view==='template'){
   const target=validate(()=>validateCycle(req.query.target)),source=validate(()=>validateCycle(req.query.source));
   const row=await read(db.from('jaguar360_planes_ciclo').select('ciclo,version,estado,plan').eq('ciclo',source).eq('estado','validada_para_planificacion').order('version',{ascending:false}).limit(1).maybeSingle());
   if(!row)throw fail('No existe una planificación validada de ese ciclo. Puedes comenzar desde cero; los datos históricos no se reconstruyen automáticamente.',404);
   return res.status(200).json({ok:true,data:validate(()=>draftFromTemplate(row,target))});
  }
  if(['evidence','evidence_content'].includes(req.query?.view)){
   const period=validate(()=>evidenceId(req.query.period));
   if(req.query.view==='evidence_content'){
    const type=req.query.type,version=Number(req.query.version);
    if(!['padron','sesiones','marcas','cualitativas'].includes(type)||!Number.isSafeInteger(version)||version<1)throw fail('Tipo o versión inválida.');
    const row=await read(db.from('jaguar360_evidencias_periodo').select('contenido').eq('periodo_id',period).eq('tipo',type).eq('version',version).maybeSingle());
    if(!row)throw fail('Evidencia no encontrada.',404);
    return res.status(200).json({ok:true,data:row.contenido});
   }
   const {data,error}=await db.rpc('jaguar360_conciliar_evidencia',{p_actor:user.id,p_periodo:period});
   if(error)throw fail(error.code==='42501'?'Sin atribución.':'No se pudo conciliar la evidencia. Comprueba la migración V3.',error.code==='42501'?403:503);
   return res.status(200).json({ok:true,data});
  }
  if(req.query?.view==='verification'){
   const period=validate(()=>evidenceId(req.query.period));
   const {data,error}=await db.rpc('jaguar360_verificar_cierre',{p_actor:user.id,p_periodo:period});
   if(error)throw fail(error.code==='42501'?'Sin atribución.':error.code==='P0001'?error.message:'No se pudo verificar el periodo · código '+(String(error.code||'').match(/^[A-Z0-9]{5,10}$/)?.[0]||'sin código')+'.',error.code==='42501'?403:error.code==='P0001'?409:503);
   return res.status(200).json({ok:true,data});
  }
  if(req.query?.view==='closure'){
   const {data,error}=await db.rpc('jaguar360_diagnostico_cierre',{p_actor:user.id});
   if(error)throw fail(error.code==='P0001'?error.message:'No se pudo consultar el diagnóstico. Comprueba la migración de diagnóstico V2.',error.code==='P0001'?409:503);
   return res.status(200).json({ok:true,data});
  }
  const cycle=req.query?.cycle?validate(()=>validateCycle(req.query.cycle)):null;
  if(cycle){const rows=await read(db.from('jaguar360_planes_ciclo').select('*').eq('ciclo',cycle).order('version',{ascending:false}).limit(50));const current=rows.find(r=>r.estado==='validada_para_planificacion');if(current)current.effectivePlan=await read(db.rpc('jaguar360_plan_con_modos',{p_plan:current.plan,p_ciclo:cycle}));return res.status(200).json({ok:true,data:{rows}})}
  const [periods,plans]=await Promise.all([read(db.from('periodos_escolares').select('id,nombre,ciclo_escolar,numero_periodo,fecha_inicio,fecha_fin,activo,es_periodo_actual').order('id',{ascending:false}).limit(100)),read(db.from('jaguar360_planes_ciclo').select('ciclo,version,estado,actor_nombre,creado_at').order('id',{ascending:false}).limit(100))]);
  return res.status(200).json({ok:true,data:{periods,plans}});
 }
 if(req.method!=='POST')throw fail('Método no permitido.',405);
 const b=req.body||{};
 if(b.action==='preview_precision'){
  return res.status(200).json({ok:true,data:validate(()=>previewGradeRules(b.raw,validatePolicy(b.policy)))});
 }
 if(b.action==='simulate'){
  // Sin IDs de alumnos ni datos personales; no representa una acreditación real.
  const plan=validate(()=>validatePlan(b.plan));const p=plan.policy;
  const result=validate(()=>{
   if(b.kind==='late_entry')return lateEntryObligations(plan,b.scenario||{});
   if(b.kind==='grade_precision')return previewGradeRules(b.raw,p);
   if(b.kind==='regularization')return evaluateRegularization(plan,b.call,b.scenario);
   if(b.kind==='curriculum')return curriculumAccreditation(plan,b.subjectKey,b.rows,{final:b.final??null});
   if(b.kind==='repetition')return repetitionDecision(b.rows,p,{regularizationFinished:b.regularizationFinished===true});
   if(b.kind==='equivalence')return unifiedGrade(b.rows,p);
   if(b.kind!=null&&b.kind!=='accreditation')throw Error('Simulación desconocida.');
   return accreditation(b.rows,p);
  });
  return res.status(200).json({ok:true,data:result});
 }
 if(b.action==='verify_closure'){
  if(profile.rol!=='direccion_escolar')throw fail('Solo Dirección puede registrar la verificación.',403);
  const origin=req.headers?.origin,host=req.headers?.['x-forwarded-host']||req.headers?.host;
  if(!origin||!host||new URL(origin).host!==host)throw fail('Origen no autorizado.',403);
  const period=validate(()=>evidenceId(b.period));
  if(typeof b.fingerprint!=='string'||!/^[a-f0-9]{32}$/.test(b.fingerprint)||b.confirmed!==true||typeof b.reason!=='string'||b.reason.trim().length<15||b.reason.length>1500)throw fail('Confirma la verificación y escribe un motivo válido.');
  const {data,error}=await db.rpc('jaguar360_verificar_cierre',{p_actor:user.id,p_periodo:period,p_huella:b.fingerprint,p_motivo:b.reason.trim()});
  if(error)throw fail(error.code==='42501'?'Sin atribución.':error.code==='P0001'?error.message:error.code==='55P03'?'Hay escrituras en curso; vuelve a consultar.':'No se pudo guardar la verificación. Comprueba la migración V6.',error.code==='42501'?403:['P0001','55P03'].includes(error.code)?409:503);
  return res.status(200).json({ok:true,data});
 }
 if(b.action==='evidence'){
  const origin=req.headers?.origin,host=req.headers?.['x-forwarded-host']||req.headers?.host;
  if(!origin||!host||new URL(origin).host!==host)throw fail('Origen no autorizado.',403);
  const period=validate(()=>evidenceId(b.period)),type=b.type,operation=b.operation,version=b.version;
  if(!['padron','sesiones','marcas','cualitativas'].includes(type)||!['proponer','revisar','devolver'].includes(operation)||!Number.isSafeInteger(version)||version<0||b.confirmed!==true||typeof b.reason!=='string'||b.reason.trim().length<15||b.reason.length>1500)throw fail('Acción, motivo o versión inválidos.');
  const allowed=operation==='proponer'?(['padron','cualitativas'].includes(type)?['control_escolar','control'].includes(profile.rol):profile.rol==='coordinacion_academica'):profile.rol==='direccion_escolar';
  if(!allowed)throw fail('Atribución insuficiente.',403);
  const content=operation==='proponer'?validate(()=>validateEvidence(type,b.content)):null;
  if(content&&Buffer.byteLength(JSON.stringify(content),'utf8')>2000000)throw fail('Evidencia mayor a 2 MB.',413);
  const {data,error}=await db.rpc('jaguar360_registrar_evidencia',{p_actor:user.id,p_periodo:period,p_tipo:type,p_version:version,p_accion:operation,p_contenido:content,p_motivo:b.reason.trim()});
  if(error)throw fail(error.code==='42501'?'Atribución insuficiente.':error.code==='P0001'?error.message:'No se pudo registrar la evidencia. Comprueba la migración V3.',error.code==='42501'?403:error.code==='P0001'?409:503);
  return res.status(200).json({ok:true,data});
 }
 if(!['proponer','validar'].includes(b.action))throw fail('Acción inválida.');
 if(!['direccion_escolar','coordinacion_academica'].includes(profile.rol)||b.action==='validar'&&profile.rol!=='direccion_escolar')throw fail('Atribución insuficiente.',403);
 const origin=req.headers?.origin,host=req.headers?.['x-forwarded-host']||req.headers?.host;
 if(!origin||!host||new URL(origin).host!==host)throw fail('Origen no autorizado.',403);
 const cycle=validate(()=>validateCycle(b.cycle)),version=b.version;
 if(!Number.isSafeInteger(version)||version<0||typeof b.reason!=='string'||b.reason.trim().length<15||b.reason.length>1500||b.confirmed!==true)throw fail('Confirma la versión y escribe un motivo válido.');
 const plan=b.action==='proponer'?validate(()=>validatePlan(b.plan)):null;
 if(plan&&Buffer.byteLength(JSON.stringify(plan),'utf8')>1000000)throw fail('Plan demasiado extenso.',413);
 if(plan&&plan.cycle!==cycle)throw fail('Ciclo inconsistente.');
 const {data,error}=await db.rpc('jaguar360_registrar_plan',{p_actor:user.id,p_ciclo:cycle,p_version:version,p_accion:b.action,p_plan:plan,p_motivo:b.reason.trim()});
 if(error)throw fail(error.code==='P0001'?error.message:'No se pudo registrar la versión. Comprueba la migración.',error.code==='P0001'?409:503);
 return res.status(200).json({ok:true,data});
 }catch(e){return res.status(e.status||500).json({ok:false,error:e.status?e.message:'Error de planificación institucional.'})}
}
