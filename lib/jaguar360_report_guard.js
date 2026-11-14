/** Refuse issue of a legacy document that cannot represent the actual historical evidence. */
export async function requireLegacyReportCompatible(admin,student,cycle){
 const {data,error}=await admin.rpc('jaguar360_boleta_bloqueos',{p_alumno:String(student),p_ciclo:cycle});
 if(error||typeof data?.allowed!=='boolean'||!Array.isArray(data.reasons))throw Object.assign(Error('No se pudo comprobar la compatibilidad de la boleta. Comprueba la migración V26.'),{status:503});
 if(!data.allowed||data.reasons.length)throw Object.assign(Error('La boleta anterior no representa este expediente de Jaguar 360. Consulta el historial de evaluación con Control Escolar.'),{status:409});
}
