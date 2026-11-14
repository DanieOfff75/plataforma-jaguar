BEGIN;
-- Read-only dated timetable from independently reviewed imported calendar evidence.
-- Never falls back to another period, a historical assignment or the current group.
CREATE OR REPLACE FUNCTION public.jaguar360_agenda_fechada(p_actor uuid,p_desde date,p_hasta date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r text; c text; sid bigint; tid bigint; coverage jsonb; sessions jsonb;
BEGIN
 IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta<p_desde OR p_hasta-p_desde>30 THEN RAISE EXCEPTION 'Consulta hasta 31 días naturales.'; END IF;
 SELECT rol INTO r FROM public.perfiles WHERE id=p_actor AND activo IS TRUE;
 IF r IS NULL OR r NOT IN ('alumno','docente','direccion_escolar','coordinacion_academica','control_escolar','control') THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF r='alumno' THEN
  IF (SELECT count(*) FROM public.alumnos WHERE auth_user_id=p_actor AND activo IS TRUE AND estado_escolar='activo' AND suspension_fecha IS NULL)<>1 THEN RAISE EXCEPTION 'Cuenta estudiantil no conciliada o suspendida.' USING ERRCODE='42501'; END IF;
  SELECT id INTO sid FROM public.alumnos WHERE auth_user_id=p_actor AND activo IS TRUE AND estado_escolar='activo' AND suspension_fecha IS NULL;
 ELSIF r='docente' THEN
  IF (SELECT count(*) FROM public.docentes WHERE auth_user_id=p_actor AND activo IS TRUE)<>1 THEN RAISE EXCEPTION 'Cuenta docente no conciliada.' USING ERRCODE='42501'; END IF;
  SELECT id INTO tid FROM public.docentes WHERE auth_user_id=p_actor AND activo IS TRUE;
 END IF;
 IF (SELECT count(*) FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE)<>1 THEN RAISE EXCEPTION 'Ciclo vigente no conciliado.'; END IF;
 SELECT ciclo_escolar INTO c FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE;
 IF c IS NULL THEN RAISE EXCEPTION 'Ciclo vigente no conciliado.'; END IF;
 WITH periods AS (
  SELECT p.id,p.numero_periodo,p.fecha_inicio,p.fecha_fin,s.id AS evidence,s.precedente_id,s.estado,s.contenido,pa.estado AS roster_state,pa.contenido AS roster,ce.evidencia_id AS imported
  FROM public.periodos_escolares p
  LEFT JOIN LATERAL (SELECT * FROM public.jaguar360_evidencias_periodo WHERE periodo_id=p.id AND tipo='sesiones' ORDER BY version DESC LIMIT 1) s ON true
  LEFT JOIN LATERAL (SELECT * FROM public.jaguar360_evidencias_periodo WHERE periodo_id=p.id AND tipo='padron' ORDER BY version DESC LIMIT 1) pa ON true
  LEFT JOIN public.jaguar360_calendario_evidencia ce ON ce.periodo_id=p.id
  WHERE p.ciclo_escolar=c AND p.fecha_inicio<=p_hasta AND p.fecha_fin>=p_desde
 ), checked AS (
  SELECT p.*,CASE WHEN estado IS DISTINCT FROM 'revisada' OR imported IS NULL OR precedente_id IS DISTINCT FROM imported THEN 'sin_calendario_revisado'
    WHEN r='alumno' AND roster_state IS DISTINCT FROM 'revisada' THEN 'sin_padron_revisado'
    WHEN EXISTS(SELECT 1 FROM jsonb_to_recordset(coalesce(contenido->'rows','[]'::jsonb)) x(grupo_materia_id bigint,fecha date,inicio time) WHERE NOT EXISTS(SELECT 1 FROM public.jaguar360_docente_sesion ds WHERE ds.periodo_id=p.id AND ds.grupo_materia_id=x.grupo_materia_id AND ds.fecha=x.fecha AND ds.inicio=x.inicio AND ds.evidencia_id=p.imported)) THEN 'sin_responsable_conciliado'
    ELSE 'disponible' END AS availability FROM periods p
 ), visible AS (
  SELECT p.numero_periodo,x.fecha,x.inicio,x.fin,x.estado,g.clave AS grupo,m.nombre AS materia,d.nombre_completo AS docente
  FROM checked p CROSS JOIN LATERAL jsonb_to_recordset(coalesce(p.contenido->'rows','[]'::jsonb)) x(grupo_materia_id bigint,fecha date,inicio time,fin time,estado text)
  JOIN public.jaguar360_docente_sesion ds ON ds.periodo_id=p.id AND ds.grupo_materia_id=x.grupo_materia_id AND ds.fecha=x.fecha AND ds.inicio=x.inicio AND ds.evidencia_id=p.imported
  JOIN public.grupo_materias gm ON gm.id=x.grupo_materia_id JOIN public.grupos g ON g.id=gm.grupo_id JOIN public.materias m ON m.id=gm.materia_id JOIN public.docentes d ON d.id=ds.docente_id
  WHERE p.availability='disponible' AND x.fecha BETWEEN p_desde AND p_hasta AND x.fecha BETWEEN p.fecha_inicio AND p.fecha_fin
    AND (r<>'alumno' OR EXISTS(SELECT 1 FROM jsonb_to_recordset(coalesce(p.roster->'rows','[]'::jsonb)) z(alumno_id bigint,grupo_materia_id bigint,desde date,hasta date) WHERE z.alumno_id=sid AND z.grupo_materia_id=x.grupo_materia_id AND x.fecha BETWEEN z.desde AND z.hasta))
    AND (r<>'docente' OR (ds.docente_id=tid AND EXISTS(SELECT 1 FROM public.asignaciones_docentes ad WHERE ad.docente_id=tid AND ad.grupo_materia_id=x.grupo_materia_id AND ad.activo IS TRUE AND ad.ciclo_escolar=c)))
 )
 SELECT (SELECT coalesce(jsonb_agg(jsonb_build_object('period',numero_periodo,'start',fecha_inicio,'end',fecha_fin,'status',availability) ORDER BY numero_periodo),'[]'::jsonb) FROM checked),
 (SELECT coalesce(jsonb_agg(jsonb_build_object('period',numero_periodo,'date',fecha,'start',to_char(inicio,'HH24:MI'),'end',to_char(fin,'HH24:MI'),'state',CASE WHEN estado='cancelada' THEN 'cancelada' ELSE 'programada' END,'group',grupo,'subject',materia,'teacher',docente) ORDER BY fecha,inicio,grupo,materia),'[]'::jsonb) FROM (SELECT * FROM visible ORDER BY fecha,inicio,grupo,materia LIMIT 1501) v)
 INTO coverage,sessions;
 IF jsonb_array_length(sessions)>1500 THEN RAISE EXCEPTION 'Reduce el intervalo; excede 1500 sesiones.'; END IF;
 RETURN jsonb_build_object('cycle',c,'from',p_desde,'to',p_hasta,'coverage',coverage,'sessions',sessions,'officialAttendance',false);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_agenda_fechada(uuid,date,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_agenda_fechada(uuid,date,date) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
