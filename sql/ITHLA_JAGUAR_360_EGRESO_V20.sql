BEGIN;
-- Experimental egress: deliberately limited to current-cycle, fully accredited graduates with an unchanged CE determination.
CREATE TABLE IF NOT EXISTS public.jaguar360_egresos (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 alumno_id bigint NOT NULL REFERENCES public.alumnos(id) ON DELETE RESTRICT,
 ciclo text NOT NULL, dictamen_id bigint NOT NULL UNIQUE REFERENCES public.jaguar360_dictamen_continuidad(id) ON DELETE RESTRICT,
 huella text NOT NULL, antes jsonb NOT NULL, despues jsonb NOT NULL,
 actor_id uuid NOT NULL, actor_nombre text NOT NULL,
 referencia text NOT NULL CHECK(char_length(referencia) BETWEEN 5 AND 300),
 motivo text NOT NULL CHECK(char_length(motivo) BETWEEN 15 AND 1500), creado_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(alumno_id,ciclo)
);
ALTER TABLE public.jaguar360_egresos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_egresos FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_egreso(p_actor uuid,p_ciclo text,p_alumno bigint,p_huella text DEFAULT NULL,p_referencia text DEFAULT NULL,p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; st public.alumnos; d public.jaguar360_dictamen_continuidad; result public.jaguar360_egresos; ctx jsonb; ready boolean; prior jsonb; nextrow jsonb; lastperiod jsonb;
BEGIN
 IF p_huella IS NOT NULL THEN
  LOCK TABLE public.perfiles,public.periodos_escolares,public.grupos,public.grupo_materias,public.jaguar360_planes_ciclo,public.jaguar360_cierres_periodo,public.jaguar360_rectificaciones,public.jaguar360_rectificacion_resoluciones,public.jaguar360_actas_recursamiento,public.jaguar360_intentos_recursamiento,public.jaguar360_aplicaciones_recursamiento,public.jaguar360_aplicacion_autorizaciones,public.jaguar360_dictamen_continuidad IN SHARE MODE NOWAIT;
  LOCK TABLE public.alumnos,public.jaguar360_egresos IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 END IF;
 SELECT rol,nombre_completo INTO a FROM public.perfiles WHERE id=p_actor AND activo IS TRUE;
 IF NOT FOUND OR coalesce(a.rol,'') NOT IN ('control_escolar','control','direccion_escolar') OR (p_huella IS NOT NULL AND a.rol NOT IN ('control_escolar','control')) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 ctx:=public.jaguar360_contexto_trayectoria(p_actor,p_ciclo,p_alumno);
 SELECT * INTO st FROM public.alumnos WHERE id=p_alumno;
 SELECT * INTO d FROM public.jaguar360_dictamen_continuidad WHERE alumno_id=p_alumno AND ciclo=p_ciclo AND huella=ctx->>'fingerprint';
 SELECT * INTO result FROM public.jaguar360_egresos WHERE alumno_id=p_alumno AND ciclo=p_ciclo;
 lastperiod:=ctx->'source'->'periods'->-1;
 ready:=coalesce(result.id IS NULL AND d.id IS NOT NULL AND d.payload->>'state'='academic_completion' AND d.payload->>'sourceGrade'='3' AND st.activo IS TRUE AND st.estado_escolar='activo' AND st.grupo_id IS NOT NULL AND (SELECT count(*) FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE)=1 AND EXISTS(SELECT 1 FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE AND ciclo_escolar=p_ciclo AND numero_periodo=(lastperiod->>'number')::integer AND fecha_fin< (now() AT TIME ZONE 'America/Mexico_City')::date) AND EXISTS(SELECT 1 FROM public.grupos WHERE id=st.grupo_id AND grado=3 AND activo IS TRUE) AND jsonb_array_length(lastperiod->'rows')>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(lastperiod->'rows') r WHERE NOT EXISTS(SELECT 1 FROM public.grupo_materias gm WHERE gm.id=(r->>'groupMaterialId')::bigint AND gm.grupo_id=st.grupo_id)) AND NOT EXISTS(SELECT 1 FROM public.jaguar360_egresos WHERE alumno_id=p_alumno),false);
 IF p_huella IS NOT NULL THEN
  IF NOT ready OR p_huella IS DISTINCT FROM ctx->>'fingerprint' OR p_referencia IS NULL OR char_length(btrim(p_referencia)) NOT BETWEEN 5 AND 300 OR p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Egreso no elegible, evidencia modificada o referencia incompleta.'; END IF;
  prior:=jsonb_build_object('grupo_id',st.grupo_id::text,'activo',st.activo,'estado_escolar',st.estado_escolar);
  -- Same terminal state as legacy egreso, but only after evidence-based confirmation. No deletion, grades or financial checks.
  UPDATE public.alumnos SET activo=false,grupo_id=NULL,estado_escolar='egresado' WHERE id=p_alumno RETURNING * INTO st;
  IF st.estado_escolar IS DISTINCT FROM 'egresado' OR st.activo IS DISTINCT FROM false OR st.grupo_id IS NOT NULL THEN RAISE EXCEPTION 'El estado devuelto no corresponde a egreso.'; END IF;
  nextrow:=jsonb_build_object('grupo_id',st.grupo_id,'activo',st.activo,'estado_escolar',st.estado_escolar);
  INSERT INTO public.jaguar360_egresos(alumno_id,ciclo,dictamen_id,huella,antes,despues,actor_id,actor_nombre,referencia,motivo) VALUES(p_alumno,p_ciclo,d.id,p_huella,prior,nextrow,p_actor,coalesce(a.nombre_completo,'Sin nombre'),btrim(p_referencia),btrim(p_motivo)) RETURNING * INTO result;
  ready:=false;
 END IF;
 RETURN jsonb_build_object('context',ctx,'eligible',ready,'record',CASE WHEN result.id IS NULL THEN NULL ELSE jsonb_build_object('id',result.id::text,'before',result.antes,'after',result.despues,'reference',result.referencia,'actor',result.actor_nombre,'at',result.creado_at,'current',result.huella=ctx->>'fingerprint') END);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_egreso(uuid,text,bigint,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_egreso(uuid,text,bigint,text,text,text) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
