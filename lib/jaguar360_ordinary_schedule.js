import {validatePlan} from './jaguar_academic_lifecycle.js';
import {evidenceId} from './jaguar_history_evidence.js';
const fail=m=>{throw Error(m)};
const int=(v,lo,hi,label)=>Number.isSafeInteger(v)&&v>=lo&&v<=hi?v:fail(label+' inválido.');
export function minute(v){const m=/^([01]\d|2[0-3]):([0-5]\d)(?::00(?:\.0+)?)?$/.exec(v??'');if(!m)fail('Hora inválida.');return +m[1]*60+(+m[2]);}
const overlap=(a,b)=>a.start<b.end&&b.start<a.end;
const dayKey=(id,day)=>id+':'+day;
function mapRows(rows,key){const out=new Map();for(const r of rows){const k=key(r);if(!out.has(k))out.set(k,[]);out.get(k).push(r);}return out;}
/** Validates a complete proposed teaching week against the current catalogue, not a published schedule.
 * No data are inferred for new cycles; missing assignment, availability or curricular mapping blocks review. */
export function ordinarySchedule(context,raw){
 const plan=validatePlan(context.plan);if(!Array.isArray(raw.slots)||raw.slots.length>5000||!raw.slots.length)fail('Indica entre 1 y 5000 sesiones.');
 const period=int(raw.period,1,plan.policy.periods,'Periodo');
 const limits=raw.limits||{},maxDaily=int(limits.maxDaily,1,1440,'Carga lectiva diaria'),maxWeekly=int(limits.maxWeekly,1,10080,'Carga lectiva semanal'),maxSpan=int(limits.maxSpan,1,1440,'Permanencia máxima'),minBreak=int(limits.minBreak,1,240,'Descanso mínimo'),maxConsecutive=int(limits.maxConsecutive,1,1440,'Clases consecutivas');
 if(maxDaily>maxSpan||maxConsecutive>maxDaily||maxDaily>maxWeekly)fail('Límites docentes incoherentes.');
 const rooms=new Map(context.rooms.map(r=>[r.id,r])),groups=new Map(context.groups.map(g=>[g.id,g])),subjects=new Map(context.subjects.map(g=>[g.id,g]));
 const problems=[],metrics=[],issue=(code,detail)=>problems.push({code,detail});
 if(context.unscoped>0)issue('unscoped_schedules','Existen horarios sin ciclo definido; revisar interferencias antes de publicar.');
 const expected=new Map();for(const gm of context.subjects){const g=groups.get(gm.group),matches=plan.curriculum.filter(s=>s.grade===g?.grade&&s.legacyId===gm.subject);if(matches.length!==1){issue('unmapped',gm.id);continue;}const s=matches[0];expected.set(gm.id,s);}
 for(const g of groups.values())for(const s of plan.curriculum.filter(x=>x.grade===g.grade)){if(!context.subjects.some(gm=>gm.group===g.id&&gm.subject===s.legacyId))issue('missing_group_subject',g.id+'/'+s.key);}
 const slots=raw.slots.map((x,i)=>{const gm=evidenceId(x.groupSubject),teacher=evidenceId(x.teacher),room=evidenceId(x.room),day=int(x.day,1,5,'Día'),start=minute(x.start),end=minute(x.end);if(end<=start)fail('Franja invertida.');const row=subjects.get(gm),g=groups.get(row?.group),s=expected.get(gm),a=rooms.get(room);if(!row||!g||!s||!a)fail('Materia, grupo, currículo o aula inexistente.');
  if(!row.teachers.includes(teacher))issue('unassigned_teacher',String(i+1));
  if(!Number.isInteger(a.capacity)||!Number.isInteger(g.students)||a.capacity<g.students)issue('capacity',String(i+1));
  if(end-start!==s.sessionMinutes)issue('duration',String(i+1));
  if(plan.policy.scheduleModel==='fixed'&&(g.start==null||g.end==null||start<minute(g.start)||end>minute(g.end)))issue('fixed_window',String(i+1));
  const av=context.availability.filter(v=>v.teacher===teacher&&v.day===day).map(v=>({...v,start:minute(v.start),end:minute(v.end)}));
  if(!av.some(v=>v.available===true&&v.start<=start&&v.end>=end)||av.some(v=>v.available===false&&overlap(v,{start,end})))issue('availability',String(i+1));
  return {groupSubject:gm,group:g.id,teacher,room,day,start,end};});
 for(const field of ['group','teacher','room'])for(const [key,rows]of mapRows(slots,s=>dayKey(s[field],s.day))){const sorted=rows.sort((a,b)=>a.start-b.start||a.end-b.end);let last=-1;for(const row of sorted){if(row.start<last)issue(field+'_overlap',key);last=Math.max(last,row.end);}}
 const bySubject=mapRows(slots,s=>s.groupSubject);
 for(const [key,s]of expected){const rows=bySubject.get(key)||[],total=rows.reduce((a,r)=>a+r.end-r.start,0);if(s.distribution==='fixed'&&total!==s.weeklyMinutes)issue('weekly_minutes',key);if(s.distribution==='flexible'&&total===0&&s.periodMinutes[period-1]>0)issue('missing_week',key);for(const [day,ds]of mapRows(rows,r=>r.day)){const total=ds.reduce((a,r)=>a+r.end-r.start,0);if(total>s.dailyMax||total<s.dailyMin)issue('daily_minutes',key+':'+day);}metrics.push({groupSubject:key,weeklyMinutes:total,targetWeekly:s.weeklyMinutes,periodMinutes:s.periodMinutes[period-1]});}
 for(const [key,rows]of mapRows(slots,s=>dayKey(s.group,s.day))){let last=null;for(const r of rows.sort((a,b)=>a.start-b.start)){if(last!==null&&r.start-last>plan.policy.maxStudentGap)issue('student_gap',key);last=Math.max(last??0,r.end);}}
 for(const [teacher,rows]of mapRows(slots,s=>s.teacher)){let weekly=0;for(const [day,ds]of mapRows(rows,r=>r.day)){ds.sort((a,b)=>a.start-b.start);let last=ds[0].start,continuous=0,teaching=0;for(const r of ds){if(r.start-last>=minBreak)continuous=0;continuous+=r.end-r.start;teaching+=r.end-r.start;if(continuous>maxConsecutive)issue('consecutive',teacher+':'+day);last=Math.max(last,r.end);}weekly+=teaching;if(teaching>maxDaily||last-ds[0].start>maxSpan)issue('teacher_day',teacher+':'+day);}if(weekly>maxWeekly)issue('teacher_week',teacher);}
 return {period,model:plan.policy.scheduleModel,limits:{maxDaily,maxWeekly,maxSpan,minBreak,maxConsecutive},slots,metrics,problems,compatible:problems.length===0,official:false,limitations:'Semana de referencia; no valida calendario completo, pausas institucionales, obligaciones no lectivas, disponibilidad aprobada o competencias fuera del catálogo ni publica horarios.'};
}
