/** Reconciliation contract. No historical membership or attended sessions are inferred. */
const error=m=>{throw new Error(m)};
const id=x=>{if(typeof x!=='string'||!(/^[1-9]\d{0,18}$/).test(x)||BigInt(x)>9223372036854775807n)error('Identificador bigint inválido (usar texto).');return x};
const date=x=>{if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x)||!Number.isFinite(Date.parse(x))||new Date(x).toISOString().slice(0,10)!==x)error('Fecha inválida.');return x};
const time=x=>{if(typeof x!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(x))error('Hora inválida (HH:mm).');return x};
const enumOf=(x,values)=>values.includes(x)?x:error('Estado no permitido.');
const source=x=>{if(typeof x!=='string'||x.trim().length<8||x.length>350)error('Indica referencia documental verificable (8 a 350 caracteres).');return x.trim()};
const list=(x,max)=>{if(!Array.isArray(x)||x.length>max)error('Lista inválida o demasiado extensa.');return x};
const obj=x=>{if(!x||typeof x!=='object'||Array.isArray(x))error('Registro inválido.');return x};
const unique=(rows,key)=>{const seen=new Set();for(const row of rows){const k=key(row);if(seen.has(k))error('Registro duplicado: '+k);seen.add(k)}return rows};
export function evidenceId(x){return id(x)}
export function validateEvidence(kind,payload){
 obj(payload);
 if(kind==='padron'){
  const rows=unique(list(payload.rows,20000).map(r=>{obj(r);const desde=date(r.desde),hasta=date(r.hasta);if(desde>hasta)error('Vigencia invertida.');return {alumno_id:id(r.alumno_id),grupo_materia_id:id(r.grupo_materia_id),desde,hasta,evaluacion:enumOf(r.evaluacion,['numerica','cualitativa','no_aplica']),referencia:source(r.referencia)}}),r=>r.alumno_id+'|'+r.grupo_materia_id);
  if(!rows.length)error('Padrón vacío: no se certifica por omisión.');
  return {rows};
 }
 if(kind==='cualitativas'){
  const v=payload.padron_version;if(!Number.isSafeInteger(v)||v<1||v>2147483647)error('Versión de padrón inválida.');
  const rows=unique(list(payload.rows,20000).map(r=>{obj(r);return {alumno_id:id(r.alumno_id),grupo_materia_id:id(r.grupo_materia_id),resultado:enumOf(r.resultado,['AP','RP']),referencia:source(r.referencia)}}),r=>r.alumno_id+'|'+r.grupo_materia_id);
  if(!rows.length)error('Sin resultados cualitativos documentados.');
  return {padron_version:v,rows};
 }
 if(kind==='marcas'){
  const version=v=>{if(!Number.isSafeInteger(v)||v<1||v>2147483647)error('Versión de evidencia inválida.');return v};
  const rows=unique(list(payload.rows,20000).map(r=>{obj(r);return {alumno_id:id(r.alumno_id),grupo_materia_id:id(r.grupo_materia_id),fecha:date(r.fecha),inicio:time(r.inicio),estado:enumOf(r.estado,['presente','retardo','falta','justificada']),referencia:source(r.referencia)}}),r=>[r.alumno_id,r.grupo_materia_id,r.fecha,r.inicio].join('|'));
  if(!rows.length)error('Sin marcas por sesión documentadas.');
  return {padron_version:version(payload.padron_version),sesiones_version:version(payload.sesiones_version),rows};
 }
 if(kind==='sesiones'){
  const rows=unique(list(payload.rows,30000).map(r=>{obj(r);const inicio=time(r.inicio),fin=time(r.fin);if(inicio>=fin)error('Franja invertida.');return {grupo_materia_id:id(r.grupo_materia_id),fecha:date(r.fecha),inicio,fin,estado:enumOf(r.estado,['programada','impartida','cancelada']),referencia:source(r.referencia)}}),r=>[r.grupo_materia_id,r.fecha,r.inicio].join('|'));
  if(!rows.length)error('Sin sesiones documentadas.');
  const ordered=rows.slice().sort((a,b)=>a.grupo_materia_id.localeCompare(b.grupo_materia_id)||a.fecha.localeCompare(b.fecha)||a.inicio.localeCompare(b.inicio));
  for(let i=1;i<ordered.length;i++){const a=ordered[i-1],b=ordered[i];if(a.grupo_materia_id===b.grupo_materia_id&&a.fecha===b.fecha&&a.fin>b.inicio)error('Dos sesiones de la misma asignación se traslapan.');}
  return {rows};
 }
 error('Tipo de evidencia inválido.');
}
/** Dates observed by legacy attendance are not proof of multiple sessions. */
export function legacyAttendanceMatch(sessions,records){
 const counts=new Map();for(const s of sessions){if(s.estado!=='impartida')continue;const k=s.grupo_materia_id+'|'+s.fecha;counts.set(k,(counts.get(k)||0)+1)}
 return records.map(r=>{const n=counts.get(r.grupo_materia_id+'|'+r.fecha)||0;return {...r,match:n===1?'unique_date':n>1?'ambiguous':'unmatched'}});
}
