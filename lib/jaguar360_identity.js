/** Existing matrícula is permanent; movement changes school placement, not identity. */
const fail=(m,status=409)=>Object.assign(Error(m),{status});
export function permanentMatricula(student){
 if(typeof student?.matricula!=='string'||!student.matricula.trim())throw fail('Matrícula sin conciliar; Control Escolar debe revisar el expediente.');
 return student.matricula;
}
export async function assertLegacyGroupMovement(db,groups){
 const ids=[...new Set(groups.filter(x=>x!=null).map(String))];
 if(!ids.length||ids.some(x=>!/^([1-9]\d{0,18})$/.test(x)||BigInt(x)>9223372036854775807n))throw fail('Grupo no conciliado.');
 const {data,error}=await db.rpc('jaguar360_grupos_gestionados',{p_grupos:ids});
 if(error||typeof data!=='boolean')throw fail('No se pudo verificar el ciclo de los grupos.',503);
 if(data)throw fail('Grupo administrado por Jaguar 360. Requiere el procedimiento de continuidad o movimiento autorizado; no se modifica desde el editor anterior.');
}
