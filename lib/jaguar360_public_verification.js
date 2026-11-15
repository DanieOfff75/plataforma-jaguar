/** A QR certifies status, not the contents of a private academic expediente. */
export function publicVerificationRecord(row){
 const privateStudent=row.alumno_id!==null&&row.alumno_id!==undefined;
 // No field supplied by a document author is copied to the public response: even
 // an ostensibly public detail or title can contain a name or a grade.
 return {id:row.id,folio:row.folio,tipo:row.tipo,titulo:privateStudent?(row.tipo==='boleta'&&row.datos_publicos?.corte_provisional===true?'Boleta escolar provisional':'Documento escolar'):'Documento institucional',estado:row.estado,fecha_emision:row.fecha_emision,fecha_expiracion:row.fecha_expiracion,datos_publicos:{}};
}
export function canInspectPublicOriginal(row,status){return status==='valido'&&row.alumno_id===null;}
