-- Diagnóstico operativo, NO cierre, NO acreditación, NO migración de datos.
-- Basado en el esquema exportado por la institución (14-11-2026).
BEGIN;
CREATE OR REPLACE FUNCTION public.jaguar360_diagnostico_cierre(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_ciclo text; v_actual bigint; v_count bigint; v_result jsonb;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('control','control_escolar','direccion_escolar','coordinacion_academica')) THEN
   RAISE EXCEPTION 'Sin permiso de diagnóstico.' USING ERRCODE='42501';
 END IF;
 SELECT count(*),min(id),min(ciclo_escolar) INTO v_count,v_actual,v_ciclo FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE;
 IF v_count<>1 OR v_ciclo IS NULL THEN RAISE EXCEPTION 'Debe existir exactamente un periodo actual verificable.' USING ERRCODE='P0001'; END IF;
 WITH periodos AS (
   SELECT id,nombre,numero_periodo,fecha_inicio,fecha_fin,activo FROM public.periodos_escolares WHERE ciclo_escolar=v_ciclo
 ), padron_presente AS (
   -- No equivale al padrón histórico. Incluye suspendidos con grupo activo.
   SELECT a.id AS alumno_id,a.grupo_id FROM public.alumnos a JOIN public.grupos g ON g.id=a.grupo_id
   WHERE g.activo IS TRUE AND (a.activo IS TRUE OR a.estado_escolar='suspendido') AND a.estado_escolar NOT IN ('baja','traslado','egresado','archivado')
 ), obligaciones AS (
   SELECT p.id AS periodo_id,a.alumno_id,gm.id AS gm_id,a.grupo_id
   FROM periodos p CROSS JOIN padron_presente a JOIN public.grupo_materias gm ON gm.grupo_id=a.grupo_id AND gm.activo IS TRUE
 ), notas AS (
   SELECT o.periodo_id,o.grupo_id,count(*) AS esperadas,count(c.calificacion) AS presentes
   FROM obligaciones o LEFT JOIN public.calificaciones c ON c.periodo_id=o.periodo_id AND c.alumno_id=o.alumno_id AND c.grupo_materia_id=o.gm_id
   GROUP BY o.periodo_id,o.grupo_id
 ), fechas_observadas AS (
   -- Sólo días con algún registro existente. No prueba que la clase se impartió.
   SELECT DISTINCT p.id AS periodo_id,a.grupo_materia_id AS gm_id,a.fecha
   FROM periodos p JOIN public.asistencias a ON a.fecha BETWEEN p.fecha_inicio AND p.fecha_fin
   JOIN public.grupo_materias gm ON gm.id=a.grupo_materia_id AND gm.activo IS TRUE JOIN public.grupos g ON g.id=gm.grupo_id AND g.activo IS TRUE
 ), listas AS (
   SELECT o.periodo_id,o.grupo_id,count(*) AS celdas,count(a.id) AS registradas
   FROM obligaciones o JOIN fechas_observadas f ON f.periodo_id=o.periodo_id AND f.gm_id=o.gm_id
   LEFT JOIN public.asistencias a ON a.alumno_id=o.alumno_id AND a.grupo_materia_id=o.gm_id AND a.fecha=f.fecha
   GROUP BY o.periodo_id,o.grupo_id
 ), fuera_padron AS (
   SELECT c.periodo_id,count(*) AS registros FROM public.calificaciones c JOIN periodos p ON p.id=c.periodo_id
   WHERE NOT EXISTS (SELECT 1 FROM obligaciones o WHERE o.periodo_id=c.periodo_id AND o.alumno_id=c.alumno_id AND o.gm_id=c.grupo_materia_id)
   GROUP BY c.periodo_id
 ), grupos_resumen AS (
   SELECT n.periodo_id,n.grupo_id,g.clave,n.esperadas,n.presentes,n.esperadas-n.presentes AS notas_pendientes,
     coalesce(l.celdas,0) AS celdas_observadas,coalesce(l.registradas,0) AS asistencias_registradas,
     coalesce(l.celdas-l.registradas,0) AS asistencias_sin_registro
   FROM notas n JOIN public.grupos g ON g.id=n.grupo_id LEFT JOIN listas l ON l.periodo_id=n.periodo_id AND l.grupo_id=n.grupo_id
 ), resumen AS (
   SELECT p.id,p.nombre,p.numero_periodo,p.fecha_inicio,p.fecha_fin,p.activo,p.id=v_actual AS actual,
     coalesce(w.habilitada,false) AS captura_abierta,
     coalesce((SELECT sum(g.esperadas) FROM grupos_resumen g WHERE g.periodo_id=p.id),0) AS notas_esperadas_estimadas,
     coalesce((SELECT sum(g.notas_pendientes) FROM grupos_resumen g WHERE g.periodo_id=p.id),0) AS notas_pendientes_estimadas,
     coalesce((SELECT sum(g.celdas_observadas) FROM grupos_resumen g WHERE g.periodo_id=p.id),0) AS celdas_asistencia_observadas,
     coalesce((SELECT sum(g.asistencias_sin_registro) FROM grupos_resumen g WHERE g.periodo_id=p.id),0) AS celdas_asistencia_pendientes,
     coalesce(f.registros,0) AS notas_fuera_padron_actual,
     coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.clave,g.grupo_id) FROM grupos_resumen g WHERE g.periodo_id=p.id),'[]'::jsonb) AS grupos
   FROM periodos p LEFT JOIN public.jaguar_evaluacion_ventanas w ON w.periodo_id=p.id LEFT JOIN fuera_padron f ON f.periodo_id=p.id
 )
 SELECT jsonb_build_object('ciclo',v_ciclo,'periodo_actual_id',v_actual,'padron_actual_count',(SELECT count(*) FROM padron_presente),
   'periodos',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.numero_periodo,r.id) FROM resumen r),'[]'::jsonb),
   'grupos_sin_materias',(SELECT count(DISTINCT a.grupo_id) FROM padron_presente a WHERE NOT EXISTS (SELECT 1 FROM public.grupo_materias gm WHERE gm.grupo_id=a.grupo_id AND gm.activo IS TRUE)),
   'padron_historico_verificado',false,'sesiones_verificadas',false,'cierre_disponible',false)
 INTO v_result;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_diagnostico_cierre(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jaguar360_diagnostico_cierre(uuid) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
