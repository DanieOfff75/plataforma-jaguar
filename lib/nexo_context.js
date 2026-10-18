/** Contexto seguro; orientación sobre pantallas del sistema, no lecturas privadas. */
const MODULES={
 jaguar:{
  alumno:['Inicio','Calificaciones','Boleta','Horario','Avisos','Perfil'],
  docente:['Inicio','Grupos','Listas','Planeaciones','Carga docente','Evaluaciones','Avisos','Perfil'],
  direccion_escolar:['Inicio','Resumen institucional','Usuarios','Grupos','Materias','Horarios','Incidencias','Configuración'],
  control_escolar:['Inicio','Alumnos','Grupos','Documentos oficiales','Solicitudes','Perfil'],
  general:['Inicio','Avisos','Perfil']
 },
 admisiones:{direccion_escolar:['Convocatorias','Supervisión de Admisiones','Autorización de apertura o cierre'],control_escolar:['Consultar registros','Validar solicitudes','Exámenes','Resoluciones','Vinculación de inscripción'],general:['Consulta de estatus por folio y CURP','Registro sólo con convocatoria abierta']},
 centro:{tecnico:['Configuración','Propuestas','Seguridad','Auditoría','Monitoreo de NEXO'],direccion_escolar:['Autorizaciones','Identidad institucional','Admisiones','Conocimiento NEXO','Auditoría']}
};
export function nexoTrustedContext(site,role=null){
 const app=MODULES[site]||MODULES.jaguar;
 const normalizedRole=role==='control'?'control_escolar':role;
 const modules=normalizedRole?(app[normalizedRole]||app.general||[]):(app.general||[]);
 return {aplicacion:site,session_verificada:Boolean(role),rol_verificado:role||'visitante',modulos_orientativos:modules,
 restricciones:'Sólo orientación sobre uso y navegación. NEXO no ve páginas abiertas, expedientes privados, calificaciones ni puede hacer cambios. No afirmar que se realizaron consultas.'};
}
