-- Jaguar V53. Lectura y pruebas de esquema. No modifica datos.
SELECT t.relname AS tabla,c.relrowsecurity AS rls_habilitada,
  has_table_privilege('authenticated','public.'||t.relname,'SELECT') AS lectura_publica,
  has_table_privilege('service_role','public.'||t.relname,'SELECT') AS lectura_servidor
FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE n.nspname='public' AND t.relname IN ('jaguar_docente_bolsa_v53','jaguar_docente_candidaturas_v53')
ORDER BY t.relname;
SELECT 'docentes' AS origen,COUNT(*) AS total FROM public.docentes
UNION ALL SELECT 'grupos/materias',COUNT(*) FROM public.grupo_materias
UNION ALL SELECT 'bolsa V53',COUNT(*) FROM public.jaguar_docente_bolsa_v53
UNION ALL SELECT 'candidaturas V53',COUNT(*) FROM public.jaguar_docente_candidaturas_v53;
