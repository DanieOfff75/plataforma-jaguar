import {trajectoryReview} from './jaguar360_trajectory.js';
import {validatePlan} from './jaguar_academic_lifecycle.js';
/** Read-only evidence export. Do not substitute a projected grade for a sealed or corrected grade. */
export function historicalReport({context,sealed},student){
 const plan=validatePlan(context.source.plan),review=trajectoryReview(context,student),rows=[];
 if(!Array.isArray(sealed))throw Error('Evidencia original no disponible.');
 const map=new Map();for(const r of sealed){const key=`${r.period}/${r.groupMaterialId}`;if(map.has(key))throw Error('Evidencia original ambigua.');map.set(key,r);}
 for(const p of context.source.periods){
  if(!p.verified)continue;
  for(const r of p.rows){const original=map.get(`${p.number}/${r.groupMaterialId}`);if(!original)throw Error('Falta evidencia original del sello.');
   const subject=plan.curriculum.find(s=>s.legacyId===r.subjectId&&s.grade===r.grade&&s.evaluation===r.evaluation);const effective=review.applications.find(a=>a.subjectKey===subject?.key&&a.status==='authorized');
   const after=effective?.proposal.after[p.number-1]??r,qual=r.evaluation==='cualitativa';
   const val=x=>qual?x.result??null:x.official??null;
   rows.push({period:p.number,subjectKey:subject?.key??null,subject:subject?.name??'Materia pendiente de conciliación',groupMaterialId:r.groupMaterialId,evaluation:r.evaluation,sealedSource:original.source??null,sealed:qual?original.result??null:original.grade??null,rectification:original.rectification??null,ordinarySource:(r.recoveryOrdinary??r).original??null,ordinary:val(r.recoveryOrdinary??r),effectiveSource:after.original??null,effective:val(after),act:effective?.call??null,recoveryCalls:(r.recoveryCalls??[]).join(' / '),attendanceReleased:effective?.proposal.attendanceReleased===true,present:r.attendance?.present??null,absent:r.attendance?.absent??null,late:r.attendance?.late??null,justified:r.attendance?.justified??null,unknown:r.attendance?.unknown??null});
  }
 }
 const periods=plan.calendar.map((p,i)=>({number:i+1,start:p.start,end:p.end,verified:context.source.periods.some(x=>x.number===i+1&&x.start===p.start&&x.end===p.end&&x.verified===true)}));
 const grades=[...new Set(context.source.periods.filter(p=>p.verified).flatMap(p=>p.rows.map(r=>r.grade)))];
 const grade=review.grade??(grades.length===1&&[1,2,3].includes(grades[0])?grades[0]:null);
 const subjects=grade==null?[]:plan.curriculum.filter(s=>s.grade===grade).map(s=>({key:s.key,name:s.name,evaluation:s.evaluation,required:s.required,state:review.subjects.find(x=>x.key===s.key)?.state??'pending'}));
 return {periods,subjects,student,cycle:plan.cycle,planVersion:context.source.version,fingerprint:context.fingerprint,state:review.state,trajectory:review.trajectory.state,rows,official:false};
}
const columns=[['period','Periodo'],['subject','Asignatura'],['groupMaterialId','ID grupo materia'],['evaluation','Evaluación'],['sealedSource','Fuente original sellada'],['sealed','Nota sellada'],['rectification','ID rectificación vigente'],['ordinarySource','Fuente ordinaria vigente'],['ordinary','Nota ordinaria vigente'],['effectiveSource','Fuente efectiva experimental'],['effective','Nota efectiva experimental'],['act','Acta recursamiento aplicada'],['recoveryCalls','Convocatorias recuperación autorizadas'],['attendanceReleased','Adeudo liberado'],['present','Presentes'],['absent','Faltas'],['late','Retardos'],['justified','Justificadas'],['unknown','Sin marca']];
// Quote all fields; neutralize spreadsheet formulas and protect bigint IDs from Excel conversion.
const cell=(v,asText=false)=>{let s=v==null?'':String(v);if(s&&(asText||/^[\s\uFEFF]*[=+\-@\t\r\n]/.test(s)))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
export function historicalCSV(report){const ids=new Set(['groupMaterialId','rectification','act']);return '\uFEFF'+[['Informe de revisión experimental; NO ES BOLETA',report.cycle,'Alumno ID',"'"+report.student,'Plan',report.planVersion,'Huella',report.fingerprint,'Estado',report.state,'Trayectoria',report.trajectory].map(x=>cell(x)).join(','),columns.map(([,name])=>cell(name)).join(','),...report.rows.map(r=>columns.map(([key])=>cell(r[key],ids.has(key))).join(','))].join('\r\n')+'\r\n';}
