import {evidenceId} from '../lib/jaguar_history_evidence.js';
import {validateCycle} from '../lib/jaguar_academic_lifecycle.js';
import {trajectoryReview} from '../lib/jaguar360_trajectory.js';
import {continuityDecision} from '../lib/jaguar360_continuity.js';
const err=(message,status=400)=>Object.assign(Error(message),{status});
const checked=f=>{try{return f()}catch(e){throw err(e.message)}};
export async function egressRoute(req,res,{user,profile,adminClient:db}){
 const b=req.body||{},q=req.query||{},write=req.method==='POST'&&b.action==='formalize_egress';if(!write&&!(req.method==='GET'&&q.view==='egress_status'))return false;
 const ce=['control_escolar','control'].includes(profile.rol),experimental=process.env.JAGUAR360_TEST_SEALS==='true';if(!ce&&profile.rol!=='direccion_escolar'||write&&!ce)throw err('Sin atribución.',403);
 if(write){try{if(!req.headers?.origin||new URL(req.headers.origin).host!==(req.headers['x-forwarded-host']||req.headers.host))throw Error()}catch{throw err('Origen no autorizado.',403)}
 if(!experimental)throw err('Solo entorno aislado de pruebas.',409);
 if(b.confirmed!==true||typeof b.fingerprint!=='string'||!/^[a-f0-9]{32}$/.test(b.fingerprint)||typeof b.reference!=='string'||b.reference.trim().length<5||b.reference.trim().length>300||typeof b.reason!=='string'||b.reason.trim().length<15||b.reason.trim().length>1500)throw err('Confirmación, huella, referencia y motivo requeridos.');}
 const x=write?b:q,student=checked(()=>evidenceId(x.student)),cycle=checked(()=>validateCycle(x.cycle)),args={p_actor:user.id,p_ciclo:cycle,p_alumno:student};
 async function run(params){const {data,error}=await db.rpc('jaguar360_egreso',params);if(error)throw err(error.code==='42501'?'Sin atribución.':error.code==='P0001'?error.message:'No se pudo formalizar o consultar egreso. Comprueba V20.',error.code==='42501'?403:['P0001','55P03','23505'].includes(error.code)?409:503);return data;}
 let d=await run(args);const decision=()=>checked(()=>continuityDecision(trajectoryReview(d.context,student),d.context.source.plan));
 const eligible=()=>d.eligible===true&&decision().state==='academic_completion'&&!d.record;
 if(write){if(!eligible()||d.context.fingerprint!==b.fingerprint)throw err('Egreso no elegible o evidencia modificada.',409);d=await run({...args,p_huella:b.fingerprint,p_referencia:b.reference.trim(),p_motivo:b.reason.trim()});}
 res.status(200).json({ok:true,data:{student,cycle,decision:decision(),fingerprint:d.context.fingerprint,record:d.record,eligible:eligible(),canFormalize:ce&&experimental&&eligible(),experimental}});return true;
}
