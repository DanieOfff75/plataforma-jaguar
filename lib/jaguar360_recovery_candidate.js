import {validatePlan,attendance} from './jaguar_academic_lifecycle.js';
import {validateCall} from './jaguar360_operations.js';
const grade=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=10;
const pending=reason=>({state:'review',reason,eligible:false});
/** Recovery is scoped to one completed ordinary period, never to a future grade. */
export function recoveryPeriod(plan,call,row){
 const p=plan.policy,subject=plan.curriculum.find(s=>s.key===call.subjectKey),period=call.blocks[0].period;
 if(!row||typeof row!=='object')return pending('target_evidence_missing');
 const qualitative=subject.evaluation==='cualitativa';
 if(qualitative?!['AP','RP'].includes(row.result):!grade(row.original)||!grade(row.official))return pending('target_grade_missing');
 if(['period','both'].includes(p.attendanceMode)){
  if(!row.attendance)return pending('target_attendance_missing');
  const a=attendance(row.attendance,{...p,attendancePct:subject.periodAttendancePct?.[period-1]??subject.attendancePct??p.attendancePct});
  if(!a.complete)return pending('target_attendance_missing');
  if(!a.meets&&(p.attendanceVeto||p.attendanceMode==='both'))return {state:'ineligible',reason:'attendance_debt_requires_recourse_or_review',eligible:false,attendance:a};
 }
 const failed=qualitative?row.result==='RP':row.official<p.minimum;
 if(!failed&&call.eligibility==='failed')return {state:'ineligible',reason:'target_not_failed',eligible:false};
 return {state:'eligible',eligible:true,period,failed,cycleAttendancePending:['cycle','both'].includes(p.attendanceMode),reason:null};
}
export function recoveryCandidate(source,callRow){
 const plan=validatePlan(source.plan),call=validateCall(callRow.reglas,plan),target=call.blocks[0].period;
 if(call.kind!=='recovery'||callRow.estado!=='autorizada_para_planeacion'||source.version!==callRow.plan_version||plan.cycle!==callRow.ciclo)throw Error('Convocatoria y plan sellado incompatibles.');
 const subject=plan.curriculum.find(s=>s.key===call.subjectKey),periods=source.periods.filter(p=>p.number===target),base={subjectKey:subject.key,name:subject.name,period:target,planVersion:source.version,official:false};
 if(periods.length!==1||periods[0].verified!==true||periods[0].start!==plan.calendar[target-1].start||periods[0].end!==plan.calendar[target-1].end||call.start<=periods[0].end||subject.legacyId===null)return {...base,...pending('target_seal_or_calendar_missing')};
 const rows=periods[0].rows.filter(r=>r.subjectId===subject.legacyId&&r.grade===subject.grade&&r.evaluation===subject.evaluation);
 if(rows.length!==1)return {...base,...pending('target_membership_ambiguous')};
 return {...base,...recoveryPeriod(plan,call,rows[0]),original:rows[0].original,ordinary:rows[0].official,result:rows[0].result};
}
