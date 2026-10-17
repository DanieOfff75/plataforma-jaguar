/** Reglas puras: cuatro áreas, un dictamen firmado e inmutable por área y versión. */
export const PLANNING_DEPARTMENTS=Object.freeze([
  'servicios_docentes','coordinacion_academica','direccion_escolar','control_escolar'
]);
export const PLANNING_LABELS=Object.freeze({
  servicios_docentes:'Servicios Docentes',coordinacion_academica:'Coordinación Académica',
  direccion_escolar:'Dirección Escolar',control_escolar:'Control Escolar'
});
export function departmentForPlanningRole(role){
  const actual=role==='control'?'control_escolar':String(role||'');
  return PLANNING_DEPARTMENTS.includes(actual)?actual:null;
}
export function planningVerdictSummary(votes=[]){
  const byDepartment=new Map();
  for(const v of votes||[]){
    if(!PLANNING_DEPARTMENTS.includes(v.departamento)||byDepartment.has(v.departamento))continue;
    if(!['aprobada','rechazada'].includes(v.dictamen))continue;
    byDepartment.set(v.departamento,v);
  }
  const aprobaciones=[...byDepartment.values()].filter(v=>v.dictamen==='aprobada').length;
  const rechazos=[...byDepartment.values()].filter(v=>v.dictamen==='rechazada').length;
  const faltantes=PLANNING_DEPARTMENTS.filter(x=>!byDepartment.has(x));
  // Con dos rechazos ya no es matemáticamente posible alcanzar tres aprobaciones.
  const valida=aprobaciones>=3;
  const requiereApelacion=!valida&&(rechazos>=2||faltantes.length===0);
  return {aprobaciones,rechazos,faltantes,registrados:byDepartment.size,valida,requiereApelacion,
    estado:valida?'aprobada':requiereApelacion?'apelacion_requerida':'en_revision'};
}
export function planningRejectReason(value){
  const reason=String(value||'').trim();
  if(reason.length<30||reason.length>2000)throw Object.assign(new Error('Para rechazar, indica argumentos concretos de 30 a 2000 caracteres.'),{status:400});
  return reason;
}
