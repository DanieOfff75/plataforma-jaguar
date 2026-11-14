-- V10. Padrón preparatorio independiente de los grupos ordinarios.
-- NO habilita clases, permisos, aplicación de resultados ni consumo de intento.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar360_reservas_recursamiento (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 convocatoria_id bigint NOT NULL REFERENCES public.jaguar360_convocatorias(id) ON DELETE RESTRICT,
 alumno_id bigint NOT NULL REFERENCES public.alumnos(id) ON DELETE RESTRICT,
 ciclo text NOT NULL, materia_clave text NOT NULL,
 causa text NOT NULL CHECK(causa IN ('academic','attendance','mixed')),
 bloques integer[] NOT NULL CHECK(cardinality(bloques) BETWEEN 1 AND 6),
 huella text NOT NULL CHECK(huella ~ '^[a-f0-9]{32}$'),
 respaldo jsonb NOT NULL CHECK(jsonb_typeof(respaldo)='object'),
 estado text NOT NULL DEFAULT 'reservada' CHECK(estado IN ('reservada','cancelada')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 creado_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,version)
);
CREATE UNIQUE INDEX IF NOT EXISTS j360_reserva_activa_unica ON public.jaguar360_reservas_recursamiento(ciclo,materia_clave,alumno_id) WHERE estado='reservada';
CREATE TABLE IF NOT EXISTS public.jaguar360_reserva_eventos (
 reserva_id bigint NOT NULL REFERENCES public.jaguar360_reservas_recursamiento(id) ON DELETE RESTRICT,
 version integer NOT NULL, estado text NOT NULL CHECK(estado IN ('reservada','cancelada')),
 actor_id uuid NOT NULL, actor_nombre text NOT NULL, actor_cargo text NOT NULL,
 motivo text NOT NULL CHECK(char_length(motivo) BETWEEN 15 AND 1500), creado_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(reserva_id,version)
);
ALTER TABLE public.jaguar360_reservas_recursamiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar360_reserva_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_reservas_recursamiento,public.jaguar360_reserva_eventos FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_candidatura_recursamiento(p_actor uuid,p_call bigint,p_alumno bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.jaguar360_convocatorias; src jsonb; fingerprint text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('direccion_escolar','coordinacion_academica','control_escolar','control')) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.jaguar360_convocatorias WHERE id=p_call AND estado='autorizada_para_planeacion' AND reglas->>'kind'='recourse';
 IF NOT FOUND THEN RAISE EXCEPTION 'Convocatoria de recursamiento no autorizada.'; END IF;
 src:=public.jaguar360_fuentes_selladas(p_actor,c.ciclo,p_alumno);
 -- fingerprint computed in the DB; includes both rules/version and sealed data with rectifications.
 fingerprint:=md5(jsonb_build_object('call',to_jsonb(c),'source',src)::text);
 RETURN jsonb_build_object('call',(to_jsonb(c)-'id')||jsonb_build_object('id',c.id::text),'source',src,'fingerprint',fingerprint,'capacity',(c.reglas->>'capacity')::integer,'reserved',(SELECT count(*) FROM public.jaguar360_reservas_recursamiento WHERE convocatoria_id=c.id AND estado='reservada'));
END $$;
CREATE OR REPLACE FUNCTION public.jaguar360_padron_recursamiento(p_actor uuid,p_call bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('direccion_escolar','coordinacion_academica','control_escolar','control')) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.jaguar360_convocatorias WHERE id=p_call AND reglas->>'kind'='recourse') THEN RAISE EXCEPTION 'Convocatoria inexistente.'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id::text,'student',r.alumno_id::text,'cause',r.causa,'blocks',r.bloques,'state',r.estado,'version',r.version,'created',r.creado_at,'events',(SELECT jsonb_agg(to_jsonb(e)-'reserva_id'-'actor_id' ORDER BY e.version) FROM public.jaguar360_reserva_eventos e WHERE e.reserva_id=r.id)) ORDER BY r.id) FROM public.jaguar360_reservas_recursamiento r WHERE r.convocatoria_id=p_call),'[]'::jsonb);
END $$;
CREATE OR REPLACE FUNCTION public.jaguar360_reservar_recursamiento(p_actor uuid,p_call bigint,p_alumno bigint,p_accion text,p_motivo text,p_huella text DEFAULT NULL,p_bloques integer[] DEFAULT NULL,p_causa text DEFAULT NULL,p_id bigint DEFAULT NULL,p_version integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; c public.jaguar360_convocatorias; r public.jaguar360_reservas_recursamiento; v jsonb; hoy date:=(now() AT TIME ZONE 'America/Mexico_City')::date;
BEGIN
 SELECT nombre_completo,rol INTO a FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol='coordinacion_academica';
 IF NOT FOUND THEN RAISE EXCEPTION 'Solo Coordinación registra reservas.' USING ERRCODE='42501'; END IF;
 IF p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500 OR p_accion IS NULL OR p_accion NOT IN ('reservar','cancelar') THEN RAISE EXCEPTION 'Operación o motivo inválido.'; END IF;
 -- Serialize capacity, cross-call reservations and source changes. NOWAIT fails closed instead of waiting for concurrent writes.
 LOCK TABLE public.jaguar360_convocatorias,public.jaguar360_reservas_recursamiento IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 SELECT * INTO c FROM public.jaguar360_convocatorias WHERE id=p_call AND reglas->>'kind'='recourse';
 IF NOT FOUND THEN RAISE EXCEPTION 'Convocatoria inexistente.'; END IF;
 IF p_accion='reservar' THEN
  IF c.estado<>'autorizada_para_planeacion' OR (c.reglas->>'start')::date<=hoy THEN RAISE EXCEPTION 'Reservas solo antes de iniciar la convocatoria autorizada.'; END IF;
  LOCK TABLE public.jaguar360_cierres_periodo,public.jaguar360_rectificaciones,public.jaguar360_rectificacion_resoluciones,public.jaguar360_planes_ciclo,public.periodos_escolares,public.alumnos IN SHARE MODE NOWAIT;
  v:=public.jaguar360_candidatura_recursamiento(p_actor,p_call,p_alumno);
  IF p_huella IS NULL OR v->>'fingerprint' IS DISTINCT FROM p_huella OR (v->'source'->>'version')::integer IS DISTINCT FROM c.plan_version THEN RAISE EXCEPTION 'La evidencia o convocatoria cambió; consulta nuevamente.'; END IF;
  IF p_causa IS NULL OR p_causa NOT IN ('academic','attendance','mixed') OR p_bloques IS NULL OR cardinality(p_bloques) NOT BETWEEN 1 AND 6 OR cardinality(p_bloques)<>(SELECT count(DISTINCT b) FROM unnest(p_bloques) b) OR EXISTS(SELECT 1 FROM unnest(p_bloques) b WHERE b IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.reglas->'blocks') z WHERE (z->>'period')::integer=b)) THEN RAISE EXCEPTION 'Causa o bloques inválidos.'; END IF;
  IF (v->>'reserved')::integer >= (v->>'capacity')::integer THEN RAISE EXCEPTION 'Cupo agotado.'; END IF;
  IF EXISTS(SELECT 1 FROM public.jaguar360_reservas_recursamiento WHERE ciclo=c.ciclo AND materia_clave=c.reglas->>'subjectKey' AND alumno_id=p_alumno AND estado='reservada') THEN RAISE EXCEPTION 'Existe una reserva vigente para esta materia y ciclo.'; END IF;
  -- Trusted server has checked candidature and mandatory blocks from THIS fingerprint. No client can execute RPC directly.
  INSERT INTO public.jaguar360_reservas_recursamiento(convocatoria_id,alumno_id,ciclo,materia_clave,causa,bloques,huella,respaldo) VALUES(c.id,p_alumno,c.ciclo,c.reglas->>'subjectKey',p_causa,p_bloques,p_huella,v->'source') RETURNING * INTO r;
 ELSE
  SELECT * INTO r FROM public.jaguar360_reservas_recursamiento WHERE id=p_id AND convocatoria_id=c.id AND alumno_id=p_alumno AND estado='reservada' AND version=p_version FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva inexistente o desactualizada.'; END IF;
  IF (c.reglas->>'start')::date<=hoy AND c.estado<>'cancelada' THEN RAISE EXCEPTION 'La convocatoria inició; requiere revisión de cancelación.'; END IF;
  UPDATE public.jaguar360_reservas_recursamiento SET estado='cancelada',version=version+1 WHERE id=r.id RETURNING * INTO r;
 END IF;
 INSERT INTO public.jaguar360_reserva_eventos(reserva_id,version,estado,actor_id,actor_nombre,actor_cargo,motivo) VALUES(r.id,r.version,r.estado,p_actor,coalesce(a.nombre_completo,'Sin nombre'),a.rol,btrim(p_motivo));
 RETURN jsonb_build_object('id',r.id::text,'state',r.estado,'version',r.version,'student',r.alumno_id::text,'blocks',r.bloques);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_candidatura_recursamiento(uuid,bigint,bigint),public.jaguar360_padron_recursamiento(uuid,bigint),public.jaguar360_reservar_recursamiento(uuid,bigint,bigint,text,text,text,integer[],text,bigint,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_candidatura_recursamiento(uuid,bigint,bigint),public.jaguar360_padron_recursamiento(uuid,bigint),public.jaguar360_reservar_recursamiento(uuid,bigint,bigint,text,text,text,integer[],text,bigint,integer) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
