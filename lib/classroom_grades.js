/** Averages for the Classroom component. Always recomputed from Google; no implicit zeros. */
import {createHmac,timingSafeEqual} from 'node:crypto';
import {gradeEntries,computeClassroomGrade,matchingTopic} from './classroom_periods.js';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const numeric=v=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<1)fail('Identificador inválido.');return n;};
export function gradeSelection(raw,work,students){
 const ids=new Set(work.map(w=>w.id)),studentsSet=new Set(students.map(s=>String(s.userId)));
 if(!Array.isArray(raw?.excluded_ids)||!Array.isArray(raw?.decisions))fail('Selección de calificaciones incompleta.');
 if(raw.excluded_ids.length>300||raw.decisions.length>30000)fail('Selección demasiado grande.');
 const excluded=raw.excluded_ids.map(String);
 if(new Set(excluded).size!==excluded.length||excluded.some(id=>!ids.has(id)))fail('Hay actividades ajenas a este periodo.');
 if(work.some(w=>w.classification==='pendiente'))fail('Clasifica y guarda todos los trabajos del periodo antes de importar.');
 if(work.some(w=>w.auto_exclude&&!excluded.includes(w.id)))fail('Los exámenes y trabajos excluidos no pueden entrar al promedio de actividades Classroom.');
 const decisions=[];const seen=new Set();
 for(const d of raw.decisions){const user=String(d.google_user_id||''),wid=String(d.work_id||'');
  if(!studentsSet.has(user)||!ids.has(wid)||!['zero','exclude'].includes(d.action))fail('Decisión de tarea inválida.');
  const key=`${user}|${wid}`;if(seen.has(key))fail('Una tarea tiene decisiones contradictorias.');seen.add(key);
  decisions.push({google_user_id:user,work_id:wid,action:d.action});
 }
 return {excluded:excluded.sort(),decisions:decisions.sort((a,b)=>`${a.google_user_id}|${a.work_id}`.localeCompare(`${b.google_user_id}|${b.work_id}`))};
}
export function gradeReport(coursework,submissions,topics,period,students,selection,classified=null){
 const topic=matchingTopic(topics,period);
 if(!topic)fail(`No existe el tema «${period.topic_name}» en Classroom. Prepara los temas antes de importar notas.`,409);
 const entries=gradeEntries(coursework,submissions,topic.topicId);
 const work=classified||entries.work,rows=entries.rows;
 const {excluded,decisions}=gradeSelection(selection,work,students);
 const active=work.filter(x=>!excluded.includes(x.id));
 if(!active.length)fail('No hay actividades incluidas y calificables en este periodo.',409);
 const grades=[...students].sort((a,b)=>String(a.userId).localeCompare(String(b.userId))).map(s=>({google_user_id:String(s.userId),nombre_google:s.profile?.name?.fullName||s.profile?.emailAddress||String(s.userId),...computeClassroomGrade(work,rows,String(s.userId),excluded,decisions)}));
 return {topic:{id:String(topic.topicId),name:String(topic.name)},work,grades,rows,excluded,decisions};
}
export function gradeProof(payload,secret){return createHmac('sha256',secret).update(JSON.stringify(payload)).digest('hex');}
export function verifyProof(provided,expected){
 const a=Buffer.from(String(provided||'')),b=Buffer.from(expected);
 return a.length===b.length&&timingSafeEqual(a,b);
}
