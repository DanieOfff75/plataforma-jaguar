-- JAGUAR V5.8.6 | Reparación mínima del Banco de Exámenes.
-- Respeta tablas y datos existentes; no instala Aulas ni Calificaciones.
-- Ejecutar completo en SQL Editor de Supabase, SIN seleccionar fragmentos.
-- Precondiciones: public.docentes, public.materias, public.grupo_materias existentes.
BEGIN;

CREATE TABLE IF NOT EXISTS public.jaguar_preguntas (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    docente_id bigint NOT NULL REFERENCES public.docentes(id),
    materia_id bigint NOT NULL REFERENCES public.materias(id),
    tipo text NOT NULL CHECK (tipo IN ('opcion_multiple','verdadero_falso','abierta')),
    enunciado text NOT NULL CHECK (length(enunciado) BETWEEN 8 AND 2500),
    opciones jsonb NOT NULL DEFAULT '[]'::jsonb,
    respuesta jsonb,
    puntos numeric(6,2) NOT NULL DEFAULT 1 CHECK (puntos > 0 AND puntos <= 100),
    creado_at timestamptz NOT NULL DEFAULT now(),
    actualizado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jaguar_preguntas_docente_materia_idx
    ON public.jaguar_preguntas(docente_id,materia_id);

CREATE TABLE IF NOT EXISTS public.jaguar_examenes (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    docente_id bigint NOT NULL REFERENCES public.docentes(id),
    grupo_materia_id bigint NOT NULL REFERENCES public.grupo_materias(id),
    ciclo_escolar text NOT NULL,
    titulo text NOT NULL,
    instrucciones text,
    preguntas jsonb NOT NULL CHECK (jsonb_typeof(preguntas)='array'),
    creado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jaguar_examenes_docente_idx
    ON public.jaguar_examenes(docente_id,creado_at DESC);

-- La API de Jaguar usa la clave privada de servidor y verifica el rol/identidad del docente.
-- No conceder permisos a anon/authenticated ni crear políticas públicas de lectura.
ALTER TABLE public.jaguar_preguntas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar_examenes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.jaguar_preguntas,public.jaguar_examenes FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.jaguar_preguntas,public.jaguar_examenes TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.jaguar_preguntas_id_seq,public.jaguar_examenes_id_seq TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
