-- V5.8.7 / Paso 02. EJECUTAR ÚNICAMENTE si el diagnóstico indica rpc_existe=false.
-- Requiere el paso 01 completo y las tablas académicas anteriores instaladas.
-- No ejecutar si la RPC ya existe: evitamos sobrescribir personalizaciones.
-- Esta declaración no importa calificaciones por sí sola; sólo define una función.
BEGIN;
CREATE OR REPLACE FUNCTION public.jaguar_classroom_importar_rubrica(
 p_actor uuid,
 p_rubrica_id bigint,
 p_componente_id bigint,
 p_google_course_id text,
 p_periodo_id bigint,
 p_grades jsonb,
 p_snapshot jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
 r record;
 record_grade record;
 count_expected integer;
 count_input integer;
 count_imported integer:=0;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'La importación sólo se ejecuta en servidor.';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.perfiles WHERE id=p_actor AND rol='docente' AND activo=true) THEN
  RAISE EXCEPTION 'La cuenta docente no está autorizada.';
 END IF;
 SELECT rb.*,gm.grupo_id,p.ciclo_escolar,p.activo AS periodo_activo,p.es_periodo_actual,p.fecha_fin
 INTO r
 FROM public.rubricas_evaluacion rb
 JOIN public.grupo_materias gm ON gm.id=rb.grupo_materia_id
 JOIN public.periodos_escolares p ON p.id=rb.periodo_id
 WHERE rb.id=p_rubrica_id AND rb.periodo_id=p_periodo_id
 FOR UPDATE OF rb;
 IF NOT FOUND THEN RAISE EXCEPTION 'No existe la rúbrica para ese periodo.'; END IF;
 IF r.estado IS DISTINCT FROM 'borrador' OR r.es_periodo_actual IS DISTINCT FROM true OR r.periodo_activo IS FALSE OR (r.fecha_fin IS NOT NULL AND r.fecha_fin<CURRENT_DATE) THEN
  RAISE EXCEPTION 'Periodo o rúbrica cerrada; no se pueden importar calificaciones.';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.docentes d JOIN public.asignaciones_docentes a ON a.docente_id=d.id
   WHERE d.auth_user_id=p_actor AND d.id=r.docente_id AND a.grupo_materia_id=r.grupo_materia_id
   AND a.ciclo_escolar=r.ciclo_escolar AND a.activo=true) THEN
   RAISE EXCEPTION 'El docente no tiene esta asignación activa.';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.jaguar_classroom_clases c WHERE c.google_course_id=p_google_course_id
   AND c.grupo_materia_id=r.grupo_materia_id AND c.ciclo_escolar=r.ciclo_escolar) THEN
   RAISE EXCEPTION 'La clase Google no coincide con la rúbrica.';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.rubrica_componentes c WHERE c.id=p_componente_id AND c.rubrica_id=r.id AND c.nombre ~* 'classroom') THEN
   RAISE EXCEPTION 'El componente no pertenece a la rúbrica Classroom.';
 END IF;
 IF (SELECT abs(coalesce(sum(ponderacion),0)-100) FROM public.rubrica_componentes WHERE rubrica_id=r.id)>0.005 THEN
   RAISE EXCEPTION 'La ponderación de la rúbrica debe sumar 100 por ciento.';
 END IF;
 IF EXISTS (SELECT 1 FROM public.cierres_evaluacion c WHERE c.rubrica_id=r.id) THEN
   RAISE EXCEPTION 'La evaluación está cerrada.';
 END IF;
 IF jsonb_typeof(p_grades) IS DISTINCT FROM 'array' OR jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Los datos enviados no son válidos.';
 END IF;
 SELECT count(*) INTO count_expected FROM public.alumnos WHERE grupo_id=r.grupo_id AND activo=true;
 SELECT count(*) INTO count_input FROM jsonb_array_elements(p_grades);
 IF count_expected=0 OR count_input<>count_expected OR count_input>250 THEN
  RAISE EXCEPTION 'La cantidad de calificaciones no coincide con la lista vigente del grupo.';
 END IF;
 IF EXISTS (
  SELECT 1 FROM (SELECT (x->>'alumno_id')::bigint AS id FROM jsonb_array_elements(p_grades) x) z
  LEFT JOIN public.alumnos a ON a.id=z.id AND a.grupo_id=r.grupo_id AND a.activo=true
  GROUP BY z.id HAVING count(*)>1 OR count(a.id)=0
 ) THEN RAISE EXCEPTION 'Existen alumnos repetidos o ajenos al grupo.'; END IF;
 FOR record_grade IN SELECT (x->>'alumno_id')::bigint AS alumno_id,(x->>'valor')::numeric AS valor
   FROM jsonb_array_elements(p_grades) x LOOP
   IF record_grade.valor IS NULL OR record_grade.valor<0 OR record_grade.valor>10 THEN
    RAISE EXCEPTION 'El promedio de Classroom debe estar entre 0 y 10.';
   END IF;
   IF (SELECT count(*) FROM public.evaluacion_notas WHERE rubrica_id=p_rubrica_id AND componente_id=p_componente_id AND alumno_id=record_grade.alumno_id)>1 THEN
      RAISE EXCEPTION 'Hay calificaciones duplicadas para este alumno en la rúbrica. Corrige el registro antes de importar.';
   END IF;
   UPDATE public.evaluacion_notas SET valor=record_grade.valor
    WHERE rubrica_id=p_rubrica_id AND componente_id=p_componente_id AND alumno_id=record_grade.alumno_id;
   IF NOT FOUND THEN
    INSERT INTO public.evaluacion_notas(rubrica_id,componente_id,alumno_id,valor)
     VALUES(p_rubrica_id,p_componente_id,record_grade.alumno_id,record_grade.valor);
   END IF;
   count_imported:=count_imported+1;
 END LOOP;
 INSERT INTO public.jaguar_classroom_importaciones(rubrica_id,componente_id,google_course_id,periodo_id,actor,calificaciones,snapshot)
 VALUES(p_rubrica_id,p_componente_id,p_google_course_id,p_periodo_id,p_actor,count_imported,p_snapshot);
 RETURN count_imported;
END;
$$;
REVOKE ALL ON FUNCTION public.jaguar_classroom_importar_rubrica(uuid,bigint,bigint,text,bigint,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jaguar_classroom_importar_rubrica(uuid,bigint,bigint,text,bigint,jsonb,jsonb) TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
