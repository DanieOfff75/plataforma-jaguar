import {validatePlan, curriculumAccreditation, repetitionDecision, proposeBlocks, teacherDay, validateCycle} from './jaguar_academic_lifecycle.js';
import {evidenceId} from './jaguar_history_evidence.js';
const fail=m=>{throw Error(m)};
const int=(v,min,max,label)=>Number.isSafeInteger(v)&&v>=min&&v<=max?v:fail(label+' inválido.');
const num=(v,min,max,label)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:fail(label+' inválido.');
const choice=(v,l,label)=>l.includes(v)?v:fail(label+' inválido.');
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v?v:fail('Fecha inválida.');
const text=(v,min,max,label)=>typeof v==='string'&&v.trim().length>=min&&v.trim().length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v)?v.trim():fail(label+' inválido.');
/** Projection from reviewed, currently verified snapshots ONLY. Existing catalogue mapping
 * is a reference, not proof of historical equivalence. No academic write or eligibility grant. */
export function projectVerifiedRecord(raw, periods){
 const plan=validatePlan(raw),p=plan.policy;
 if(!Array.isArray(periods)||periods.length!==p.periods)return {state:'pending',reason:'periods_missing',official:false};
 const sorted=periods.slice().sort((a,b)=>a.number-b.number);
 for(let i=0;i<sorted.length;i++){
  const r=sorted[i];if(r.number!==i+1||r.start!==plan.calendar[i].start||r.end!==plan.calendar[i].end||r.verified!==true||!Array.isArray(r.rows))return {state:'pending',reason:'verification_or_calendar',official:false};
 }
 const all=sorted.flatMap(r=>r.rows),grades=[...new Set(all.map(r=>r.grade))];
 if(grades.length!==1||![1,2,3].includes(grades[0]))return {state:'pending',reason:'grade_history_ambiguous',official:false};
 const curriculum=plan.curriculum.filter(s=>s.grade===grades[0]);
 if(!curriculum.some(s=>s.required))return {state:'pending',reason:'curriculum_missing',official:false};
 if(all.some(r=>!curriculum.some(s=>s.legacyId===r.subjectId&&s.evaluation===r.evaluation)))return {state:'pending',reason:'unmapped_subject',official:false};
 const subjects=curriculum.map(s=>{
  const base={key:s.key,name:s.name,required:s.required};
  if(s.evaluation==='no_aplica')return {...base,state:'not_applicable'};
  if(s.legacyId===null)return {...base,state:'pending',reason:'unmapped_subject'};
  const rows=sorted.map(r=>{const matches=r.rows.filter(x=>x.subjectId===s.legacyId);return matches.length===1?matches[0]:null;});
  if(rows.some(r=>!r||r.evaluation!==s.evaluation))return {...base,state:'pending',reason:'membership_or_equivalence_pending'};
  if(s.evaluation==='numerica'&&rows.some(r=>r.official===null||r.original===null))return {...base,state:'pending',reason:'original_or_official_missing'};
  // A qualitative final grade needs independent authorized evidence; don't assume last period equals final.
  const result=curriculumAccreditation(plan,s.key,rows);
  const proposed=proposeBlocks(result,p.periods);
  if(s.evaluation==='cualitativa'&&s.qualitativeMode==='all'&&result.state==='candidate'){proposed.blocks=[...new Set([...proposed.blocks,...rows.flatMap((r,i)=>r.result==='RP'?[i+1]:[])])].sort((a,b)=>a-b);}
  return {...base,...result,required:s.required,pointsRequired:s.evaluation==='numerica'?p.points:null,suggestedBlocks:proposed.blocks,needsBlockReview:proposed.review};
 });
 const trajectory=repetitionDecision(subjects,p,{regularizationFinished:false});
 return {state:subjects.some(s=>s.required&&s.state==='pending')?'pending':'projected',official:false,grade:grades[0],subjects,trajectory};
}
/** Operational planning only; a call is not an enrollment, group or authorized change of grade. */
export function validateCall(raw,rawPlan){
 const plan=validatePlan(rawPlan),p=plan.policy;
 if(!raw||typeof raw!=='object')fail('Convocatoria requerida.');
 const kind=choice(raw.kind,['recovery','recourse'],'Tipo');
 const subject=plan.curriculum.find(s=>s.key===raw.subjectKey);if(!subject||subject.evaluation==='no_aplica')fail('Asignatura evaluable requerida.');
 const start=date(raw.start),end=date(raw.end);if(end<start)fail('Fechas invertidas.');
 if(!Array.isArray(raw.blocks)||!raw.blocks.length||raw.blocks.length>p.periods||kind==='recovery'&&raw.blocks.length!==1)fail('Bloques inválidos.');
 const seen=new Set();const blocks=raw.blocks.map(b=>{const period=int(b.period,1,p.periods,'Periodo objetivo');if(seen.has(period))fail('Bloque duplicado.');seen.add(period);return {period,minutes:int(b.minutes,1,525600,'Duración del bloque')};}).sort((a,b)=>a.period-b.period);
 const qualitative=subject.evaluation==='cualitativa';
 const method=qualitative?'qualitative':choice(raw.method,['direct','proportional'],'Método de escala');
 if(kind==='recourse'&&!qualitative&&method!==p.recourseMethod)fail('El método de recursamiento debe corresponder al ciclo.');
 const cap=qualitative?null:num(raw.cap,p.minimum,10,'Tope');
 if(kind==='recourse'&&!qualitative&&cap!==p.recourseCap)fail('El tope del recursamiento corresponde al ciclo.');
 const eligibility=kind==='recourse'?'failed':choice(raw.eligibility,['failed','improve'],'Elegibilidad');
 const teacherMode=kind==='recourse'?'support':choice(raw.teacherMode,['holder','support','either'],'Docente');
 const naming=kind==='recovery'?p.recoveryTemplate:p.recourseTemplate; const letter=raw.letter==null||raw.letter===''?null:raw.letter; if(letter!==null&&!/^[A-Z]$/.test(letter)||naming.includes('{LETRA}')&&letter===null)fail('Indica letra mayúscula para la nomenclatura.');
 return {kind,subjectKey:subject.key,start,end,blocks,method,cap,letter,attendancePct:num(raw.attendancePct,0,100,'Asistencia'),capacity:int(raw.capacity,1,1000,'Cupo'),attempts:kind==='recourse'?1:int(raw.attempts,1,10,'Intentos'),eligibility,teacherMode,turn:choice(raw.turn,['MATUTINO','VESPERTINO'],'Turno'),modality:text(raw.modality,3,120,'Modalidad')};
}
/** Read-only timetable statistics; distinguish actual listed class minutes from span.
 * Missing instructor limits remain unknown; no inferred legal/contractual limit. */
export function summarizeTeacherSchedule(rows){
 if(!Array.isArray(rows))fail('Horario inválido.');const map=new Map();let unassigned=0,invalid=0;
 const minutes=v=>{const m=/^([01]\d|2[0-3]):([0-5]\d)(?::00(?:\.0+)?)?$/.exec(v??'');return m?Number(m[1])*60+Number(m[2]):null;};
 for(const r of rows){if(r.teacherId==null){unassigned++;continue;}const start=minutes(r.start),end=minutes(r.end);if(start===null||end===null||start>=end||!Number.isInteger(r.day)||r.day<1||r.day>7){invalid++;continue;}
  const key=evidenceId(r.teacherId);if(!map.has(key))map.set(key,{teacherId:key,name:String(r.name??'Docente'),days:new Map()});const t=map.get(key);if(!t.days.has(r.day))t.days.set(r.day,[]);t.days.get(r.day).push({start,end,type:'class'});
 }
 const teachers=[...map.values()].map(t=>{const days=[...t.days.entries()].sort((a,b)=>a[0]-b[0]).map(([day,s])=>{const metrics=teacherDay(s),ordered=s.slice().sort((a,b)=>a.start-b.start||a.end-b.end);let end=ordered[0].end,gaps=0,largestGap=0,overlap=false;for(const row of ordered.slice(1)){if(row.start<end)overlap=true;const gap=Math.max(0,row.start-end);gaps+=gap;largestGap=Math.max(largestGap,gap);end=Math.max(end,row.end);}return {day,...metrics,gaps,largestGap,overlap};});return {teacherId:t.teacherId,name:t.name,days,weeklyTeaching:days.reduce((n,d)=>n+d.teaching,0),weeklySpan:days.reduce((n,d)=>n+d.span,0),weeklyGaps:days.reduce((n,d)=>n+d.gaps,0),conflicts:days.filter(d=>d.overlap).length};}).sort((a,b)=>b.weeklyGaps-a.weeklyGaps||a.name.localeCompare(b.name));
 return {teachers,unassigned,invalid,limitations:'Solo clases registradas; los huecos pueden contener descansos o trabajo no lectivo. No representa jornada laboral confirmada ni propone cambios.'};
}
