-- V20: teacher attribution for imported calendars, no reconstruction of prior imported evidence.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar360_docente_sesion (
 periodo_id bigint NOT NULL REFERENCES public.periodos_escolares(id) ON DELETE RESTRICT,
 grupo_materia_id bigint NOT NULL REFERENCES public.grupo_materias(id) ON DELETE RESTRICT,
 fecha date NOT NULL,inicio time NOT NULL,
 docente_id bigint NOT NULL REFERENCES public.docentes(id) ON DELETE RESTRICT,
 evidencia_id bigint NOT NULL REFERENCES public.jaguar360_evidencias_periodo(id) ON DELETE RESTRICT,
 PRIMARY KEY(periodo_id,grupo_materia_id,fecha,inicio)
);
ALTER TABLE public.jaguar360_docente_sesion ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_docente_sesion FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_importar_calendario(p_actor uuid,p_ciclo text,p_calendario bigint,p_huella text,p_contenido jsonb,p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.jaguar360_calendarios_propuestos; w public.jaguar360_semanas_propuestas; pe public.periodos_escolares; ctx jsonb; outrow jsonb;
BEGIN
 LOCK TABLE public.perfiles,public.jaguar360_planes_ciclo,public.grupos,public.grupo_materias,public.alumnos,public.asignaciones_docentes,public.docentes,public.docente_disponibilidad,public.jaguar_aulas,public.horarios,public.jaguar360_semanas_propuestas,public.jaguar360_semanas_resoluciones,public.jaguar360_calendarios_propuestos,public.jaguar360_calendarios_resoluciones,public.periodos_escolares,public.asistencias,public.jaguar360_cierres_periodo IN SHARE MODE NOWAIT;
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol='coordinacion_academica') THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.jaguar360_calendarios_propuestos WHERE id=p_calendario AND ciclo=p_ciclo;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.jaguar360_calendarios_resoluciones WHERE propuesta_id=c.id AND estado='reviewed') THEN RAISE EXCEPTION 'Calendario no revisado.'; END IF;
 SELECT * INTO w FROM public.jaguar360_semanas_propuestas WHERE id=c.semana_id AND ciclo=p_ciclo;
 ctx:=public.jaguar360_contexto_semana(p_actor,p_ciclo);
 IF w.id IS NULL OR w.huella IS DISTINCT FROM ctx->>'fingerprint' OR c.huella IS DISTINCT FROM ctx->>'fingerprint' OR p_huella IS DISTINCT FROM ctx->>'fingerprint' OR NOT EXISTS(SELECT 1 FROM public.jaguar360_semanas_resoluciones WHERE propuesta_id=w.id AND estado='reviewed') THEN RAISE EXCEPTION 'Catálogo o semana modificados.'; END IF;
 IF (SELECT count(*) FROM public.periodos_escolares WHERE ciclo_escolar=p_ciclo AND numero_periodo=w.periodo)<>1 THEN RAISE EXCEPTION 'Periodo no identificado de forma única.'; END IF;
 SELECT * INTO pe FROM public.periodos_escolares WHERE ciclo_escolar=p_ciclo AND numero_periodo=w.periodo FOR SHARE;
 IF pe.fecha_inicio IS NULL OR pe.fecha_fin IS NULL OR pe.fecha_inicio<=(now() AT TIME ZONE 'America/Mexico_City')::date OR pe.fecha_inicio::text IS DISTINCT FROM c.propuesta->>'start' OR pe.fecha_fin::text IS DISTINCT FROM c.propuesta->>'end' THEN RAISE EXCEPTION 'Solo periodo futuro con fechas idénticas al calendario revisado.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('j360-evidencia:'||pe.id));
 IF EXISTS(SELECT 1 FROM public.jaguar360_evidencias_periodo WHERE periodo_id=pe.id AND tipo IN ('sesiones','marcas')) OR EXISTS(SELECT 1 FROM public.jaguar360_listas_sesion WHERE periodo_id=pe.id) OR EXISTS(SELECT 1 FROM public.jaguar360_cierres_periodo WHERE periodo_id=pe.id) OR EXISTS(SELECT 1 FROM public.jaguar360_calendario_evidencia WHERE periodo_id=pe.id) THEN RAISE EXCEPTION 'Ya existen sesiones, marcas o cierre; no se reemplaza evidencia.'; END IF;
 IF jsonb_typeof(p_contenido->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p_contenido->'rows') NOT BETWEEN 1 AND 30000 OR jsonb_array_length(p_contenido->'rows') IS DISTINCT FROM (c.propuesta->>'sessionCount')::integer THEN RAISE EXCEPTION 'Lista incompleta o demasiado extensa.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_contenido->'rows') AS r(grupo_materia_id bigint,fecha date,inicio time,fin time,estado text) WHERE r.estado IS NULL OR r.estado NOT IN ('programada','cancelada') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(w.propuesta->'slots') s WHERE s->>'groupSubject'=r.grupo_materia_id::text AND ((s->>'end')::integer-(s->>'start')::integer)*60=extract(epoch FROM r.fin-r.inicio))) THEN RAISE EXCEPTION 'Sesión ajena a la semana o estado inválido.'; END IF;
 IF EXISTS(SELECT 1 FROM public.asistencias a JOIN jsonb_to_recordset(p_contenido->'rows') r(grupo_materia_id bigint,fecha date) ON a.grupo_materia_id=r.grupo_materia_id AND a.fecha=r.fecha) THEN RAISE EXCEPTION 'Hay asistencias previas en las fechas proyectadas.'; END IF;
 IF jsonb_typeof(p_contenido->'teachers') IS DISTINCT FROM 'array' OR jsonb_array_length(p_contenido->'teachers') IS DISTINCT FROM jsonb_array_length(p_contenido->'rows') THEN RAISE EXCEPTION 'Asignación docente por sesión incompleta.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_contenido->'teachers') AS t(grupo_materia_id bigint,fecha date,inicio time,docente_id bigint) GROUP BY t.grupo_materia_id,t.fecha,t.inicio HAVING count(*)<>1) OR EXISTS(SELECT 1 FROM jsonb_to_recordset(p_contenido->'teachers') AS t(grupo_materia_id bigint,fecha date,inicio time,docente_id bigint) WHERE t.docente_id IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(p_contenido->'rows') AS r(grupo_materia_id bigint,fecha date,inicio time) WHERE r.grupo_materia_id=t.grupo_materia_id AND r.fecha=t.fecha AND r.inicio=t.inicio) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(w.propuesta->'slots') s WHERE s->>'groupSubject'=t.grupo_materia_id::text AND s->>'teacher'=t.docente_id::text)) THEN RAISE EXCEPTION 'Asignación docente no corresponde a la semana revisada.'; END IF;
 -- The existing RPC validates every row, duplicate, overlap and reference; its review remains independent.
 outrow:=public.jaguar360_registrar_evidencia(p_actor,pe.id,'sesiones',0,'proponer',p_contenido-'teachers',p_motivo);
 INSERT INTO public.jaguar360_calendario_evidencia(calendario_id,periodo_id,evidencia_id,actor_id) VALUES(c.id,pe.id,(outrow->>'id')::bigint,p_actor);
 INSERT INTO public.jaguar360_docente_sesion(periodo_id,grupo_materia_id,fecha,inicio,docente_id,evidencia_id)
 SELECT pe.id,t.grupo_materia_id,t.fecha,t.inicio,t.docente_id,(outrow->>'id')::bigint FROM jsonb_to_recordset(p_contenido->'teachers') AS t(grupo_materia_id bigint,fecha date,inicio time,docente_id bigint);
 RETURN outrow||jsonb_build_object('periodId',pe.id::text,'calendarId',c.id::text,'official',false);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_importar_calendario(uuid,text,bigint,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_importar_calendario(uuid,text,bigint,text,jsonb,text) TO service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_contexto_sesion(p_actor uuid,p_periodo bigint,p_gm bigint,p_fecha date,p_inicio time)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; pe record; pa public.jaguar360_evidencias_periodo; se public.jaguar360_evidencias_periodo; ss record; l public.jaguar360_listas_sesion; roster jsonb; allowed boolean; compatible boolean;
BEGIN
 SELECT id,rol,activo INTO a FROM public.perfiles WHERE id=p_actor;
 IF NOT FOUND OR a.activo IS DISTINCT FROM true OR coalesce(a.rol,'') NOT IN ('docente','prefectura','direccion_escolar','coordinacion_academica','control_escolar','control') THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 SELECT id,ciclo_escolar,fecha_inicio,fecha_fin INTO pe FROM public.periodos_escolares WHERE id=p_periodo;
 IF NOT FOUND OR p_fecha IS NULL OR p_inicio IS NULL OR pe.fecha_inicio IS NULL OR pe.fecha_fin IS NULL OR p_fecha NOT BETWEEN pe.fecha_inicio AND pe.fecha_fin OR p_fecha>(now() AT TIME ZONE 'America/Mexico_City')::date THEN RAISE EXCEPTION 'Fecha o periodo no disponible.'; END IF;
 IF a.rol='docente' AND (NOT EXISTS(SELECT 1 FROM public.docentes d JOIN public.asignaciones_docentes ad ON ad.docente_id=d.id WHERE d.auth_user_id=p_actor AND d.activo IS TRUE AND ad.activo IS TRUE AND ad.ciclo_escolar=pe.ciclo_escolar AND ad.grupo_materia_id=p_gm) OR (SELECT count(*) FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE)<>1 OR NOT EXISTS(SELECT 1 FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE AND ciclo_escolar=pe.ciclo_escolar)) THEN RAISE EXCEPTION 'Asignación o ciclo no autorizado.' USING ERRCODE='42501'; END IF;
 SELECT * INTO pa FROM public.jaguar360_evidencias_periodo WHERE periodo_id=p_periodo AND tipo='padron' ORDER BY version DESC LIMIT 1;
 SELECT * INTO se FROM public.jaguar360_evidencias_periodo WHERE periodo_id=p_periodo AND tipo='sesiones' ORDER BY version DESC LIMIT 1;
 IF pa.estado IS DISTINCT FROM 'revisada' OR se.estado IS DISTINCT FROM 'revisada' THEN RAISE EXCEPTION 'Se requiere padrón y sesiones vigentes revisados.'; END IF;
 SELECT * INTO ss FROM jsonb_to_recordset(se.contenido->'rows') AS x(grupo_materia_id bigint,fecha date,inicio time,fin time,estado text) WHERE grupo_materia_id=p_gm AND fecha=p_fecha AND inicio=p_inicio;
 IF NOT FOUND OR ss.estado NOT IN ('programada','impartida') THEN RAISE EXCEPTION 'Sesión no definida o cancelada.'; END IF;
 -- Calendar-origin sessions must use the exact reviewed evidence version and scheduled teacher.
 IF a.rol='docente' AND EXISTS(SELECT 1 FROM public.jaguar360_calendario_evidencia WHERE periodo_id=p_periodo) AND NOT EXISTS(SELECT 1 FROM public.jaguar360_docente_sesion ds JOIN public.docentes d ON d.id=ds.docente_id WHERE ds.periodo_id=p_periodo AND ds.grupo_materia_id=p_gm AND ds.fecha=p_fecha AND ds.inicio=p_inicio AND ds.evidencia_id=se.precedente_id AND d.auth_user_id=p_actor AND d.activo IS TRUE) THEN RAISE EXCEPTION 'Sesión no asignada a este docente o evidencia sustituida.' USING ERRCODE='42501'; END IF;
 SELECT * INTO l FROM public.jaguar360_listas_sesion WHERE periodo_id=p_periodo AND grupo_materia_id=p_gm AND fecha=p_fecha AND inicio=p_inicio ORDER BY version DESC LIMIT 1;
 WITH expected AS (SELECT alumno_id FROM jsonb_to_recordset(pa.contenido->'rows') AS r(alumno_id bigint,grupo_materia_id bigint,desde date,hasta date) WHERE r.grupo_materia_id=p_gm AND p_fecha BETWEEN r.desde AND r.hasta),
 marks AS (SELECT * FROM jsonb_to_recordset(coalesce(l.marcas,'[]'::jsonb)) AS m(student bigint,state text))
 SELECT coalesce(jsonb_agg(jsonb_build_object('student',e.alumno_id::text,'name',al.nombre_completo,'registration',al.matricula,'state',m.state) ORDER BY al.nombre_completo,e.alumno_id),'[]'::jsonb) INTO roster FROM expected e LEFT JOIN public.alumnos al ON al.id=e.alumno_id LEFT JOIN marks m ON m.student=e.alumno_id;
 IF jsonb_array_length(roster) NOT BETWEEN 1 AND 1000 OR EXISTS(SELECT 1 FROM jsonb_array_elements(roster) x WHERE x->>'name' IS NULL) THEN RAISE EXCEPTION 'Padrón de la sesión vacío o excesivo.'; END IF;
 compatible:=l.id IS NULL OR (l.fin=ss.fin AND jsonb_array_length(l.marcas)=jsonb_array_length(roster) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(roster) x WHERE x->>'state' IS NULL));
 allowed:=compatible AND (p_fecha<(now() AT TIME ZONE 'America/Mexico_City')::date OR p_inicio<=(now() AT TIME ZONE 'America/Mexico_City')::time) AND a.rol IN ('docente','prefectura') AND EXISTS(SELECT 1 FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE AND ciclo_escolar=pe.ciclo_escolar) AND (SELECT count(*) FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE)=1;
 RETURN jsonb_build_object('rosterVersion',pa.version,'scheduleVersion',se.version,'version',coalesce(l.version,0),'sessionState',CASE WHEN l.id IS NOT NULL AND compatible THEN 'impartida' ELSE ss.estado END,'compatible',compatible,'canWrite',allowed,'end',to_char(ss.fin,'HH24:MI'),'rows',roster,'lastActor',l.actor_nombre,'lastDate',l.creado_at);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_contexto_sesion(uuid,bigint,bigint,date,time) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_contexto_sesion(uuid,bigint,bigint,date,time) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
