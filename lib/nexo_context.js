/** NEXO 4.0: rol y portal derivados solo de una sesión comprobada por el servidor. */
const MODULES={
 jaguar:{visitante:['Acceso público','Recuperación de cuenta'],alumno:['Inicio','Mis calificaciones','Mi horario','Mi asistencia','Mis pagos','Solicitudes'],docente:['Mis grupos','Calificaciones','Planeaciones','Asistencia','Horario'],direccion_escolar:['Resumen institucional','Usuarios','Autorizaciones','Alumnos','Grupos','Materias','Planeaciones','Auditoría'],control_escolar:['Alumnos','Inscripciones','Grupos','Documentos','Solicitudes'],coordinacion_academica:['Materias','Docentes','Asignaciones','Horarios'],servicios_docentes:['Carga docente','Grupos','Planeaciones'],servicios_estudiantiles:['Talleres','Solicitudes','Credenciales'],archivo_escolar:['Archivo Escolar','Documentos','Retención'],prefectura:['Incidencias'],recursos_monetarios:['Recursos monetarios']},
 admisiones:{visitante:['Convocatorias publicadas','Registro habilitado','Consulta de estatus'],control_escolar:['Solicitudes','Exámenes','Resoluciones','Inscripción confirmada'],direccion_escolar:['Supervisión','Autorizaciones de convocatorias']},
 centro:{visitante:[],tecnico:['Infraestructura','Seguridad','Monitoreo','Auditoría','NEXO'],direccion_escolar:['Autorizaciones académicas','Gobierno institucional','Conocimiento NEXO','Identidad']}
};
const ALIASES={control:'control_escolar',admin_tecnico:'tecnico',administrador_tecnico:'tecnico'};
export function nexoTrustedContext(site,role=null){
 const app=Object.hasOwn(MODULES,site)?site:'jaguar';
 const raw=typeof role==='string'?role.toLowerCase().trim():'';
 const normalized=ALIASES[raw]||raw;
 const verified=Boolean(raw&&Object.hasOwn(MODULES[app],normalized));
 const rol=verified?normalized:'visitante';
 return {aplicacion:app,superficie:verified?'autenticada':'publica',session_verificada:verified,rol_verificado:rol,modulos_orientativos:MODULES[app][rol]||[],restricciones:'Solo orientación. NEXO no ve expedientes, pantallas abiertas o datos privados, ni realiza cambios.'};
}
