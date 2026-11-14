-- Registro voluntario y revisión documental; no se crean asignaciones ni permisos.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar360_apoyo_docente (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 docente_id bigint NOT NULL REFERENCES public.docentes(id) ON DELETE RESTRICT,
 ciclo text NOT NULL CHECK(ciclo ~ '^[0-9]{4}-[0-9]{4}$'),
 propuesta jsonb NOT NULL CHECK(jsonb_typeof(propuesta)='object'),
 estado text NOT NULL CHECK(estado IN ('solicitado','validado','rechazado','retirado','revocado')),
 version integer NOT NULL CHECK(version>0), creado_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS j360_apoyo_unico ON public.jaguar360_apoyo_docente(docente_id,ciclo) WHERE estado IN ('solicitado','validado');
CREATE TABLE IF NOT EXISTS public.jaguar360_apoyo_eventos (
 solicitud_id bigint NOT NULL REFERENCES public.jaguar360_apoyo_docente(id) ON DELETE RESTRICT,
 version integer NOT NULL, estado text NOT NULL,
 actor_id uuid NOT NULL, actor_nombre text NOT NULL, actor_cargo text NOT NULL,
 motivo text NOT NULL CHECK(char_length(motivo) BETWEEN 15 AND 1500), referencia text,
 creado_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(solicitud_id,version)
);
ALTER TABLE public.jaguar360_apoyo_docente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar360_apoyo_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_apoyo_docente,public.jaguar360_apoyo_eventos FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_consultar_apoyo_docente(p_actor uuid,p_ciclo text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; own bigint; rows jsonb; subjects jsonb;
BEGIN
 SELECT rol INTO a FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('docente','servicios_docentes','coordinacion_academica','direccion_escolar');
 IF NOT FOUND THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF a.rol='docente' THEN SELECT id INTO own FROM public.docentes WHERE auth_user_id=p_actor AND activo IS TRUE AND estado_profesional='activo'; IF own IS NULL THEN RAISE EXCEPTION 'Docente no activo.' USING ERRCODE='42501'; END IF; END IF;
 IF p_ciclo IS NULL OR p_ciclo !~ '^[0-9]{4}-[0-9]{4}$' THEN RAISE EXCEPTION 'Ciclo inválido.'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id::text,'teacher',r.docente_id::text,'name',d.nombre_completo,'active',d.activo AND d.estado_profesional='activo','application',r.propuesta,'state',r.estado,'version',r.version,'events',(SELECT jsonb_agg(to_jsonb(e)-'actor_id'-'solicitud_id' ORDER BY e.version) FROM public.jaguar360_apoyo_eventos e WHERE e.solicitud_id=r.id)) ORDER BY r.id),'[]'::jsonb) INTO rows FROM public.jaguar360_apoyo_docente r JOIN public.docentes d ON d.id=r.docente_id WHERE r.ciclo=p_ciclo AND (a.rol<>'docente' OR r.docente_id=own);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id::text,'name',m.nombre) ORDER BY m.nombre,m.id),'[]'::jsonb) INTO subjects FROM public.materias m WHERE m.activa IS TRUE;
 RETURN jsonb_build_object('rows',rows,'subjects',subjects);
END $$;
CREATE OR REPLACE FUNCTION public.jaguar360_registrar_apoyo_docente(p_actor uuid,p_ciclo text,p_accion text,p_motivo text,p_propuesta jsonb DEFAULT NULL,p_id bigint DEFAULT NULL,p_version integer DEFAULT NULL,p_referencia text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; own bigint; r public.jaguar360_apoyo_docente; slot record; total integer:=0; prior_day integer:=0; prior_end integer:=0; ids bigint[]; st text;
BEGIN
 SELECT rol,nombre_completo INTO a FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('docente','servicios_docentes');
 IF NOT FOUND THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF p_accion IS NULL OR p_accion NOT IN ('submit','approve','reject','withdraw','revoke') OR (p_accion IN ('submit','withdraw') AND a.rol<>'docente') OR (p_accion IN ('approve','reject','revoke') AND a.rol<>'servicios_docentes') THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF p_ciclo IS NULL OR p_ciclo !~ '^[0-9]{4}-[0-9]{4}$' OR substring(p_ciclo,6,4)::integer<>substring(p_ciclo,1,4)::integer+1 OR p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Ciclo o motivo inválido.'; END IF;
 IF a.rol='docente' THEN SELECT id INTO own FROM public.docentes WHERE auth_user_id=p_actor AND activo IS TRUE AND estado_profesional='activo'; IF own IS NULL THEN RAISE EXCEPTION 'Docente no activo.' USING ERRCODE='42501'; END IF; END IF;
 LOCK TABLE public.jaguar360_apoyo_docente IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 IF p_accion='submit' THEN
  IF EXISTS(SELECT 1 FROM public.jaguar360_apoyo_docente WHERE docente_id=own AND ciclo=p_ciclo AND estado IN ('solicitado','validado')) THEN RAISE EXCEPTION 'Ya existe una solicitud vigente.'; END IF;
  IF jsonb_typeof(p_propuesta) IS DISTINCT FROM 'object' OR jsonb_typeof(p_propuesta->'subjects') IS DISTINCT FROM 'array' OR jsonb_typeof(p_propuesta->'slots') IS DISTINCT FROM 'array' OR jsonb_typeof(p_propuesta->'maxMinutes') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Datos inválidos.'; END IF;
  IF jsonb_array_length(p_propuesta->'subjects') NOT BETWEEN 1 AND 40 OR jsonb_array_length(p_propuesta->'slots') NOT BETWEEN 1 AND 70 THEN RAISE EXCEPTION 'Materias o franjas inválidas.'; END IF;
  SELECT array_agg(v::bigint) INTO ids FROM jsonb_array_elements_text(p_propuesta->'subjects') v;
  IF cardinality(ids)<>(SELECT count(DISTINCT z) FROM unnest(ids) z) OR EXISTS(SELECT 1 FROM unnest(ids) z WHERE NOT EXISTS(SELECT 1 FROM public.materias m WHERE m.id=z AND m.activa IS TRUE)) THEN RAISE EXCEPTION 'Materias duplicadas o inexistentes.'; END IF;
  FOR slot IN SELECT (v->>'day')::integer AS d,(v->>'start')::integer AS s,(v->>'end')::integer AS e FROM jsonb_array_elements(p_propuesta->'slots') v ORDER BY 1,2 LOOP
   IF slot.d IS NULL OR slot.s IS NULL OR slot.e IS NULL OR slot.d NOT BETWEEN 1 AND 7 OR slot.s<0 OR slot.e>1440 OR slot.e<=slot.s OR (slot.d=prior_day AND slot.s<prior_end) THEN RAISE EXCEPTION 'Franja inválida o traslapada.'; END IF;
   total:=total+slot.e-slot.s;prior_day:=slot.d;prior_end:=slot.e;
  END LOOP;
  IF (p_propuesta->>'maxMinutes')::integer NOT BETWEEN 1 AND total THEN RAISE EXCEPTION 'Carga fuera de disponibilidad.'; END IF;
  INSERT INTO public.jaguar360_apoyo_docente(docente_id,ciclo,propuesta,estado,version) VALUES(own,p_ciclo,jsonb_build_object('subjects',p_propuesta->'subjects','slots',p_propuesta->'slots','maxMinutes',p_propuesta->'maxMinutes'),'solicitado',1) RETURNING * INTO r;
 ELSE
  SELECT * INTO r FROM public.jaguar360_apoyo_docente WHERE id=p_id AND ciclo=p_ciclo AND version=p_version FOR UPDATE;
  IF NOT FOUND OR (a.rol='docente' AND r.docente_id IS DISTINCT FROM own) THEN RAISE EXCEPTION 'Solicitud ajena, inexistente o desactualizada.'; END IF;
  IF p_accion IN ('approve','reject') AND r.estado<>'solicitado' OR p_accion='withdraw' AND r.estado NOT IN ('solicitado','validado') OR p_accion='revoke' AND r.estado<>'validado' THEN RAISE EXCEPTION 'Transición inválida.'; END IF;
  IF p_accion='approve' AND (p_referencia IS NULL OR char_length(btrim(p_referencia)) NOT BETWEEN 5 AND 200 OR NOT EXISTS(SELECT 1 FROM public.docentes d WHERE d.id=r.docente_id AND d.activo IS TRUE AND d.estado_profesional='activo' AND d.auth_user_id IS DISTINCT FROM p_actor)) THEN RAISE EXCEPTION 'Requiere referencia y docente activo distinto del revisor.'; END IF;
  st:=CASE p_accion WHEN 'approve' THEN 'validado' WHEN 'reject' THEN 'rechazado' WHEN 'withdraw' THEN 'retirado' ELSE 'revocado' END;
  UPDATE public.jaguar360_apoyo_docente SET estado=st,version=version+1 WHERE id=r.id RETURNING * INTO r;
 END IF;
 INSERT INTO public.jaguar360_apoyo_eventos(solicitud_id,version,estado,actor_id,actor_nombre,actor_cargo,motivo,referencia) VALUES(r.id,r.version,r.estado,p_actor,coalesce(a.nombre_completo,'Sin nombre'),a.rol,btrim(p_motivo),CASE WHEN p_accion='approve' THEN btrim(p_referencia) ELSE NULL END);
 RETURN jsonb_build_object('id',r.id::text,'state',r.estado,'version',r.version);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_consultar_apoyo_docente(uuid,text),public.jaguar360_registrar_apoyo_docente(uuid,text,text,text,jsonb,bigint,integer,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_consultar_apoyo_docente(uuid,text),public.jaguar360_registrar_apoyo_docente(uuid,text,text,text,jsonb,bigint,integer,text) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
