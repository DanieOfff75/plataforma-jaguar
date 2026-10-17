-- Jaguar V5.8: registro y asignación por grupo; ejecutar primero en una copia de Supabase.
-- No borra tablas ni registros. Se exige revisar conflictos existentes antes de ejecutar.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar_aulas (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 codigo text NOT NULL UNIQUE CHECK (length(codigo) BETWEEN 2 AND 24),
 nombre text NOT NULL UNIQUE,
 edificio text, descripcion text,
 capacidad integer NOT NULL CHECK(capacidad BETWEEN 1 AND 1000),
 activo boolean NOT NULL DEFAULT true,
 creado_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.jaguar_aulas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar_aulas FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.jaguar_aulas TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.jaguar_aulas_id_seq TO service_role;
CREATE OR REPLACE FUNCTION public.jaguar_asignar_aula(p_horario_id bigint,p_aula_id bigint,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_role text; v_room public.jaguar_aulas%ROWTYPE; v_hour public.horarios%ROWTYPE;
 v_group_id bigint; v_students integer; v_room_key text;
BEGIN
 SELECT rol INTO v_role FROM public.perfiles WHERE id=p_actor AND activo=true;
 IF v_role NOT IN ('coordinacion_academica','direccion_escolar','servicios_docentes') OR v_role IS NULL THEN RAISE EXCEPTION 'Permiso insuficiente para asignar aulas.'; END IF;
 SELECT * INTO v_hour FROM public.horarios WHERE id=p_horario_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Horario no encontrado.'; END IF;
 SELECT grupo_id INTO v_group_id FROM public.grupo_materias WHERE id=v_hour.grupo_materia_id;
 IF v_group_id IS NULL THEN RAISE EXCEPTION 'El horario no tiene grupo válido.'; END IF;
 IF p_aula_id IS NULL THEN
   UPDATE public.horarios SET aula=NULL WHERE id=p_horario_id;
   RETURN jsonb_build_object('horario_id',p_horario_id,'aula',NULL);
 END IF;
 SELECT * INTO v_room FROM public.jaguar_aulas WHERE id=p_aula_id AND activo=true;
 IF NOT FOUND THEN RAISE EXCEPTION 'Aula no encontrada o inactiva.'; END IF;
 v_room_key=upper(btrim(v_room.nombre));
 PERFORM pg_advisory_xact_lock(hashtext('jaguar-aula:'||v_room_key));
 SELECT count(*) INTO v_students FROM public.alumnos WHERE grupo_id=v_group_id AND activo=true;
 IF v_students>v_room.capacidad THEN RAISE EXCEPTION 'Capacidad insuficiente: % alumnos para % lugares.',v_students,v_room.capacidad; END IF;
 IF EXISTS(
   SELECT 1 FROM public.horarios h
   WHERE h.id<>p_horario_id AND h.ciclo_escolar=v_hour.ciclo_escolar
     AND h.dia_semana=v_hour.dia_semana
     AND upper(btrim(coalesce(h.aula,'')))=v_room_key
     AND h.hora_inicio::time < v_hour.hora_fin::time
     AND v_hour.hora_inicio::time < h.hora_fin::time
 ) THEN RAISE EXCEPTION 'Aula ocupada: existe una clase que coincide con este horario.'; END IF;
 UPDATE public.horarios SET aula=v_room.nombre WHERE id=p_horario_id;
 RETURN jsonb_build_object('horario_id',p_horario_id,'aula_id',p_aula_id,'aula',v_room.nombre,'grupo_alumnos',v_students,'capacidad',v_room.capacidad);
END $$;
REVOKE ALL ON FUNCTION public.jaguar_asignar_aula(bigint,bigint,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jaguar_asignar_aula(bigint,bigint,uuid) TO service_role;

-- Protección adicional cuando otro módulo modifica el campo aula directamente.
CREATE OR REPLACE FUNCTION public.jaguar_prevenir_choque_aula()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_capacity int; v_students int; v_group bigint; v_roomname text;
BEGIN
 IF new.aula IS NULL OR btrim(new.aula)='' THEN RETURN new; END IF;
 v_roomname=upper(btrim(new.aula));
 PERFORM pg_advisory_xact_lock(hashtext('jaguar-aula:'||v_roomname));
 IF EXISTS(SELECT 1 FROM public.horarios h
     WHERE h.id IS DISTINCT FROM new.id AND h.ciclo_escolar=new.ciclo_escolar
       AND h.dia_semana=new.dia_semana AND upper(btrim(coalesce(h.aula,'')))=v_roomname
       AND h.hora_inicio::time<new.hora_fin::time AND new.hora_inicio::time<h.hora_fin::time)
 THEN RAISE EXCEPTION 'Choque de aula: el salón ya se encuentra ocupado en ese intervalo.'; END IF;
 SELECT capacidad INTO v_capacity FROM public.jaguar_aulas WHERE upper(nombre)=v_roomname AND activo=true;
 IF v_capacity IS NOT NULL THEN
   IF (SELECT count(DISTINCT gm.grupo_id)
       FROM public.horarios h JOIN public.grupo_materias gm ON gm.id=h.grupo_materia_id
       WHERE h.ciclo_escolar=new.ciclo_escolar AND upper(btrim(coalesce(h.aula,'')))=v_roomname
         AND h.id IS DISTINCT FROM new.id AND gm.grupo_id IS DISTINCT FROM
              (SELECT grupo_id FROM public.grupo_materias WHERE id=new.grupo_materia_id))>=2
   THEN RAISE EXCEPTION 'Esta aula ya tiene dos grupos diferentes en el ciclo escolar.'; END IF;
   SELECT grupo_id INTO v_group FROM public.grupo_materias WHERE id=new.grupo_materia_id;
   SELECT count(*) INTO v_students FROM public.alumnos WHERE grupo_id=v_group AND activo=true;
   IF v_students>v_capacity THEN RAISE EXCEPTION 'Capacidad insuficiente para grupo: % alumnos y % lugares.',v_students,v_capacity; END IF;
 END IF;
 RETURN new;
END $$;
DROP TRIGGER IF EXISTS jaguar_prevenir_choque_aula_horarios ON public.horarios;
CREATE TRIGGER jaguar_prevenir_choque_aula_horarios BEFORE INSERT OR UPDATE OF aula,dia_semana,hora_inicio,hora_fin,ciclo_escolar,grupo_materia_id ON public.horarios
FOR EACH ROW EXECUTE FUNCTION public.jaguar_prevenir_choque_aula();


-- Confirmación atómica para los 18 grupos. Si falla un horario, se revierte el lote completo.
CREATE OR REPLACE FUNCTION public.jaguar_asignar_aulas_grupos_lote(
 p_actor uuid, p_ciclo text, p_asignaciones jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_role text; v_item jsonb; v_id bigint; v_room bigint; v_row record;
 v_groups int; v_m int; v_v int; v_updated int:=0;v_nowroom text;v_total int;
BEGIN
 SELECT rol INTO v_role FROM public.perfiles WHERE id=p_actor AND activo=true;
 IF v_role NOT IN ('coordinacion_academica','direccion_escolar','servicios_docentes') OR v_role IS NULL
 THEN RAISE EXCEPTION 'Solo Servicios Docentes, Coordinación Académica o Dirección Escolar pueden asignar aulas.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('jaguar-aulas-lote:'||p_ciclo));
 SELECT count(*),count(*) FILTER(WHERE lower(turno) LIKE 'matut%'),count(*) FILTER(WHERE lower(turno) LIKE 'vespert%')
 INTO v_groups,v_m,v_v FROM public.grupos WHERE activo=true;
 IF v_groups<>18 OR v_m<>9 OR v_v<>9
 THEN RAISE EXCEPTION 'Se requieren 18 grupos activos: 9 matutinos y 9 vespertinos.'; END IF;
 IF jsonb_typeof(p_asignaciones)<>'array' OR jsonb_array_length(p_asignaciones)<>18
 THEN RAISE EXCEPTION 'El lote debe contener exactamente 18 grupos.'; END IF;
 IF (SELECT count(DISTINCT (j->>'grupo_id')) FROM jsonb_array_elements(p_asignaciones) j)<>18
 THEN RAISE EXCEPTION 'El lote contiene grupos repetidos.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_asignaciones) j LEFT JOIN public.grupos g
     ON g.id=(j->>'grupo_id')::bigint AND g.activo=true WHERE g.id IS NULL)
 THEN RAISE EXCEPTION 'El lote contiene un grupo inactivo o inexistente.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_asignaciones) j LEFT JOIN public.jaguar_aulas a
     ON a.id=(j->>'aula_id')::bigint AND a.activo=true WHERE a.id IS NULL)
 THEN RAISE EXCEPTION 'El lote contiene aulas inexistentes o inactivas.'; END IF;
 -- Todos los horarios de cada grupo conservarán el mismo salón.
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_asignaciones) LOOP
   v_id:=(v_item->>'grupo_id')::bigint; v_room:=(v_item->>'aula_id')::bigint;
   IF NOT EXISTS(SELECT 1 FROM public.horarios h JOIN public.grupo_materias gm
     ON gm.id=h.grupo_materia_id WHERE gm.grupo_id=v_id AND h.ciclo_escolar=p_ciclo)
   THEN RAISE EXCEPTION 'Grupo % sin horario, no se puede asignar aula.',v_id; END IF;
   SELECT nombre INTO v_nowroom FROM public.jaguar_aulas WHERE id=v_room;
   IF EXISTS(SELECT 1 FROM public.horarios h JOIN public.grupo_materias gm ON gm.id=h.grupo_materia_id
     WHERE gm.grupo_id=v_id AND h.ciclo_escolar=p_ciclo
       AND h.aula IS NOT NULL AND btrim(h.aula)<>'' AND upper(btrim(h.aula))<>upper(btrim(v_nowroom)))
   THEN RAISE EXCEPTION 'El grupo % ya tiene un salón distinto; no se sobrescribe.',v_id; END IF;
 END LOOP;
 -- Validar que cada aula sólo reciba dos grupos en toda la asignación, turnos distintos.
 IF EXISTS(
   SELECT 1 FROM (SELECT (j->>'aula_id')::bigint AS aula,
     count(*) AS n, count(*) FILTER(WHERE lower(g.turno) LIKE 'matut%') AS m,
     count(*) FILTER(WHERE lower(g.turno) LIKE 'vespert%') AS v
     FROM jsonb_array_elements(p_asignaciones) j JOIN public.grupos g ON g.id=(j->>'grupo_id')::bigint
     GROUP BY (j->>'aula_id')::bigint) z WHERE z.n>2 OR z.m>1 OR z.v>1
 ) THEN RAISE EXCEPTION 'Una aula tendría más de dos grupos o dos del mismo turno.'; END IF;
 -- Se valida toda la capacidad por grupo antes de mutar un horario.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_asignaciones) j
   JOIN public.grupos g ON g.id=(j->>'grupo_id')::bigint
   JOIN public.jaguar_aulas a ON a.id=(j->>'aula_id')::bigint
   WHERE (SELECT count(*) FROM public.alumnos s WHERE s.grupo_id=g.id AND s.activo=true)>a.capacidad)
 THEN RAISE EXCEPTION 'Alguno de los salones tiene capacidad insuficiente.'; END IF;
 -- Los triggers de horarios impiden coincidencias reales y grupos extra al guardar.
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_asignaciones) LOOP
   v_id:=(v_item->>'grupo_id')::bigint;v_room:=(v_item->>'aula_id')::bigint;
   UPDATE public.horarios h SET aula=(SELECT nombre FROM public.jaguar_aulas WHERE id=v_room)
   FROM public.grupo_materias gm WHERE h.grupo_materia_id=gm.id AND gm.grupo_id=v_id
     AND h.ciclo_escolar=p_ciclo AND (h.aula IS NULL OR btrim(h.aula)='');
   GET DIAGNOSTICS v_total=ROW_COUNT;v_updated:=v_updated+v_total;
 END LOOP;
 RETURN jsonb_build_object('horarios_asignados',v_updated,'grupos',18,'ciclo',p_ciclo);
END $$;
REVOKE ALL ON FUNCTION public.jaguar_asignar_aulas_grupos_lote(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jaguar_asignar_aulas_grupos_lote(uuid,text,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
