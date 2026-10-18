-- JAGUAR V5.8.6 | SOLO LECTURA. No modifica tablas, horarios ni calificaciones.
-- Resultado 1: tablas necesarias para Banco de Exámenes.
SELECT 'jaguar_preguntas' AS objeto,
       to_regclass('public.jaguar_preguntas') IS NOT NULL AS existe
UNION ALL
SELECT 'jaguar_examenes', to_regclass('public.jaguar_examenes') IS NOT NULL;

-- Resultado 2: tipos y disponibilidad de aulas ordinarias.
-- Si falla por columna tipo_espacio ausente, falta aplicar V5.8.2 (01).
SELECT codigo, nombre, tipo_espacio, activo,
       (tipo_espacio='aula' AND activo) AS puede_asignarse
FROM public.jaguar_aulas
ORDER BY codigo;

-- Resultado 3: triggers de protección en horarios y clasificación de aulas.
-- estado O = trigger habilitado en operaciones normales de PostgreSQL.
SELECT tgname AS trigger, tgenabled AS estado
FROM pg_trigger
WHERE (tgrelid='public.horarios'::regclass
  AND tgname IN ('jaguar_solo_aula_ordinaria_en_horarios','jaguar_prevenir_choque_aula_horarios'))
  OR (tgrelid='public.jaguar_aulas'::regclass
  AND tgname='jaguar_no_reclasificar_aula_asignada')
ORDER BY tgname;
