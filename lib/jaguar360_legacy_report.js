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

// A provisional cut uses the persisted period ID to locate the marks. Dates are
// only needed for attendance; never invent them or infer a period by row order.
function numberFromName(name){
 const n=String(name??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[º°ª.]/g,'').replace(/\s+/g,' ');
 const m=n.match(/^p\s*([1-3])$/)||n.match(/^(?:periodo|trimestre)\s*([1-3])$/)||n.match(/^([1-3])(?:er|ro|do|to|o)?\s*(?:periodo|trimestre)$/);
 if(m)return Number(m[1]);
 const word=n.match(/^(primer(?:o)?|segundo|tercer(?:o)?) (?:periodo|trimestre)$/)?.[1];
 return word?.startsWith('primer')?1:word==='segundo'?2:word?.startsWith('tercer')?3:null;
}
export function provisionalPeriodScope(rows,cycle){
 if(!Array.isArray(rows)||rows.length<1||rows.length>3)fail('La boleta admite de uno a tres periodos; revisa la cantidad configurada.');
 const seen=new Set(),numbers=new Set();
 const periods=rows.map(p=>{
  const id=String(p?.id??'');
  if(!/^[1-9]\d*$/.test(id)||seen.has(id)||p.ciclo_escolar!==cycle)fail('Identidad de periodos duplicada o fuera del ciclo. Revisa la configuración.');
  const named=numberFromName(p.nombre),raw=p.numero_periodo;
  const explicit=raw===null||raw===undefined||raw===''?null:Number(raw);
  const number=explicit??named;
  if(!Number.isInteger(number)||number<1||number>3||numbers.has(number)||(named!==null&&explicit!==null&&named!==explicit))fail('Numeración de periodos ambigua: '+String(p.nombre||id)+'. Revisa el número de periodo.');
  seen.add(id);numbers.add(number);return {...p,numero_periodo:number};
 }).sort((a,b)=>a.numero_periodo-b.numero_periodo);
 // Do not shift P2 to P1, nor conceal a missing intermediate period.
 if(periods.some((p,i)=>p.numero_periodo!==i+1))fail('Faltan periodos intermedios o iniciales; revisa la numeración.');
 const calendarValid=periods.every((p,i)=>date(p.fecha_inicio)&&date(p.fecha_fin)&&p.fecha_inicio<=p.fecha_fin&&(!i||periods[i-1].fecha_fin<p.fecha_inicio));
 return {periods,calendarValid};
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
