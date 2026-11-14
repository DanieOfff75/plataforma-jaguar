import {gradeText,mixedGradeSummary} from './jaguar360_mixed_grades.js';
/** Read-only safeguards for the approved legacy report card; no conversion of grades. */
const fail=m=>{throw Object.assign(Error(m),{status:409})};
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
export const reportGradeText=gradeText;
export function legacyPeriodScope(periods,cycle){
 if(!Array.isArray(periods)||periods.length<1||periods.length>3)fail('La boleta aprobada requiere de uno a tres periodos conciliados.');
 const sorted=[...periods].sort((a,b)=>a.numero_periodo-b.numero_periodo);
 const seen=new Set();for(const [i,p] of sorted.entries()){
  if(p.ciclo_escolar!==cycle||Number(p.numero_periodo)!==i+1||!p.id||seen.has(String(p.id))||!date(p.fecha_inicio)||!date(p.fecha_fin)||p.fecha_inicio>p.fecha_fin||i>0&&sorted[i-1].fecha_fin>=p.fecha_inicio)fail('Fechas o identidad de periodos sin conciliar.');
  seen.add(String(p.id));
 }
 return sorted;
}
export function countLegacyAbsenceDays(rows,periods,groupSubjects){
 if(!Array.isArray(rows)||!Array.isArray(groupSubjects))fail('Asistencia o materias no disponibles.');
 const ids=new Set(groupSubjects.map(x=>String(x.id)));
 return new Set(rows.filter(r=>r.estado==='falta'&&ids.has(String(r.grupo_materia_id))&&date(r.fecha)&&periods.some(p=>p.fecha_inicio<=r.fecha&&r.fecha<=p.fecha_fin)).map(r=>r.fecha)).size;
}
export function legacyEvaluationSummary(subjects,periods,minimum){
 const {failed,status}=mixedGradeSummary(subjects,periods.length,minimum);return {failed,status};
}
export function assignLegacyGrade(subject,index,raw){
 if(Object.hasOwn(subject.grades,index))fail('Más de una calificación para la materia y periodo. Requiere conciliación.');
 const text=reportGradeText(raw);subject.grades[index]=text==='—'?null:text==='AP'||text==='RP'?text:typeof raw==='string'?text:Number(text);
}
