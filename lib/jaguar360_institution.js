/** Institutional records are documentary. This module never grants permissions. */
const fail=m=>{throw Error(m)};
export const departments=['control_escolar','coordinacion_academica','servicios_docentes','prefectura','servicios_estudiantiles','archivo_escolar','recursos_monetarios'];
export const scopes={control_escolar:['expedientes','inscripciones','documentacion'],coordinacion_academica:['planeaciones','horarios','regularizacion'],servicios_docentes:['expedientes_docentes','disponibilidad','cobertura'],prefectura:['incidencias','justificantes'],servicios_estudiantiles:['tramites','apoyos'],archivo_escolar:['resguardo','tramites_archivo'],recursos_monetarios:['registro_administrativo']};
const pick=(v,a,label)=>a.includes(v)?v:fail(label+' inválido.');
const txt=(v,min,max,label)=>typeof v==='string'&&v.trim().length>=min&&v.trim().length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v)?v.trim():fail(label+' inválido.');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)?v.toLowerCase():fail('Identidad inválida.');
const id=v=>typeof v==='string'&&/^[1-9]\d{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n?v:fail('Referencia interna inválida.');
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v?v:fail('Fecha inválida.');
const ver=v=>Number.isSafeInteger(v)&&v>=1&&v<=2147483647?v:fail('Versión inválida.');
export function institutionalRequest(b){
 if(b.confirmed!==true)fail('Confirma la operación.');
 const op=pick(b.operation,['propose','approve','reject','revoke'],'Operación'),reason=txt(b.reason,15,1500,'Motivo'),reference=txt(b.reference,5,300,'Referencia');
 if(op!=='propose')return {op,reason,reference,id:id(b.id),version:ver(b.version)};
 const p=b.record;if(!p||typeof p!=='object'||Array.isArray(p))fail('Registro requerido.');
 const kind=pick(p.kind,['appointment','delegation'],'Tipo'),department=pick(p.department,departments,'Departamento'),person=uuid(p.person),start=date(p.start),end=p.end==null||p.end===''?null:date(p.end);
 if(end&&end<start)fail('Vigencia invertida.');
 const record={kind,department,person,start,end};
 if(kind==='appointment'){
  const title=pick(p.title,['titular','suplente','encargado','auxiliar'],'Cargo');if(title!=='titular'&&!end)fail('Un cargo temporal requiere fin de vigencia.');
  record.title=title;
  if(title==='titular'){
   const h=p.handover;if(!h||typeof h!=='object')fail('Entrega–recepción requerida.');
   const mode=pick(h.mode,['initial','participated','absent'],'Entrega–recepción');
   const previous=mode==='initial'?null:uuid(h.previous);
   if(previous===person)fail('Titulares saliente y entrante deben ser distintos.');
   record.handover={mode,previous,inventory:txt(h.inventory,15,3000,'Inventario y pendientes'),reference:txt(h.reference,5,300,'Referencia de entrega–recepción')};
  }
 }else{
  if(!end)fail('La delegación debe caducar.');
  record.appointment=id(p.appointment);record.scope=pick(p.scope,scopes[department],'Atribución documental');
 }
 return {op,reason,reference,record};
}
export function mayResolve(actor,proposal){return actor.role==='direccion_escolar'&&actor.id!==proposal.actor&&actor.id!==proposal.record.person;}
