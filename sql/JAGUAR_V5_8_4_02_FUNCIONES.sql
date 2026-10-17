-- V5.8.4: SOLO FUNCIONES, después de 01_TABLAS. No insertar RLS dentro de funciones.
BEGIN;
CREATE OR REPLACE FUNCTION public.jaguar_crear_carga_grupo(
 p_actor uuid,p_operacion uuid,p_grupo_id bigint,p_periodo_id bigint,p_materias jsonb
) RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $jaguar_crear$
DECLARE
 v_actor public.perfiles%ROWTYPE; v_cycle text; v_m jsonb; v_gm bigint;v_docente bigint;
 v_rows jsonb;v_expected bigint;v_id bigint;v_total int;v_student bigint;v_note numeric;v_role text;
BEGIN
 SELECT * INTO v_actor FROM public.perfiles WHERE id=p_actor AND activo=true;
 IF NOT FOUND OR v_actor.rol NOT IN ('control_escolar','control','direccion_escolar') THEN RAISE EXCEPTION 'Perfil sin permiso para emitir cargas institucionales.';END IF;
 IF nullif(v_actor.firma_path,'') IS NULL OR nullif(v_actor.firma_sha256,'') IS NULL THEN RAISE EXCEPTION 'Registra tu firma institucional en Perfil antes de emitir el lote.';END IF;
 SELECT ciclo_escolar INTO v_cycle FROM public.periodos_escolares WHERE id=p_periodo_id AND activo=true AND fecha_fin>=CURRENT_DATE;
 IF v_cycle IS NULL THEN RAISE EXCEPTION 'Periodo inexistente, inactivo o cerrado.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.grupos WHERE id=p_grupo_id AND activo=true) THEN RAISE EXCEPTION 'Grupo no activo.';END IF;
 IF jsonb_typeof(p_materias) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Lista de materias inválida.';END IF;
 SELECT count(*) INTO v_expected FROM public.grupo_materias WHERE grupo_id=p_grupo_id;
 IF jsonb_array_length(p_materias)<>v_expected OR v_expected<1 THEN RAISE EXCEPTION 'Incluye exactamente todas las materias asignadas al grupo.';END IF;
 IF (SELECT count(DISTINCT (v->>'grupo_materia_id')) FROM jsonb_array_elements(p_materias) v)<>v_expected THEN RAISE EXCEPTION 'Materias repetidas en el lote.';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('jaguar-carga-grupo:'||p_grupo_id||':'||p_periodo_id));
 INSERT INTO public.jaguar_cargas_grupo(operacion_id,grupo_id,periodo_id,actor_id,actor_nombre,actor_rol,firma_departamento_path,firma_departamento_sha256)
 VALUES(p_operacion,p_grupo_id,p_periodo_id,p_actor,v_actor.nombre_completo,v_actor.rol,v_actor.firma_path,v_actor.firma_sha256) RETURNING id INTO v_id;
 FOR v_m IN SELECT value FROM jsonb_array_elements(p_materias) LOOP
   v_gm:=(v_m->>'grupo_materia_id')::bigint;v_rows:=v_m->'rows';
   IF NOT EXISTS(SELECT 1 FROM public.grupo_materias WHERE id=v_gm AND grupo_id=p_grupo_id) THEN RAISE EXCEPTION 'Materia ajena al grupo %.',v_gm;END IF;
   SELECT docente_id INTO v_docente FROM public.asignaciones_docentes WHERE grupo_materia_id=v_gm AND ciclo_escolar=v_cycle AND activo=true ORDER BY id DESC LIMIT 1;
   IF v_docente IS NULL THEN RAISE EXCEPTION 'La materia % no tiene docente asignado.',v_gm;END IF;
   IF jsonb_typeof(v_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Notas inválidas de materia %.',v_gm;END IF;
   SELECT count(*) INTO v_total FROM public.alumnos WHERE grupo_id=p_grupo_id AND activo=true;
   IF v_total<1 OR jsonb_array_length(v_rows)<>v_total THEN RAISE EXCEPTION 'Faltan alumnos en materia % (esperados %).',v_gm,v_total;END IF;
   IF (SELECT count(DISTINCT (r->>'alumno_id')) FROM jsonb_array_elements(v_rows) r)<>v_total THEN RAISE EXCEPTION 'Alumnos duplicados en materia %.',v_gm;END IF;
   FOR v_student,v_note IN SELECT (r->>'alumno_id')::bigint,(r->>'calificacion')::numeric FROM jsonb_array_elements(v_rows) r LOOP
     IF v_note IS NULL OR v_note<0 OR v_note>10 OR v_note<>round(v_note,2) THEN RAISE EXCEPTION 'Nota inválida, alumno %.',v_student;END IF;
     IF NOT EXISTS(SELECT 1 FROM public.alumnos WHERE id=v_student AND grupo_id=p_grupo_id AND activo=true) THEN RAISE EXCEPTION 'Alumno % no pertenece al grupo.',v_student;END IF;
     IF EXISTS(SELECT 1 FROM public.calificaciones WHERE alumno_id=v_student AND grupo_materia_id=v_gm AND periodo_id=p_periodo_id) THEN RAISE EXCEPTION 'Ya hay nota oficial en materia %, alumno %. Usa el proceso de rectificación.',v_gm,v_student; END IF;
   END LOOP;
   INSERT INTO public.jaguar_cargas_materias(carga_id,grupo_materia_id,docente_id,notas_originales)
   VALUES(v_id,v_gm,v_docente,v_rows);
 END LOOP;
 RETURN v_id;
END;
$jaguar_crear$;

CREATE OR REPLACE FUNCTION public.jaguar_aceptar_carga_materia(
 p_actor uuid,p_revision_id bigint,p_notas jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $jaguar_aceptar$
DECLARE
 v_rev public.jaguar_cargas_materias%ROWTYPE;v_batch public.jaguar_cargas_grupo%ROWTYPE;
 v_perfil public.perfiles%ROWTYPE;v_student bigint;v_score numeric;v_original numeric;v_reason text;
 v_entry jsonb;v_expected int;v_count int:=0;v_old jsonb;v_nuevo jsonb:='[]'::jsonb;
BEGIN
 SELECT * INTO v_rev FROM public.jaguar_cargas_materias WHERE id=p_revision_id FOR UPDATE;
 IF NOT FOUND OR v_rev.estado<>'pendiente' THEN RAISE EXCEPTION 'Revisión inexistente o ya aceptada.';END IF;
 SELECT * INTO v_batch FROM public.jaguar_cargas_grupo WHERE id=v_rev.carga_id FOR UPDATE;
 SELECT * INTO v_perfil FROM public.perfiles WHERE id=p_actor AND activo=true;
 IF NOT FOUND OR v_perfil.rol<>'docente' THEN RAISE EXCEPTION 'Sólo el docente titular puede aceptar esta evaluación.';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.docentes WHERE id=v_rev.docente_id AND auth_user_id=p_actor) THEN RAISE EXCEPTION 'No eres el docente responsable de esta materia.';END IF;
 IF nullif(v_perfil.firma_path,'') IS NULL OR nullif(v_perfil.firma_sha256,'') IS NULL THEN RAISE EXCEPTION 'El docente debe registrar su firma en Perfil.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.periodos_escolares WHERE id=v_batch.periodo_id AND activo=true AND fecha_fin>=CURRENT_DATE) THEN RAISE EXCEPTION 'Periodo cerrado: requiere autorización académica de rectificación.';END IF;
 IF jsonb_typeof(p_notas) IS DISTINCT FROM 'array' OR jsonb_array_length(p_notas)<>jsonb_array_length(v_rev.notas_originales) THEN RAISE EXCEPTION 'La revisión debe conservar todos los alumnos.';END IF;
 IF (SELECT count(DISTINCT (x->>'alumno_id')) FROM jsonb_array_elements(p_notas) x)<>jsonb_array_length(p_notas) THEN RAISE EXCEPTION 'Alumnos duplicados.';END IF;
 FOR v_entry IN SELECT value FROM jsonb_array_elements(p_notas) LOOP
   v_student:=(v_entry->>'alumno_id')::bigint; v_score:=(v_entry->>'calificacion')::numeric;
   v_reason:=btrim(coalesce(v_entry->>'motivo',''));
   IF v_score IS NULL OR v_score<0 OR v_score>10 OR v_score<>round(v_score,2) THEN RAISE EXCEPTION 'Nota inválida para alumno %.',v_student; END IF;
   SELECT value INTO v_old FROM jsonb_array_elements(v_rev.notas_originales) value WHERE (value->>'alumno_id')::bigint=v_student;
   IF v_old IS NULL THEN RAISE EXCEPTION 'Alumno no estaba en el lote original: %.',v_student;END IF;
   v_original:=(v_old->>'calificacion')::numeric;
   IF v_original IS DISTINCT FROM v_score AND length(v_reason)<12 THEN RAISE EXCEPTION 'Ajuste del alumno % requiere motivo (mínimo 12 caracteres).',v_student;END IF;
   IF NOT EXISTS(SELECT 1 FROM public.alumnos WHERE id=v_student AND grupo_id=v_batch.grupo_id AND activo=true) THEN RAISE EXCEPTION 'Alumno % ya no pertenece al grupo.',v_student;END IF;
   IF EXISTS(SELECT 1 FROM public.calificaciones WHERE alumno_id=v_student AND grupo_materia_id=v_rev.grupo_materia_id AND periodo_id=v_batch.periodo_id) THEN RAISE EXCEPTION 'Ya hay nota oficial para alumno %. No se sobrescribió.',v_student;END IF;
   INSERT INTO public.calificaciones(alumno_id,grupo_materia_id,periodo_id,docente_id,calificacion,observaciones)
   VALUES(v_student,v_rev.grupo_materia_id,v_batch.periodo_id,v_rev.docente_id,v_score,nullif(v_reason,''));
   v_nuevo:=v_nuevo||jsonb_build_array(jsonb_build_object('alumno_id',v_student,'original',v_original,'calificacion',v_score,'motivo',v_reason));
   v_count:=v_count+1;
 END LOOP;
 UPDATE public.jaguar_cargas_materias SET estado='aceptada',notas_finales=v_nuevo,firmado_por=p_actor,
 firma_docente_path=v_perfil.firma_path,firma_docente_sha256=v_perfil.firma_sha256,firmado_at=now()
 WHERE id=p_revision_id;
 IF NOT EXISTS(SELECT 1 FROM public.jaguar_cargas_materias WHERE carga_id=v_batch.id AND estado<>'aceptada') THEN
   UPDATE public.jaguar_cargas_grupo SET estado='completa' WHERE id=v_batch.id;
 END IF;
 RETURN jsonb_build_object('materia_id',v_rev.grupo_materia_id,'aceptadas',v_count,'revision_id',p_revision_id);
END;
$jaguar_aceptar$;
REVOKE ALL ON FUNCTION public.jaguar_crear_carga_grupo(uuid,uuid,bigint,bigint,jsonb), public.jaguar_aceptar_carga_materia(uuid,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jaguar_crear_carga_grupo(uuid,uuid,bigint,bigint,jsonb), public.jaguar_aceptar_carga_materia(uuid,bigint,jsonb) TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
