/** Los periodos académicos son fuente de verdad: no usar periodos ficticios. */
const ORDINAL=['','PRIMER','SEGUNDO','TERCER','CUARTO','QUINTO','SEXTO','SÉPTIMO','OCTAVO','NOVENO','DÉCIMO'];
export function topicForPeriod(period){
 const n=Number(period?.numero_periodo);
 if(!Number.isSafeInteger(n)||n<1||n>10)throw new Error(`Periodo «${String(period?.nombre||'?')}» sin número válido de 1 a 10. Revísalo en Control Escolar.`);
 return `${ORDINAL[n]} PERIODO`;
}
export function matchingTopic(topics,period){
 const target=topicForPeriod(period);
 return (topics||[]).find(t=>String(t.name||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase()===target.normalize('NFD').replace(/[\u0300-\u036f]/g,''))||null;
}
export function gradeEntries(coursework,submissions,topicId){
 const work=(coursework||[]).filter(t=>String(t.topicId)===String(topicId)&&t.state==='PUBLISHED'&&['ASSIGNMENT','SHORT_ANSWER_QUESTION','MULTIPLE_CHOICE_QUESTION'].includes(t.workType)&&Number(t.maxPoints)>0);
 work.sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 const map=new Map();for(const t of work)map.set(String(t.id),t);
 const rows=[];
 for(const s of submissions||[]){const t=map.get(String(s.courseWorkId));if(!t)continue;
  const assigned=s.assignedGrade;
  rows.push({google_user_id:String(s.userId||''),work_id:String(t.id),title:String(t.title||''),max_points:Number(t.maxPoints),points:assigned===undefined||assigned===null?null:Number(assigned),state:String(s.state||''),late:!!s.late});
 }
 rows.sort((a,b)=>`${a.google_user_id}|${a.work_id}`.localeCompare(`${b.google_user_id}|${b.work_id}`));
 return {work:work.map(t=>({id:String(t.id),title:String(t.title||''),max_points:Number(t.maxPoints),auto_exclude:/\b(EXAMEN|EXÁMEN|EXAM|PRUEBA)\b/i.test(t.title||'')})),rows};
}
export function computeClassroomGrade(work,rows,studentId,excludedWorkIds=[],decisions=[]){
 const ignore=new Set(excludedWorkIds.map(String));const tasks=work.filter(x=>!ignore.has(String(x.id)));
 const dm=new Map(decisions.map(x=>[`${x.google_user_id}|${x.work_id}`,x.action]));
 let earned=0,possible=0;const unresolved=[];
 for(const task of tasks){const row=rows.find(r=>r.google_user_id===studentId&&r.work_id===task.id);
  if(row?.points!==null&&row?.points!==undefined){if(!Number.isFinite(row.points)||row.points<0||row.points>task.max_points)throw new Error('Classroom devolvió puntos inválidos.');earned+=row.points;possible+=task.max_points;continue;}
  const decision=dm.get(`${studentId}|${task.id}`);
  if(decision==='zero'){possible+=task.max_points;continue;}
  if(decision==='exclude')continue;
  unresolved.push(task.id);
 }
 return {earned,possible,grade:possible>0?Math.round((earned/possible)*1000)/100:null,unresolved};
}
