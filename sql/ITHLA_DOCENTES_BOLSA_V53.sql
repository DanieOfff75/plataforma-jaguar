-- Jaguar V53. Ejecutar SOLO despues de V52. No cambia docentes ni asignaciones actuales.
BEGIN;

CREATE TABLE IF NOT EXISTS public.jaguar_docente_bolsa_v53 (
 ciclo text NOT NULL CHECK (ciclo ~ '^[0-9]{4}-[0-9]{4}(/[1-9])?$'),
 docente_id bigint NOT NULL REFERENCES public.docentes(id) ON DELETE RESTRICT,
 modalidad text NOT NULL CHECK (modalidad IN ('regularizacion','reserva','mixto')),
 recuperacion boolean NOT NULL DEFAULT false,
 recursamiento boolean NOT NULL DEFAULT false,
 suplencia boolean NOT NULL DEFAULT false,
 horas_max_semanales integer NOT NULL CHECK (horas_max_semanales BETWEEN 1 AND 60),
 materias_ids bigint[] NOT NULL DEFAULT '{}'::bigint[],
 estado text NOT NULL DEFAULT 'solicitado' CHECK (estado IN ('solicitado','aprobado','rechazado','suspendido')),
 observaciones text NOT NULL DEFAULT '' CHECK (char_length(observaciones)<=700),
 solicitado_por uuid NOT NULL,
 aprobado_por uuid,
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (ciclo,docente_id),
 CONSTRAINT jaguar_docente_bolsa_tipo_check CHECK (recuperacion OR recursamiento OR suplencia)
);

CREATE TABLE IF NOT EXISTS public.jaguar_docente_candidaturas_v53 (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 ciclo text NOT NULL CHECK (ciclo ~ '^[0-9]{4}-[0-9]{4}(/[1-9])?$'),
 grupo_materia_id bigint NOT NULL REFERENCES public.grupo_materias(id) ON DELETE RESTRICT,
 docente_id bigint NOT NULL REFERENCES public.docentes(id) ON DELETE RESTRICT,
 tipo text NOT NULL CHECK (tipo IN ('recuperacion','recursamiento','suplencia')),
 prioridad smallint NOT NULL CHECK (prioridad BETWEEN 1 AND 5),
 estado text NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente','retirada')),
 observaciones text NOT NULL DEFAULT '' CHECK (char_length(observaciones)<=400),
 registrado_por uuid NOT NULL,
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 UNIQUE (ciclo,grupo_materia_id,docente_id,tipo)
);
CREATE UNIQUE INDEX IF NOT EXISTS jaguar_docente_candidaturas_v53_prioridad_activa
 ON public.jaguar_docente_candidaturas_v53(ciclo,grupo_materia_id,tipo,prioridad)
 WHERE estado='vigente';
CREATE INDEX IF NOT EXISTS jaguar_docente_candidaturas_v53_docente
 ON public.jaguar_docente_candidaturas_v53(docente_id,ciclo,estado);

-- Toda lectura/escritura pasa por rutas que verifican la sesión y el rol.
ALTER TABLE public.jaguar_docente_bolsa_v53 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar_docente_candidaturas_v53 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.jaguar_docente_bolsa_v53, public.jaguar_docente_candidaturas_v53 FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.jaguar_docente_bolsa_v53, public.jaguar_docente_candidaturas_v53 TO service_role;
REVOKE ALL ON SEQUENCE public.jaguar_docente_candidaturas_v53_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE,SELECT ON SEQUENCE public.jaguar_docente_candidaturas_v53_id_seq TO service_role;
COMMIT;
