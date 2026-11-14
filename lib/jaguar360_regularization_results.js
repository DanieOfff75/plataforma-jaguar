import {recoveryPeriod} from './jaguar360_recovery_candidate.js';
import {specialGrade} from './jaguar360_grade_policy.js';
import {validatePlan,curriculumAccreditation,regularizationGrade,attendance} from './jaguar_academic_lifecycle.js';
import {validateCall} from './jaguar360_operations.js';
const fail=m=>{throw Error(m)};
const n=(v,label)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=10?v:fail(label+' inválida.');
const exactCount=(v)=>Number.isSafeInteger(v)&&v>=0&&v<=100000?v:fail('Número de sesiones inválido.');
/** Evaluates one proposed attempt. Inputs are scenario data, NOT proof of attendance or eligibility.
 * A separate authorization must supply actual block evidence and attempt history. Never writes notes. */
export function evaluateRegularization(rawPlan,rawCall,scenario){
 const plan=validatePlan(rawPlan),call=validateCall(rawCall,plan),p=plan.policy,subject=plan.curriculum.find(s=>s.key===call.subjectKey),qual=subject.evaluation==='cualitativa';
 if(!scenario||!['academic','attendance','mixed'].includes(scenario.cause)||!Array.isArray(scenario.blocks)||!scenario.blocks.length||!Array.isArray(scenario.periodRows)||scenario.periodRows.length!==p.periods)fail('Escenario incompleto.');
 const old=scenario.periodRows.map((row,i)=>{
  if(call.kind==='recovery'&&i!==call.blocks[0].period-1)return null;
  if(!row||typeof row!=='object')fail('Periodo '+(i+1)+' sin evidencia.');
  if(qual){if(!['AP','RP'].includes(row.result))fail('Resultado AP/RP requerido.');return {result:row.result,attendance:row.attendance};}
  return {original:n(row.original,'Nota fuente'),official:n(row.official,'Nota oficial'),attendance:row.attendance};
 });
 const prior=call.kind==='recovery'?recoveryPeriod(plan,call,old[call.blocks[0].period-1]):curriculumAccreditation(plan,subject.key,old);
 if(call.kind==='recovery'&&!prior.eligible)return {...prior,official:false};
 if(prior.state==='pending')return {state:'review',reason:'incomplete_ordinary_evidence',official:false};
 const targets=new Set(call.blocks.map(b=>b.period)),seen=new Set();
 if(!Number.isSafeInteger(scenario.usedAttempts)||scenario.usedAttempts<0||scenario.usedAttempts>=call.attempts)return {state:'ineligible',reason:'attempt_limit',official:false};
 if(call.kind==='recovery'&&(scenario.cause!=='academic'||prior.reason==='attendance'||prior.reason==='mixed'))return {state:'ineligible',reason:'attendance_debt_requires_recourse_or_review',official:false};
 if(call.kind==='recourse'&&(prior.state!=='candidate'||prior.reason!==scenario.cause))return {state:'ineligible',reason:'cause_or_eligibility_mismatch',official:false};
 
 const blocks=scenario.blocks.map(b=>{
  if(!b||!Number.isInteger(b.period)||!targets.has(b.period)||seen.has(b.period))fail('Bloque ajeno o duplicado.');seen.add(b.period);
  if(!['completed','institution_cancelled','justified_absence','unjustified_absence','pending'].includes(b.state))fail('Estado de bloque inválido.');
  if(b.state!=='completed')return {period:b.period,state:b.state,passed:false};
  if(!b.attendance)fail('Asistencia del bloque requerida.');const counts=Object.fromEntries(['present','absent','justified','late','unknown'].map(k=>[k,exactCount(b.attendance[k]??0)]));
  const a=attendance(counts,{...p,attendancePct:call.attendancePct});
  if(!a.complete)return {period:b.period,state:'pending',passed:false,attendance:a};
  const raw=qual?b.result:n(b.grade,'Resultado del bloque');if(qual&&!['AP','RP'].includes(raw))fail('AP/RP inválido.');
  let adjusted=raw,precisionReview=null;
  if(!qual){const opts={minimum:p.minimum,maximum:call.cap,method:call.method,floor:p.floor};try{adjusted=specialGrade(raw,{...opts,kind:call.kind,policy:p});}catch(e){if(p[call.kind+'Rounding']!=='exact'||!e.message.includes('Fracción no terminante'))throw e;adjusted=regularizationGrade(raw,opts);precisionReview=e.message;}}
  const passed=a.meets&&(qual?raw==='AP':raw>=p.minimum);
  return {period:b.period,state:passed?'passed':'failed',passed,raw,adjusted,attendance:a,...(precisionReview?{precisionReview}: {})};
 }).sort((a,b)=>a.period-b.period);
 if(blocks.some(b=>b.state==='institution_cancelled'))return {state:'review',reason:'institution_cancelled_no_attempt',blocks,consumesAttempt:false,official:false};
 if(blocks.some(b=>b.state==='pending'||b.state==='justified_absence'))return {state:'review',reason:'missing_or_justified_review',blocks,consumesAttempt:false,official:false};
 if(blocks.some(b=>b.state==='unjustified_absence')&&p.absenceRecourse==='review')return {state:'review',reason:'absence_review',blocks,consumesAttempt:false,official:false};
 const allPassed=blocks.every(b=>b.passed),changes=[];
 if(call.kind==='recovery'&&blocks.some(b=>b.precisionReview))return {state:'review',reason:'precision_requires_authorization',blocks,consumesAttempt:false,official:false};
 // Recovery and recourse-by-attendance must not lower any original notes.
 // A pass in a subset of recourse blocks does NOT mean the whole obligation is cleared.
 const mayApply=call.kind==='recovery'||p.partialBlocks||allPassed;
 if(mayApply&&scenario.cause!=='attendance'&&(call.kind==='recovery'||p.recourseRecord==='periods')){
  for(const b of blocks.filter(b=>b.passed)){
   const previous=old[b.period-1];
   const revised=qual?{result:previous.result==='AP'?'AP':b.adjusted}:{original:Math.max(previous.original,b.adjusted),officialBefore:previous.official};
   changes.push({period:b.period,before:previous,proposed:revised,requiresOfficialNormalization:!qual});
  }
 }
 const missingRequired=call.kind==='recourse'&&prior.reason!=='attendance'&&Array.isArray(prior.failed)&&prior.failed.some(period=>!seen.has(period));
 // Final extraordinary formula and attendance release require authorization; no implicit waiver.
 const requiresReview=call.kind==='recourse'&&(scenario.cause!=='academic'||p.recourseRecord==='extraordinary'||missingRequired||qual&&subject.qualitativeMode==='final');
 return {state:allPassed?'blocks_passed':'blocks_failed',kind:call.kind,blocks,changes,allPassed,consumesAttempt:true,attemptsRemaining:Math.max(0,call.attempts-scenario.usedAttempts-1),
  attendanceReleaseCandidate:scenario.cause!=='academic'&&allPassed,extraordinaryRequired:call.kind==='recourse'&&p.recourseRecord==='extraordinary'&&scenario.cause!=='attendance',requiresReview,finalAccreditation:'pending_authorized_recalculation',official:false};
}
