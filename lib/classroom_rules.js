/** Reglas puras para registro de Classroom. No crea recursos de Google. */
export const CLASSROOM_MANAGERS=['servicios_docentes'];
export const CLASSROOM_READERS=['servicios_docentes','docente','coordinacion_academica','control_escolar','control','direccion_escolar'];
export function cleanText(s,max=120){return String(s??'').trim().replace(/[\x00-\x1f\x7f]/g,' ').slice(0,max);}
export function classCode(s){const v=cleanText(s,30);if(!v)return null;if(!/^[a-zA-Z0-9]{4,15}$/.test(v))throw new Error('El código de Classroom debe tener de 4 a 15 letras o números.');return v.toLowerCase();}
export function classroomLink(s){const v=cleanText(s,500);if(!v)return null;let u;try{u=new URL(v);}catch{throw new Error('El enlace de Classroom no es una URL válida.');}
 if(u.protocol!=='https:'||u.hostname!=='classroom.google.com'||u.username||u.password||u.port)throw new Error('Usa un enlace HTTPS de classroom.google.com.');
 if(!/(^|\/)c\/[a-zA-Z0-9_-]+(?:\/|$)/.test(u.pathname))throw new Error('El enlace debe conducir a una clase de Google Classroom.');
 return u.href;
}
export function cleanRecord(raw){
 const groupMateriaId=Number(raw.grupo_materia_id);
 if(!Number.isSafeInteger(groupMateriaId)||groupMateriaId<1)throw new Error('Selecciona una materia y grupo válidos.');
 const teacherId=raw.docente_id==null||raw.docente_id===''?null:Number(raw.docente_id);
 if(teacherId!==null&&(!Number.isSafeInteger(teacherId)||teacherId<1))throw new Error('Selecciona un docente válido.');
 const codigo_union=classCode(raw.codigo_union),enlace_clase=classroomLink(raw.enlace_clase);
 const nombre=cleanText(raw.nombre,150),descripcion=cleanText(raw.descripcion,800),google_course_id=cleanText(raw.google_course_id,70)||null;
 if(google_course_id&&!/^[a-zA-Z0-9_-]{4,70}$/.test(google_course_id))throw new Error('El ID de Google Classroom contiene caracteres inválidos.');
 if(!nombre||nombre.length<4)throw new Error('Escribe un nombre de clase de al menos cuatro caracteres.');
 const estado=String(raw.estado||'pendiente');
 if(!['pendiente','registrada','archivada'].includes(estado))throw new Error('Estado de clase no admitido.');
 if(estado==='registrada'&&(!codigo_union||!enlace_clase))throw new Error('Para marcar una clase como registrada necesitas código y enlace.');
 if(codigo_union&&!enlace_clase)throw new Error('Para guardar un código también debes registrar el enlace de la clase.');
 return {grupo_materia_id:groupMateriaId,docente_id:teacherId,nombre,descripcion,codigo_union,enlace_clase,google_course_id,estado};
}
export function canReadCourse(role,docenteId,record){return role!=='docente'||(docenteId!=null&&Number(record.docente_id)===Number(docenteId));}
