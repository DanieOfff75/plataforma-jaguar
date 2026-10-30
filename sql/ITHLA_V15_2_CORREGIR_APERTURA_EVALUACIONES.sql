-- JAGUAR 360 V15.2 | Corrección de apertura de evaluaciones.
-- Aplicar en Supabase SQL Editor DESPUES de un respaldo. No borra calificaciones.
-- Idempotente: permite corregir la función de una instalación V15 / V15.1.
-- No habilita ningún periodo al instalar; Dirección lo autoriza en Jaguar.
BEGIN;

CREATE TABLE IF NOT EXISTS public.jaguar_evaluacion_ventanas (
  periodo_id bigint PRIMARY KEY REFERENCES public.periodos_escolares(id) ON DELETE RESTRICT,
  habilitada boolean NOT NULL DEFAULT false,
  actualizado_por uuid,
  actualizado_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.jaguar_evaluacion_ventanas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar_evaluacion_ventanas FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.jaguar_evaluacion_ventanas TO service_role;

CREATE TABLE IF NOT EXISTS public.jaguar_evaluacion_ventanas_auditoria (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  periodo_id bigint NOT NULL,
  habilitada boolean NOT NULL,
  actor uuid NOT NULL,
  fecha timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.jaguar_evaluacion_ventanas_auditoria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar_evaluacion_ventanas_auditoria FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.jaguar_evaluacion_ventanas_auditoria TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.jaguar_evaluacion_ventanas_auditoria_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.jaguar_abrir_cerrar_evaluacion(
  p_periodo_id bigint,
  p_habilitada boolean,
  p_actor uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $jaguar_evaluacion_v152$
DECLARE
  v_role text;
BEGIN
  -- PostgREST moderno entrega el JWT en request.jwt.claims (JSON).
  -- Conservar la segunda ruta solamente para instalaciones heredadas.
  v_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    nullif(current_setting('request.jwt.claim.role', true), '')
  );
  IF v_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'La apertura de evaluaciones requiere una llamada autorizada del servidor.' USING ERRCODE='42501';
  END IF;

  IF p_periodo_id IS NULL OR p_periodo_id <= 0 OR p_habilitada IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'Se requiere un periodo, una decisión y el usuario responsable.' USING ERRCODE='22023';
  END IF;

  -- La API ya valida la sesión: este segundo control evita cambios sin
  -- un actor vigente con el rol institucional requerido.
  IF NOT EXISTS (
    SELECT 1 FROM public.perfiles
    WHERE id = p_actor AND rol = 'direccion_escolar' AND activo IS TRUE
  ) THEN
    RAISE EXCEPTION 'Solo Dirección Escolar activa puede autorizar evaluaciones.' USING ERRCODE='42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.periodos_escolares
    WHERE id = p_periodo_id AND (activo IS TRUE OR p_habilitada IS FALSE)
  ) THEN
    RAISE EXCEPTION 'El periodo no existe o no está activo para abrir la captura.' USING ERRCODE='23514';
  END IF;

  -- Una sola transacción RPC: ventana y registro de auditoría.
  INSERT INTO public.jaguar_evaluacion_ventanas
    (periodo_id, habilitada, actualizado_por, actualizado_at)
  VALUES (p_periodo_id, p_habilitada, p_actor, now())
  ON CONFLICT (periodo_id) DO UPDATE SET
    habilitada = EXCLUDED.habilitada,
    actualizado_por = EXCLUDED.actualizado_por,
    actualizado_at = now();

  INSERT INTO public.jaguar_evaluacion_ventanas_auditoria
    (periodo_id, habilitada, actor)
  VALUES (p_periodo_id, p_habilitada, p_actor);
END;
$jaguar_evaluacion_v152$;

REVOKE ALL ON FUNCTION public.jaguar_abrir_cerrar_evaluacion(bigint, boolean, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jaguar_abrir_cerrar_evaluacion(bigint, boolean, uuid)
  TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';

-- Diagnóstico sin cambiar el estado de ningún periodo.
-- Si el RPC persiste en fallar, verifica la función y el rol desplegados:
SELECT p.proname AS funcion, pg_get_function_identity_arguments(p.oid) AS argumentos,
  p.prosecdef AS security_definer,
  has_function_privilege('service_role',p.oid,'EXECUTE') AS permiso_servicio
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='jaguar_abrir_cerrar_evaluacion';
