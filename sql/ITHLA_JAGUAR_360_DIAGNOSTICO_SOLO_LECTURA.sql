-- Solo lectura: no devuelve nombres, matrículas, notas, credenciales ni registros individuales.
-- Ejecutar en SQL Editor autorizado. Exportar solo el resultado de esta consulta.
WITH relevant AS (
 SELECT c.oid,c.relname,c.relrowsecurity,c.relforcerowsecurity
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p') AND (
 c.relname ~ '^(jaguar|ithla|periodos|ciclos|asignaciones|grupo|materia|alumno|docente|perfil|asistencia|calificacion|horario|rubrica|bitacora|departamento|encargado|oficio|documento|inscrip|admision|aspirante|incidencia)' )
)
SELECT jsonb_build_object(
 'tablas',(SELECT jsonb_agg(jsonb_build_object('tabla',r.relname,'rls',r.relrowsecurity,'force_rls',r.relforcerowsecurity,
  'columnas',(SELECT jsonb_agg(jsonb_build_object('nombre',a.attname,'tipo',pg_catalog.format_type(a.atttypid,a.atttypmod),'obligatoria',a.attnotnull) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped),
  'restricciones',(SELECT jsonb_agg(jsonb_build_object('nombre',con.conname,'tipo',con.contype,'definicion',pg_catalog.pg_get_constraintdef(con.oid)) ORDER BY con.conname) FROM pg_catalog.pg_constraint con WHERE con.conrelid=r.oid),
  'triggers',(SELECT jsonb_agg(jsonb_build_object('nombre',t.tgname,'estado',t.tgenabled,'funcion',p.proname) ORDER BY t.tgname) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid=r.oid AND NOT t.tgisinternal),
  'politicas',(SELECT jsonb_agg(jsonb_build_object('nombre',p.policyname,'roles',p.roles,'operacion',p.cmd) ORDER BY p.policyname) FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename=r.relname)) ORDER BY r.relname) FROM relevant r),
 'funciones',(SELECT jsonb_agg(jsonb_build_object('nombre',p.proname,'argumentos',pg_catalog.pg_get_function_identity_arguments(p.oid),'security_definer',p.prosecdef) ORDER BY p.proname) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname ~ '^(jaguar|ithla)')
) AS diagnostico;
