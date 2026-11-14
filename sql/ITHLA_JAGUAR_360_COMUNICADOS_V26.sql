-- Internal notices and acknowledgements; no public publication, signature, email or SMS.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar360_comunicados (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 autor uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE RESTRICT, cargo text NOT NULL,
 asunto text NOT NULL CHECK(char_length(asunto) BETWEEN 6 AND 180), contenido text NOT NULL CHECK(char_length(contenido) BETWEEN 15 AND 6000),
 destinatarios text[] NOT NULL CHECK(cardinality(destinatarios) BETWEEN 1 AND 11), referencia text NOT NULL CHECK(char_length(referencia) BETWEEN 5 AND 300),
 motivo text NOT NULL CHECK(char_length(motivo) BETWEEN 15 AND 1500), creado_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.jaguar360_comunicado_resoluciones (
 comunicado_id bigint PRIMARY KEY REFERENCES public.jaguar360_comunicados(id) ON DELETE RESTRICT,
 estado text NOT NULL CHECK(estado IN ('publicado','rechazado')), actor_id uuid NOT NULL, motivo text NOT NULL CHECK(char_length(motivo) BETWEEN 15 AND 1500),
 creado_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.jaguar360_comunicado_receptores (
 comunicado_id bigint NOT NULL REFERENCES public.jaguar360_comunicado_resoluciones(comunicado_id) ON DELETE RESTRICT,
 receptor uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE RESTRICT, cargo text NOT NULL,
 enviado_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(comunicado_id,receptor)
);
CREATE TABLE IF NOT EXISTS public.jaguar360_comunicado_acuses (
 comunicado_id bigint NOT NULL, receptor uuid NOT NULL, cargo text NOT NULL, creado_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(comunicado_id,receptor), FOREIGN KEY(comunicado_id,receptor) REFERENCES public.jaguar360_comunicado_receptores(comunicado_id,receptor) ON DELETE RESTRICT
);
ALTER TABLE public.jaguar360_comunicados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar360_comunicado_resoluciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar360_comunicado_receptores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar360_comunicado_acuses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_comunicados,public.jaguar360_comunicado_resoluciones,public.jaguar360_comunicado_receptores,public.jaguar360_comunicado_acuses FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_comunicados_bandeja(p_actor uuid,p_op text DEFAULT NULL,p_id bigint DEFAULT NULL,p_asunto text DEFAULT NULL,p_contenido text DEFAULT NULL,p_roles text[] DEFAULT NULL,p_referencia text DEFAULT NULL,p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cargo_actor text; draft public.jaguar360_comunicados; total int; inbox jsonb; sent jsonb;
 roles constant text[]:=ARRAY['alumno','docente','direccion_escolar','control_escolar','control','coordinacion_academica','servicios_docentes','servicios_estudiantiles','prefectura','archivo_escolar','recursos_monetarios'];
 proposers constant text[]:=ARRAY['control_escolar','control','coordinacion_academica','servicios_docentes','servicios_estudiantiles','prefectura','archivo_escolar','recursos_monetarios'];
BEGIN
 IF p_op IS NOT NULL THEN
  LOCK TABLE public.perfiles,public.alumnos,public.docentes IN SHARE MODE NOWAIT;
  LOCK TABLE public.jaguar360_comunicados,public.jaguar360_comunicado_resoluciones,public.jaguar360_comunicado_receptores,public.jaguar360_comunicado_acuses IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 END IF;
 SELECT rol INTO cargo_actor FROM public.perfiles WHERE id=p_actor AND activo IS TRUE;
 IF cargo_actor IS NULL OR NOT (cargo_actor=ANY(roles)) OR (cargo_actor='alumno' AND NOT EXISTS(SELECT 1 FROM public.alumnos a WHERE a.auth_user_id=p_actor AND a.activo AND a.estado_escolar NOT IN ('baja','traslado','archivado','egresado'))) OR (cargo_actor='docente' AND NOT EXISTS(SELECT 1 FROM public.docentes d WHERE d.auth_user_id=p_actor AND d.activo AND d.estado_profesional NOT IN ('baja','archivado','inactivo'))) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF p_op='propose' THEN
  IF NOT (cargo_actor=ANY(proposers)) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
  IF p_roles IS NULL OR NOT (p_roles<@roles) OR cardinality(p_roles) NOT BETWEEN 1 AND 11 OR array_position(p_roles,NULL) IS NOT NULL OR (SELECT count(DISTINCT r) FROM unnest(p_roles) r)<>cardinality(p_roles) OR p_asunto IS NULL OR char_length(btrim(p_asunto)) NOT BETWEEN 6 AND 180 OR p_contenido IS NULL OR char_length(btrim(p_contenido)) NOT BETWEEN 15 AND 6000 OR p_referencia IS NULL OR char_length(btrim(p_referencia)) NOT BETWEEN 5 AND 300 OR p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Comunicado incompleto.'; END IF;
  INSERT INTO public.jaguar360_comunicados(autor,cargo,asunto,contenido,destinatarios,referencia,motivo) VALUES(p_actor,cargo_actor,btrim(p_asunto),btrim(p_contenido),p_roles,btrim(p_referencia),btrim(p_motivo));
 ELSIF p_op IN ('publish','reject') THEN
  IF cargo_actor<>'direccion_escolar' THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
  SELECT * INTO draft FROM public.jaguar360_comunicados WHERE id=p_id;
  IF NOT FOUND OR draft.autor=p_actor OR EXISTS(SELECT 1 FROM public.jaguar360_comunicado_resoluciones WHERE comunicado_id=p_id) OR p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Propuesta no disponible o revisión no independiente.'; END IF;
  INSERT INTO public.jaguar360_comunicado_resoluciones(comunicado_id,estado,actor_id,motivo) VALUES(draft.id,CASE WHEN p_op='publish' THEN 'publicado' ELSE 'rechazado' END,p_actor,btrim(p_motivo));
  IF p_op='publish' THEN
   INSERT INTO public.jaguar360_comunicado_receptores(comunicado_id,receptor,cargo)
   SELECT draft.id,p.id,p.rol FROM public.perfiles p WHERE p.activo AND p.rol=ANY(draft.destinatarios)
    AND (p.rol<>'alumno' OR EXISTS(SELECT 1 FROM public.alumnos a WHERE a.auth_user_id=p.id AND a.activo AND a.estado_escolar NOT IN ('baja','traslado','archivado','egresado')))
    AND (p.rol<>'docente' OR EXISTS(SELECT 1 FROM public.docentes d WHERE d.auth_user_id=p.id AND d.activo AND d.estado_profesional NOT IN ('baja','archivado','inactivo')));
   GET DIAGNOSTICS total=ROW_COUNT;
   IF total=0 THEN RAISE EXCEPTION 'No existen receptores activos para el alcance elegido.'; END IF;
  END IF;
 ELSIF p_op='ack' THEN
  IF NOT EXISTS(SELECT 1 FROM public.jaguar360_comunicado_receptores r WHERE r.comunicado_id=p_id AND r.receptor=p_actor AND r.cargo=cargo_actor) THEN RAISE EXCEPTION 'Comunicado no asignado a este cargo.' USING ERRCODE='42501'; END IF;
  INSERT INTO public.jaguar360_comunicado_acuses(comunicado_id,receptor,cargo) VALUES(p_id,p_actor,cargo_actor) ON CONFLICT(comunicado_id,receptor) DO NOTHING;
 ELSIF p_op IS NOT NULL THEN RAISE EXCEPTION 'Operación inválida.';
 END IF;
 SELECT coalesce(jsonb_agg(x.item ORDER BY x.ack_at NULLS FIRST,x.id DESC),'[]'::jsonb) INTO inbox FROM (
  SELECT c.id,a.creado_at AS ack_at,jsonb_build_object('id',c.id::text,'subject',c.asunto,'body',c.contenido,'reference',c.referencia,'senderRole',c.cargo,'sentAt',r.enviado_at,'ackAt',a.creado_at) item
  FROM public.jaguar360_comunicado_receptores r JOIN public.jaguar360_comunicados c ON c.id=r.comunicado_id LEFT JOIN public.jaguar360_comunicado_acuses a ON a.comunicado_id=r.comunicado_id AND a.receptor=r.receptor WHERE r.receptor=p_actor AND r.cargo=cargo_actor ORDER BY a.creado_at NULLS FIRST,c.id DESC LIMIT 100) x;
 SELECT coalesce(jsonb_agg(x.item ORDER BY x.id DESC),'[]'::jsonb) INTO sent FROM (
 SELECT c.id,jsonb_build_object('id',c.id::text,'subject',c.asunto,'body',c.contenido,'reference',c.referencia,'reason',c.motivo,'roles',c.destinatarios,'senderRole',c.cargo,'state',coalesce(d.estado,'propuesta'),'resolutionReason',d.motivo,'recipients',(SELECT count(*) FROM public.jaguar360_comunicado_receptores r WHERE r.comunicado_id=c.id),'acknowledged',(SELECT count(*) FROM public.jaguar360_comunicado_acuses a WHERE a.comunicado_id=c.id)) item FROM public.jaguar360_comunicados c LEFT JOIN public.jaguar360_comunicado_resoluciones d ON d.comunicado_id=c.id WHERE (c.autor=p_actor AND c.cargo=cargo_actor) OR cargo_actor='direccion_escolar' ORDER BY c.id DESC LIMIT 100) x;
 RETURN jsonb_build_object('inbox',inbox,'sent',sent,'canPropose',cargo_actor=ANY(proposers),'canResolve',cargo_actor='direccion_escolar','roles',to_jsonb(roles));
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_comunicados_bandeja(uuid,text,bigint,text,text,text[],text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_comunicados_bandeja(uuid,text,bigint,text,text,text[],text,text) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
