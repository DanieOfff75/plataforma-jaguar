-- Cotejado con el catálogo de PostgreSQL 17.6 entregado después de V33.
-- Aplicar exclusivamente en clon después de V34. Mantener acceso del servidor.
BEGIN;
-- Estas relaciones se consumen mediante la API, no mediante PostgREST del navegador.
-- Las políticas antiguas permitían SELECT a cualquier usuario autenticado.
REVOKE ALL PRIVILEGES ON TABLE
 public.incidencias_prefectura,
 public.solicitudes_estudiantiles,
 public.matricula_migraciones,
 public.aprobaciones_cambio_grado,
 public.solicitudes_cambio_grado,
 public.docente_disponibilidad,
 public.ciclos_escolares_operaciones
 FROM PUBLIC,anon,authenticated;
-- No basta el RLS: quitar también permisos directos a la vista financiera (ya restringida en el catálogo real).
REVOKE ALL PRIVILEGES ON TABLE public.jaguar_recursos_movimientos FROM PUBLIC,anon,authenticated;
-- La función anterior a Jaguar 360 borra TODOS los horarios del grupo y genera otros aleatorios.
-- Ninguna ruta vigente la invoca y no tiene trigger asociado en el esquema real.
-- Deshabilitarla incluso para service_role, conservando su firma para diagnóstico.
CREATE OR REPLACE FUNCTION public.generar_horario_grupo(p_grupo_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RAISE EXCEPTION 'Generador legado retirado. Usa la programación de horarios de Jaguar 360.' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION public.generar_horario_grupo(bigint) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.regenerar_horario_grupo_trigger() FROM PUBLIC,anon,authenticated,service_role;
-- La API de administración de usuarios todavía usa esta RPC. Conservar sólo su acceso de servicio.
REVOKE ALL ON FUNCTION public.recalcular_horas_docente(bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.recalcular_horas_docente(bigint) TO service_role;
-- La RPC auxiliar de creación de índices no es una operación del usuario final.
REVOKE ALL ON FUNCTION public.jaguar_crear_indice_si_columnas(text,text,text[]) FROM PUBLIC,anon,authenticated;
-- No modificar políticas de permisos de auth/storage ni el comportamiento de triggers activos.
-- Respect the configured group capacity in current-cycle bindings. The old fixed-40
-- trigger otherwise rejects valid configured capacities and can permit races on smaller ones.
CREATE OR REPLACE FUNCTION public.inetch_validar_cupo_grupo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cap integer; total bigint; enabled boolean;
BEGIN
 IF NEW.activo IS DISTINCT FROM TRUE OR NEW.grupo_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.grupo_id IS NOT DISTINCT FROM NEW.grupo_id AND OLD.activo IS TRUE THEN RETURN NEW; END IF;
 END IF;
 -- Serialize concurrent arrivals to the same group in the default READ COMMITTED isolation.
 SELECT g.activo INTO enabled FROM public.grupos g WHERE g.id=NEW.grupo_id FOR NO KEY UPDATE;
 IF NOT FOUND OR enabled IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Grupo de destino no activo.' USING ERRCODE='23514'; END IF;
 SELECT coalesce((SELECT c.cupo FROM public.jaguar360_grupos_ciclo c WHERE c.grupo_id=NEW.grupo_id),40) INTO cap;
 SELECT count(*) INTO total FROM public.alumnos a WHERE a.grupo_id=NEW.grupo_id AND a.activo IS TRUE AND a.id IS DISTINCT FROM NEW.id;
 IF total>=cap THEN RAISE EXCEPTION 'El grupo alcanzó su cupo autorizado de % alumnos.',cap USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.inetch_validar_cupo_grupo() FROM PUBLIC,anon,authenticated,service_role;

-- Return only aggregate metrics. No employee names, pupil IDs, grades or incidents leave this RPC.
CREATE OR REPLACE FUNCTION public.jaguar360_panel_departamento(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r text; p public.periodos_escolares; cycles integer; curr integer;
 res jsonb; academic jsonb; pending bigint; incidents bigint; top_group jsonb; lo date; hi date;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Acceso exclusivo del servidor.' USING ERRCODE='42501'; END IF;
 SELECT rol INTO r FROM public.perfiles WHERE id=p_actor AND activo IS TRUE;
 IF r IS NULL OR r NOT IN ('servicios_estudiantiles','servicios_docentes','prefectura','coordinacion_academica','direccion_escolar','control_escolar','control') THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO curr FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE;
 IF curr>1 THEN RAISE EXCEPTION 'Hay varios periodos actuales. Revisa el calendario.'; END IF;
 IF curr=1 THEN
  SELECT * INTO p FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE;
  IF p.activo IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'El periodo actual no está activo.'; END IF;
 ELSE
  SELECT count(DISTINCT ciclo_escolar) INTO cycles FROM public.periodos_escolares WHERE activo IS TRUE;
  IF cycles<>1 THEN RAISE EXCEPTION 'No hay un ciclo activo inequívoco.'; END IF;
  SELECT * INTO p FROM public.periodos_escolares WHERE activo IS TRUE ORDER BY numero_periodo DESC NULLS LAST,id DESC LIMIT 1;
 END IF;
 IF p.ciclo_escolar IS NULL OR p.ciclo_escolar !~ '^\d{4}-\d{4}$' THEN RAISE EXCEPTION 'Ciclo activo inválido.'; END IF;
 res:=jsonb_build_object('cycle',p.ciclo_escolar,'period',jsonb_build_object('id',p.id::text,'nombre',p.nombre,'ciclo_escolar',p.ciclo_escolar,'activo',p.activo),'totalStudents',(SELECT count(*) FROM public.alumnos a JOIN public.grupos g ON g.id=a.grupo_id AND g.activo IS TRUE WHERE a.activo IS TRUE AND coalesce(a.estado_escolar,'activo') NOT IN ('archivado','baja','traslado','egresado','inactivo')),'totalTeachers',(SELECT count(*) FROM public.docentes WHERE activo IS TRUE AND coalesce(estado_profesional,'activo') NOT IN ('archivado','baja','inactivo')),'totalGroups',(SELECT count(*) FROM public.grupos WHERE activo IS TRUE),'totalSubjects',(SELECT count(*) FROM public.materias WHERE activa IS TRUE),'average',NULL,'averageByGrade','{}'::jsonb,'groupAverages','[]'::jsonb,'pendingRequests',NULL,'incidentCount',NULL,'topIncidentGroup',NULL,'academicSource','ordinarias_registradas');
 IF r IN ('servicios_estudiantiles','coordinacion_academica','direccion_escolar','control_escolar','control') THEN
  -- Group memberships are current; exclude grades belonging to a previous group, even within the same cycle.
  WITH roster AS (
   SELECT a.id AS student_id,g.id AS group_id,g.clave,g.grado,g.turno FROM public.alumnos a JOIN public.grupos g ON g.id=a.grupo_id AND g.activo IS TRUE WHERE a.activo IS TRUE AND coalesce(a.estado_escolar,'activo') NOT IN ('archivado','baja','traslado','egresado','inactivo')
  ), marks AS (
   SELECT ro.group_id,ro.grado,c.calificacion FROM public.calificaciones c JOIN roster ro ON ro.student_id=c.alumno_id JOIN public.grupo_materias gm ON gm.id=c.grupo_materia_id AND gm.grupo_id=ro.group_id JOIN public.periodos_escolares pe ON pe.id=c.periodo_id AND pe.ciclo_escolar=p.ciclo_escolar WHERE c.calificacion BETWEEN 0 AND 10
  ), groups_count AS (
   SELECT group_id,clave,turno,grado,count(*) AS pupils FROM roster GROUP BY group_id,clave,turno,grado
  ), grade_count AS (SELECT grado,count(*) AS pupils FROM roster GROUP BY grado),
  group_marks AS (SELECT group_id,avg(calificacion) AS mean FROM marks GROUP BY group_id),
  grade_marks AS (SELECT grado,avg(calificacion) AS mean FROM marks GROUP BY grado)
  SELECT jsonb_build_object('average',(SELECT avg(calificacion) FROM marks),'averageByGrade',coalesce((SELECT jsonb_object_agg(gc.grado::text,jsonb_build_object('count',gc.pupils,'average',gm.mean) ORDER BY gc.grado) FROM grade_count gc LEFT JOIN grade_marks gm USING(grado)),'{}'::jsonb),'groupAverages',coalesce((SELECT jsonb_agg(jsonb_build_object('group',gc.clave||' · '||coalesce(gc.turno,'Sin turno'),'count',gc.pupils,'average',gm.mean) ORDER BY gc.grado,gc.clave,gc.turno,gc.group_id) FROM groups_count gc LEFT JOIN group_marks gm USING(group_id)),'[]'::jsonb)) INTO academic;
  res:=res||academic;
 END IF;
 IF r IN ('servicios_estudiantiles','direccion_escolar','control_escolar','control','servicios_docentes','prefectura','coordinacion_academica') THEN
  SELECT count(*) INTO pending FROM public.solicitudes_estudiantiles s WHERE s.estado='pendiente' AND s.tipo IN ('grupo','grado','turno','taller','otro') AND (r='direccion_escolar' OR (r IN ('control_escolar','control') AND s.tipo='grupo') OR (r='servicios_estudiantiles' AND s.tipo IN ('grado','turno','taller')) OR (s.tipo='otro' AND s.departamento_destino=CASE WHEN r='control' THEN 'control_escolar' ELSE r END));
  res:=res||jsonb_build_object('pendingRequests',pending);
 END IF;
 IF r IN ('prefectura','direccion_escolar','control_escolar','control') THEN
  SELECT min(fecha_inicio),max(fecha_fin) INTO lo,hi FROM public.periodos_escolares WHERE ciclo_escolar=p.ciclo_escolar;
  IF lo IS NULL OR hi IS NULL OR hi<lo THEN RAISE EXCEPTION 'Calendario del ciclo incompleto.'; END IF;
  SELECT count(*) INTO incidents FROM public.incidencias_prefectura WHERE fecha BETWEEN lo AND hi;
  SELECT jsonb_build_array(g.clave||' · '||coalesce(g.turno,'Sin turno'),count(*)) INTO top_group FROM public.incidencias_prefectura i JOIN public.alumnos a ON a.id=i.alumno_id AND a.activo IS TRUE JOIN public.grupos g ON g.id=a.grupo_id AND g.activo IS TRUE WHERE i.fecha BETWEEN lo AND hi GROUP BY g.id,g.clave,g.turno ORDER BY count(*) DESC,g.id LIMIT 1;
  res:=res||jsonb_build_object('incidentCount',incidents,'topIncidentGroup',top_group,'incidentGrouping','grupo_actual');
 END IF;
 RETURN res;
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_panel_departamento(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_panel_departamento(uuid) TO service_role;

COMMIT;
NOTIFY pgrst,'reload schema';
