import {evidenceId} from '../lib/jaguar_history_evidence.js';
import {recoveryCandidate} from '../lib/jaguar360_recovery_candidate.js';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
export async function recoveryCandidateRoute(req,res,{user,profile,adminClient:db}){
 if(req.method!=='GET'||req.query?.view!=='recovery_candidate')return false;
 if(!['direccion_escolar','coordinacion_academica','control_escolar','control'].includes(profile.rol))throw fail('Sin atribución.',403);
 let call,student;try{call=evidenceId(req.query.call);student=evidenceId(req.query.student)}catch(e){throw fail(e.message)}
 const {data,error}=await db.rpc('jaguar360_candidatura_recuperacion',{p_actor:user.id,p_call:call,p_alumno:student});
 if(error)throw fail(error.code==='42501'?'Sin atribución.':error.code==='P0001'?error.message:'No se pudo consultar. Comprueba V23.',error.code==='42501'?403:error.code==='P0001'?409:503);
 let candidate;try{candidate=recoveryCandidate(data.source,data.call)}catch(e){throw fail(e.message,409)}
 res.status(200).json({ok:true,data:{...candidate,notice:'Consulta preparatoria. No comprueba saldo de intentos ni autoriza inscripción, resultado o acreditación.'}});return true;
}
