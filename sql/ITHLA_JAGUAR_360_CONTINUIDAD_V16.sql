-- Registro administrativo de determinaciones, no matrícula ni modificación de expediente legado.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar360_dictamen_continuidad (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 alumno_id bigint NOT NULL REFERENCES public.alumnos(id) ON DELETE RESTRICT,
 ciclo text NOT NULL CHECK(ciclo ~ '^[0-9]{4}-[0-9]{4}$'),
 huella text NOT NULL CHECK(huella ~ '^[a-f0-9]{32}$'),
 version_plan integer NOT NULL CHECK(version_plan>0),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 actor_id uuid NOT NULL, actor_nombre text NOT NULL,
 referencia text NOT NULL CHECK(char_length(referencia) BETWEEN 5 AND 300),
 motivo text NOT NULL CHECK(char_length(motivo) BETWEEN 15 AND 1500),
 creado_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(alumno_id,ciclo,huella)
);
ALTER TABLE public.jaguar360_dictamen_continuidad ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_dictamen_continuidad FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_continuidad(p_actor uuid,p_ciclo text,p_alumno bigint,p_huella text DEFAULT NULL,p_payload jsonb DEFAULT NULL,p_referencia text DEFAULT NULL,p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; ctx jsonb; history jsonb;
BEGIN
 IF p_payload IS NOT NULL THEN
  LOCK TABLE public.perfiles,public.alumnos,public.periodos_escolares,public.jaguar360_planes_ciclo,public.jaguar360_cierres_periodo,public.jaguar360_rectificaciones,public.jaguar360_rectificacion_resoluciones,public.jaguar360_actas_recursamiento,public.jaguar360_intentos_recursamiento,public.jaguar360_aplicaciones_recursamiento,public.jaguar360_aplicacion_autorizaciones IN SHARE MODE NOWAIT;
  LOCK TABLE public.jaguar360_dictamen_continuidad IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 END IF;
 SELECT rol,nombre_completo INTO a FROM public.perfiles WHERE id=p_actor AND activo IS TRUE;
 IF NOT FOUND OR a.rol NOT IN ('direccion_escolar','coordinacion_academica','control_escolar','control') OR (p_payload IS NOT NULL AND a.rol NOT IN ('control_escolar','control')) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 ctx:=public.jaguar360_contexto_trayectoria(p_actor,p_ciclo,p_alumno);
 IF p_payload IS NOT NULL THEN
  IF p_huella IS NULL OR p_huella IS DISTINCT FROM ctx->>'fingerprint' THEN RAISE EXCEPTION 'Cambió la evidencia. Consulta nuevamente.'; END IF;
  -- The trusted backend computes the decision. Check source binding and structural constraints.
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>100000 OR p_payload->>'sourceCycle' IS DISTINCT FROM p_ciclo OR p_payload->>'canRecord' IS DISTINCT FROM 'true' OR coalesce(p_payload->>'state','') NOT IN ('academic_completion','promotion_eligible','repeat_grade','repeat_subjects','provisional_eligible') OR p_referencia IS NULL OR char_length(btrim(p_referencia)) NOT BETWEEN 5 AND 300 OR p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Determinación o evidencia inválida.'; END IF;
  INSERT INTO public.jaguar360_dictamen_continuidad(alumno_id,ciclo,huella,version_plan,payload,actor_id,actor_nombre,referencia,motivo) VALUES(p_alumno,p_ciclo,p_huella,(ctx->'source'->>'version')::integer,p_payload,p_actor,coalesce(a.nombre_completo,'Sin nombre'),btrim(p_referencia),btrim(p_motivo));
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id::text,'fingerprint',d.huella,'planVersion',d.version_plan,'decision',d.payload,'actor',d.actor_nombre,'reference',d.referencia,'reason',d.motivo,'at',d.creado_at) ORDER BY d.id DESC),'[]'::jsonb) INTO history FROM (SELECT * FROM public.jaguar360_dictamen_continuidad WHERE alumno_id=p_alumno AND ciclo=p_ciclo ORDER BY id DESC LIMIT 100) d;
 RETURN jsonb_build_object('context',ctx,'history',history);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_continuidad(uuid,text,bigint,text,jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_continuidad(uuid,text,bigint,text,jsonb,text,text) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
