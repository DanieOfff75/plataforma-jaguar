-- V5.8.7 / Paso 01. Reparación idempotente de tablas Classroom.
-- Probar con respaldo antes. No toca rubricas, notas, grupos ni clases Google.
-- Si ya existe una tabla con COLUMNAS INCOMPATIBLES, detener y mostrar el diagnóstico.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar_classroom_alumnos (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 google_course_id text NOT NULL,
 google_user_id text NOT NULL,
 alumno_id bigint NOT NULL REFERENCES public.alumnos(id),
 ciclo_escolar text NOT NULL,
 actualizado_por uuid NOT NULL REFERENCES auth.users(id),
 actualizado_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(google_course_id,google_user_id),
 UNIQUE(google_course_id,alumno_id)
);
CREATE TABLE IF NOT EXISTS public.jaguar_classroom_importaciones (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 rubrica_id bigint NOT NULL REFERENCES public.rubricas_evaluacion(id),
 componente_id bigint NOT NULL REFERENCES public.rubrica_componentes(id),
 google_course_id text NOT NULL,
 periodo_id bigint NOT NULL REFERENCES public.periodos_escolares(id),
 actor uuid NOT NULL REFERENCES auth.users(id),
 calificaciones integer NOT NULL,
 snapshot jsonb NOT NULL,
 creado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jaguar_classroom_imp_periodo_idx
 ON public.jaguar_classroom_importaciones(periodo_id,rubrica_id);
CREATE TABLE IF NOT EXISTS public.jaguar_classroom_trabajos_tipo (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 google_course_id text NOT NULL,
 google_work_id text NOT NULL,
 grupo_materia_id bigint NOT NULL REFERENCES public.grupo_materias(id),
 periodo_id bigint NOT NULL REFERENCES public.periodos_escolares(id),
 tipo text NOT NULL CHECK (tipo IN ('actividad','examen','excluir')),
 fuente_examen text CHECK (fuente_examen IN ('forms','classroom','manual')),
 google_form_id text,
 actualizado_por uuid NOT NULL REFERENCES auth.users(id),
 actualizado_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (google_course_id,google_work_id),
 CONSTRAINT jaguar_clasif_fuente_consistente CHECK (
  (tipo='examen' AND fuente_examen IS NOT NULL AND (fuente_examen='forms' OR google_form_id IS NULL))
  OR (tipo <> 'examen' AND fuente_examen IS NULL AND google_form_id IS NULL)
 )
);
CREATE UNIQUE INDEX IF NOT EXISTS jaguar_clasif_forms_no_dup
 ON public.jaguar_classroom_trabajos_tipo(google_course_id,periodo_id,google_form_id)
 WHERE google_form_id IS NOT NULL AND tipo='examen' AND fuente_examen='forms';
CREATE INDEX IF NOT EXISTS jaguar_clasif_course_period
 ON public.jaguar_classroom_trabajos_tipo(google_course_id,periodo_id);
ALTER TABLE public.jaguar_classroom_alumnos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar_classroom_importaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar_classroom_trabajos_tipo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar_classroom_alumnos,public.jaguar_classroom_importaciones,public.jaguar_classroom_trabajos_tipo FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.jaguar_classroom_alumnos,public.jaguar_classroom_importaciones TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.jaguar_classroom_trabajos_tipo TO service_role;
REVOKE ALL ON SEQUENCE public.jaguar_classroom_alumnos_id_seq,public.jaguar_classroom_importaciones_id_seq,public.jaguar_classroom_trabajos_tipo_id_seq FROM PUBLIC,anon,authenticated;
GRANT USAGE,SELECT ON SEQUENCE public.jaguar_classroom_alumnos_id_seq,public.jaguar_classroom_importaciones_id_seq,public.jaguar_classroom_trabajos_tipo_id_seq TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
