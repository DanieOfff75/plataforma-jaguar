/** Read-only safeguards for the approved legacy report card; no conversion of grades. */
const fail=m=>{throw Object.assign(Error(m),{status:409})};
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
export function reportGradeText(value){
 if(value===null||value===undefined||value==='')return '—';
 if(typeof value!=='number'&&(typeof value!=='string'||!/^\d+(?:\.\d+)?$/.test(value)))fail('Calificación registrada inválida.');
 const n=Number(value);if(!Number.isFinite(n)||n<0||n>10)fail('Calificación registrada fuera de rango.');
 return String(n);
}
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
 if(!Number.isInteger(minimum)||minimum<1||minimum>10)fail('Mínima aprobatoria inválida.');
 let seen=0,missing=0,failed=0;
 for(const s of subjects){let sum=0,n=0;for(let i=0;i<periods.length;i++){const text=reportGradeText(s.grades[i]);if(text==='—'){missing++;continue;}sum+=Number(text);n++;seen++;}if(n&&sum/n<minimum)failed++;}
 // This renderer cannot certify accreditation; attendance and special pathways are separate.
 return {failed,status:!seen?'Sin evaluar':missing?'En curso':failed?'En revisión':'Evaluado'};
}
export function assignLegacyGrade(subject,index,raw){
 if(Object.hasOwn(subject.grades,index))fail('Más de una calificación para la materia y periodo. Requiere conciliación.');
 const text=reportGradeText(raw);subject.grades[index]=text==='—'?null:Number(text);
}
