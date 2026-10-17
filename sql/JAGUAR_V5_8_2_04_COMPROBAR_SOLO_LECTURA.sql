-- JAGUAR V5.8.2 | Comprobación segura; NO asigna ni modifica horarios.
SELECT tipo_espacio, count(*) AS espacios,
       count(*) FILTER (WHERE activo) AS activos
FROM public.jaguar_aulas GROUP BY tipo_espacio ORDER BY tipo_espacio;

SELECT tgname AS trigger, tgenabled AS estado
FROM pg_trigger
WHERE tgrelid = 'public.horarios'::regclass
  AND tgname IN ('jaguar_prevenir_choque_aula_horarios','jaguar_solo_aula_ordinaria_en_horarios')
UNION ALL
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgrelid = 'public.jaguar_aulas'::regclass
  AND tgname = 'jaguar_no_reclasificar_aula_asignada';
