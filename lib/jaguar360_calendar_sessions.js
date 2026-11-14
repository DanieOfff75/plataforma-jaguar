import {projectCalendar} from './jaguar360_calendar_projection.js';
import {validateEvidence,evidenceId} from './jaguar_history_evidence.js';
const clock=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
/** Reconstruct the entire reviewed projection on the server, never from UI preview rows. */
export function calendarSessions(context,week,calendar,{withTeachers=false}={}){
 const id=evidenceId(calendar.id);
 if(calendar.state!=='reviewed'||!calendar.current||!week.current||week.state!=='reviewed'||calendar.week!==week.id)throw Error('Calendario o semana no revisados o desactualizados.');
 const result=projectCalendar(context,week.proposal,calendar.events,{full:true});
 if(result.period!==calendar.period||result.sessionCount!==calendar.sessionCount||JSON.stringify(result.summary.map(sortKeys))!==JSON.stringify(calendar.summary.map(sortKeys)))throw Error('La proyección no coincide con el expediente revisado.');
 const rows=result.rows.map(r=>({grupo_materia_id:r.groupSubject,fecha:r.date,inicio:clock(r.start),fin:clock(r.end),estado:r.state==='proposed_suspension'?'cancelada':'programada',referencia:`Calendario #${id} · ${r.state}${r.reference?' · '+r.reference:''}`.slice(0,350)}));
 const evidence=validateEvidence('sesiones',{rows});
 if(withTeachers) evidence.teachers=result.rows.map(r=>({grupo_materia_id:evidenceId(r.groupSubject),fecha:r.date,inicio:clock(r.start),docente_id:evidenceId(r.teacher)}));
 return evidence;
}
const sortKeys=x=>Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]]));
