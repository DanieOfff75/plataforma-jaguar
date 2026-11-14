-- V24: recuperación documental con autorización independiente y proyección histórica. SOLO clon aislado.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar360_recuperaciones (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 convocatoria_id bigint NOT NULL REFERENCES public.jaguar360_convocatorias(id) ON DELETE RESTRICT,
 alumno_id bigint NOT NULL REFERENCES public.alumnos(id) ON DELETE RESTRICT,
 ciclo text NOT NULL, materia_clave text NOT NULL, periodo integer NOT NULL CHECK(periodo BETWEEN 1 AND 6),
 estado text NOT NULL CHECK(estado IN ('reservada','evaluada','autorizada','rechazada','cancelada')),
 version integer NOT NULL DEFAULT 1, base jsonb NOT NULL, payload jsonb, evaluador uuid,
 UNIQUE(convocatoria_id,alumno_id), CHECK(jsonb_typeof(base)='object')
);
CREATE UNIQUE INDEX IF NOT EXISTS j360_recovery_active ON public.jaguar360_recuperaciones(ciclo,materia_clave,periodo,alumno_id) WHERE estado IN ('reservada','evaluada');
CREATE TABLE IF NOT EXISTS public.jaguar360_recuperacion_eventos (
 recuperacion_id bigint NOT NULL REFERENCES public.jaguar360_recuperaciones(id) ON DELETE RESTRICT,
 version integer NOT NULL, estado text NOT NULL, actor_id uuid NOT NULL, cargo text NOT NULL,
 referencia text NOT NULL, motivo text NOT NULL, creado_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(recuperacion_id,version)
);
ALTER TABLE public.jaguar360_recuperaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar360_recuperacion_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_recuperaciones,public.jaguar360_recuperacion_eventos FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_fuentes_ordinarias(p_actor uuid,p_ciclo text,p_alumno bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE pv integer; plan jsonb; pe record; seal public.jaguar360_cierres_periodo; rows jsonb; output jsonb:='[]'::jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('direccion_escolar','coordinacion_academica','control_escolar','control')) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.alumnos WHERE id=p_alumno) THEN RAISE EXCEPTION 'Alumno inexistente.'; END IF;
 SELECT min(plan_version) INTO pv FROM public.jaguar360_cierres_periodo WHERE ciclo=p_ciclo;
 IF pv IS NULL OR EXISTS(SELECT 1 FROM public.jaguar360_cierres_periodo WHERE ciclo=p_ciclo AND plan_version<>pv) THEN RAISE EXCEPTION 'No existe un plan común en los sellos del ciclo.'; END IF;
 SELECT t.plan INTO plan FROM public.jaguar360_planes_ciclo t WHERE ciclo=p_ciclo AND version=pv;
 IF NOT FOUND THEN RAISE EXCEPTION 'Versión histórica del plan inexistente.'; END IF;
 IF (SELECT count(*) FROM public.periodos_escolares WHERE ciclo_escolar=p_ciclo)>6 THEN RAISE EXCEPTION 'Periodos no conciliados.'; END IF;
 FOR pe IN SELECT id,numero_periodo,fecha_inicio,fecha_fin FROM public.periodos_escolares WHERE ciclo_escolar=p_ciclo ORDER BY numero_periodo,id LOOP
  SELECT * INTO seal FROM public.jaguar360_cierres_periodo WHERE periodo_id=pe.id AND ciclo=p_ciclo AND plan_version=pv;
  rows:='[]'::jsonb;
  IF seal.periodo_id IS NOT NULL THEN
   WITH notes AS (SELECT * FROM jsonb_to_recordset(seal.evidencia->'notas') AS n(alumno_id bigint,grupo_materia_id bigint,evaluacion text,calificacion numeric,fuente_original numeric,resultado text) WHERE alumno_id=p_alumno),
   marks AS (SELECT grupo_materia_id,count(*) FILTER(WHERE estado='presente') AS present,count(*) FILTER(WHERE estado='falta') AS absent,count(*) FILTER(WHERE estado='retardo') AS late,count(*) FILTER(WHERE estado='justificada') AS justified,count(*) FILTER(WHERE estado IS NULL) AS unknown FROM jsonb_to_recordset(seal.evidencia->'asistencias') AS s(alumno_id bigint,grupo_materia_id bigint,estado text) WHERE alumno_id=p_alumno GROUP BY grupo_materia_id),
   mapping AS (SELECT * FROM jsonb_to_recordset(seal.mapa_materias) AS m(gm text,materia text,grado integer,evaluacion text))
   SELECT coalesce(jsonb_agg(jsonb_build_object('subjectId',g.materia,'groupMaterialId',n.grupo_materia_id::text,'grade',g.grado,'evaluation',n.evaluacion,'official',coalesce(rect.nuevo_oficial,n.calificacion),'original',coalesce(rect.nuevo_original,n.fuente_original),'result',n.resultado,'attendance',jsonb_build_object('present',coalesce(m.present,0),'absent',coalesce(m.absent,0),'late',coalesce(m.late,0),'justified',coalesce(m.justified,0),'unknown',coalesce(m.unknown,0))) ORDER BY n.grupo_materia_id),'[]'::jsonb) INTO rows FROM notes n LEFT JOIN mapping g ON g.gm=n.grupo_materia_id::text AND g.evaluacion=n.evaluacion LEFT JOIN marks m ON m.grupo_materia_id=n.grupo_materia_id LEFT JOIN LATERAL (SELECT r.nuevo_oficial,r.nuevo_original FROM public.jaguar360_rectificaciones r JOIN public.jaguar360_rectificacion_resoluciones d ON d.rectificacion_id=r.id AND d.estado='autorizada' WHERE r.periodo_id=pe.id AND r.alumno_id=n.alumno_id AND r.grupo_materia_id=n.grupo_materia_id ORDER BY r.id DESC LIMIT 1) rect ON true;
  END IF;
  output:=output||jsonb_build_array(jsonb_build_object('number',pe.numero_periodo,'start',pe.fecha_inicio,'end',pe.fecha_fin,'verified',seal.periodo_id IS NOT NULL,'rows',rows));
 END LOOP;
 RETURN jsonb_build_object('plan',plan,'version',pv,'periods',output);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_fuentes_ordinarias(uuid,text,bigint) FROM PUBLIC,anon,authenticated,service_role;
-- Retain the same function identity and callers; augment sealed sources without changing seal or legacy notes.
CREATE OR REPLACE FUNCTION public.jaguar360_fuentes_selladas(p_actor uuid,p_ciclo text,p_alumno bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE src jsonb; r public.jaguar360_recuperaciones; pi integer; ri integer; oldrow jsonb; updated jsonb; pending jsonb;
BEGIN
 src:=public.jaguar360_fuentes_ordinarias(p_actor,p_ciclo,p_alumno);
 FOR r IN SELECT * FROM public.jaguar360_recuperaciones WHERE ciclo=p_ciclo AND alumno_id=p_alumno AND estado='autorizada' ORDER BY id LOOP
  SELECT (ord-1)::integer INTO pi FROM jsonb_array_elements(src->'periods') WITH ORDINALITY p(v,ord) WHERE v->>'number'=r.periodo::text;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recuperación sin periodo vigente; requiere conciliación.'; END IF;
  SELECT (ord-1)::integer INTO ri FROM jsonb_array_elements(src->'periods'->pi->'rows') WITH ORDINALITY p(v,ord) WHERE v->>'groupMaterialId'=r.base->'before'->>'groupMaterialId';
  IF NOT FOUND THEN RAISE EXCEPTION 'Recuperación sin pertenencia vigente; requiere conciliación.'; END IF;
  oldrow:=src->'periods'->pi->'rows'->ri;
  IF oldrow IS DISTINCT FROM r.base->'before' OR r.payload->'before' IS DISTINCT FROM oldrow OR (src->>'version')::int IS DISTINCT FROM (r.base->>'planVersion')::int THEN RAISE EXCEPTION 'La evidencia de una recuperación autorizada cambió. Requiere conciliación; no se omite su resultado.'; END IF;
  updated:=r.payload->'after'||jsonb_build_object('recoveryOrdinary',coalesce(oldrow->'recoveryOrdinary',jsonb_build_object('original',oldrow->'original','official',oldrow->'official','result',oldrow->'result')),'recoveryCalls',coalesce(oldrow->'recoveryCalls','[]'::jsonb)||jsonb_build_array(r.convocatoria_id::text));
  src:=jsonb_set(src,ARRAY['periods',pi::text,'rows',ri::text],updated,false);
 END LOOP;
 SELECT coalesce(jsonb_agg(DISTINCT rr.materia_clave ORDER BY rr.materia_clave),'[]'::jsonb) INTO pending FROM public.jaguar360_recuperaciones rr JOIN public.jaguar360_convocatorias c ON c.id=rr.convocatoria_id WHERE rr.ciclo=p_ciclo AND rr.alumno_id=p_alumno AND rr.estado IN ('reservada','evaluada') AND c.estado='autorizada_para_planeacion';
 RETURN src||jsonb_build_object('pendingRecovery',pending);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_fuentes_selladas(uuid,text,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_fuentes_selladas(uuid,text,bigint) TO service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_recuperacion_contexto(p_actor uuid,p_call bigint,p_alumno bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.jaguar360_convocatorias; src jsonb; rec jsonb; target jsonb; mat jsonb; targetcount int; per int; used int; occupied int; hist jsonb; fp text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('direccion_escolar','coordinacion_academica','control_escolar','control')) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.jaguar360_convocatorias WHERE id=p_call AND reglas->>'kind'='recovery';
 IF NOT FOUND THEN RAISE EXCEPTION 'Convocatoria inexistente.'; END IF;
 src:=public.jaguar360_fuentes_selladas(p_actor,c.ciclo,p_alumno); per:=(c.reglas->'blocks'->0->>'period')::int;
 SELECT v INTO mat FROM jsonb_array_elements(src->'plan'->'curriculum') v WHERE v->>'key'=c.reglas->>'subjectKey';
 SELECT count(*) INTO targetcount FROM jsonb_array_elements(src->'periods') p CROSS JOIN LATERAL jsonb_array_elements(p->'rows') r WHERE p->>'number'=per::text AND p->>'verified'='true' AND r->>'subjectId'=mat->>'legacyId' AND r->>'grade'=mat->>'grade' AND r->>'evaluation'=mat->>'evaluation';
 IF targetcount=1 THEN SELECT r INTO target FROM jsonb_array_elements(src->'periods') p CROSS JOIN LATERAL jsonb_array_elements(p->'rows') r WHERE p->>'number'=per::text AND p->>'verified'='true' AND r->>'subjectId'=mat->>'legacyId' AND r->>'grade'=mat->>'grade' AND r->>'evaluation'=mat->>'evaluation'; END IF;
 SELECT jsonb_build_object('id',r.id::text,'state',r.estado,'version',r.version,'payload',r.payload,'base',r.base) INTO rec FROM public.jaguar360_recuperaciones r WHERE convocatoria_id=p_call AND alumno_id=p_alumno;
 SELECT count(*) INTO used FROM public.jaguar360_recuperaciones WHERE ciclo=c.ciclo AND materia_clave=c.reglas->>'subjectKey' AND periodo=per AND alumno_id=p_alumno AND estado='autorizada';
 SELECT count(*) INTO occupied FROM public.jaguar360_recuperaciones WHERE convocatoria_id=p_call AND estado NOT IN ('cancelada','rechazada');
 SELECT coalesce(jsonb_agg(to_jsonb(e)-'recuperacion_id' ORDER BY e.version),'[]'::jsonb) INTO hist FROM public.jaguar360_recuperacion_eventos e JOIN public.jaguar360_recuperaciones r ON r.id=e.recuperacion_id WHERE r.convocatoria_id=p_call AND r.alumno_id=p_alumno;
 fp:=md5(jsonb_build_object('call',to_jsonb(c),'planVersion',src->'version','target',target,'record',rec,'used',used,'occupied',occupied)::text);
 RETURN jsonb_build_object('call',(to_jsonb(c)-'id')||jsonb_build_object('id',c.id::text),'source',src,'target',target,'record',rec,'history',hist,'usedAttempts',used,'reserved',occupied,'capacity',(c.reglas->>'capacity')::int,'fingerprint',fp);
END $$;
CREATE OR REPLACE FUNCTION public.jaguar360_recuperacion_mover(p_actor uuid,p_call bigint,p_alumno bigint,p_accion text,p_huella text,p_payload jsonb,p_referencia text,p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; c public.jaguar360_convocatorias; r public.jaguar360_recuperaciones; ctx jsonb; per int; today date:=(now() AT TIME ZONE 'America/Mexico_City')::date; k text; base jsonb; oldrow jsonb; newrow jsonb;
BEGIN
 -- Exclusive lock on rectifications also serializes against existing recourse, continuity, egresos and reenrollment writers that take SHARE on it.
 LOCK TABLE public.perfiles,public.alumnos,public.periodos_escolares,public.jaguar360_planes_ciclo,public.jaguar360_cierres_periodo,public.jaguar360_rectificacion_resoluciones,public.jaguar360_convocatorias,public.jaguar360_reservas_recursamiento,public.jaguar360_egresos,public.jaguar360_reinscripciones IN SHARE MODE NOWAIT;
 LOCK TABLE public.jaguar360_rectificaciones,public.jaguar360_recuperaciones,public.jaguar360_recuperacion_eventos IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 SELECT rol INTO a FROM public.perfiles WHERE id=p_actor AND activo IS TRUE;
 IF NOT FOUND OR p_accion IS NULL OR p_accion NOT IN ('reservar','cancelar','evaluar','autorizar','rechazar') OR (p_accion IN ('autorizar','rechazar') AND a.rol<>'direccion_escolar') OR (p_accion IN ('reservar','cancelar','evaluar') AND a.rol<>'coordinacion_academica') THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF p_referencia IS NULL OR char_length(btrim(p_referencia)) NOT BETWEEN 5 AND 300 OR p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500 OR p_huella IS NULL OR p_huella !~ '^[a-f0-9]{32}$' OR coalesce(octet_length(p_payload::text),0)>200000 THEN RAISE EXCEPTION 'Motivo, referencia o evidencia inválidos.'; END IF;
 ctx:=public.jaguar360_recuperacion_contexto(p_actor,p_call,p_alumno);
 IF ctx->>'fingerprint' IS DISTINCT FROM p_huella THEN RAISE EXCEPTION 'Cambió la evidencia; vuelve a consultar.'; END IF;
 SELECT * INTO c FROM public.jaguar360_convocatorias WHERE id=p_call; k:=c.reglas->>'subjectKey'; per:=(c.reglas->'blocks'->0->>'period')::int;
 SELECT * INTO r FROM public.jaguar360_recuperaciones WHERE convocatoria_id=p_call AND alumno_id=p_alumno;
 IF p_accion NOT IN ('cancelar','rechazar') AND (c.estado<>'autorizada_para_planeacion' OR c.plan_version::text IS DISTINCT FROM ctx->'source'->>'version' OR ctx->'target'='null'::jsonb OR EXISTS(SELECT 1 FROM public.jaguar360_reservas_recursamiento WHERE ciclo=c.ciclo AND alumno_id=p_alumno AND materia_clave=k AND estado='reservada') OR EXISTS(SELECT 1 FROM public.jaguar360_egresos WHERE alumno_id=p_alumno AND ciclo=c.ciclo) OR EXISTS(SELECT 1 FROM public.jaguar360_reinscripciones WHERE alumno_id=p_alumno AND ciclo_origen=c.ciclo)) THEN RAISE EXCEPTION 'Convocatoria, pertenencia o trayectoria incompatible; requiere revisión.'; END IF;
 IF p_accion='reservar' THEN
  IF r.id IS NOT NULL OR today>=(c.reglas->>'start')::date OR (ctx->>'usedAttempts')::int >= (c.reglas->>'attempts')::int OR (ctx->>'reserved')::int >= (c.reglas->>'capacity')::int OR EXISTS(SELECT 1 FROM public.jaguar360_recuperaciones WHERE ciclo=c.ciclo AND materia_clave=k AND periodo=per AND alumno_id=p_alumno AND estado IN ('reservada','evaluada')) OR p_payload->'before' IS DISTINCT FROM ctx->'target' OR p_payload->>'subjectKey' IS DISTINCT FROM k OR p_payload->>'period' IS DISTINCT FROM per::text THEN RAISE EXCEPTION 'Cupo, intento, fecha o evidencia incompatible.'; END IF;
  base:=p_payload||jsonb_build_object('planVersion',c.plan_version);
  INSERT INTO public.jaguar360_recuperaciones(convocatoria_id,alumno_id,ciclo,materia_clave,periodo,estado,base) VALUES(p_call,p_alumno,c.ciclo,k,per,'reservada',base) RETURNING * INTO r;
 ELSIF p_accion='cancelar' THEN
  IF r.estado IS DISTINCT FROM 'reservada' OR (today>=(c.reglas->>'start')::date AND c.estado<>'cancelada') THEN RAISE EXCEPTION 'Solo se cancela una reserva antes del inicio o por cancelación institucional.'; END IF;
  UPDATE public.jaguar360_recuperaciones SET estado='cancelada',version=version+1 WHERE id=r.id RETURNING * INTO r;
 ELSIF p_accion='rechazar' THEN
  IF r.estado IS DISTINCT FROM 'evaluada' OR r.evaluador=p_actor THEN RAISE EXCEPTION 'Se requiere revisión independiente de un resultado.'; END IF;
  UPDATE public.jaguar360_recuperaciones SET estado='rechazada',version=version+1 WHERE id=r.id RETURNING * INTO r;
 ELSE
  IF today<=(c.reglas->>'end')::date OR r.id IS NULL OR r.base->'before' IS DISTINCT FROM ctx->'target' OR (ctx->>'usedAttempts')::int >= (c.reglas->>'attempts')::int OR p_payload->'before' IS DISTINCT FROM ctx->'target' OR p_payload->>'subjectKey' IS DISTINCT FROM k OR p_payload->>'period' IS DISTINCT FROM per::text OR p_payload->>'official' IS DISTINCT FROM 'false' OR p_payload->'evaluation'->>'consumesAttempt' IS DISTINCT FROM 'true' OR p_payload->>'usedAttempts' IS DISTINCT FROM ctx->>'usedAttempts' THEN RAISE EXCEPTION 'Falta evidencia vigente o intento disponible.'; END IF;
  oldrow:=p_payload->'before'; newrow:=p_payload->'after';
  IF jsonb_typeof(newrow) IS DISTINCT FROM 'object' OR (newrow-'original'-'official'-'result') IS DISTINCT FROM (oldrow-'original'-'official'-'result') THEN RAISE EXCEPTION 'No se altera la pertenencia ni asistencia ordinaria.'; END IF;
  IF oldrow->>'evaluation'='numerica' AND (jsonb_typeof(newrow->'original') IS DISTINCT FROM 'number' OR jsonb_typeof(newrow->'official') IS DISTINCT FROM 'number' OR (newrow->>'original')::numeric NOT BETWEEN (oldrow->>'original')::numeric AND 10 OR (newrow->>'official')::numeric NOT BETWEEN (oldrow->>'official')::numeric AND 10 OR newrow->'result' IS DISTINCT FROM oldrow->'result') THEN RAISE EXCEPTION 'Nota incompatible.'; END IF;
  IF oldrow->>'evaluation'='cualitativa' AND (newrow->>'result' IS NULL OR newrow->>'result' NOT IN ('AP','RP') OR (oldrow->>'result'='AP' AND newrow->>'result'<>'AP') OR newrow->'original' IS DISTINCT FROM oldrow->'original' OR newrow->'official' IS DISTINCT FROM oldrow->'official') THEN RAISE EXCEPTION 'Resultado AP/RP incompatible.'; END IF;
  IF p_accion='evaluar' THEN
   IF r.estado IS DISTINCT FROM 'reservada' THEN RAISE EXCEPTION 'Reserva no disponible para evaluación.'; END IF;
   UPDATE public.jaguar360_recuperaciones SET estado='evaluada',version=version+1,payload=p_payload,evaluador=p_actor WHERE id=r.id RETURNING * INTO r;
  ELSE
   IF r.estado IS DISTINCT FROM 'evaluada' OR r.evaluador=p_actor OR p_payload IS DISTINCT FROM r.payload THEN RAISE EXCEPTION 'Resultado no vigente o sin revisión independiente.'; END IF;
   UPDATE public.jaguar360_recuperaciones SET estado='autorizada',version=version+1 WHERE id=r.id RETURNING * INTO r;
  END IF;
 END IF;
 INSERT INTO public.jaguar360_recuperacion_eventos(recuperacion_id,version,estado,actor_id,cargo,referencia,motivo) VALUES(r.id,r.version,r.estado,p_actor,a.rol,btrim(p_referencia),btrim(p_motivo));
 RETURN public.jaguar360_recuperacion_contexto(p_actor,p_call,p_alumno);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_recuperacion_contexto(uuid,bigint,bigint),public.jaguar360_recuperacion_mover(uuid,bigint,bigint,text,text,jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_recuperacion_contexto(uuid,bigint,bigint),public.jaguar360_recuperacion_mover(uuid,bigint,bigint,text,text,jsonb,text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_guardar_reserva_sin_recuperacion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.estado='reservada' AND EXISTS(SELECT 1 FROM public.jaguar360_recuperaciones r JOIN public.jaguar360_convocatorias c ON c.id=r.convocatoria_id WHERE r.ciclo=NEW.ciclo AND r.alumno_id=NEW.alumno_id AND r.materia_clave=NEW.materia_clave AND r.estado IN ('reservada','evaluada') AND c.estado='autorizada_para_planeacion') THEN RAISE EXCEPTION 'Existe recuperación pendiente para esta asignatura.'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_guardar_reserva_sin_recuperacion() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS j360_recuperacion_pendiente ON public.jaguar360_reservas_recursamiento;
CREATE TRIGGER j360_recuperacion_pendiente BEFORE INSERT OR UPDATE ON public.jaguar360_reservas_recursamiento FOR EACH ROW EXECUTE FUNCTION public.jaguar360_guardar_reserva_sin_recuperacion();
COMMIT;
NOTIFY pgrst,'reload schema';
