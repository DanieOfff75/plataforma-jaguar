/* Jaguar · Organización visual únicamente. Los permisos reales permanecen en las APIs. */
(function(root){
 'use strict';
 const groups=[
  ['inicio','Inicio',['inicio','resumen']],
  ['escolar','Alumnos y grupos',['alumnos','grupos','listas','talleres','credenciales','horario','tutoria']],
  ['academico','Organización académica',['materias','cargas','horas_materias','horarios','aulas','classroom']],
  ['evaluacion','Evaluación y seguimiento',['calificaciones','bitacora_calificaciones','asistencia','ventanas_evaluacion','calificaciones_masivas','calificaciones_lote_grupo','examenes']],
  ['personal','Personal docente',['docentes','carga_docente','relevos_docentes','mis_relevos']],
  ['didactico','Trabajo didáctico',['planeaciones','centro_didactico']],
  ['atencion','Atención y trámites',['tramites_360','solicitudes_taller','solicitudes_academicas','cambios_especiales','revision_acceso','revision_acceso_alumno','clarificaciones','incidencias','archivo_solicitudes']],
  ['archivo','Documentación',['archivo','documentos_oficiales','documentos','retencion']],
  ['finanzas','Finanzas',['recursos_monetarios','mis_pagos']],
  ['comunicaciones','Comunicaciones',['notificaciones','avisos','oficios_firma','portal_publico']],
  ['institucion','Gobierno institucional',['modo_materia_360','planificacion_360','admision_control','departamentos','encargados','institucion','estadisticas']],
  ['sistema','Configuración y seguridad',['config','usuarios','auditoria','salud_360','sms_gateway']],
  ['perfil','Mi perfil',['perfil','config_docente']]
 ];
 const teacher=[
  ['inicio','Inicio',['inicio','resumen']],
  ['grupos','Mis grupos',['grupos','asistencia','calificaciones','bitacora_calificaciones','tutoria']],
  ['horario','Mi horario',['horario']],
  ['didactico','Centro didáctico',['planeaciones','centro_didactico','classroom','examenes']],
  ['comunicaciones','Comunicaciones',['notificaciones','avisos','clarificaciones','oficios_firma']],
  ['tramites','Mis trámites',['mis_relevos','archivo_solicitudes','tramites_360']],
  ['perfil','Mi perfil',['perfil','config_docente']]
 ];
 const student=[
  ['inicio','Inicio',['inicio','resumen']],
  ['academico','Vida académica',['calificaciones','asistencia']],
  ['horario','Mi horario',['horario']],
  ['tramites','Mis trámites',['tramites_360','solicitudes_taller','archivo_solicitudes','revision_acceso_alumno']],
  ['finanzas','Mis pagos',['mis_pagos']],
  ['comunicaciones','Comunicaciones',['notificaciones','avisos']],
  ['perfil','Mi perfil',['perfil']]
 ];
 const validKey=id=>typeof id==='string'&&/^[a-z0-9_]+$/i.test(id);
 function organize(items,role){
  const remaining=new Map();
  for(const row of items||[])if(Array.isArray(row)&&validKey(row[0])&&!remaining.has(row[0]))remaining.set(row[0],row);
  const catalog=role==='docente'?teacher:role==='alumno'?student:groups;
  const out=[];
  for(const [id,label,keys] of catalog){
   const entries=[];for(const key of keys){if(remaining.has(key)){entries.push(remaining.get(key));remaining.delete(key);}}
   if(entries.length)out.push({id,label,entries});
  }
  // Fail-open only for existing menu entries; never manufacture new permissions.
  if(remaining.size)out.push({id:'otros',label:'Otros módulos',entries:[...remaining.values()]});
  return out;
 }
 function positiveId(raw){const n=Number(raw);return Number.isSafeInteger(n)&&n>0?n:0;}
 const contextual=['grupos','asistencia','calificaciones','bitacora_calificaciones','tutoria','examenes','classroom'];
 function workspaceId(role,page,context){return role==='docente'&&contextual.includes(page)?positiveId(context?.gmId):0;}
 function matches(id,requested){return !requested||positiveId(id)===positiveId(requested);}
 root.JaguarWorkspaces=Object.freeze({organize,positiveId,workspaceId,matches});
})(typeof window==='undefined'?globalThis:window);
