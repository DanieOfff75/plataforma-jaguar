SELECT c.relname AS tabla, c.relrowsecurity AS rls,
 NOT has_table_privilege('anon',c.oid,'SELECT') AS anon_bloqueado,
 NOT has_table_privilege('authenticated',c.oid,'SELECT') AS usuario_directo_bloqueado,
 has_table_privilege('service_role',c.oid,'SELECT') AS servidor_lee,
 NOT has_table_privilege('service_role',c.oid,'DELETE') AS servidor_no_borra
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('jaguar_tutoria_asesores','jaguar_tutoria_observaciones');

SELECT 'jaguar_tutoria_listas_sesion' AS funcion,
 NOT has_function_privilege('anon','public.jaguar_tutoria_listas_sesion(uuid,bigint,bigint)','EXECUTE') AS anon_bloqueado,
 NOT has_function_privilege('authenticated','public.jaguar_tutoria_listas_sesion(uuid,bigint,bigint)','EXECUTE') AS usuario_directo_bloqueado,
 has_function_privilege('service_role','public.jaguar_tutoria_listas_sesion(uuid,bigint,bigint)','EXECUTE') AS servidor_lee;
