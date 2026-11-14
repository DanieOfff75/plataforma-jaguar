import {specialGrade} from './jaguar360_grade_policy.js';
import {validatePlan, curriculumAccreditation, repetitionDecision} from './jaguar_academic_lifecycle.js';
import {projectVerifiedRecord,validateCall} from './jaguar360_operations.js';
import {recourseCandidate} from './jaguar360_roster.js';
import {reviewTemporaryResults} from './jaguar360_temporary_results.js';
const fail=m=>{throw Error(m)};
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const eq=(a,b)=>canonical(a)===canonical(b);
function subjectRows(source,subject,plan){
 if(source.periods.length!==plan.policy.periods)fail('Periodos incompletos.');
 return source.periods.slice().sort((a,b)=>a.number-b.number).map((p,i)=>{
  if(p.verified!==true||p.number!==i+1||p.start!==plan.calendar[i].start||p.end!==plan.calendar[i].end)fail('Sello o calendario incompatible.');
  const rows=p.rows.filter(r=>r.subjectId===subject.legacyId);
  if(rows.length!==1||rows[0].evaluation!==subject.evaluation||rows[0].grade!==subject.grade)fail('Materia histórica ambigua.');
  return structuredClone(rows[0]);
 });
}
/** Only consumes persisted act evidence. No browser-supplied marks or decisions. */
export function deriveApplication(source,attempt,student){
 const plan=validatePlan(source.plan),p=plan.policy,subject=plan.curriculum.find(s=>s.key===attempt.subjectKey);
 if(!subject||!subject.legacyId||subject.evaluation==='no_aplica')fail('Materia no conciliada.');
 const act=attempt.snapshot,entry=act?.students?.[0];
 if(act?.students?.length!==1||entry.student!==student||entry.stale!==false||entry.source.version!==source.version||!eq(validatePlan(entry.source.plan),plan)||act.call.plan_version!==source.version||act.call.ciclo!==plan.cycle)fail('Acta y plan incompatibles.');
 const call=validateCall(act.call.reglas,plan);
 if(call.kind!=='recourse'||call.subjectKey!==subject.key)fail('Convocatoria incompatible.');
 recourseCandidate(entry.source,act.call,entry.blocks.map(b=>b.period));
 const before=subjectRows(source,subject,plan);
 if(!eq(before,subjectRows(entry.source,subject,plan)))fail('La evidencia ordinaria de esta materia cambió después del acta.');
 const [review]=reviewTemporaryResults(act),ev=review?.evaluation;
 if(!ev||ev.consumesAttempt!==true||review.state!==attempt.outcome||!eq(ev,attempt.recordedEvaluation))fail('Acta no coincide con el cálculo de sus evidencias.');
 if(ev.extraordinaryRequired||subject.evaluation==='cualitativa'&&subject.qualitativeMode==='final')fail('Fórmula extraordinaria o evaluación cualitativa final pendiente de autorización.');
 const after=structuredClone(before),changes=[];
 for(const change of ev.changes){
  const i=change.period-1,block=ev.blocks.find(b=>b.period===change.period&&b.passed);
  if(!block||!after[i])fail('Bloque incompatible.');
  if(subject.evaluation==='cualitativa'){after[i].result='AP';}
  else {const adjusted=specialGrade(block.raw,{minimum:p.minimum,maximum:call.cap,method:call.method,kind:'recourse',policy:p,floor:p.floor});
   // Points use the exact authorized scaled value, not the raw course result or rounded display.
   after[i].original=Math.max(before[i].original,adjusted);after[i].official=Math.max(before[i].official,adjusted);
  }
  changes.push({period:change.period,before:before[i],after:after[i]});
 }
 const released=ev.attendanceReleaseCandidate===true&&ev.allPassed===true;
 // Release is a distinct obligation, not fabricated attendance. Preserve original counts.
 const ordinary=curriculumAccreditation(plan,subject.key,after);
 let result=released?curriculumAccreditation({...plan,policy:{...p,attendanceMode:'informative'}},subject.key,after):ordinary;
 if(result.state==='pending')fail('No se puede determinar la acreditación.');
 // A failed mandatory block exhausts the attempt, even if partial credit raises the sum.
 if(!ev.allPassed&&result.state==='accredited')result={...result,state:'candidate',reason:'regularization_failed'};
 return {subjectKey:subject.key,call:attempt.call,actFingerprint:attempt.actFingerprint,planVersion:source.version,before,after,changes,attendanceReleased:released,ordinaryAttendance:ordinary.cumulative??null,result,attemptExhausted:true,official:false};
}
/** Applies only a validated, authorized application to the historical projection. */
export function trajectoryReview(context,student){
 const source=context.source,plan=validatePlan(source.plan),ordinary=projectVerifiedRecord(plan,source.periods),subjects=structuredClone(ordinary.subjects||[]),applications=[];
 const seen=new Set();for(const a of context.attempts||[]){
  const s=subjects.find(s=>s.key===a.subjectKey);let proposed=null,error=null;
  try{if(seen.has(a.subjectKey)||!s)fail('Intento sin materia conciliada o duplicado.');seen.add(a.subjectKey);if(ordinary.state!=='projected')fail('Expediente ordinario incompleto.');proposed=deriveApplication(source,a,student);}catch(e){error=e.message;}
  const stored=a.application;const current=!!proposed&&!!stored&&eq(stored.payload,proposed);const effective=current&&stored.state==='authorized';
  applications.push({call:a.call,subjectKey:a.subjectKey,name:s?.name||a.subjectKey,proposal:proposed,error:error||(!current&&stored?'La revisión guardada no coincide con evidencia vigente.':null),status:effective?'authorized':stored?.state==='proposed'&&current?'proposed':stored?'review':'not_recorded',canPropose:!!proposed&&!stored,canAuthorize:!!proposed&&current&&stored.state==='proposed',actor:stored?.actor??null,reference:stored?.reference??null});
  if(s){if(effective){const next=proposed.result;Object.assign(s,next,{regularizationApplied:true,attendanceReleased:proposed.attendanceReleased,attemptExhausted:true,suggestedBlocks:[],needsBlockReview:false});}else Object.assign(s,{state:'pending',reason:'regularization_application_pending'});}
 }
 const waitingRecovery=source.pendingRecovery??[],waitingRecourse=source.pendingRecourse??[];
 if(!Array.isArray(waitingRecovery)||!Array.isArray(waitingRecourse))fail('Reservas pendientes inválidas.');
 const unknownRegularization=[...waitingRecovery,...waitingRecourse,...(context.attempts||[]).map(a=>a.subjectKey)].some(key=>!subjects.some(s=>s.key===key));
 for(const s of subjects){if(waitingRecovery.includes(s.key))Object.assign(s,{state:'pending',reason:'recovery_resolution_pending'});else if(waitingRecourse.includes(s.key))Object.assign(s,{state:'pending',reason:'recourse_reservation_pending'});}
 // Preserve the distinction between missing evidence and an unresolved documented procedure.
 const provisionalEligible=ordinary.state==='projected'&&subjects.some(s=>s.required&&s.state!=='accredited')&&subjects.filter(s=>s.required).every(s=>s.state==='accredited'||s.state==='candidate'||(s.state==='pending'&&['recovery_resolution_pending','recourse_reservation_pending'].includes(s.reason))||(s.state==='pending'&&s.reason==='regularization_application_pending'&&applications.some(a=>a.subjectKey===s.key&&a.proposal&&!a.error)))&&!unknownRegularization&&applications.every(a=>!a.error);
 const complete=!unknownRegularization&&ordinary.state==='projected'&&subjects.every(s=>!s.required||s.state==='accredited'||s.state==='candidate'&&s.attemptExhausted===true);
 const trajectory=unknownRegularization?{state:'pending',reason:'unmapped_regularization'}:repetitionDecision(subjects,plan.policy,{regularizationFinished:complete});
 return {state:!unknownRegularization&&ordinary.state==='projected'&&subjects.every(s=>!s.required||s.state!=='pending')?'projected':'pending',grade:ordinary.grade,subjects,applications,trajectory:{...trajectory,state:trajectory.state==='promote'&&ordinary.grade===3?'academic_completion':trajectory.state},allRequiredResolved:complete,provisionalEligible,official:false};
}
