/** Reglas de ventanas de evaluación; el estado solo lo autoriza Dirección Escolar. */
export const evaluationWindowMessage = 'Dirección Escolar todavía no habilita la captura de calificaciones para este periodo. Puedes consultar lo ya registrado.';
export async function evaluationWindow(db,periodoId){
 const id=Number(periodoId);
 if(!Number.isSafeInteger(id)||id<1)throw Object.assign(new Error('Selecciona un periodo válido.'),{status:400});
 const {data:period,error:pe}=await db.from('periodos_escolares').select('id,nombre,ciclo_escolar,activo').eq('id',id).maybeSingle();
 if(pe)throw pe;if(!period)throw Object.assign(new Error('Periodo inexistente.'),{status:404});
 const {data,error}=await db.from('jaguar_evaluacion_ventanas').select('periodo_id,habilitada,actualizado_at').eq('periodo_id',id).maybeSingle();
 if(error)throw Object.assign(new Error('Falta instalar la migración de ventanas de evaluación en Supabase.'),{status:409});
 return {periodo:period,habilitada:Boolean(data?.habilitada&&period.activo!==false),actualizado_at:data?.actualizado_at||null};
}
export async function requireEvaluationOpen(db,periodoId){
 const status=await evaluationWindow(db,periodoId);
 if(!status.habilitada)throw Object.assign(new Error(evaluationWindowMessage),{status:409});
 return status;
}
