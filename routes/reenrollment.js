import {evidenceId} from '../lib/jaguar_history_evidence.js';
import {validateCycle} from '../lib/jaguar_academic_lifecycle.js';
import {trajectoryReview} from '../lib/jaguar360_trajectory.js';
import {continuityDecision} from '../lib/jaguar360_continuity.js';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const checked=f=>{try{return f()}catch(e){throw fail(e.message)}};
const fingerprint=v=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
const validText=(v,min,max)=>typeof v==='string'&&v.trim().length>=min&&v.trim().length<=max;
export async function reenrollmentRoute(req,res,{user,profile,adminClient:db}){
 const b=req.body||{},q=req.query||{},action=b.action,view=q.view;
 const binding=req.method==='POST'&&action==='bind_cycle_group',enroll=req.method==='POST'&&action==='formalize_reenrollment',getGroup=req.method==='GET'&&view==='cycle_group',getEnrollment=req.method==='GET'&&view==='reenrollment';
 if(!binding&&!enroll&&!getGroup&&!getEnrollment)return false;
 const ce=['control_escolar','control'].includes(profile.rol),dir=profile.rol==='direccion_escolar',experimental=process.env.JAGUAR360_TEST_SEALS==='true';
 if(!ce&&!dir||binding&&!dir||enroll&&!ce)throw fail('Sin atribución.',403);
 if(binding||enroll){
  try{if(!req.headers?.origin||new URL(req.headers.origin).host!==(req.headers['x-forwarded-host']||req.headers.host))throw Error()}catch{throw fail('Origen no autorizado.',403)}
  if(!experimental)throw fail('Solo entorno aislado de pruebas.',409);
  if(b.confirmed!==true||!fingerprint(b.fingerprint)||!validText(b.reference,5,300))throw fail('Confirmación, huella y referencia requeridas.');
 }
 const x=binding||enroll?b:q,cycle=checked(()=>validateCycle(x.cycle)),group=checked(()=>evidenceId(x.group)),args={p_actor:user.id,p_ciclo:cycle,p_grupo:group};
 async function rpc(name,params){const {data,error}=await db.rpc(name,params);if(error)throw fail(error.code==='42501'?'Sin atribución.':error.code==='P0001'?error.message:'No se pudo consultar o formalizar. Comprueba V21.',error.code==='42501'?403:['P0001','55P03','23505'].includes(error.code)?409:503);return data;}
 if(binding||getGroup){
  if(binding&&(!Number.isInteger(b.capacity)||b.capacity<1||b.capacity>500))throw fail('Cupo entero entre 1 y 500 requerido.');
  const data=await rpc('jaguar360_destino_ciclo',binding?{...args,p_cupo:b.capacity,p_huella:b.fingerprint,p_referencia:b.reference.trim()}:args);
  res.status(200).json({ok:true,data:{...data,canBind:dir&&experimental&&data.valid===true&&data.empty===true&&!data.binding,experimental}});return true;
 }
 const student=checked(()=>evidenceId(x.student)),params={...args,p_alumno:student};
 if(enroll&&(!fingerprint(b.destinationFingerprint)||!validText(b.reason,15,1500)))throw fail('Huella del destino y motivo requeridos.');
 let d=await rpc('jaguar360_reinscribir',params);
 const decision=()=>checked(()=>continuityDecision(trajectoryReview(d.context,student),d.context.source.plan));
 const eligible=()=>d.eligible===true&&d.confirmation?.state==='confirmada'&&['promotion_eligible','repeat_grade'].includes(decision().state)&&!d.record;
 if(enroll){if(!eligible()||d.context.fingerprint!==b.fingerprint||d.destination?.fingerprint!==b.destinationFingerprint)throw fail('Dictamen, grupo o evidencia modificada.',409);
  d=await rpc('jaguar360_reinscribir',{...params,p_huella:b.fingerprint,p_destino_huella:b.destinationFingerprint,p_referencia:b.reference.trim(),p_motivo:b.reason.trim()});if(!d.record||d.record.after?.grupo_id!==group)throw fail('No se confirmó el registro de reinscripción.',409);}
 res.status(200).json({ok:true,data:{student,cycle,decision:decision(),fingerprint:d.context.fingerprint,destination:d.destination,record:d.record,confirmation:d.confirmation??null,reason:d.reason,eligible:eligible(),canEnroll:ce&&experimental&&eligible(),experimental}});return true;
}
