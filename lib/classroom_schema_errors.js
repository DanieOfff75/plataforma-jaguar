/** Traduce fallos PostgREST de Classroom sin revelar datos ni ocultar otros errores. */
export const CLASSROOM_DATA_TABLES = Object.freeze([
  'jaguar_classroom_alumnos',
  'jaguar_classroom_trabajos_tipo',
  'jaguar_classroom_importaciones'
]);
export const CLASSROOM_GRADE_RPC = 'jaguar_classroom_importar_rubrica';

export function classroomDbProblem(error) {
  const code = String(error?.code || '').toUpperCase();
  // Los mensajes de PostgREST pueden variar entre versiones; sólo buscamos nombres permitidos.
  const source = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
  const resource = [...CLASSROOM_DATA_TABLES, CLASSROOM_GRADE_RPC]
    .find(name => source.includes(name));
  const missing = code === '42P01' || code === 'PGRST205' ||
    (resource && resource !== CLASSROOM_GRADE_RPC &&
      /could not find (the )?table|does not exist|schema cache|relation .* does not exist/i.test(source));
  if (code === '42703' || (resource && /column .*does not exist|could not find the .*column/i.test(source))) return {
    status: 409,
    message: resource
      ? `La estructura de «${resource}» no coincide con el código de Jaguar. Revisa las columnas faltantes en el diagnóstico V5.8.7; no borres la tabla.`
      : 'Falta una columna requerida por Classroom. Revisa el diagnóstico de columnas V5.8.7.',
    code, resource: resource || null
  };
  if (missing) return {
    status: 409,
    message: resource && resource !== CLASSROOM_GRADE_RPC
      ? `Supabase no encuentra «public.${resource}». Ejecuta el diagnóstico SQL de Classroom y, si falta, la reparación de tablas V5.8.7. No es necesario reconectar Google.`
      : 'Supabase no encuentra una tabla requerida por Classroom. Ejecuta el diagnóstico SQL V5.8.7 antes de instalar nada.',
    code, resource: resource || null
  };
  if (code === 'PGRST202' || (resource === CLASSROOM_GRADE_RPC && /schema cache|could not find the function|does not exist/i.test(source))) return {
    status: 409,
    message: `Supabase no encuentra la función public.${CLASSROOM_GRADE_RPC} con la firma esperada. Compruébala en el diagnóstico V5.8.7 y restaúrala sólo si falta.`,
    code, resource: CLASSROOM_GRADE_RPC
  };
  if (code === '42501' || /permission denied/i.test(source)) return {
    status: 403,
    message: 'Supabase rechazó el acceso al registro de Classroom. Comprueba los permisos de service_role con el diagnóstico V5.8.7; no compartas tu clave.',
    code, resource: resource || null
  };
  if (code === '23505') return {status:409,message:'Ya existe una asociación de Classroom con esos identificadores. Revisa la matrícula o el trabajo antes de reintentar.',code,resource:null};
  if (code === '23503') return {status:409,message:'El registro de Classroom se refiere a una matrícula, rúbrica o periodo inexistente. Comprueba la asignación.',code,resource:null};
  return {status:502,message:'Supabase no completó la operación de Classroom. Revisa en Vercel el código del error y ejecuta el diagnóstico V5.8.7; no repitas la importación a ciegas.',code,resource:null};
}
