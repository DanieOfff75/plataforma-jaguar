import {validatePlan,lateEntryPlan} from './jaguar_academic_lifecycle.js';
import {ordinaryGrade} from './jaguar360_grade_policy.js';
const fail=m=>{throw Error(m)};
/** A CE verification of a server-calculated trajectory, not a new academic decision. */
export function continuityDecision(review,rawPlan){
 const plan=validatePlan(rawPlan),state=review.trajectory?.state,grade=review.grade;
 const nextCycle=String(Number(plan.cycle.slice(0,4))+1)+'-'+String(Number(plan.cycle.slice(5))+1);
 if((review.state!=='projected'&&review.provisionalEligible!==true)||![1,2,3].includes(grade))return {state:'pending',canRecord:false,reason:'Expediente incompleto.'};
 const common={sourceCycle:plan.cycle,sourceGrade:grade,academicState:state,groupDistribution:plan.policy.groupDistribution,historyPreserved:true};
 if(state==='academic_completion'&&grade===3&&review.allRequiredResolved===true)return {...common,state:'academic_completion',canRecord:true,targetCycle:null,targetGrade:null,administrativeEgress:'pending',financialClearance:'separate_review',subjects:[]};
 if(state==='promote'&&grade<3&&review.allRequiredResolved===true)return {...common,state:'promotion_eligible',canRecord:true,targetCycle:nextCycle,targetGrade:grade+1,subjects:[],enrollment:'requires_confirmation'};
 if(['repeat_grade','repeat_subjects'].includes(state)&&review.allRequiredResolved===true){
  const subjects=review.trajectory.subjects;if(!Array.isArray(subjects)||!subjects.length||new Set(subjects).size!==subjects.length||subjects.some(key=>!plan.curriculum.some(m=>m.key===key&&m.grade===grade&&m.required)))fail('Materias de repetición incompatibles.');
  return {...common,state,canRecord:true,targetCycle:nextCycle,targetGrade:grade,subjects,enrollment:'requires_confirmation',equivalenceReview:true};
 }
 if((state==='await_regularization'||state==='pending'&&review.provisionalEligible===true)&&plan.policy.pendingReenrollment==='provisional')return {...common,state:'provisional_eligible',canRecord:true,targetCycle:nextCycle,targetGrade:grade,subjects:[],enrollment:'provisional_without_promotion'};
 return {...common,state:'pending',canRecord:false,reason:'Falta resolver regularización o revisar evidencia.'};
}
/** Explicit late-entry proposal, with no invented attendance/marks. Dates must fall in an actual period. */
export function lateEntryObligations(rawPlan,{grade,date,firstResults={}}){
 const plan=validatePlan(rawPlan),p=plan.policy;
 if(!Number.isInteger(grade)||grade<1||grade>3||typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)fail('Grado y fecha de ingreso válidos requeridos.');
 const entry=plan.calendar.findIndex(r=>date>=r.start&&date<=r.end)+1;
 if(!entry)fail('Fecha fuera de los periodos del plan. Requiere revisión de Coordinación.');
 if(!firstResults||typeof firstResults!=='object'||Array.isArray(firstResults))fail('Resultados iniciales inválidos.');
 const subjects=plan.curriculum.filter(s=>s.grade===grade&&s.evaluation!=='no_aplica');if(!subjects.length)fail('No hay materias evaluables para ese grado.');
 if(Object.keys(firstResults).some(k=>!subjects.some(s=>s.key===k)))fail('Resultado de materia ajena.');
 return {cycle:plan.cycle,grade,entry,date,official:false,subjects:subjects.map(s=>{const qual=s.evaluation==='cualitativa',first=firstResults[s.key]??null;const rows=lateEntryPlan({periods:p.periods,entry,minimum:p.minimum,method:p.lateEntry,firstGrade:first,qualitative:qual});return {key:s.key,name:s.name,evaluation:s.evaluation,obligations:rows.map(r=>({...r,original:r.grade,grade:r.grade==null||qual?r.grade:ordinaryGrade(r.grade,p),source:r.grade==null?'pending_first_result':r.source,mandatoryRecovery:true,requiresValidation:true}))};})};
}
