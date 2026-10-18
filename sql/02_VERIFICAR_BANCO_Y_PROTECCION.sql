-- JAGUAR V5.8.6 | SOLO LECTURA. Confirmar tablas, RLS y permisos.
SELECT c.relname AS tabla, c.relrowsecurity AS rls_activo,
       has_table_privilege('service_role',c.oid,'SELECT') AS puede_consultar,
       has_table_privilege('service_role',c.oid,'INSERT') AS puede_insertar
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('jaguar_preguntas','jaguar_examenes')
  AND c.relkind IN ('r','p')
ORDER BY c.relname;

-- La garantía de exclusión en la BD depende del trigger, además del filtro JavaScript.
SELECT tgname AS trigger, tgenabled AS estado
FROM pg_trigger
WHERE tgrelid='public.horarios'::regclass
  AND tgname IN ('jaguar_solo_aula_ordinaria_en_horarios','jaguar_prevenir_choque_aula_horarios')
ORDER BY tgname;
