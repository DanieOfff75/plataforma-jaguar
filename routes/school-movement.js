import {evidenceId} from '../lib/jaguar_history_evidence.js';
import {validateCycle} from '../lib/jaguar_academic_lifecycle.js';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const checked=fn=>{try{return fn()}catch(e){throw fail(e.message)}};
const refOk=(v,min,max)=>typeof v==='string'&&v.trim().length>=min&&v.trim().length<=max;
export async function schoolMovement(req,res,{user,profile,adminClient:db}){
 const b=req.body||{},q=req.query||{},write=req.method==='POST'&&b.action==='school_movement';
 if(!write&&!(req.method==='GET'&&q.view==='school_movement'))return false;
 const ce=['control_escolar','control'].includes(profile.rol),dir=profile.rol==='direccion_escolar',experimental=process.env.JAGUAR360_TEST_SEALS==='true';
 if(!ce&&!dir)throw fail('Sin atribución.',403);
 const x=write?b:q,student=checked(()=>evidenceId(x.student)),cycle=checked(()=>validateCycle(x.cycle)),type=x.type;
 if(!['baja','traslado','retorno'].includes(type)||(type!=='retorno'&&x.group!=null&&x.group!==''))throw fail('Tipo o destino inválido.');
 const group=type==='retorno'?checked(()=>evidenceId(x.group)):null;
 const args={p_actor:user.id,p_ciclo:cycle,p_alumno:student,p_tipo:type,p_grupo:group};
 if(write){
  if((b.operation==='propose'&&!ce)||(['approve','reject'].includes(b.operation)&&!dir))throw fail('Sin atribución.',403);
  if(!['propose','approve','reject'].includes(b.operation))throw fail('Operación inválida.');
  try{if(!req.headers?.origin||new URL(req.headers.origin).host!==(req.headers['x-forwarded-host']||req.headers.host))throw Error()}catch{throw fail('Origen no autorizado.',403)}
  if(!experimental)throw fail('Solo entorno aislado de pruebas.',409);
  if(b.confirmed!==true||typeof b.fingerprint!=='string'||!/^[a-f0-9]{32}$/.test(b.fingerprint)||!refOk(b.reference,5,300)||!refOk(b.reason,15,1500))throw fail('Confirmación, huella, referencia y motivo requeridos.');
  Object.assign(args,{p_op:b.operation,p_id:b.operation==='propose'?null:checked(()=>evidenceId(b.id)),p_huella:b.fingerprint,p_reference:b.reference.trim(),p_reason:b.reason.trim()});
 }
 const {data,error}=await db.rpc('jaguar360_movimiento_escolar',args);
 if(error)throw fail(error.code==='42501'?'Sin atribución.':error.code==='P0001'?error.message:['55P03','23505'].includes(error.code)?'Conflicto concurrente. Vuelve a consultar.':'No se pudo consultar o registrar el movimiento. Comprueba V25.',error.code==='42501'?403:['P0001','55P03','23505'].includes(error.code)?409:503);
 const history=(data.history||[]).map(r=>({...r,canReview:experimental&&dir&&r.state==='pending'&&r.cycle===cycle&&r.type===type&&r.target===group,canApprove:experimental&&dir&&r.state==='pending'&&r.cycle===cycle&&r.type===type&&r.target===group&&r.fingerprint===data.fingerprint&&data.eligible===true}));
 res.status(200).json({ok:true,data:{...data,history,student,cycle,type,group,experimental,canPropose:experimental&&ce&&data.eligible===true&&!data.pending}});return true;
}
