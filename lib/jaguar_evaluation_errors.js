/** Traduce errores del RPC de Supabase en mensajes útiles sin revelar detalles de la BD. */
export function explainEvaluationSaveError(error){
 const code=String(error?.code||'').trim().toUpperCase();
 const msg=String(error?.message||'').toLowerCase();
 if(code==='PGRST202'||code==='42883'||msg.includes('could not find the function')||msg.includes('function public.jaguar_abrir_cerrar_evaluacion')||msg.includes('schema cache')){
   return {status:409,code:'EVAL_RPC_AUSENTE',message:'La función de apertura no está instalada o Supabase aún no la reconoce. Ejecuta sql/ITHLA_V15_2_CORREGIR_APERTURA_EVALUACIONES.sql y vuelve a intentarlo.'};
 }
 if(code==='42501'||code==='PGRST301'){
   return {status:403,code:'EVAL_PERMISOS_SQL',message:'Supabase rechazó la autorización para abrir evaluaciones. Actualiza la función SQL V15.2 y comprueba la clave de servicio configurada en Vercel.'};
 }
 if(code==='23514'||msg.includes('periodo no existe')||msg.includes('periodo no válido')){
   return {status:409,code:'EVAL_PERIODO_INACTIVO',message:'Este periodo no está activo. Revisa el ciclo escolar y el estado del periodo antes de habilitar la captura.'};
 }
 if(['42P01','42703','23503','PGRST204'].includes(code)){
   return {status:409,code:'EVAL_ESQUEMA_INCOMPLETO',message:'La estructura de ventanas de evaluación no coincide con la base de datos. Ejecuta la corrección SQL V15.2 en Supabase.'};
 }
 return {status:500,code:code?`EVAL_DB_${code}`:'EVAL_DB_ERROR',message:'Supabase no pudo guardar la apertura. Consulta el registro de Vercel con el código indicado; no se modificó el estado.'};
}
