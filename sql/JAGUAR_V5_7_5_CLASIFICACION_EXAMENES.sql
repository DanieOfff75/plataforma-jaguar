-- V5.7.5: sólo clasifica evaluaciones publicadas en Google Classroom.
-- Requiere haber ejecutado V5.7.4. No modifica ni borra calificaciones.
BEGIN;
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
ALTER TABLE public.jaguar_classroom_trabajos_tipo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar_classroom_trabajos_tipo FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE public.jaguar_classroom_trabajos_tipo_id_seq FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.jaguar_classroom_trabajos_tipo TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.jaguar_classroom_trabajos_tipo_id_seq TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
