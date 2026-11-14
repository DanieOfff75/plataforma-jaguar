BEGIN;
-- Read-only scoped recovery candidate from the existing sealed ledger. No new authorization.
CREATE OR REPLACE FUNCTION public.jaguar360_candidatura_recuperacion(p_actor uuid,p_call bigint,p_alumno bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.jaguar360_convocatorias; src jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('direccion_escolar','coordinacion_academica','control_escolar','control')) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.jaguar360_convocatorias WHERE id=p_call AND estado='autorizada_para_planeacion' AND reglas->>'kind'='recovery';
 IF NOT FOUND THEN RAISE EXCEPTION 'Convocatoria de recuperación no autorizada.'; END IF;
 src:=public.jaguar360_fuentes_selladas(p_actor,c.ciclo,p_alumno);
 RETURN jsonb_build_object('call',(to_jsonb(c)-'id')||jsonb_build_object('id',c.id::text),'source',src);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_candidatura_recuperacion(uuid,bigint,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_candidatura_recuperacion(uuid,bigint,bigint) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
