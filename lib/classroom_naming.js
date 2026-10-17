/** Formato institucional de nuevas clases. Nunca infiere PROF./PROFA. a partir del nombre. */
function required(s, label){const v=String(s??'').trim().replace(/\s+/g,' ');if(!v)throw new Error(`${label} obligatorio.`);return v;}
export function classroomGroupLabel(group){
 const raw=required(group?.clave,'Grupo').toLocaleUpperCase('es-MX').replace(/\s+/g,'');
 // Claves institucionales: 1F, 1°F, 1ºF, 1° F, 1-F. La «°» va inmediatamente después del grado.
 const m=raw.match(/^(\d{1,2})(?:[°º.\-])?([A-ZÑ]{1,3})$/u);
 if(m)return `${m[1]}°${m[2]}`;
 // Si no podemos reconocerla, mejor rechazar que inventar un grado/grupo.
 throw new Error('La clave del grupo debe tener formato 1F, 1°F o equivalente. Revisa la clave en Control Escolar.');
}
export function classroomCourseLabel(group,subject){
 const label=required(subject,'Materia').toLocaleUpperCase('es-MX');
 const name=`${classroomGroupLabel(group)} | ${label}`;
 if(name.length>150)throw new Error('Nombre de Classroom demasiado largo.');
 return name;
}
export function classroomTeacherLabel(teacherName,treatment){
 const kind=String(treatment||'').trim().toUpperCase();
 if(!['PROF.','PROFA.'].includes(kind))throw new Error('Selecciona PROF. o PROFA. según corresponda al docente.');
 const name=required(teacherName,'Nombre del docente').toLocaleUpperCase('es-MX');
 const description=`${kind} ${name}`;
 if(description.length>800)throw new Error('Nombre del docente demasiado largo.');
 return description;
}
export function classroomCoursePayload(group,subject,teacherName,treatment){
 const name=classroomCourseLabel(group,subject),teacher=classroomTeacherLabel(teacherName,treatment);
 return {name,section:teacher,description:teacher,descriptionHeading:teacher,ownerId:'me',courseState:'PROVISIONED'};
}
export function normalizedClassroomName(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'').toLocaleUpperCase('es-MX');}
