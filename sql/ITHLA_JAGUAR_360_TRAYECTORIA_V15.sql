-- V15. Aplicación experimental individual en libro separado. No escribe notas ni matrícula ordinarias.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar360_aplicaciones_recursamiento (
 reserva_id bigint PRIMARY KEY REFERENCES public.jaguar360_intentos_recursamiento(reserva_id) ON DELETE RESTRICT,
 convocatoria_id bigint NOT NULL REFERENCES public.jaguar360_actas_recursamiento(convocatoria_id) ON DELETE RESTRICT,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 actor_id uuid NOT NULL, actor_nombre text NOT NULL,
 referencia text NOT NULL CHECK(char_length(referencia) BETWEEN 5 AND 300),
 motivo text NOT NULL CHECK(char_length(motivo) BETWEEN 15 AND 1500), creado_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.jaguar360_aplicacion_autorizaciones (
 reserva_id bigint PRIMARY KEY REFERENCES public.jaguar360_aplicaciones_recursamiento(reserva_id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL, actor_nombre text NOT NULL,
 referencia text NOT NULL CHECK(char_length(referencia) BETWEEN 5 AND 300),
 motivo text NOT NULL CHECK(char_length(motivo) BETWEEN 15 AND 1500), creado_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.jaguar360_aplicaciones_recursamiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar360_aplicacion_autorizaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_aplicaciones_recursamiento,public.jaguar360_aplicacion_autorizaciones FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_contexto_trayectoria(p_actor uuid,p_ciclo text,p_alumno bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE src jsonb; attempts jsonb; ctx jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('direccion_escolar','coordinacion_academica','control_escolar','control')) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 src:=public.jaguar360_fuentes_selladas(p_actor,p_ciclo,p_alumno);
 SELECT coalesce(jsonb_agg(jsonb_build_object('call',i.convocatoria_id::text,'subjectKey',i.materia_clave,'outcome',i.resultado,'actFingerprint',a.huella,'snapshot',jsonb_build_object('call',a.evidencia->'call','students',coalesce((SELECT jsonb_agg(s-'name') FROM jsonb_array_elements(a.evidencia->'students') s WHERE s->>'student'=p_alumno::text AND s->>'reservation'=i.reserva_id::text),'[]'::jsonb)),'recordedEvaluation',(SELECT r->'evaluation' FROM jsonb_array_elements(a.resultados) r WHERE r->>'student'=p_alumno::text),'application',CASE WHEN ap.reserva_id IS NULL THEN NULL ELSE jsonb_build_object('state',CASE WHEN au.reserva_id IS NULL THEN 'proposed' ELSE 'authorized' END,'payload',ap.payload,'actor',coalesce(au.actor_nombre,ap.actor_nombre),'reference',coalesce(au.referencia,ap.referencia),'at',coalesce(au.creado_at,ap.creado_at)) END) ORDER BY i.materia_clave),'[]'::jsonb) INTO attempts
 FROM public.jaguar360_intentos_recursamiento i JOIN public.jaguar360_actas_recursamiento a ON a.convocatoria_id=i.convocatoria_id
 LEFT JOIN public.jaguar360_aplicaciones_recursamiento ap ON ap.reserva_id=i.reserva_id LEFT JOIN public.jaguar360_aplicacion_autorizaciones au ON au.reserva_id=i.reserva_id
 WHERE i.ciclo=p_ciclo AND i.alumno_id=p_alumno;
 ctx:=jsonb_build_object('source',src,'attempts',attempts);
 RETURN ctx||jsonb_build_object('fingerprint',md5(ctx::text));
END $$;
CREATE OR REPLACE FUNCTION public.jaguar360_aplicar_recursamiento(p_actor uuid,p_ciclo text,p_alumno bigint,p_call bigint,p_accion text,p_huella text,p_payload jsonb,p_referencia text,p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; i public.jaguar360_intentos_recursamiento; ap public.jaguar360_aplicaciones_recursamiento; ctx jsonb; atp jsonb;
BEGIN
 LOCK TABLE public.perfiles,public.alumnos,public.periodos_escolares,public.jaguar360_planes_ciclo,public.jaguar360_cierres_periodo,public.jaguar360_rectificaciones,public.jaguar360_rectificacion_resoluciones,public.jaguar360_actas_recursamiento,public.jaguar360_intentos_recursamiento IN SHARE MODE NOWAIT;
 LOCK TABLE public.jaguar360_aplicaciones_recursamiento,public.jaguar360_aplicacion_autorizaciones IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 SELECT rol,nombre_completo INTO a FROM public.perfiles WHERE id=p_actor AND activo IS TRUE;
 IF NOT FOUND OR p_accion IS NULL OR p_accion NOT IN ('proponer','autorizar') OR (p_accion='proponer' AND a.rol NOT IN ('control_escolar','control')) OR (p_accion='autorizar' AND a.rol<>'direccion_escolar') THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF p_referencia IS NULL OR char_length(btrim(p_referencia)) NOT BETWEEN 5 AND 300 OR p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500 OR p_huella IS NULL OR p_huella !~ '^[a-f0-9]{32}$' OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>200000 THEN RAISE EXCEPTION 'Referencia, motivo, huella o resultado inválidos.'; END IF;
 SELECT * INTO i FROM public.jaguar360_intentos_recursamiento WHERE convocatoria_id=p_call AND ciclo=p_ciclo AND alumno_id=p_alumno;
 IF NOT FOUND THEN RAISE EXCEPTION 'Intento no registrado.'; END IF;
 ctx:=public.jaguar360_contexto_trayectoria(p_actor,p_ciclo,p_alumno);
 IF ctx->>'fingerprint' IS DISTINCT FROM p_huella THEN RAISE EXCEPTION 'Cambió la evidencia. Consulta nuevamente.'; END IF;
 SELECT z INTO atp FROM jsonb_array_elements(ctx->'attempts') z WHERE z->>'call'=p_call::text;
 -- Payload derived by the trusted backend, never from browser input. Check binding to immutable act and plan.
 IF atp IS NULL OR p_payload->>'subjectKey' IS DISTINCT FROM i.materia_clave OR p_payload->>'call' IS DISTINCT FROM p_call::text OR p_payload->>'actFingerprint' IS DISTINCT FROM atp->>'actFingerprint' OR p_payload->>'planVersion' IS DISTINCT FROM ctx->'source'->>'version' OR p_payload->>'official' IS DISTINCT FROM 'false' OR coalesce(p_payload->'result'->>'state','') NOT IN ('accredited','candidate') THEN RAISE EXCEPTION 'Resultado incompatible con el intento.'; END IF;
 SELECT * INTO ap FROM public.jaguar360_aplicaciones_recursamiento WHERE reserva_id=i.reserva_id;
 IF p_accion='proponer' THEN
  IF FOUND THEN RAISE EXCEPTION 'Ya existe una propuesta.'; END IF;
  INSERT INTO public.jaguar360_aplicaciones_recursamiento(reserva_id,convocatoria_id,payload,actor_id,actor_nombre,referencia,motivo) VALUES(i.reserva_id,p_call,p_payload,p_actor,coalesce(a.nombre_completo,'Sin nombre'),btrim(p_referencia),btrim(p_motivo));
 ELSE
  IF NOT FOUND OR ap.actor_id=p_actor OR ap.payload IS DISTINCT FROM p_payload OR EXISTS(SELECT 1 FROM public.jaguar360_aplicacion_autorizaciones WHERE reserva_id=i.reserva_id) THEN RAISE EXCEPTION 'Falta propuesta vigente, revisión independiente o la aplicación ya fue autorizada.'; END IF;
  INSERT INTO public.jaguar360_aplicacion_autorizaciones(reserva_id,actor_id,actor_nombre,referencia,motivo) VALUES(i.reserva_id,p_actor,coalesce(a.nombre_completo,'Sin nombre'),btrim(p_referencia),btrim(p_motivo));
 END IF;
 RETURN public.jaguar360_contexto_trayectoria(p_actor,p_ciclo,p_alumno);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_contexto_trayectoria(uuid,text,bigint),public.jaguar360_aplicar_recursamiento(uuid,text,bigint,bigint,text,text,jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_contexto_trayectoria(uuid,text,bigint),public.jaguar360_aplicar_recursamiento(uuid,text,bigint,bigint,text,text,jsonb,text,text) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
