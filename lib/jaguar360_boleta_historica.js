import {historicalReport} from './jaguar360_historical_report.js';
import {gradeText} from './jaguar360_mixed_grades.js';
const fail=m=>{throw Object.assign(Error(m),{status:409});};
/** Use only the server's verified, persisted trajectory. Never substitute a proposed application. */
export function historicalBoletaValues(snapshot,student,periods,groupSubjects){
 if(!snapshot||!Array.isArray(snapshot.exact)||!/^([a-f0-9]{32})$/.test(snapshot.hash||'')||!Number.isSafeInteger(snapshot.absenceDays)||snapshot.absenceDays<0||String(snapshot.groupId)!==String(student.grupo_id))fail('Evidencia histórica incompleta.');
 if(snapshot.context?.source?.plan?.curriculum?.some(s=>s.grade===student.grupos?.grado&&s.evaluation==='cualitativa'&&s.qualitativeMode==='final'))fail('La evaluación cualitativa final requiere conciliación específica.');
 const r=historicalReport(snapshot,String(student.id));
 if(r.state!=='projected'||r.periods.length!==periods.length||r.periods.some((p,i)=>!p.verified||p.number!==i+1||p.start!==periods[i].fecha_inicio||p.end!==periods[i].fecha_fin))fail('La trayectoria o los periodos históricos no están conciliados.');
 const allowed=new Map(groupSubjects.map(g=>[String(g.id),g]));
 const exact=new Map();for(const x of snapshot.exact){const k=`${x.period}/${x.groupMaterialId}`;if(exact.has(k))fail('Calificación histórica duplicada.');exact.set(k,x.value);}
 const out=new Map();for(const row of r.rows){const gm=allowed.get(String(row.groupMaterialId)),key=`${row.period}/${row.groupMaterialId}`;if(!gm||!row.subjectKey||!exact.has(key))fail('Materia histórica no conciliada.');
  if(row.evaluation==='no_aplica')continue;
  const val=gradeText(exact.get(key));if(val==='—'||row.effective==null||(row.evaluation==='cualitativa'?val!==row.effective:Number(val)!==Number(row.effective)))fail('Resultado autorizado incompatible con la evidencia efectiva.');
  const mid=String(gm.materia_id),s=out.get(mid)||{mode:row.evaluation,grades:{}};if(s.mode!==row.evaluation||Object.hasOwn(s.grades,row.period-1))fail('Materia histórica duplicada.');s.grades[row.period-1]=val;out.set(mid,s);
 }
 if(exact.size!==r.rows.length)fail('Inventario histórico incompleto.');
 for(const s of out.values())if(Object.keys(s.grades).length!==periods.length)fail('Evaluación histórica incompleta.');
 return {subjects:out,absenceDays:snapshot.absenceDays,hash:snapshot.hash};
}
