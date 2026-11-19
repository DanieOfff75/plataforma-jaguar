-- V49. Tablas nuevas; no se modifican los registros académicos existentes.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar_tutoria_asesores (
 ciclo text NOT NULL CHECK (ciclo ~ '^[0-9]{4}-[0-9]{4}$'),
 grupo_id bigint NOT NULL REFERENCES public.grupos(id) ON DELETE RESTRICT,
 docente_id bigint REFERENCES public.docentes(id) ON DELETE RESTRICT,
 actualizado_por uuid NOT NULL,
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (ciclo, grupo_id)
);
ALTER TABLE public.jaguar_tutoria_asesores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar_tutoria_asesores FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.jaguar_tutoria_asesores TO service_role;
CREATE INDEX IF NOT EXISTS j_tutoria_docente ON public.jaguar_tutoria_asesores(ciclo, docente_id);
CREATE TABLE IF NOT EXISTS public.jaguar_tutoria_observaciones (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 grupo_id bigint NOT NULL REFERENCES public.grupos(id) ON DELETE RESTRICT,
 periodo_id bigint NOT NULL REFERENCES public.periodos_escolares(id) ON DELETE RESTRICT,
 docente_id bigint NOT NULL REFERENCES public.docentes(id) ON DELETE RESTRICT,
 texto text NOT NULL CHECK (char_length(btrim(texto)) BETWEEN 10 AND 1800),
 creado_en timestamptz NOT NULL DEFAULT now(),
 retirada_en timestamptz
);
ALTER TABLE public.jaguar_tutoria_observaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar_tutoria_observaciones FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.jaguar_tutoria_observaciones TO service_role;
REVOKE ALL ON SEQUENCE public.jaguar_tutoria_observaciones_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE public.jaguar_tutoria_observaciones_id_seq TO service_role;
CREATE INDEX IF NOT EXISTS j_tutoria_notas_periodo ON public.jaguar_tutoria_observaciones(grupo_id, periodo_id, id);
-- Lectura de listas versionadas V8 sin conceder SELECT general sobre la tabla original.
CREATE OR REPLACE FUNCTION public.jaguar_tutoria_listas_sesion(p_actor uuid, p_grupo bigint, p_periodo bigint)
RETURNS TABLE(grupo_materia_id bigint, fecha date, inicio text, marcas jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $tutoria_lectura$
 SELECT DISTINCT ON (l.grupo_materia_id, l.fecha, l.inicio)
   l.grupo_materia_id, l.fecha, l.inicio::text, l.marcas
 FROM public.jaguar360_listas_sesion AS l
 JOIN public.grupo_materias AS gm ON gm.id = l.grupo_materia_id AND gm.activo IS TRUE
 JOIN public.grupos AS g ON g.id = gm.grupo_id AND g.activo IS TRUE
 JOIN public.periodos_escolares AS pe ON pe.id = l.periodo_id
 JOIN public.jaguar_tutoria_asesores AS ta ON ta.grupo_id = g.id AND ta.ciclo = pe.ciclo_escolar
 JOIN public.docentes AS d ON d.id = ta.docente_id AND d.activo IS TRUE
 JOIN public.perfiles AS p ON p.id = d.auth_user_id AND p.activo IS TRUE AND p.rol = 'docente'
 WHERE pe.id = p_periodo AND g.id = p_grupo AND p.id = p_actor
   AND coalesce(d.estado_profesional, 'activo') NOT IN ('archivado', 'baja', 'inactivo', 'suspendido')
   AND (SELECT count(*) FROM public.periodos_escolares x WHERE x.es_periodo_actual IS TRUE) = 1
   AND EXISTS (SELECT 1 FROM public.periodos_escolares x WHERE x.es_periodo_actual IS TRUE AND x.ciclo_escolar = pe.ciclo_escolar)
 ORDER BY l.grupo_materia_id, l.fecha, l.inicio, l.version DESC;
$tutoria_lectura$;
REVOKE ALL ON FUNCTION public.jaguar_tutoria_listas_sesion(uuid,bigint,bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.jaguar_tutoria_listas_sesion(uuid,bigint,bigint) TO service_role;
COMMIT;
