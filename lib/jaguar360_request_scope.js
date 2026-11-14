// Ordinary requests are not grade clarifications. Typed requests have an institutional owner.
export const requestRoles=['direccion_escolar','control_escolar','servicios_estudiantiles','servicios_docentes','prefectura','coordinacion_academica'];
export const requestTypes=['grupo','grado','turno','taller','otro'];
export const requestRole=r=>r==='control'?'control_escolar':r;
export function requestOwner(row){
 if(row?.tipo==='grupo')return 'control_escolar';
 if(['grado','turno','taller'].includes(row?.tipo))return 'servicios_estudiantiles';
 if(row?.tipo==='otro'&&requestRoles.includes(requestRole(row.departamento_destino)))return requestRole(row.departamento_destino);
 return null;
}
export function canReadRequest(role,row){
 role=requestRole(role);
 return requestTypes.includes(row?.tipo)&&requestRoles.includes(role)&&(role==='direccion_escolar'||requestOwner(row)===role);
}
export function scopedRequests(query,role){
 role=requestRole(role);
 if(!requestRoles.includes(role))throw Object.assign(Error('Este departamento no administra solicitudes.'),{status:403});
 if(role==='direccion_escolar')return query.in('tipo',requestTypes);
 const typed=role==='control_escolar'?'tipo.eq.grupo,':role==='servicios_estudiantiles'?'tipo.in.(grado,turno,taller),':'';
 return query.or(`${typed}and(tipo.eq.otro,departamento_destino.eq.${role})`);
}
export function requestId(value){
 if(typeof value==='number'&&!Number.isSafeInteger(value))return null;
 if(typeof value!=='string'&&typeof value!=='number')return null;
 const s=String(value);return /^[1-9]\d{0,18}$/.test(s)&&BigInt(s)<=9223372036854775807n?s:null;
}
