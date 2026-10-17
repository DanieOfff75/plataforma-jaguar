-- Jaguar V5.4: ejecutar UNA VEZ en el editor SQL de Supabase, antes del deploy.
-- Ninguna tabla de planeaciones existente se borra o reemplaza.
BEGIN;
CREATE TABLE IF NOT EXISTS public.planeacion_dictamenes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  planeacion_id bigint NOT NULL REFERENCES public.planeaciones_docentes(id) ON DELETE RESTRICT,
  departamento text NOT NULL CHECK (departamento IN ('servicios_docentes','coordinacion_academica','direccion_escolar','control_escolar')),
  dictamen text NOT NULL CHECK (dictamen IN ('aprobada','rechazada')),
  motivo text,
  firmado_por uuid NOT NULL,
  firma_path text NOT NULL,
  firma_sha256 text NOT NULL,
  firmado_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(planeacion_id, departamento),
  CONSTRAINT dictamen_argumentado CHECK (dictamen='aprobada' OR char_length(btrim(COALESCE(motivo,'')))>=30)
);
CREATE INDEX IF NOT EXISTS planeacion_dictamenes_plan_idx ON public.planeacion_dictamenes(planeacion_id);
CREATE TABLE IF NOT EXISTS public.planeacion_apelaciones (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  planeacion_origen_id bigint NOT NULL REFERENCES public.planeaciones_docentes(id) ON DELETE RESTRICT,
  planeacion_nueva_id bigint NOT NULL REFERENCES public.planeaciones_docentes(id) ON DELETE RESTRICT,
  docente_id bigint NOT NULL,
  argumentos text NOT NULL CHECK (char_length(btrim(argumentos))>=30),
  cambios_realizados text NOT NULL CHECK (char_length(btrim(cambios_realizados))>=15),
  creado_por uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(planeacion_origen_id), UNIQUE(planeacion_nueva_id)
);
CREATE INDEX IF NOT EXISTS planeacion_apelaciones_origen_idx ON public.planeacion_apelaciones(planeacion_origen_id);
ALTER TABLE public.planeacion_dictamenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planeacion_apelaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planeacion_dictamenes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.planeacion_apelaciones FROM PUBLIC, anon, authenticated;
-- En Vercel las consultas pasan por el servidor tras comprobar autenticación y rol.
GRANT SELECT, INSERT ON public.planeacion_dictamenes TO service_role;
GRANT SELECT, INSERT ON public.planeacion_apelaciones TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.planeacion_dictamenes_id_seq, public.planeacion_apelaciones_id_seq TO service_role;
-- Operación serializada: evita que dos departamentos sobrescriban o invaliden un voto simultáneo.
CREATE OR REPLACE FUNCTION public.jaguar_firmar_dictamen_planeacion(
  p_planeacion_id bigint, p_departamento text, p_dictamen text, p_motivo text,
  p_firmado_por uuid, p_firma_path text, p_firma_sha256 text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE v_estado text; v_si integer; v_no integer; v_total integer; v_final text;
BEGIN
  IF p_departamento NOT IN ('servicios_docentes','coordinacion_academica','direccion_escolar','control_escolar')
     OR p_dictamen NOT IN ('aprobada','rechazada') THEN
    RAISE EXCEPTION 'Dictamen o departamento no autorizado.';
  END IF;
  IF p_dictamen='rechazada' AND char_length(btrim(COALESCE(p_motivo,'')))<30 THEN
    RAISE EXCEPTION 'El rechazo debe incluir argumentos claros, al menos 30 caracteres.';
  END IF;
  SELECT estado INTO v_estado FROM public.planeaciones_docentes
    WHERE id=p_planeacion_id FOR UPDATE;
  IF NOT FOUND OR v_estado NOT IN ('enviada','revisada') THEN
    RAISE EXCEPTION 'La planeación no se encuentra abierta para dictámenes.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.planeacion_dictamenes
            WHERE planeacion_id=p_planeacion_id AND departamento=p_departamento) THEN
    RAISE EXCEPTION 'Este departamento ya emitió su dictamen para esta versión.';
  END IF;
  INSERT INTO public.planeacion_dictamenes
    (planeacion_id,departamento,dictamen,motivo,firmado_por,firma_path,firma_sha256)
  VALUES(p_planeacion_id,p_departamento,p_dictamen,NULLIF(btrim(COALESCE(p_motivo,'')),''),p_firmado_por,p_firma_path,p_firma_sha256);
  SELECT count(*) FILTER(WHERE dictamen='aprobada'),count(*) FILTER(WHERE dictamen='rechazada'),count(*)
    INTO v_si,v_no,v_total FROM public.planeacion_dictamenes WHERE planeacion_id=p_planeacion_id;
  v_final=CASE WHEN v_si>=3 THEN 'revisada' WHEN v_no>=2 OR v_total=4 THEN 'devuelta' ELSE 'enviada' END;
  UPDATE public.planeaciones_docentes
  SET estado=v_final,
      revision_observaciones=CASE WHEN v_final='devuelta' THEN 'No alcanzó 3 de 4 aprobaciones. Se requiere apelación y nueva versión.'
        ELSE revision_observaciones END,
      revisado_por=CASE WHEN v_final IN ('revisada','devuelta') THEN p_firmado_por ELSE revisado_por END,
      revisado_at=CASE WHEN v_final IN ('revisada','devuelta') THEN now() ELSE revisado_at END,
      updated_at=now()
  WHERE id=p_planeacion_id;
  RETURN jsonb_build_object('aprobaciones',v_si,'rechazos',v_no,'registrados',v_total,'estado',v_final,
   'valida',(v_si>=3),'requiere_apelacion',(v_final='devuelta'));
END $$;
REVOKE ALL ON FUNCTION public.jaguar_firmar_dictamen_planeacion(bigint,text,text,text,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jaguar_firmar_dictamen_planeacion(bigint,text,text,text,uuid,text,text) TO service_role;
COMMIT;
