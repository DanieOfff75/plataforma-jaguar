-- V5.8.4: SOLO TABLAS, ejecutar completo tras respaldo.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar_cargas_grupo (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operacion_id uuid NOT NULL UNIQUE,
  grupo_id bigint NOT NULL REFERENCES public.grupos(id),
  periodo_id bigint NOT NULL REFERENCES public.periodos_escolares(id),
  actor_id uuid NOT NULL REFERENCES public.perfiles(id),
  actor_nombre text NOT NULL,
  actor_rol text NOT NULL,
  firma_departamento_path text NOT NULL,
  firma_departamento_sha256 text NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente_docentes' CHECK(estado IN ('pendiente_docentes','completa')),
  creado_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.jaguar_cargas_materias (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  carga_id bigint NOT NULL REFERENCES public.jaguar_cargas_grupo(id) ON DELETE RESTRICT,
  grupo_materia_id bigint NOT NULL REFERENCES public.grupo_materias(id),
  docente_id bigint NOT NULL REFERENCES public.docentes(id),
  notas_originales jsonb NOT NULL,
  notas_finales jsonb,
  estado text NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','aceptada')),
  firmado_por uuid REFERENCES public.perfiles(id),
  firma_docente_path text,
  firma_docente_sha256 text,
  firmado_at timestamptz,
  UNIQUE(carga_id,grupo_materia_id)
);
CREATE INDEX IF NOT EXISTS jaguar_cargas_materias_docente_idx ON public.jaguar_cargas_materias(docente_id,estado);
ALTER TABLE public.jaguar_cargas_grupo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar_cargas_materias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar_cargas_grupo,public.jaguar_cargas_materias FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.jaguar_cargas_grupo,public.jaguar_cargas_materias TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.jaguar_cargas_grupo_id_seq,public.jaguar_cargas_materias_id_seq TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
