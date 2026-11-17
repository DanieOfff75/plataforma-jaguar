-- Auditoría estructural V45 (consulta única de sólo lectura).
SELECT 'Memoria docente' AS comprobacion, to_regclass('public.jaguar_nexo_memoria_docente') IS NOT NULL AS correcto
UNION ALL SELECT 'Equivalencias curriculares',to_regclass('public.jaguar_nexo_curriculo') IS NOT NULL
UNION ALL SELECT 'RPC estadística',to_regprocedure('public.jaguar_nexo_corte_v45(uuid)') IS NOT NULL
UNION ALL SELECT 'RLS memoria',COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.jaguar_nexo_memoria_docente')),false)
UNION ALL SELECT 'RLS currículo',COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.jaguar_nexo_curriculo')),false)
UNION ALL SELECT 'RPC sólo servidor',COALESCE(has_function_privilege('service_role',to_regprocedure('public.jaguar_nexo_corte_v45(uuid)'),'EXECUTE') AND NOT has_function_privilege('anon',to_regprocedure('public.jaguar_nexo_corte_v45(uuid)'),'EXECUTE') AND NOT has_function_privilege('authenticated',to_regprocedure('public.jaguar_nexo_corte_v45(uuid)'),'EXECUTE'),false)
UNION ALL SELECT 'Memoria sin SELECT público',COALESCE(NOT has_table_privilege('anon',to_regclass('public.jaguar_nexo_memoria_docente'),'SELECT') AND NOT has_table_privilege('authenticated',to_regclass('public.jaguar_nexo_memoria_docente'),'SELECT'),false)
UNION ALL SELECT 'Currículo sin SELECT público',COALESCE(NOT has_table_privilege('anon',to_regclass('public.jaguar_nexo_curriculo'),'SELECT') AND NOT has_table_privilege('authenticated',to_regclass('public.jaguar_nexo_curriculo'),'SELECT'),false);
