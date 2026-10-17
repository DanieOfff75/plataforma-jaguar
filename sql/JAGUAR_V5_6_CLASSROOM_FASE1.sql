-- JAGUAR V5.6 · Classroom etapa 1 (registro institucional/manual).
-- EJECUTAR PRIMERO EN SUPABASE SQL EDITOR DE PRUEBAS, con copia de seguridad.
-- Esta migración NO habilita la creación en Google ni almacena tokens OAuth.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar_classroom_clases (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 ciclo_escolar text NOT NULL CHECK(length(trim(ciclo_escolar)) BETWEEN 4 AND 30),
 grupo_materia_id bigint NOT NULL REFERENCES public.grupo_materias(id),
 docente_id bigint REFERENCES public.docentes(id),
 nombre text NOT NULL CHECK(length(trim(nombre)) BETWEEN 4 AND 150),
 descripcion text NOT NULL DEFAULT '',
 codigo_union text,
 enlace_clase text,
 google_course_id text,
 estado text NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','registrada','archivada')),
 origen text NOT NULL DEFAULT 'manual' CHECK(origen IN ('manual','google')),
 creado_por uuid REFERENCES auth.users(id),
 actualizado_por uuid REFERENCES auth.users(id),
 creado_at timestamptz NOT NULL DEFAULT now(),
 actualizado_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(ciclo_escolar,grupo_materia_id),
 CONSTRAINT jaguar_classroom_google_id_unique UNIQUE(google_course_id),
 CONSTRAINT jaguar_classroom_registrada_complete CHECK(estado <> 'registrada' OR (codigo_union IS NOT NULL AND enlace_clase IS NOT NULL)),
 CONSTRAINT jaguar_classroom_codigo_link_pair CHECK(codigo_union IS NULL OR enlace_clase IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS jaguar_classroom_docente_idx ON public.jaguar_classroom_clases(docente_id,ciclo_escolar);
CREATE INDEX IF NOT EXISTS jaguar_classroom_grupo_idx ON public.jaguar_classroom_clases(grupo_materia_id,ciclo_escolar);
ALTER TABLE public.jaguar_classroom_clases ENABLE ROW LEVEL SECURITY;
-- Exclusivamente la API, después de comprobar sesión y rol, usa service_role.
REVOKE ALL ON public.jaguar_classroom_clases FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE public.jaguar_classroom_clases_id_seq FROM PUBLIC,anon,authenticated;
COMMIT;
