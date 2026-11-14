import {validatePlan} from './jaguar_academic_lifecycle.js';
import {ordinarySchedule,minute} from './jaguar360_ordinary_schedule.js';
const fail=m=>{throw Error(m)};
const clock=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
const overlap=(a,b)=>a.start<b.end&&b.start<a.end;
/** Bounded heuristic, no assertion of infeasibility or optimality. Only complete compatible weeks can be saved by V17. */
export function generateWeek(context,raw){
 const plan=validatePlan(context.plan),period=raw.period,L=raw.limits||{};
 if(plan.policy.scheduleGeneration==='manual')fail('El plan solo permite generación manual.');
 if(!Number.isInteger(period)||period<1||period>plan.policy.periods)fail('Periodo inválido.');
 for(const [k,max] of Object.entries({maxDaily:1440,maxWeekly:10080,maxSpan:1440,minBreak:240,maxConsecutive:1440}))if(!Number.isInteger(L[k])||L[k]<1||L[k]>max)fail('Límites docentes inválidos.');
 if(L.maxDaily>L.maxSpan||L.maxConsecutive>L.maxDaily||L.maxDaily>L.maxWeekly)fail('Límites docentes incoherentes.');
 const tasks=[],problems=[];let candidateCount=0;
 const result=(status,slots=[],validation=null)=>({status,slots,validation,problems,official:false,limitations:'Búsqueda acotada de semana de referencia; no prueba inexistencia de solución ni publica horarios.'});
 if(context.unscoped>0){problems.push('Existen horarios sin ciclo definido.');return result('requires_review');}
 for(const g of context.groups)for(const m of plan.curriculum.filter(x=>x.grade===g.grade))if(!context.subjects.some(x=>x.group===g.id&&x.subject===m.legacyId))problems.push('Sin grupo-materia: '+g.id+'/'+m.key);
 for(const row of context.subjects){
  const g=context.groups.find(x=>x.id===row.group),matches=plan.curriculum.filter(x=>x.grade===g?.grade&&x.legacyId===row.subject);
  if(matches.length!==1){problems.push('Sin correspondencia única: '+row.id);continue;}
  const m=matches[0],target=m.weeklyMinutes;
  if(m.distribution!=='fixed'){problems.push('Distribución flexible de '+row.id+': define una semana manual; el total del periodo aún requiere distribución fechada.');continue;}
  if(target%m.sessionMinutes!==0){problems.push('Carga no divisible en sesiones: '+row.id);continue;}
  if(target===0)continue;
  const count=target/m.sessionMinutes;if(count>100||tasks.length+count>500){problems.push('Carga fuera del límite de búsqueda.');return result('requires_review');}
  const candidates=[];
  for(const teacher of row.teachers)for(const a of context.availability.filter(x=>x.teacher===teacher&&x.available===true&&x.day>=1&&x.day<=5)){
   let lo=minute(a.start),hi=minute(a.end);if(plan.policy.scheduleModel==='fixed'){if(!g.start||!g.end)continue;lo=Math.max(lo,minute(g.start));hi=Math.min(hi,minute(g.end));}
   const denied=context.availability.filter(x=>x.teacher===teacher&&x.day===a.day&&x.available===false).map(x=>({start:minute(x.start),end:minute(x.end)}));
   for(let start=lo;start+m.sessionMinutes<=hi;start+=5){const end=start+m.sessionMinutes;if(denied.some(x=>overlap(x,{start,end})))continue;
    for(const room of context.rooms.filter(x=>Number.isInteger(x.capacity)&&Number.isInteger(g.students)&&x.capacity>=g.students)){
     if(++candidateCount>150000){problems.push('Catálogo demasiado amplio para búsqueda automática acotada.');return result('search_limit');}
     candidates.push({groupSubject:row.id,group:g.id,teacher,room:room.id,day:a.day,start,end});
    }
   }
  }
  if(!candidates.length){problems.push('Sin franjas compatibles registradas: '+row.id);continue;}
  for(let i=0;i<count;i++)tasks.push({row,m,candidates});
 }
 if(problems.length||!tasks.length)return result('requires_review');
 tasks.sort((a,b)=>a.candidates.length-b.candidates.length||b.m.sessionMinutes-a.m.sessionMinutes||a.row.id.localeCompare(b.row.id));
 let operations=0,best=null;
 for(let attempt=0;attempt<12;attempt++){
  const slots=[];let interrupted=false;
  for(const task of tasks){let choice=null,score=Infinity;
   for(const c of task.candidates){if(++operations>600000){interrupted=true;break;}
    const duration=c.end-c.start;
    if(slots.some(x=>x.day===c.day&&overlap(x,c)&&(x.group===c.group||x.teacher===c.teacher||x.room===c.room)))continue;
    const teacher=slots.filter(x=>x.teacher===c.teacher),td=teacher.filter(x=>x.day===c.day).concat(c).sort((a,b)=>a.start-b.start);
    const sum=xs=>xs.reduce((n,x)=>n+x.end-x.start,0);
    if(sum(teacher)+duration>L.maxWeekly||sum(td)>L.maxDaily||td.at(-1).end-td[0].start>L.maxSpan)continue;
    let consecutive=0,last=-Infinity;for(const x of td){if(x.start-last>=L.minBreak)consecutive=0;consecutive+=x.end-x.start;last=x.end;if(consecutive>L.maxConsecutive)break;}if(consecutive>L.maxConsecutive)continue;
    const same=slots.filter(x=>x.groupSubject===c.groupSubject&&x.day===c.day);if(sum(same)+duration>task.m.dailyMax)continue;
    const gd=slots.filter(x=>x.group===c.group&&x.day===c.day).concat(c).sort((a,b)=>a.start-b.start);
    const gaps=gd.slice(1).map((x,i)=>x.start-gd[i].end);if(gaps.some(g=>g>plan.policy.maxStudentGap))continue;
    const teacherGaps=td.slice(1).reduce((n,x,i)=>n+x.start-td[i].end,0);
    const rotation=(c.day+attempt)%5;
    const cost=gaps.reduce((n,g)=>n+g,0)*4+teacherGaps*2+(attempt%3===0?same.length*100:attempt%3===1?-same.length*100:0)+rotation*8+c.start/1440+(attempt%2?c.room.localeCompare('5')/100:0);
    if(cost<score){score=cost;choice=c;}
   }
   if(interrupted||!choice)break;slots.push(choice);
  }
  if(slots.length> (best?.length??0))best=slots;
  if(slots.length===tasks.length){const normalized=slots.map(({groupSubject,teacher,room,day,start,end})=>({groupSubject,teacher,room,day,start:clock(start),end:clock(end)}));const v=ordinarySchedule(context,{period,limits:L,slots:normalized});if(v.compatible)return result('compatible',normalized,v);}
  if(interrupted)break;
 }
 problems.push(`No se encontró semana completa compatible en la búsqueda (${best?.length??0}/${tasks.length} sesiones colocadas). Ajusta las restricciones o completa manualmente.`);
 return result('search_limit');
}
