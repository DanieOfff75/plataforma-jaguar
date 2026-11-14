-- Dated draft schedule for a temporary recourse group; does not create access or consume attempts.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar360_programacion_temporal (
 convocatoria_id bigint NOT NULL REFERENCES public.jaguar360_convocatorias(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version>0), estado text NOT NULL CHECK(estado IN ('propuesta','cancelada')),
 huella text NOT NULL CHECK(huella ~ '^[a-f0-9]{32}$'), programacion jsonb NOT NULL CHECK(jsonb_typeof(programacion)='object'),
 actor_id uuid NOT NULL, actor_nombre text NOT NULL, motivo text NOT NULL CHECK(char_length(motivo) BETWEEN 15 AND 1500),
 creado_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(convocatoria_id,version)
);
ALTER TABLE public.jaguar360_programacion_temporal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_programacion_temporal FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_fuentes_programacion_temporal(p_actor uuid,p_call bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.jaguar360_convocatorias; p jsonb; subject bigint; rr record; sources jsonb; roster jsonb:='[]'; gms bigint[]:='{}'; historical bigint[]; teachers jsonb; ordinary jsonb; commitments jsonb; prev jsonb; output jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('direccion_escolar','coordinacion_academica','control_escolar','control')) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.jaguar360_convocatorias WHERE id=p_call AND reglas->>'kind'='recourse';
 IF NOT FOUND THEN RAISE EXCEPTION 'Convocatoria inexistente.'; END IF;
 SELECT plan INTO p FROM public.jaguar360_planes_ciclo WHERE ciclo=c.ciclo AND version=c.plan_version;
 SELECT (s->>'legacyId')::bigint INTO subject FROM jsonb_array_elements(p->'curriculum') s WHERE s->>'key'=c.reglas->>'subjectKey';
 IF subject IS NULL THEN RAISE EXCEPTION 'Materia sin vínculo inequívoco al catálogo.'; END IF;
 -- Exclude known ordinary holders from original memberships; don't infer historical completeness.
 FOR rr IN SELECT * FROM public.jaguar360_reservas_recursamiento WHERE convocatoria_id=p_call AND estado='reservada' ORDER BY id LOOP
  sources:=public.jaguar360_fuentes_selladas(p_actor,c.ciclo,rr.alumno_id);
  roster:=roster||jsonb_build_array(jsonb_build_object('id',rr.id::text,'version',rr.version,'stale',rr.huella<>md5(jsonb_build_object('call',to_jsonb(c),'source',sources)::text)));
  SELECT coalesce(array_agg(DISTINCT (r->>'groupMaterialId')::bigint),'{}'::bigint[]) INTO historical FROM jsonb_array_elements(sources->'periods') pe CROSS JOIN LATERAL jsonb_array_elements(pe->'rows') r WHERE r->>'subjectId'=subject::text;
  IF cardinality(historical)=0 THEN RAISE EXCEPTION 'Falta correspondencia histórica de un alumno.'; END IF;
  gms:=gms||historical;
 END LOOP;
 SELECT coalesce(array_agg(DISTINCT d ORDER BY d),'{}'::bigint[]) INTO historical FROM (
  SELECT docente_id d FROM public.asignaciones_docentes WHERE grupo_materia_id=ANY(gms) AND ciclo_escolar=c.ciclo
  UNION SELECT ca.docente_id FROM public.calificaciones ca JOIN public.periodos_escolares pe ON pe.id=ca.periodo_id WHERE ca.grupo_materia_id=ANY(gms) AND pe.ciclo_escolar=c.ciclo
  UNION SELECT h.docente_id FROM public.horarios h WHERE h.grupo_materia_id=ANY(gms) AND (h.ciclo_escolar=c.ciclo OR h.ciclo_escolar IS NULL)
 ) x WHERE d IS NOT NULL;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id::text,'teacher',s.docente_id::text,'state',s.estado,'version',s.version,'application',s.propuesta,'active',d.activo AND d.estado_profesional='activo' AND EXISTS(SELECT 1 FROM public.perfiles f WHERE f.id=d.auth_user_id AND f.activo IS TRUE AND f.rol='docente')) ORDER BY s.id),'[]') INTO teachers FROM public.jaguar360_apoyo_docente s JOIN public.docentes d ON d.id=s.docente_id WHERE s.ciclo=c.ciclo AND s.estado='validado';
 -- Conservative: all listed ordinary slots for support teachers, even across cycles. No invented validity dates.
 SELECT coalesce(jsonb_agg(jsonb_build_object('teacher',h.docente_id::text,'day',h.dia_semana,'start',h.hora_inicio,'end',h.hora_fin) ORDER BY h.id),'[]') INTO ordinary FROM public.horarios h WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(teachers) t WHERE t->>'teacher'=h.docente_id::text);
 SELECT coalesce(jsonb_agg(s ORDER BY t.convocatoria_id,s->>'date',s->>'start'),'[]') INTO commitments FROM (SELECT DISTINCT ON(convocatoria_id) * FROM public.jaguar360_programacion_temporal WHERE convocatoria_id<>p_call ORDER BY convocatoria_id,version DESC) t CROSS JOIN LATERAL jsonb_array_elements(t.programacion->'sessions') s WHERE t.estado='propuesta';
 SELECT jsonb_build_object('version',a.version,'state',a.estado,'schedule',a.programacion,'actor',a.actor_nombre,'reason',a.motivo,'created',a.creado_at) INTO prev FROM public.jaguar360_programacion_temporal a WHERE convocatoria_id=p_call ORDER BY version DESC LIMIT 1;
 output:=jsonb_build_object('call',(to_jsonb(c)-'id')||jsonb_build_object('id',c.id::text),'subjectId',subject::text,'roster',roster,'holders',to_jsonb(ARRAY(SELECT z::text FROM unnest(historical) z)),'teachers',teachers,'ordinary',ordinary,'commitments',commitments,'previous',prev);
 RETURN output||jsonb_build_object('fingerprint',md5(output::text));
END $$;
CREATE OR REPLACE FUNCTION public.jaguar360_guardar_programacion_temporal(p_actor uuid,p_call bigint,p_op text,p_version integer,p_reason text,p_fingerprint text DEFAULT NULL,p_schedule jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; src jsonb; v integer; c public.jaguar360_convocatorias; r public.jaguar360_programacion_temporal; st text; sessions jsonb;
BEGIN
 SELECT nombre_completo INTO a FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol='coordinacion_academica';
 IF NOT FOUND THEN RAISE EXCEPTION 'Solo Coordinación registra propuestas.' USING ERRCODE='42501'; END IF;
 IF p_op IS NULL OR p_op NOT IN ('save','cancel') OR p_version IS NULL OR p_version<0 OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Operación inválida.'; END IF;
 LOCK TABLE public.jaguar360_programacion_temporal IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 LOCK TABLE public.jaguar360_convocatorias,public.jaguar360_reservas_recursamiento,public.jaguar360_apoyo_docente,public.docentes,public.perfiles,public.asignaciones_docentes,public.calificaciones,public.horarios,public.jaguar360_cierres_periodo,public.jaguar360_rectificaciones,public.jaguar360_rectificacion_resoluciones,public.jaguar360_planes_ciclo,public.periodos_escolares,public.alumnos IN SHARE MODE NOWAIT;
 SELECT * INTO c FROM public.jaguar360_convocatorias WHERE id=p_call AND reglas->>'kind'='recourse';
 IF NOT FOUND THEN RAISE EXCEPTION 'Convocatoria inexistente.'; END IF;
 SELECT * INTO r FROM public.jaguar360_programacion_temporal WHERE convocatoria_id=p_call ORDER BY version DESC LIMIT 1;
 v:=coalesce(r.version,0);
 IF v<>p_version THEN RAISE EXCEPTION 'Versión desactualizada.'; END IF;
 IF p_op='cancel' THEN
  IF r.estado IS DISTINCT FROM 'propuesta' THEN RAISE EXCEPTION 'No hay propuesta vigente.'; END IF;
  st:='cancelada';p_schedule:=r.programacion;p_fingerprint:=r.huella;
 ELSE
  IF c.estado<>'autorizada_para_planeacion' OR (c.reglas->>'start')::date<=(now() AT TIME ZONE 'America/Mexico_City')::date THEN RAISE EXCEPTION 'Solo antes de iniciar convocatoria autorizada.'; END IF;
  src:=public.jaguar360_fuentes_programacion_temporal(p_actor,p_call);
  IF p_fingerprint IS NULL OR src->>'fingerprint' IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'Las fuentes cambiaron; vuelve a consultar.'; END IF;
  sessions:=p_schedule->'sessions';
  IF p_schedule->>'state' IS DISTINCT FROM 'proposed' OR jsonb_typeof(sessions) IS DISTINCT FROM 'array' OR jsonb_array_length(sessions) NOT BETWEEN 1 AND 366 OR jsonb_array_length(src->'roster')=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(src->'roster') q WHERE (q->>'stale')::boolean) THEN RAISE EXCEPTION 'Propuesta o padrón inválido.'; END IF;
  -- The trusted API computes availability, duration, load and tie breaking against this exact fingerprint.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(sessions) s WHERE EXISTS(SELECT 1 FROM jsonb_array_elements_text(src->'holders') h WHERE h=s->>'teacher') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(src->'teachers') t WHERE t->>'teacher'=s->>'teacher' AND t->>'id'=s->>'support' AND t->>'version'=s->>'supportVersion' AND (t->>'active')::boolean)) THEN RAISE EXCEPTION 'Docente incompatible.'; END IF;
  st:='propuesta';
 END IF;
 INSERT INTO public.jaguar360_programacion_temporal(convocatoria_id,version,estado,huella,programacion,actor_id,actor_nombre,motivo) VALUES(p_call,v+1,st,p_fingerprint,p_schedule,p_actor,coalesce(a.nombre_completo,'Sin nombre'),btrim(p_reason)) RETURNING * INTO r;
 RETURN jsonb_build_object('version',r.version,'state',r.estado,'schedule',r.programacion);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_fuentes_programacion_temporal(uuid,bigint),public.jaguar360_guardar_programacion_temporal(uuid,bigint,text,integer,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_fuentes_programacion_temporal(uuid,bigint),public.jaguar360_guardar_programacion_temporal(uuid,bigint,text,integer,text,text,jsonb) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
