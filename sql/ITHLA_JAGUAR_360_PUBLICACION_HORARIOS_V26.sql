-- Publication of an initial, identical weekly schedule for every ordinary period in a new cycle.
-- Legacy horarios has no period id; do not project differing weeks into that table.
BEGIN;
CREATE OR REPLACE FUNCTION public.jaguar360_contexto_semana(p_actor uuid,p_ciclo text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; planrow public.jaguar360_planes_ciclo; ctx jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('direccion_escolar','coordinacion_academica')) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 SELECT * INTO planrow FROM public.jaguar360_planes_ciclo WHERE ciclo=p_ciclo AND estado='validada_para_planificacion' ORDER BY version DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'No hay plan validado.'; END IF;
 IF (SELECT count(*) FROM public.grupo_materias gm JOIN public.grupos g ON g.id=gm.grupo_id WHERE gm.activo AND g.activo)>1000 OR (SELECT count(*) FROM public.docente_disponibilidad)>20000 THEN RAISE EXCEPTION 'Catálogo demasiado extenso para esta revisión.'; END IF;
 SELECT jsonb_build_object('plan',planrow.plan,'version',planrow.version,
  'groups',coalesce((SELECT jsonb_agg(jsonb_build_object('id',g.id::text,'name',g.clave,'grade',g.grado,'turn',g.turno,'start',g.hora_inicio,'end',g.hora_fin,'students',(SELECT count(*) FROM public.alumnos al WHERE al.grupo_id=g.id AND al.activo)) ORDER BY g.id) FROM public.grupos g WHERE g.activo),'[]'::jsonb),
  'subjects',coalesce((SELECT jsonb_agg(jsonb_build_object('id',gm.id::text,'group',gm.grupo_id::text,'subject',gm.materia_id::text,'teachers',coalesce((SELECT jsonb_agg(DISTINCT ad.docente_id::text ORDER BY ad.docente_id::text) FROM public.asignaciones_docentes ad JOIN public.docentes d ON d.id=ad.docente_id JOIN public.perfiles p ON p.id=d.auth_user_id WHERE ad.grupo_materia_id=gm.id AND ad.activo AND ad.ciclo_escolar=p_ciclo AND d.activo AND p.activo AND p.rol='docente'),'[]'::jsonb)) ORDER BY gm.id) FROM public.grupo_materias gm JOIN public.grupos g ON g.id=gm.grupo_id WHERE gm.activo AND g.activo),'[]'::jsonb),
  'rooms',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id::text,'name',nombre,'code',codigo,'capacity',capacidad) ORDER BY id) FROM public.jaguar_aulas WHERE activo AND tipo_espacio='aula'),'[]'::jsonb),
  'teachers',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id::text,'name',d.nombre_completo) ORDER BY d.id) FROM public.docentes d JOIN public.perfiles p ON p.id=d.auth_user_id WHERE d.activo AND p.activo AND p.rol='docente'),'[]'::jsonb),
  'availability',coalesce((SELECT jsonb_agg(jsonb_build_object('teacher',docente_id::text,'day',dia_semana,'start',hora_inicio,'end',hora_fin,'available',disponible) ORDER BY id) FROM public.docente_disponibilidad),'[]'::jsonb),
  'unscoped',(SELECT count(*) FROM public.horarios WHERE ciclo_escolar IS NULL)) INTO ctx;
 RETURN ctx||jsonb_build_object('fingerprint',md5(ctx::text));
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_contexto_semana(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_contexto_semana(uuid,text) TO service_role;

CREATE TABLE IF NOT EXISTS public.jaguar360_horarios_publicados (
 ciclo text PRIMARY KEY REFERENCES public.jaguar360_aperturas_ciclo(ciclo) ON DELETE RESTRICT,
 version_plan integer NOT NULL, huella text NOT NULL, propuestas jsonb NOT NULL, sesiones jsonb NOT NULL,
 actor_id uuid NOT NULL, referencia text NOT NULL, motivo text NOT NULL, creado_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(ciclo,version_plan) REFERENCES public.jaguar360_planes_ciclo(ciclo,version) ON DELETE RESTRICT
);
ALTER TABLE public.jaguar360_horarios_publicados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_horarios_publicados FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_publicar_horario(p_actor uuid,p_ciclo text,p_huella text DEFAULT NULL,p_referencia text DEFAULT NULL,p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor_role text; ctx jsonb; n int; firstslots jsonb; slots jsonb; proposals jsonb:='[]'::jsonb; rowinfo record; h text; existing public.jaguar360_horarios_publicados; reasons text[]:=ARRAY[]::text[]; cnt int;
BEGIN
 IF p_huella IS NOT NULL THEN
  LOCK TABLE public.perfiles,public.jaguar360_planes_ciclo,public.jaguar360_aperturas_ciclo,public.jaguar360_grupos_ciclo,public.grupos,public.grupo_materias,public.alumnos,public.asignaciones_docentes,public.docentes,public.docente_disponibilidad,public.jaguar_aulas,public.periodos_escolares,public.jaguar360_semanas_propuestas,public.jaguar360_semanas_resoluciones,public.jaguar360_evidencias_periodo,public.calificaciones,public.asistencias IN SHARE MODE NOWAIT;
  LOCK TABLE public.horarios,public.jaguar360_horarios_publicados IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 END IF;
 SELECT rol INTO actor_role FROM public.perfiles WHERE id=p_actor AND activo IS TRUE;
 IF actor_role IS NULL OR actor_role NOT IN ('coordinacion_academica','direccion_escolar') OR (p_huella IS NOT NULL AND actor_role<>'direccion_escolar') THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 SELECT * INTO existing FROM public.jaguar360_horarios_publicados WHERE ciclo=p_ciclo;
 IF FOUND THEN
  IF p_huella IS NOT NULL THEN RAISE EXCEPTION 'Horario ya publicado; no se reemplaza.'; END IF;
  RETURN jsonb_build_object('published',true,'ready',false,'cycle',p_ciclo,'count',jsonb_array_length(existing.sesiones),'record',to_jsonb(existing)-'sesiones');
 END IF;
 ctx:=public.jaguar360_contexto_semana(p_actor,p_ciclo);
 n:=(ctx->'plan'->'policy'->>'periods')::int;
 IF n IS NULL OR n NOT BETWEEN 1 AND 6 THEN RAISE EXCEPTION 'Plan incompatible.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.jaguar360_aperturas_ciclo a WHERE a.ciclo=p_ciclo AND a.version_plan=(ctx->>'version')::int) OR (SELECT count(*) FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE)<>1 OR NOT EXISTS(SELECT 1 FROM public.periodos_escolares WHERE ciclo_escolar=p_ciclo AND es_periodo_actual IS TRUE AND numero_periodo=1) THEN reasons:=array_append(reasons,'Se requiere un ciclo nuevo activado con su plan vigente.'); END IF;
 IF (SELECT count(*) FROM public.periodos_escolares WHERE ciclo_escolar=p_ciclo)<>n OR EXISTS(SELECT 1 FROM public.periodos_escolares WHERE ciclo_escolar=p_ciclo AND (fecha_inicio IS NULL OR fecha_fin IS NULL OR fecha_inicio<=(now() AT TIME ZONE 'America/Mexico_City')::date)) THEN reasons:=array_append(reasons,'Publicación inicial antes de comenzar clases.'); END IF;
 IF EXISTS(SELECT 1 FROM public.horarios h WHERE h.ciclo_escolar=p_ciclo OR h.ciclo_escolar IS NULL OR EXISTS(SELECT 1 FROM public.grupo_materias gm JOIN public.jaguar360_grupos_ciclo b ON b.grupo_id=gm.grupo_id WHERE gm.id=h.grupo_materia_id AND b.ciclo=p_ciclo)) THEN reasons:=array_append(reasons,'Hay horarios previos o sin ciclo; no se sobrescriben.'); END IF;
 IF EXISTS(SELECT 1 FROM public.grupos g WHERE g.activo AND NOT EXISTS(SELECT 1 FROM public.jaguar360_grupos_ciclo b WHERE b.grupo_id=g.id AND b.ciclo=p_ciclo AND b.version_plan=(ctx->>'version')::int)) OR NOT EXISTS(SELECT 1 FROM public.grupos WHERE activo) THEN reasons:=array_append(reasons,'Grupos activos sin vinculación única al plan.'); END IF;
 IF EXISTS(SELECT 1 FROM public.calificaciones c JOIN public.periodos_escolares p ON p.id=c.periodo_id WHERE p.ciclo_escolar=p_ciclo) OR EXISTS(SELECT 1 FROM public.asistencias a JOIN public.grupo_materias gm ON gm.id=a.grupo_materia_id JOIN public.jaguar360_grupos_ciclo b ON b.grupo_id=gm.grupo_id WHERE b.ciclo=p_ciclo) OR EXISTS(SELECT 1 FROM public.jaguar360_evidencias_periodo e JOIN public.periodos_escolares p ON p.id=e.periodo_id WHERE p.ciclo_escolar=p_ciclo AND e.tipo IN ('sesiones','marcas')) THEN reasons:=array_append(reasons,'Ya existen sesiones o resultados; no se cambia la programación.'); END IF;
 -- Latest independently reviewed compatible week per period; exact slot equality, ignoring ordering.
 FOR rowinfo IN SELECT i AS period,w.id,w.propuesta FROM generate_series(1,n) AS series(i) LEFT JOIN LATERAL (SELECT p.id,p.propuesta FROM public.jaguar360_semanas_propuestas p JOIN public.jaguar360_semanas_resoluciones r ON r.propuesta_id=p.id AND r.estado='reviewed' AND r.actor<>p.actor WHERE p.ciclo=p_ciclo AND p.periodo=i AND p.version_plan=(ctx->>'version')::int AND p.huella=ctx->>'fingerprint' ORDER BY p.id DESC LIMIT 1) w ON true LOOP
  IF rowinfo.id IS NULL OR rowinfo.propuesta->>'compatible' IS DISTINCT FROM 'true' OR jsonb_typeof(rowinfo.propuesta->'slots') IS DISTINCT FROM 'array' THEN reasons:=array_append(reasons,'Falta semana vigente revisada del periodo '||rowinfo.period); CONTINUE; END IF;
  SELECT jsonb_agg(x ORDER BY x::text) INTO slots FROM jsonb_array_elements(rowinfo.propuesta->'slots') x;
  IF slots IS NULL OR jsonb_array_length(slots) NOT BETWEEN 1 AND 5000 THEN reasons:=array_append(reasons,'Semana vacía o inválida.'); CONTINUE; END IF;
  IF firstslots IS NULL THEN firstslots:=slots; ELSIF slots IS DISTINCT FROM firstslots THEN reasons:=array_append(reasons,'El horario varía entre periodos; el modelo anterior no admite esa publicación.'); END IF;
  proposals:=proposals||jsonb_build_array(jsonb_build_object('period',rowinfo.period,'id',rowinfo.id::text));
 END LOOP;
 -- Cross-check live ordinary rooms and roster caps (not only current enrolment), assignment and date-independent overlaps.
 IF firstslots IS NULL OR EXISTS(SELECT 1 FROM jsonb_to_recordset(coalesce(firstslots,'[]'::jsonb)) z("groupSubject" bigint,"group" bigint,teacher bigint,room bigint,day int,start int,"end" int)
  LEFT JOIN public.grupo_materias gm ON gm.id=z."groupSubject" AND gm.activo LEFT JOIN public.grupos g ON g.id=gm.grupo_id AND g.activo LEFT JOIN public.jaguar360_grupos_ciclo b ON b.grupo_id=g.id AND b.ciclo=p_ciclo LEFT JOIN public.jaguar_aulas a ON a.id=z.room AND a.activo AND a.tipo_espacio='aula'
  WHERE gm.id IS NULL OR g.id IS NULL OR z."group" IS DISTINCT FROM g.id OR b.grupo_id IS NULL OR a.id IS NULL OR a.capacidad<b.cupo OR z.day IS NULL OR z.day NOT BETWEEN 1 AND 5 OR z.start IS NULL OR z."end" IS NULL OR z.start<0 OR z."end">1439 OR z.start>=z."end" OR NOT EXISTS(SELECT 1 FROM public.asignaciones_docentes ad JOIN public.docentes d ON d.id=ad.docente_id AND d.activo JOIN public.perfiles p ON p.id=d.auth_user_id AND p.activo AND p.rol='docente' WHERE ad.grupo_materia_id=gm.id AND ad.docente_id=z.teacher AND ad.activo AND ad.ciclo_escolar=p_ciclo) OR (SELECT count(*) FROM public.jaguar_aulas aa WHERE aa.activo AND upper(btrim(aa.nombre))=upper(btrim(a.nombre)))<>1) THEN reasons:=array_append(reasons,'Aulas, capacidad autorizada de grupo o asignaciones no conciliadas.'); END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(firstslots,'[]'::jsonb)) WITH ORDINALITY a(s,i) JOIN jsonb_array_elements(coalesce(firstslots,'[]'::jsonb)) WITH ORDINALITY b(s,i) ON a.i<b.i AND a.s->>'day'=b.s->>'day' AND (a.s->>'start')::int<(b.s->>'end')::int AND (b.s->>'start')::int<(a.s->>'end')::int AND (a.s->>'group'=b.s->>'group' OR a.s->>'teacher'=b.s->>'teacher' OR a.s->>'room'=b.s->>'room')) THEN reasons:=array_append(reasons,'Traslapes en sesiones propuestas.'); END IF;
 h:=md5(jsonb_build_object('context',ctx,'weeks',proposals,'slots',firstslots,'bindings',(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.grupo_id),'[]'::jsonb) FROM public.jaguar360_grupos_ciclo b WHERE ciclo=p_ciclo),'reasons',reasons)::text);
 IF p_huella IS NOT NULL THEN
  IF cardinality(reasons)>0 OR p_huella IS DISTINCT FROM h OR p_referencia IS NULL OR char_length(btrim(p_referencia)) NOT BETWEEN 5 AND 300 OR p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Horario no publicable, huella modificada o confirmación incompleta.'; END IF;
  INSERT INTO public.horarios(grupo_materia_id,dia_semana,hora_inicio,hora_fin,aula,docente_id,ciclo_escolar)
  SELECT z."groupSubject",z.day,(time '00:00'+z.start*interval '1 minute'),(time '00:00'+z."end"*interval '1 minute'),a.nombre,z.teacher,p_ciclo FROM jsonb_to_recordset(firstslots) z("groupSubject" bigint,teacher bigint,room bigint,day int,start int,"end" int) JOIN public.jaguar_aulas a ON a.id=z.room;
  GET DIAGNOSTICS cnt=ROW_COUNT;
  IF cnt<>jsonb_array_length(firstslots) THEN RAISE EXCEPTION 'Publicación incompleta.'; END IF;
  INSERT INTO public.jaguar360_horarios_publicados(ciclo,version_plan,huella,propuestas,sesiones,actor_id,referencia,motivo) VALUES(p_ciclo,(ctx->>'version')::int,h,proposals,firstslots,p_actor,btrim(p_referencia),btrim(p_motivo));
  RETURN jsonb_build_object('published',true,'ready',false,'cycle',p_ciclo,'count',cnt,'proposals',proposals);
 END IF;
 RETURN jsonb_build_object('cycle',p_ciclo,'ready',cardinality(reasons)=0,'published',false,'reasons',to_jsonb(reasons),'fingerprint',h,'proposals',proposals,'count',coalesce(jsonb_array_length(firstslots),0));
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_publicar_horario(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_publicar_horario(uuid,text,text,text,text) TO service_role;
-- Never let the old timetable editor silently alter an already published experimental schedule.
CREATE OR REPLACE FUNCTION public.jaguar360_proteger_horario_publicado() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF EXISTS(SELECT 1 FROM public.jaguar360_horarios_publicados p WHERE p.ciclo=OLD.ciclo_escolar OR EXISTS(SELECT 1 FROM public.grupo_materias gm JOIN public.jaguar360_grupos_ciclo b ON b.grupo_id=gm.grupo_id WHERE gm.id=OLD.grupo_materia_id AND b.ciclo=p.ciclo)) THEN RAISE EXCEPTION 'Horario Jaguar 360 publicado: no se modifica mediante el editor antiguo.'; END IF;
 END IF;
 IF TG_OP<>'DELETE' THEN
  IF EXISTS(SELECT 1 FROM public.jaguar360_horarios_publicados p WHERE p.ciclo=NEW.ciclo_escolar OR EXISTS(SELECT 1 FROM public.grupo_materias gm JOIN public.jaguar360_grupos_ciclo b ON b.grupo_id=gm.grupo_id WHERE gm.id=NEW.grupo_materia_id AND b.ciclo=p.ciclo)) THEN RAISE EXCEPTION 'Horario Jaguar 360 publicado: no se modifica mediante el editor antiguo.'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_proteger_horario_publicado() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS jaguar360_proteger_horario_publicado ON public.horarios;
CREATE TRIGGER jaguar360_proteger_horario_publicado BEFORE INSERT OR UPDATE OR DELETE ON public.horarios FOR EACH ROW EXECUTE FUNCTION public.jaguar360_proteger_horario_publicado();
COMMIT;
NOTIFY pgrst,'reload schema';
