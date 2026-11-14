-- Experimental isolated operational recourse groups; never alter ordinary grading.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar360_grupos_temporales (
 convocatoria_id bigint PRIMARY KEY REFERENCES public.jaguar360_convocatorias(id) ON DELETE RESTRICT,
 programacion_version integer NOT NULL, aula_id bigint NOT NULL REFERENCES public.jaguar_aulas(id) ON DELETE RESTRICT,
 estado text NOT NULL CHECK(estado IN ('activo','cancelado')), evidencia jsonb NOT NULL,
 actor_id uuid NOT NULL, referencia text NOT NULL, motivo text NOT NULL, creado_at timestamptz NOT NULL DEFAULT now(),
 cancelado_por uuid, cancelado_at timestamptz, motivo_cancelacion text,
 FOREIGN KEY(convocatoria_id,programacion_version) REFERENCES public.jaguar360_programacion_temporal(convocatoria_id,version) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS public.jaguar360_grupo_temporal_padron (
 convocatoria_id bigint NOT NULL REFERENCES public.jaguar360_grupos_temporales(convocatoria_id) ON DELETE RESTRICT,
 reserva_id bigint NOT NULL UNIQUE REFERENCES public.jaguar360_reservas_recursamiento(id) ON DELETE RESTRICT,
 alumno_id bigint NOT NULL REFERENCES public.alumnos(id) ON DELETE RESTRICT, bloques integer[] NOT NULL,
 PRIMARY KEY(convocatoria_id,alumno_id)
);
CREATE TABLE IF NOT EXISTS public.jaguar360_sesiones_temporales (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 convocatoria_id bigint NOT NULL REFERENCES public.jaguar360_grupos_temporales(convocatoria_id) ON DELETE RESTRICT,
 bloque integer NOT NULL CHECK(bloque BETWEEN 1 AND 6), fecha date NOT NULL,
 inicio integer NOT NULL CHECK(inicio BETWEEN 0 AND 1439), fin integer NOT NULL CHECK(fin BETWEEN 1 AND 1439 AND fin>inicio),
 docente_id bigint NOT NULL REFERENCES public.docentes(id) ON DELETE RESTRICT,
 apoyo_id bigint NOT NULL REFERENCES public.jaguar360_apoyo_docente(id) ON DELETE RESTRICT, apoyo_version integer NOT NULL,
 UNIQUE(convocatoria_id,fecha,inicio)
);
CREATE TABLE IF NOT EXISTS public.jaguar360_listas_temporales (
 sesion_id bigint PRIMARY KEY REFERENCES public.jaguar360_sesiones_temporales(id) ON DELETE RESTRICT,
 marcas jsonb NOT NULL CHECK(jsonb_typeof(marcas)='array'), actor_id uuid NOT NULL, registrado_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.jaguar360_grupos_temporales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar360_grupo_temporal_padron ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar360_sesiones_temporales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar360_listas_temporales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_grupos_temporales,public.jaguar360_grupo_temporal_padron,public.jaguar360_sesiones_temporales,public.jaguar360_listas_temporales FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_consultar_grupo_temporal(p_actor uuid,p_call bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE g public.jaguar360_grupos_temporales; outg jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('direccion_escolar','coordinacion_academica','control_escolar','control')) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.jaguar360_convocatorias WHERE id=p_call AND reglas->>'kind'='recourse') THEN RAISE EXCEPTION 'Convocatoria inexistente.'; END IF;
 SELECT * INTO g FROM public.jaguar360_grupos_temporales WHERE convocatoria_id=p_call;
 IF FOUND THEN outg:=jsonb_build_object('state',g.estado,'version',g.programacion_version,'room',g.aula_id::text,'reference',g.referencia,'reason',g.motivo,'created',g.creado_at,'rosterCount',(SELECT count(*) FROM public.jaguar360_grupo_temporal_padron WHERE convocatoria_id=p_call),'sessions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id::text,'period',s.bloque,'date',s.fecha,'start',s.inicio,'end',s.fin,'teacher',s.docente_id::text,'recorded',l.sesion_id IS NOT NULL) ORDER BY s.fecha,s.inicio) FROM public.jaguar360_sesiones_temporales s LEFT JOIN public.jaguar360_listas_temporales l ON l.sesion_id=s.id WHERE s.convocatoria_id=p_call),'[]')); END IF;
 RETURN jsonb_build_object('group',outg,'rooms',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id::text,'name',a.nombre,'code',a.codigo,'capacity',a.capacidad) ORDER BY a.codigo) FROM public.jaguar_aulas a WHERE a.activo),'[]'));
END $$;
CREATE OR REPLACE FUNCTION public.jaguar360_activar_grupo_temporal(p_actor uuid,p_call bigint,p_op text,p_reason text,p_version integer DEFAULT NULL,p_fingerprint text DEFAULT NULL,p_room bigint DEFAULT NULL,p_reference text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.jaguar360_convocatorias; g public.jaguar360_grupos_temporales; a public.jaguar_aulas; src jsonb; s jsonb; n integer; dt date; ini integer; fin integer; today date:=(now() AT TIME ZONE 'America/Mexico_City')::date;
BEGIN
 -- Serialize activation and mutations of the preparatory sources. Fail closed under contention.
 LOCK TABLE public.jaguar360_grupos_temporales,public.jaguar360_programacion_temporal,public.jaguar360_reservas_recursamiento,public.jaguar360_convocatorias IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 LOCK TABLE public.jaguar360_apoyo_docente,public.docentes,public.perfiles,public.asignaciones_docentes,public.calificaciones,public.horarios,public.jaguar360_cierres_periodo,public.jaguar360_rectificaciones,public.jaguar360_rectificacion_resoluciones,public.jaguar360_planes_ciclo,public.periodos_escolares,public.alumnos,public.jaguar_aulas,public.grupo_materias IN SHARE MODE NOWAIT;
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol='direccion_escolar') THEN RAISE EXCEPTION 'Solo Dirección.' USING ERRCODE='42501'; END IF;
 IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 15 AND 1500 OR p_op IS NULL OR p_op NOT IN ('activate','cancel') THEN RAISE EXCEPTION 'Operación o motivo inválidos.'; END IF;
 SELECT * INTO c FROM public.jaguar360_convocatorias WHERE id=p_call AND reglas->>'kind'='recourse';
 IF NOT FOUND OR (c.reglas->>'start')::date<=today THEN RAISE EXCEPTION 'Solo antes del inicio de la convocatoria.'; END IF;
 SELECT * INTO g FROM public.jaguar360_grupos_temporales WHERE convocatoria_id=p_call;
 IF p_op='cancel' THEN
  IF g.estado IS DISTINCT FROM 'activo' THEN RAISE EXCEPTION 'Grupo no activo.'; END IF;
  UPDATE public.jaguar360_grupos_temporales SET estado='cancelado',cancelado_por=p_actor,cancelado_at=now(),motivo_cancelacion=btrim(p_reason) WHERE convocatoria_id=p_call;
  RETURN jsonb_build_object('state','cancelado');
 END IF;
 IF g.convocatoria_id IS NOT NULL OR c.estado<>'autorizada_para_planeacion' OR p_reference IS NULL OR char_length(btrim(p_reference)) NOT BETWEEN 5 AND 300 THEN RAISE EXCEPTION 'Grupo ya registrado o referencia insuficiente.'; END IF;
 src:=public.jaguar360_fuentes_programacion_temporal(p_actor,p_call);
 IF src->>'fingerprint' IS DISTINCT FROM p_fingerprint OR (src->'previous'->>'version')::integer IS DISTINCT FROM p_version OR src->'previous'->>'state' IS DISTINCT FROM 'propuesta' OR jsonb_array_length(src->'roster')=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(src->'roster') z WHERE (z->>'stale')::boolean) THEN RAISE EXCEPTION 'Fuentes desactualizadas.'; END IF;
 SELECT count(*) INTO n FROM public.jaguar360_reservas_recursamiento WHERE convocatoria_id=p_call AND estado='reservada';
 SELECT * INTO a FROM public.jaguar_aulas WHERE id=p_room AND activo IS TRUE;
 IF NOT FOUND OR a.capacidad<n OR n>(c.reglas->>'capacity')::integer THEN RAISE EXCEPTION 'Aula no disponible o cupo insuficiente.'; END IF;
 IF EXISTS(SELECT 1 FROM public.jaguar360_reservas_recursamiento r JOIN public.alumnos al ON al.id=r.alumno_id WHERE r.convocatoria_id=p_call AND r.estado='reservada' AND (NOT al.activo OR al.estado_escolar<>'activo')) THEN RAISE EXCEPTION 'Padrón contiene alumnos no activos; concilia primero.'; END IF;
 -- Revalidate known schedule/room/student conflicts in the same locked transaction.
 FOR s IN SELECT value FROM jsonb_array_elements(src->'previous'->'schedule'->'sessions') LOOP
  dt:=(s->>'date')::date; ini:=(s->>'start')::integer; fin:=(s->>'end')::integer;
  IF NOT EXISTS(SELECT 1 FROM public.jaguar360_reservas_recursamiento r WHERE r.convocatoria_id=p_call AND r.estado='reservada' AND (s->>'period')::integer=ANY(r.bloques)) THEN RAISE EXCEPTION 'Bloque sin alumnos reservados; ajusta la convocatoria.'; END IF;
  IF EXISTS(SELECT 1 FROM public.horarios h JOIN public.grupo_materias gm ON gm.id=h.grupo_materia_id WHERE h.dia_semana=extract(isodow FROM dt) AND h.hora_inicio<make_time(fin/60,fin%60,0) AND h.hora_fin>make_time(ini/60,ini%60,0) AND (lower(btrim(h.aula)) IN (lower(btrim(a.codigo)),lower(btrim(a.nombre))) OR gm.grupo_id IN (SELECT al.grupo_id FROM public.jaguar360_reservas_recursamiento r JOIN public.alumnos al ON al.id=r.alumno_id WHERE r.convocatoria_id=p_call AND r.estado='reservada' AND (s->>'period')::integer=ANY(r.bloques)))) THEN RAISE EXCEPTION 'Conflicto conocido de aula o grupo ordinario.'; END IF;
  IF EXISTS(SELECT 1 FROM public.jaguar360_sesiones_temporales st JOIN public.jaguar360_grupos_temporales gt ON gt.convocatoria_id=st.convocatoria_id WHERE gt.estado='activo' AND st.fecha=dt AND st.inicio<fin AND st.fin>ini AND (gt.aula_id=p_room OR st.docente_id=(s->>'teacher')::bigint OR EXISTS(SELECT 1 FROM public.jaguar360_grupo_temporal_padron tp JOIN public.jaguar360_reservas_recursamiento r ON r.alumno_id=tp.alumno_id WHERE tp.convocatoria_id=st.convocatoria_id AND st.bloque=ANY(tp.bloques) AND r.convocatoria_id=p_call AND r.estado='reservada' AND (s->>'period')::integer=ANY(r.bloques)))) THEN RAISE EXCEPTION 'Conflicto con otro grupo temporal activo.'; END IF;
 END LOOP;
 INSERT INTO public.jaguar360_grupos_temporales(convocatoria_id,programacion_version,aula_id,estado,evidencia,actor_id,referencia,motivo) VALUES(p_call,p_version,p_room,'activo',src||jsonb_build_object('documentaryChecks',jsonb_build_array('holders','contents','students','calendar','workload','room')),p_actor,btrim(p_reference),btrim(p_reason));
 INSERT INTO public.jaguar360_grupo_temporal_padron SELECT p_call,r.id,r.alumno_id,r.bloques FROM public.jaguar360_reservas_recursamiento r WHERE r.convocatoria_id=p_call AND r.estado='reservada';
 INSERT INTO public.jaguar360_sesiones_temporales(convocatoria_id,bloque,fecha,inicio,fin,docente_id,apoyo_id,apoyo_version) SELECT p_call,(z->>'period')::integer,(z->>'date')::date,(z->>'start')::integer,(z->>'end')::integer,(z->>'teacher')::bigint,(z->>'support')::bigint,(z->>'supportVersion')::integer FROM jsonb_array_elements(src->'previous'->'schedule'->'sessions') z;
 RETURN jsonb_build_object('state','activo','rosterCount',n);
END $$;
-- Keep the activated version stable against old V10/V11 endpoints.
CREATE OR REPLACE FUNCTION public.jaguar360_bloquear_fuente_temporal_activa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cid bigint;
BEGIN
 IF TG_TABLE_NAME='jaguar360_convocatorias' THEN cid:=OLD.id; ELSE cid:=CASE WHEN TG_OP='DELETE' THEN OLD.convocatoria_id ELSE NEW.convocatoria_id END; END IF;
 IF EXISTS(SELECT 1 FROM public.jaguar360_grupos_temporales WHERE convocatoria_id=cid AND estado='activo') THEN RAISE EXCEPTION 'Grupo temporal activo; no modificar la fuente.'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS j360_freeze_call ON public.jaguar360_convocatorias;
CREATE TRIGGER j360_freeze_call BEFORE UPDATE OR DELETE ON public.jaguar360_convocatorias FOR EACH ROW EXECUTE FUNCTION public.jaguar360_bloquear_fuente_temporal_activa();
DROP TRIGGER IF EXISTS j360_freeze_roster ON public.jaguar360_reservas_recursamiento;
CREATE TRIGGER j360_freeze_roster BEFORE INSERT OR UPDATE OR DELETE ON public.jaguar360_reservas_recursamiento FOR EACH ROW EXECUTE FUNCTION public.jaguar360_bloquear_fuente_temporal_activa();
DROP TRIGGER IF EXISTS j360_freeze_schedule ON public.jaguar360_programacion_temporal;
CREATE TRIGGER j360_freeze_schedule BEFORE INSERT OR UPDATE OR DELETE ON public.jaguar360_programacion_temporal FOR EACH ROW EXECUTE FUNCTION public.jaguar360_bloquear_fuente_temporal_activa();
-- Narrow access: only the assigned active teacher, valid support revision, during the call.
CREATE OR REPLACE FUNCTION public.jaguar360_mis_sesiones_temporales(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE own bigint; today date:=(now() AT TIME ZONE 'America/Mexico_City')::date;
BEGIN
 SELECT d.id INTO own FROM public.docentes d JOIN public.perfiles f ON f.id=d.auth_user_id WHERE f.id=p_actor AND f.activo AND f.rol='docente' AND d.activo AND d.estado_profesional='activo' AND (d.suspension_fecha IS NULL OR d.suspension_hasta<today);
 IF own IS NULL THEN RAISE EXCEPTION 'Docente sin acceso.' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id::text,'name',c.nombre,'period',s.bloque,'date',s.fecha,'start',s.inicio,'end',s.fin,'room',a.nombre,'recorded',l.sesion_id IS NOT NULL) ORDER BY s.fecha,s.inicio) FROM public.jaguar360_sesiones_temporales s JOIN public.jaguar360_grupos_temporales g ON g.convocatoria_id=s.convocatoria_id JOIN public.jaguar360_convocatorias c ON c.id=g.convocatoria_id JOIN public.jaguar_aulas a ON a.id=g.aula_id JOIN public.jaguar360_apoyo_docente ap ON ap.id=s.apoyo_id AND ap.version=s.apoyo_version AND ap.estado='validado' AND ap.docente_id=own LEFT JOIN public.jaguar360_listas_temporales l ON l.sesion_id=s.id WHERE s.docente_id=own AND g.estado='activo' AND today BETWEEN (c.reglas->>'start')::date AND (c.reglas->>'end')::date),'[]');
END $$;
CREATE OR REPLACE FUNCTION public.jaguar360_lista_temporal(p_actor uuid,p_session bigint,p_marks jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.jaguar360_sesiones_temporales; l public.jaguar360_listas_temporales; rows jsonb; expected integer; localnow timestamp:=now() AT TIME ZONE 'America/Mexico_City';
BEGIN
 IF p_marks IS NOT NULL THEN LOCK TABLE public.jaguar360_grupos_temporales,public.jaguar360_apoyo_docente,public.docentes,public.perfiles,public.alumnos IN SHARE MODE NOWAIT; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.jaguar360_mis_sesiones_temporales(p_actor)) z WHERE z->>'id'=p_session::text) THEN RAISE EXCEPTION 'Sesión no asignada o fuera de vigencia.' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.jaguar360_sesiones_temporales WHERE id=p_session FOR UPDATE;
 -- Allow only same-day capture following the scheduled end. No invented attendance for future dates.
 IF localnow::date<s.fecha THEN RAISE EXCEPTION 'Sesión futura.'; END IF;
 SELECT * INTO l FROM public.jaguar360_listas_temporales WHERE sesion_id=p_session;
 SELECT count(*) INTO expected FROM public.jaguar360_grupo_temporal_padron p WHERE p.convocatoria_id=s.convocatoria_id AND s.bloque=ANY(p.bloques);
 IF p_marks IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM public.jaguar360_grupo_temporal_padron p JOIN public.alumnos a ON a.id=p.alumno_id WHERE p.convocatoria_id=s.convocatoria_id AND s.bloque=ANY(p.bloques) AND (NOT a.activo OR a.estado_escolar<>'activo')) THEN RAISE EXCEPTION 'Padrón cambió; requiere revisión antes de registrar.'; END IF;
  IF l.sesion_id IS NOT NULL OR localnow::date<>s.fecha OR localnow::time<make_time(s.fin/60,s.fin%60,0) THEN RAISE EXCEPTION 'Lista ya registrada o fuera del horario de captura.'; END IF;
  IF expected=0 OR jsonb_typeof(p_marks) IS DISTINCT FROM 'array' OR jsonb_array_length(p_marks)<>expected OR (SELECT count(DISTINCT z->>'student') FROM jsonb_array_elements(p_marks) z)<>expected OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_marks) z WHERE coalesce(z->>'state','') NOT IN ('presente','falta','retardo') OR NOT EXISTS(SELECT 1 FROM public.jaguar360_grupo_temporal_padron p WHERE p.convocatoria_id=s.convocatoria_id AND s.bloque=ANY(p.bloques) AND p.alumno_id::text=z->>'student')) THEN RAISE EXCEPTION 'Lista incompleta o alumno ajeno al bloque.'; END IF;
  INSERT INTO public.jaguar360_listas_temporales(sesion_id,marcas,actor_id) VALUES(p_session,(SELECT jsonb_agg(jsonb_build_object('student',z->>'student','state',z->>'state') ORDER BY z->>'student') FROM jsonb_array_elements(p_marks) z),p_actor) RETURNING * INTO l;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('student',p.alumno_id::text,'name',a.nombre_completo,'state',(SELECT z->>'state' FROM jsonb_array_elements(l.marcas) z WHERE z->>'student'=p.alumno_id::text)) ORDER BY a.nombre_completo,p.alumno_id),'[]') INTO rows FROM public.jaguar360_grupo_temporal_padron p JOIN public.alumnos a ON a.id=p.alumno_id WHERE p.convocatoria_id=s.convocatoria_id AND s.bloque=ANY(p.bloques);
 RETURN jsonb_build_object('rows',rows,'recorded',l.sesion_id IS NOT NULL,'canWrite',l.sesion_id IS NULL AND localnow::date=s.fecha AND localnow::time>=make_time(s.fin/60,s.fin%60,0));
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_consultar_grupo_temporal(uuid,bigint),public.jaguar360_activar_grupo_temporal(uuid,bigint,text,text,integer,text,bigint,text),public.jaguar360_bloquear_fuente_temporal_activa(),public.jaguar360_mis_sesiones_temporales(uuid),public.jaguar360_lista_temporal(uuid,bigint,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_consultar_grupo_temporal(uuid,bigint),public.jaguar360_activar_grupo_temporal(uuid,bigint,text,text,integer,text,bigint,text),public.jaguar360_mis_sesiones_temporales(uuid),public.jaguar360_lista_temporal(uuid,bigint,jsonb) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
