// Consulta y autorización independientes de la planificación.
const fail=(message,status=400)=>Object.assign(Error(message),{status});
export function validateSubjectPreview(body){
 const {cycle,subject,mode,minAP}=body||{};
 if(typeof cycle!=='string'||!/^\d{4}-\d{4}(?:\/[1-9])?$/.test(cycle)||Number(cycle.slice(5,9))!==Number(cycle.slice(0,4))+1)throw fail('Selecciona un ciclo válido.');
 if(typeof subject!=='string'||!/^([1-9][0-9]{0,18})$/.test(subject)||BigInt(subject)>9223372036854775807n)throw fail('Selecciona una materia válida.');
 if(!['numerica','cualitativa'].includes(mode))throw fail('Selecciona un modo válido.');
 if(mode==='cualitativa'&&(typeof minAP!=='string'||!/^\d{1,2}(?:\.\d{1,6})?$/.test(minAP)||Number(minAP)<=0||Number(minAP)>10))throw fail('El mínimo AP debe ser mayor que 0 y hasta 10, con máximo 6 decimales.');
 return {p_ciclo:cycle,p_materia:subject,p_modo:mode,p_min_ap:mode==='cualitativa'?minAP:null};
}
export async function subjectEvaluationPreview(req,res,{user,profile,adminClient:db}){
 if(req.method!=='POST'||!['preview_subject_mode','apply_subject_mode'].includes(req.body?.action))return false;
 if(!['direccion_escolar','control_escolar','control','coordinacion_academica'].includes(profile.rol))throw fail('Sin atribución.',403);
 const args=validateSubjectPreview(req.body);
 const apply=req.body.action==='apply_subject_mode';
 if(apply){
  if(profile.rol!=='direccion_escolar')throw fail('Solo Dirección Escolar autoriza cambios.',403);
  const {origin,host}=req.headers||{};try{if(!origin||new URL(origin).host!==(req.headers?.['x-forwarded-host']||host))throw Error()}catch{throw fail('Origen no autorizado.',403)}
  const {confirmed,hash,reason}=req.body;
  if(confirmed!==true||typeof hash!=='string'||!/^[a-f0-9]{32}$/.test(hash)||typeof reason!=='string'||reason.trim().length<15||reason.length>1500)throw fail('Confirma la consulta y escribe un motivo válido.');
  Object.assign(args,{p_huella:hash,p_motivo:reason.trim()});
 }
 const {data,error}=await db.rpc(apply?'jaguar360_aplicar_modo_materia':'jaguar360_previsualizar_modo_materia',{p_actor:user.id,...args});
 if(error){if(error.code==='42501')throw fail('Sin atribución.',403);if(error.code==='55P03')throw fail('Otra operación académica está en curso. Vuelve a consultar.',409);if(error.code==='P0001')throw fail(error.message,409);throw fail('No se pudo consultar el impacto de la materia ('+(String(error.code||'').match(/^[A-Z0-9]{5,10}$/)?.[0]||'sin código')+'). Comprueba la instalación de la migración V40.',503);}
 if(apply){if(data?.aplicado!==true)throw fail('No se confirmó el cambio.',503);res.status(200).json({ok:true,data});return true;}
 if(data?.solo_lectura!==true||!Array.isArray(data.periodos))throw fail('Respuesta de consulta incompatible.',503);
 res.status(200).json({ok:true,data});return true;
}
