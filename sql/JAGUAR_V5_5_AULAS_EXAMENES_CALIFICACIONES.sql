-- JAGUAR V5.5 · ejecutar en Supabase de PRUEBAS antes del deploy.
-- Requiere V5.4 instalada; no elimina ni cambia las tablas anteriores.
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
CREATE TABLE IF NOT EXISTS public.jaguar_preguntas (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 docente_id bigint NOT NULL REFERENCES public.docentes(id),
 materia_id bigint NOT NULL REFERENCES public.materias(id),
 tipo text NOT NULL CHECK(tipo IN ('opcion_multiple','verdadero_falso','abierta')),
 enunciado text NOT NULL CHECK(length(enunciado) BETWEEN 8 AND 2500),
 opciones jsonb NOT NULL DEFAULT '[]'::jsonb,
 respuesta jsonb,
 puntos numeric(6,2) NOT NULL DEFAULT 1 CHECK(puntos>0 AND puntos<=100),
 creado_at timestamptz NOT NULL DEFAULT now(), actualizado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jaguar_preguntas_docente_materia_idx ON public.jaguar_preguntas(docente_id,materia_id);
CREATE TABLE IF NOT EXISTS public.jaguar_examenes (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 docente_id bigint NOT NULL REFERENCES public.docentes(id),
 grupo_materia_id bigint NOT NULL REFERENCES public.grupo_materias(id),
 ciclo_escolar text NOT NULL,
 titulo text NOT NULL,
 instrucciones text,
 preguntas jsonb NOT NULL CHECK(jsonb_typeof(preguntas)='array'),
 creado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jaguar_examenes_docente_idx ON public.jaguar_examenes(docente_id,creado_at DESC);
CREATE TABLE IF NOT EXISTS public.jaguar_importaciones_calificaciones (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 operacion_id uuid NOT NULL UNIQUE,
 usuario_id uuid NOT NULL,
 grupo_materia_id bigint NOT NULL,
 periodo_id bigint NOT NULL,
 registros integer NOT NULL,
 insertados integer NOT NULL,
 actualizados integer NOT NULL,
 sin_cambio integer NOT NULL,
 motivo text,
 detalle jsonb NOT NULL DEFAULT '[]'::jsonb,
 creado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jaguar_importaciones_fecha_idx ON public.jaguar_importaciones_calificaciones(creado_at DESC);
ALTER TABLE public.jaguar_aulas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar_preguntas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar_examenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar_importaciones_calificaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar_aulas,public.jaguar_preguntas,public.jaguar_examenes,public.jaguar_importaciones_calificaciones FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.jaguar_aulas,public.jaguar_preguntas,public.jaguar_examenes,public.jaguar_importaciones_calificaciones TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.jaguar_aulas_id_seq, public.jaguar_preguntas_id_seq, public.jaguar_examenes_id_seq, public.jaguar_importaciones_calificaciones_id_seq TO service_role;

-- Asignación concurrente: el bloqueo de advisory serializa reserva del mismo salón.
-- Los horarios existentes conservan el campo aula para PDF y vistas previas.
CREATE OR REPLACE FUNCTION public.jaguar_asignar_aula(p_horario_id bigint,p_aula_id bigint,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_role text; v_room public.jaguar_aulas%ROWTYPE; v_hour public.horarios%ROWTYPE;
 v_group_id bigint; v_students integer; v_room_key text;
BEGIN
 SELECT rol INTO v_role FROM public.perfiles WHERE id=p_actor AND activo=true;
 IF v_role NOT IN ('coordinacion_academica','direccion_escolar') OR v_role IS NULL THEN RAISE EXCEPTION 'Permiso insuficiente para asignar aulas.'; END IF;
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
   SELECT grupo_id INTO v_group FROM public.grupo_materias WHERE id=new.grupo_materia_id;
   SELECT count(*) INTO v_students FROM public.alumnos WHERE grupo_id=v_group AND activo=true;
   IF v_students>v_capacity THEN RAISE EXCEPTION 'Capacidad insuficiente para grupo: % alumnos y % lugares.',v_students,v_capacity; END IF;
 END IF;
 RETURN new;
END $$;
DROP TRIGGER IF EXISTS jaguar_prevenir_choque_aula_horarios ON public.horarios;
CREATE TRIGGER jaguar_prevenir_choque_aula_horarios BEFORE INSERT OR UPDATE OF aula,dia_semana,hora_inicio,hora_fin,ciclo_escolar,grupo_materia_id ON public.horarios
FOR EACH ROW EXECUTE FUNCTION public.jaguar_prevenir_choque_aula();

-- Aplicación transaccional: TODO el lote se confirma o NINGUNA calificación se modifica.
CREATE OR REPLACE FUNCTION public.jaguar_importar_calificaciones_lote(
 p_operacion uuid,p_actor uuid,p_grupo_materia_id bigint,p_periodo_id bigint,
 p_rows jsonb,p_allow_updates boolean DEFAULT false,p_motivo text DEFAULT ''
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_role text; v_group_id bigint; v_cycle text; v_teacher bigint; v_row jsonb;
 v_student bigint; v_grade numeric; v_note text; v_existing public.calificaciones%ROWTYPE;
 v_new int:=0;v_update int:=0;v_skip int:=0;v_details jsonb:='[]'::jsonb;v_total integer;
BEGIN
 SELECT rol INTO v_role FROM public.perfiles WHERE id=p_actor AND activo=true;
 IF v_role NOT IN ('control_escolar','control','direccion_escolar') OR v_role IS NULL THEN RAISE EXCEPTION 'Solo Control Escolar o Dirección pueden realizar cargas institucionales.'; END IF;
 SELECT gm.grupo_id INTO v_group_id FROM public.grupo_materias gm WHERE gm.id=p_grupo_materia_id;
 SELECT ciclo_escolar INTO v_cycle FROM public.periodos_escolares WHERE id=p_periodo_id;
 IF v_group_id IS NULL OR v_cycle IS NULL THEN RAISE EXCEPTION 'Grupo-materia o periodo no existe.'; END IF;
 IF EXISTS(SELECT 1 FROM public.periodos_escolares p WHERE p.id=p_periodo_id AND (p.fecha_fin < current_date OR p.activo=false)) THEN RAISE EXCEPTION 'Periodo inactivo o concluido: no admite carga masiva.'; END IF;
 SELECT docente_id INTO v_teacher FROM public.asignaciones_docentes
  WHERE grupo_materia_id=p_grupo_materia_id AND ciclo_escolar=v_cycle AND activo=true
  ORDER BY id DESC LIMIT 1;
 IF v_teacher IS NULL THEN RAISE EXCEPTION 'No hay docente activo asignado a esa materia y ciclo.'; END IF;
 IF jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)<1 OR jsonb_array_length(p_rows)>250 THEN RAISE EXCEPTION 'Lote inválido; de 1 a 250 notas.'; END IF;
 IF p_allow_updates AND length(btrim(coalesce(p_motivo,'')))<20 THEN RAISE EXCEPTION 'Para cambiar notas previas se requiere motivo de 20 caracteres.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('jaguar-notas:'||p_grupo_materia_id||':'||p_periodo_id));
 IF EXISTS(SELECT 1 FROM public.jaguar_importaciones_calificaciones WHERE operacion_id=p_operacion) THEN RAISE EXCEPTION 'Esta operación ya se registró, evita aplicar dos veces el lote.'; END IF;
 v_total:=jsonb_array_length(p_rows);
 IF (SELECT count(DISTINCT (j->>'alumno_id')) FROM jsonb_array_elements(p_rows) j)<>v_total THEN RAISE EXCEPTION 'Alumnos duplicados en el lote.'; END IF;
 FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
   v_student:=(v_row->>'alumno_id')::bigint; v_grade:=(v_row->>'calificacion')::numeric;v_note:=left(coalesce(v_row->>'observaciones',''),450);
   IF v_grade<0 OR v_grade>10 OR v_grade<>round(v_grade,1) THEN RAISE EXCEPTION 'Nota fuera de rango para alumno %.',v_student; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.alumnos WHERE id=v_student AND grupo_id=v_group_id AND activo=true) THEN RAISE EXCEPTION 'Alumno % no pertenece al grupo activo.',v_student; END IF;
   SELECT * INTO v_existing FROM public.calificaciones WHERE alumno_id=v_student AND grupo_materia_id=p_grupo_materia_id AND periodo_id=p_periodo_id FOR UPDATE;
   IF FOUND THEN
     IF v_existing.rubrica_id IS NOT NULL OR v_existing.cierre_evaluacion_id IS NOT NULL THEN RAISE EXCEPTION 'La calificación del alumno % procede de una rúbrica cerrada; no puede sobrescribirse.',v_student; END IF;
     IF v_existing.calificacion=v_grade AND coalesce(v_existing.observaciones,'')=v_note THEN v_skip:=v_skip+1;
     ELSE
       IF NOT p_allow_updates THEN RAISE EXCEPTION 'Ya hay nota para alumno %; debes autorizar correcciones.',v_student; END IF;
       UPDATE public.calificaciones SET calificacion=v_grade,observaciones=nullif(v_note,'') WHERE id=v_existing.id;
       v_update:=v_update+1;
     END IF;
   ELSE
     INSERT INTO public.calificaciones(alumno_id,grupo_materia_id,periodo_id,docente_id,calificacion,observaciones)
     VALUES(v_student,p_grupo_materia_id,p_periodo_id,v_teacher,v_grade,nullif(v_note,''));v_new:=v_new+1;
   END IF;
   v_details:=v_details||jsonb_build_array(jsonb_build_object('alumno_id',v_student,'antes',v_existing.calificacion,'despues',v_grade));
 END LOOP;
 INSERT INTO public.jaguar_importaciones_calificaciones(operacion_id,usuario_id,grupo_materia_id,periodo_id,registros,insertados,actualizados,sin_cambio,motivo,detalle)
 VALUES(p_operacion,p_actor,p_grupo_materia_id,p_periodo_id,v_total,v_new,v_update,v_skip,nullif(btrim(p_motivo),''),v_details);
 RETURN jsonb_build_object('insertados',v_new,'actualizados',v_update,'sin_cambio',v_skip,'total',v_total,'operacion_id',p_operacion);
END $$;
REVOKE ALL ON FUNCTION public.jaguar_importar_calificaciones_lote(uuid,uuid,bigint,bigint,jsonb,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jaguar_importar_calificaciones_lote(uuid,uuid,bigint,bigint,jsonb,boolean,text) TO service_role;
COMMIT;
