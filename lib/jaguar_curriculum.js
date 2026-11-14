/** Versioned curriculum snapshots. No mutation of the live catalogue. Minutes are integers. */
const fail=m=>{throw Error(m)};
function integer(v,min,max,label){if(!Number.isSafeInteger(v)||v<min||v>max)fail(label+' inválido.');return v}
const pct=v=>{if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>100)fail('Asistencia mínima inválida.');return v};
const text=(v,min,max,label)=>{if(typeof v!=='string'||v.trim().length<min||v.trim().length>max||/[\u0000-\u001f]/.test(v))fail(label+' inválido.');return v.trim()};
export function validateCurriculum(input,periods){
 if(input==null)return [];
 if(!Array.isArray(input)||input.length>300)fail('Plan de estudios inválido (máximo 300 asignaciones).');
 const keys=new Set(),names=new Set(),legacy=new Set();
 return input.map(r=>{
  if(!r||typeof r!=='object'||Array.isArray(r))fail('Asignatura inválida.');
  const key=text(r.key,1,64,'Identificador estable');if(!/^[A-Z0-9_-]+$/.test(key)||keys.has(key))fail('Identificador de asignatura inválido o duplicado.');keys.add(key);
  const grade=integer(r.grade,1,3,'Grado');const name=text(r.name,2,120,'Nombre de asignatura');const nk=grade+':'+name.normalize('NFC').toLowerCase();if(names.has(nk))fail('Nombre duplicado en el grado.');names.add(nk);
  const legacyId=r.legacyId==null||r.legacyId===''?null:r.legacyId;
  if(legacyId!==null){if(typeof legacyId!=='string'||!/^[1-9]\d{0,18}$/.test(legacyId)||BigInt(legacyId)>9223372036854775807n)fail('ID de materia existente inválido.');const lk=grade+':'+legacyId;if(legacy.has(lk))fail('Materia existente duplicada en el grado.');legacy.add(lk)}
  if(!['numerica','cualitativa','no_aplica'].includes(r.evaluation))fail('Tipo de evaluación inválido.');
  const qualitativeMode=r.evaluation==='cualitativa'?(r.qualitativeMode??'all'):null;if(qualitativeMode!==null&&!['all','final'].includes(qualitativeMode))fail('Criterio cualitativo inválido.');
  if(typeof r.required!=='boolean'||(r.evaluation==='no_aplica'&&r.required))fail('Asignatura sin evaluación no puede exigirse para promoción.');
  const sessionMinutes=integer(r.sessionMinutes,1,240,'Duración de sesión'),dailyMin=integer(r.dailyMin??0,0,1440,'Mínimo diario en minutos'),dailyMax=integer(r.dailyMax,sessionMinutes,1440,'Máximo diario en minutos'),weeklyMinutes=integer(r.weeklyMinutes,0,10080,'Referencia semanal en minutos'),monthlyMinutes=integer(r.monthlyMinutes,0,44640,'Referencia mensual en minutos');
  if(dailyMin>dailyMax)fail('Mínimo diario superior al máximo.');
  if(!['fixed','flexible'].includes(r.distribution))fail('Distribución inválida.');
  if(!['block','resolution'].includes(r.shortfall))fail('Tratamiento del déficit inválido.');
  if(!Array.isArray(r.periodMinutes)||r.periodMinutes.length!==periods)fail('Define la carga de todos los periodos.');
  const periodMinutes=r.periodMinutes.map(v=>integer(v,0,525600,'Minutos del periodo'));
  const totalMinutes=integer(r.totalMinutes,1,525600,'Carga total');
  if(periodMinutes.reduce((a,b)=>a+b,0)!==totalMinutes)fail('La suma por periodo debe coincidir con la carga total de '+name+'.');
  if(r.distribution==='fixed'&&weeklyMinutes===0)fail('Una distribución fija requiere referencia semanal positiva.');
  const attendancePct=r.attendancePct==null?null:pct(r.attendancePct);
  const periodAttendancePct=r.periodAttendancePct??Array(periods).fill(null);if(!Array.isArray(periodAttendancePct)||periodAttendancePct.length!==periods)fail('Define los mínimos de asistencia por periodo.');
  const periodAttendance=periodAttendancePct.map(v=>v==null?null:pct(v));
  return {key,grade,name,legacyId,evaluation:r.evaluation,qualitativeMode,required:r.required,sessionMinutes,dailyMin,dailyMax,weeklyMinutes,monthlyMinutes,distribution:r.distribution,shortfall:r.shortfall,periodMinutes,totalMinutes,attendancePct,periodAttendancePct:periodAttendance};
 });
}
export function curriculumSummary(rows,periods){const clean=validateCurriculum(rows,periods);return [1,2,3].map(grade=>{const s=clean.filter(r=>r.grade===grade);return {grade,subjects:s.length,required:s.filter(r=>r.required).length,totalMinutes:s.reduce((n,r)=>n+r.totalMinutes,0),periodMinutes:Array.from({length:periods},(_,i)=>s.reduce((n,r)=>n+r.periodMinutes[i],0))}})}
