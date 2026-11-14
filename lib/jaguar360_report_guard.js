/** Refuse issue of a legacy document that cannot represent the actual historical evidence. */
export async function requireLegacyReportCompatible(admin,student,cycle){
 const {data,error}=await admin.rpc('jaguar360_boleta_bloqueos',{p_alumno:String(student),p_ciclo:cycle});
 if(error)throw Object.assign(Error('No se pudo comprobar la compatibilidad de la boleta · código '+(String(error.code||'').match(/^[A-Z0-9]{5,10}$/)?.[0]||'sin código')+'.'),{status:503});
 if(typeof data?.allowed!=='boolean'||!Array.isArray(data.reasons))throw Object.assign(Error('Respuesta de compatibilidad de boleta inválida.'),{status:503});
 if(!data.allowed||data.reasons.length)throw Object.assign(Error('La boleta anterior no representa este expediente de Jaguar 360. Consulta el historial de evaluación con Control Escolar.'),{status:409});
}
