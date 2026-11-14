BEGIN;
-- Import only the first proposed session evidence of a future period. Never infer attendance.
CREATE TABLE IF NOT EXISTS public.jaguar360_calendario_evidencia (
 calendario_id bigint PRIMARY KEY REFERENCES public.jaguar360_calendarios_propuestos(id) ON DELETE RESTRICT,
 periodo_id bigint NOT NULL UNIQUE REFERENCES public.periodos_escolares(id) ON DELETE RESTRICT,
 evidencia_id bigint NOT NULL UNIQUE REFERENCES public.jaguar360_evidencias_periodo(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL, creado_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.jaguar360_calendario_evidencia ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_calendario_evidencia FROM PUBLIC,anon,authenticated,service_role;
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
 -- The existing RPC validates every row, duplicate, overlap and reference; its review remains independent.
 outrow:=public.jaguar360_registrar_evidencia(p_actor,pe.id,'sesiones',0,'proponer',p_contenido,p_motivo);
 INSERT INTO public.jaguar360_calendario_evidencia(calendario_id,periodo_id,evidencia_id,actor_id) VALUES(c.id,pe.id,(outrow->>'id')::bigint,p_actor);
 RETURN outrow||jsonb_build_object('periodId',pe.id::text,'calendarId',c.id::text,'official',false);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_importar_calendario(uuid,text,bigint,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_importar_calendario(uuid,text,bigint,text,jsonb,text) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
