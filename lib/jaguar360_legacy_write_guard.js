import {assertLegacyGroupMovement} from './jaguar360_identity.js';
/** Protect legacy generic endpoints. Dedicated workflows still perform their own role and window checks. */
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const identityFields=new Set(['nombre_completo','curp','fecha_nacimiento','sexo','matricula']);
export function assertGenericAcademicWrite(resource,mode,patch,role){
 if(['grades','attendance'].includes(resource))throw fail('La captura genérica antigua no valida el expediente completo. Usa Evaluaciones, Asistencias por sesión o Rectificaciones autorizadas.');
 if(resource!=='students')return;
 if(!['control_escolar','control'].includes(role))throw fail('Solo Control Escolar puede editar el expediente básico del alumno.',403);
 if(mode==='insert')throw fail('Usa el procedimiento de alta de Control Escolar o Admisiones, no el registro genérico.');
 if(!patch||Object.keys(patch).some(k=>!identityFields.has(k)))throw fail('El editor básico no puede modificar cuenta, estado, grupo, turno, grado ni suspensiones. Usa el procedimiento autorizado.');
}
/** Only legacy, active, identified students may be archived through the old path. */
export async function assertLegacyStudentDeparture(db,student){
 if(!student||student.activo!==true||student.estado_escolar!=='activo'||student.grupo_id==null)throw fail('El alumno no tiene una inscripción activa conciliada. Consulta su expediente.');
 await assertLegacyGroupMovement(db,[student.grupo_id]);
}
export function assertStudentSuspensionAccount(student){
 if(!student||student.activo!==true||!['activo','suspendido'].includes(student.estado_escolar))throw fail('La suspensión no permite reincorporar alumnos egresados, archivados, inactivos o dados de baja.');
}
