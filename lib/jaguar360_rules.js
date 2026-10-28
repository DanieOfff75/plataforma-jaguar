/** Catálogo compartido: la función SQL valida exactamente los mismos códigos de trámite. */
export const REQUEST_TYPES=Object.freeze([
 {id:'constancia_estudios',title:'Constancia de estudios',dept:'control_escolar'},
 {id:'boleta_certificada',title:'Boleta certificada',dept:'control_escolar'},
 {id:'historial_academico',title:'Historial académico',dept:'archivo_escolar'},
 {id:'aclaracion_documental',title:'Aclaración documental',dept:'archivo_escolar'},
 {id:'credencial_reposicion',title:'Reposición de credencial',dept:'servicios_estudiantiles'},
 {id:'consulta_taller',title:'Consulta de taller',dept:'servicios_estudiantiles'},
 {id:'revision_pago',title:'Revisión de pago',dept:'recursos_monetarios'},
 {id:'constancia_conducta',title:'Constancia de conducta',dept:'prefectura'}
]);
export const OPEN_STATES=['recibida','en_revision','requiere_aclaracion','lista_para_recoger'];
export const TERMINAL_STATES=['entregada','rechazada','cancelada'];
export const DESK_ROLES=[...new Set(REQUEST_TYPES.map(x=>x.dept)), 'control'];
export const ALL_ROLES=['alumno',...DESK_ROLES,'direccion_escolar','docente','servicios_docentes','coordinacion_academica'];
export const TYPE_LOOKUP=new Map(REQUEST_TYPES.map(x=>[x.id,x]));
export function validRequest(type,subject,detail){return TYPE_LOOKUP.has(type)&&String(subject||'').trim().length>=6&&String(subject||'').trim().length<=140&&String(detail||'').length<=1500;}
export function canView(role,request,subjectId){return role==='direccion_escolar'||(role==='alumno'&&request.solicitante_id===subjectId)||request.departamento===role||(role==='control'&&request.departamento==='control_escolar');}
export function canManage(role,request){return (role===request.departamento)||(role==='control'&&request.departamento==='control_escolar');}
export function canTransition(role,request,next){
 if(role==='alumno')return next==='cancelada'&&['recibida','requiere_aclaracion'].includes(request.estado);
 if(!canManage(role,request))return false;
 return ({recibida:['en_revision','requiere_aclaracion','rechazada'],en_revision:['lista_para_recoger','requiere_aclaracion','rechazada'],requiere_aclaracion:['en_revision','rechazada'],lista_para_recoger:['entregada']})[request.estado]?.includes(next)||false;
}
