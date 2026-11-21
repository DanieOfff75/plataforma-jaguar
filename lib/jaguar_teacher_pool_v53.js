/* Jaguar V53 - helpers puros de bolsa y cobertura. No reasigna alumnos ni calificaciones. */
export const ROLES_POOL = ['servicios_docentes','coordinacion_academica','direccion_escolar'];
export const TYPES = ['recuperacion','recursamiento','suplencia'];
export const MODES = ['regularizacion','reserva','mixto'];
export function cycleValid(v){const m=/^(\d{4})-(\d{4})(?:\/([1-9]))?$/.exec(String(v||''));return Boolean(m&&Number(m[2])===Number(m[1])+1);}
export function id(v){const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:0;}
export function isActive(t){return Boolean(t&&t.activo===true&&!['archivado','baja','inactivo','suspendido'].includes(String(t.estado_profesional||'activo').toLowerCase())&&!t.suspension_fecha);}
export function timeMinutes(t){const m=/^(\d\d):(\d\d)(?::\d\d)?$/.exec(String(t||''));return m?Number(m[1])*60+Number(m[2]):null;}
export function scheduleMinutes(s){const a=timeMinutes(s.hora_inicio),b=timeMinutes(s.hora_fin);return a==null||b==null||b<=a?0:b-a;}
export function summary({groupSubjects=[],assignments=[],schedules=[],teachers=[],pools=[],candidates=[]}){
 const aByGm=new Map(),schedByGm=new Map(),byTeacher=new Map();
 for(const a of assignments){if(a.activo!==true)continue;const k=id(a.grupo_materia_id);if(!k)continue;const rows=aByGm.get(k)||[];rows.push(a);aByGm.set(k,rows);}
 for(const h of schedules){const k=id(h.grupo_materia_id),minutes=scheduleMinutes(h);if(!k||minutes<=0)continue;schedByGm.set(k,(schedByGm.get(k)||0)+minutes);if(id(h.docente_id))byTeacher.set(id(h.docente_id),(byTeacher.get(id(h.docente_id))||0)+minutes);}
 const lessons=groupSubjects.filter(g=>g.activo!==false&&g.grupos?.activo!==false&&g.materias?.activa!==false).map(g=>{
  const a=aByGm.get(id(g.id))||[],mins=schedByGm.get(id(g.id))||0;
  const hours=Number(g.horas_semana??g.materias?.horas_semana??0);
  const declared=Number.isFinite(hours)&&hours>0?hours:0;
  const totalAssigned=a.reduce((sum,x)=>sum+Math.max(0,Number(x.horas_asignadas)||0),0);
  return {id:id(g.id),group:g.grupos?.clave||`Grupo ${g.grupo_id}`,subject:g.materias?.nombre||`Materia ${g.materia_id}`,group_id:id(g.grupo_id),subject_id:id(g.materia_id),weekly_declared:declared,weekly_scheduled_minutes:mins||null,assigned_hours:totalAssigned,owners:a.map(x=>({id:id(x.docente_id),hours:Number(x.horas_asignadas)||0})),open:!a.length};
 });
 const loads=teachers.map(t=>({id:id(t.id),name:t.nombre_completo,active:isActive(t),requested:Number(t.horas_solicitadas)||0,scheduled_minutes:byTeacher.get(id(t.id))||0,assigned_hours:assignments.filter(a=>a.activo===true&&id(a.docente_id)===id(t.id)).reduce((s,a)=>s+(Number(a.horas_asignadas)||0),0),pool:pools.find(p=>id(p.docente_id)===id(t.id))||null}));
 return {lessons,loads,totals:{teachers:loads.filter(x=>x.active).length,subjects:lessons.length,vacancies:lessons.filter(x=>x.open).length,pool:pools.filter(x=>x.estado==='aprobado').length,candidates:candidates.filter(x=>x.estado==='vigente').length}};
}
export function poolAllows(pool,type){return Boolean(pool&&pool.estado==='aprobado'&&TYPES.includes(type)&&pool[type]===true);}
export function canNominate({teacher,pool,groupSubject,assignments,type}){if(!isActive(teacher))return 'El docente debe estar activo y sin suspensión.';if(!poolAllows(pool,type))return 'El docente no tiene una candidatura aprobada para este tipo de atención.';if(!groupSubject||groupSubject.activo===false||groupSubject.materias?.activa===false)return 'La materia ya no está activa.';if((pool.materias_ids||[]).length&&!(pool.materias_ids||[]).map(id).includes(id(groupSubject.materia_id)))return 'La especialidad declarada no incluye esta materia.';if(type==='suplencia'&&(assignments||[]).some(a=>a.activo===true&&id(a.docente_id)===id(teacher.id)&&id(a.grupo_materia_id)===id(groupSubject.id)))return 'El docente ya es titular de esa materia.';return null;}
