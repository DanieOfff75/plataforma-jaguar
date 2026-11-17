-- Después de V44; primero en copia aislada. No transforma registros escolares.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar_nexo_memoria_docente (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 docente_id bigint NOT NULL REFERENCES public.docentes(id) ON DELETE RESTRICT,
 grupo_materia_id bigint NOT NULL REFERENCES public.grupo_materias(id) ON DELETE RESTRICT,
 materia_id bigint NOT NULL REFERENCES public.materias(id) ON DELETE RESTRICT,
 materia_nombre text NOT NULL,
 compartir text NOT NULL DEFAULT 'privada' CHECK(compartir IN ('privada','solicitada','aprobada','rechazada')),
 revisada_por uuid,revisada_en timestamptz,
 ciclo text NOT NULL CHECK(ciclo ~ '^[0-9]{4}-[0-9]{4}$'),
 tema text NOT NULL CHECK(char_length(tema) BETWEEN 3 AND 180),
 extracto text NOT NULL CHECK(char_length(extracto) BETWEEN 10 AND 1800),
 tipo text NOT NULL CHECK(tipo IN ('reflexion','planeacion')),
 planeacion_id bigint REFERENCES public.planeaciones_docentes(id) ON DELETE RESTRICT,
 fecha timestamptz NOT NULL DEFAULT now(),retirado_en timestamptz,
 CHECK ((tipo='planeacion')=(planeacion_id IS NOT NULL))
);
ALTER TABLE public.jaguar_nexo_memoria_docente ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar_nexo_memoria_docente FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.jaguar_nexo_memoria_docente TO service_role;
REVOKE ALL ON SEQUENCE public.jaguar_nexo_memoria_docente_id_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SEQUENCE public.jaguar_nexo_memoria_docente_id_seq TO service_role;
CREATE INDEX IF NOT EXISTS jnexo_memoria_busqueda ON public.jaguar_nexo_memoria_docente(docente_id,grupo_materia_id,ciclo,fecha DESC) WHERE retirado_en IS NULL;
CREATE INDEX IF NOT EXISTS jnexo_memoria_compartida ON public.jaguar_nexo_memoria_docente(materia_id,ciclo,fecha DESC) WHERE compartir='aprobada' AND retirado_en IS NULL;
CREATE TABLE IF NOT EXISTS public.jaguar_nexo_curriculo (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 materia_id bigint NOT NULL REFERENCES public.materias(id) ON DELETE RESTRICT,
 materia_nombre text NOT NULL,ciclo text NOT NULL CHECK(ciclo ~ '^[0-9]{4}-[0-9]{4}$'),
 fuente_id text NOT NULL,nivel text NOT NULL,programa text NOT NULL,grado text NOT NULL,
 edicion text NOT NULL,localizador text NOT NULL,objetivo text NOT NULL CHECK(char_length(objetivo) BETWEEN 10 AND 1800),
 actor_id uuid NOT NULL,validada_en timestamptz NOT NULL DEFAULT now(),retirada_en timestamptz,retirada_por uuid
);
ALTER TABLE public.jaguar_nexo_curriculo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar_nexo_curriculo FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.jaguar_nexo_curriculo TO service_role;
REVOKE ALL ON SEQUENCE public.jaguar_nexo_curriculo_id_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SEQUENCE public.jaguar_nexo_curriculo_id_seq TO service_role;
CREATE INDEX IF NOT EXISTS jnexo_curriculo_idx ON public.jaguar_nexo_curriculo(ciclo,materia_id) WHERE retirada_en IS NULL;
CREATE OR REPLACE FUNCTION public.jaguar_nexo_corte_v45(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE r text; p public.periodos_escolares; n integer; t bigint; o jsonb; lo date; hi date;
BEGIN
 IF current_user <> 'service_role' THEN RAISE EXCEPTION 'Acceso exclusivo servidor' USING ERRCODE='42501'; END IF;
 SELECT rol INTO r FROM public.perfiles WHERE id=p_actor AND activo IS TRUE;
 IF r IS NULL OR r NOT IN ('direccion_escolar','control_escolar','control','coordinacion_academica','servicios_docentes','servicios_estudiantiles','prefectura','docente','archivo_escolar','recursos_monetarios','tecnico') THEN RAISE EXCEPTION 'Sin atribución' USING ERRCODE='42501'; END IF;
 IF r='tecnico' THEN
 RETURN jsonb_build_object('ciclo','Diagnóstico técnico','periodo',NULL,'fecha',now(),'objetos_faltantes',(SELECT count(*) FROM (VALUES (to_regclass('public.jaguar_nexo_memoria_docente') IS NULL),(to_regclass('public.jaguar_nexo_curriculo') IS NULL),(to_regprocedure('public.jaguar360_registrar_plan(uuid,text,integer,text,jsonb,text)') IS NULL),(to_regprocedure('public.jaguar360_verificar_cierre(uuid,bigint,text,text)') IS NULL),(to_regprocedure('public.jaguar360_cierre_periodo(uuid,bigint,integer,text,text)') IS NULL),(to_regprocedure('public.jaguar360_boleta_bloqueos(bigint,text)') IS NULL)) v(falta) WHERE falta)); END IF;
 SELECT count(*) INTO n FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE;
 IF n<>1 THEN RAISE EXCEPTION 'Periodo actual inexistente o ambiguo'; END IF;
 SELECT * INTO p FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE;
 IF p.activo IS DISTINCT FROM TRUE OR p.ciclo_escolar IS NULL OR p.ciclo_escolar !~ '^[0-9]{4}-[0-9]{4}$' THEN RAISE EXCEPTION 'Periodo actual no válido'; END IF;
 o:=jsonb_build_object('ciclo',p.ciclo_escolar,'periodo',p.numero_periodo,'fecha',now());
 IF r IN ('direccion_escolar','control_escolar','control','prefectura','servicios_estudiantiles') THEN
 WITH a AS (SELECT g.turno FROM public.alumnos a JOIN public.grupos g ON g.id=a.grupo_id AND g.activo WHERE a.activo AND coalesce(a.estado_escolar,'activo') NOT IN ('archivado','baja','traslado','egresado','inactivo')), b AS (SELECT CASE lower(turno) WHEN 'matutino' THEN 'matutino' WHEN 'vespertino' THEN 'vespertino' ELSE 'sin_clasificar' END turno,count(*) cantidad FROM a GROUP BY 1)
 SELECT o||jsonb_build_object('alumnos',(SELECT count(*) FROM a),'por_turno',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY turno) FROM b),'[]'::jsonb)) INTO o;
 END IF;
 IF r IN ('direccion_escolar','control_escolar','control','prefectura','servicios_estudiantiles','coordinacion_academica') THEN o:=o||jsonb_build_object('grupos',(SELECT count(*) FROM public.grupos WHERE activo)); END IF;
 IF r IN ('direccion_escolar','control_escolar','control','coordinacion_academica') THEN
 o:=o||jsonb_build_object('materias',(SELECT count(*) FROM public.materias WHERE activa),'periodos_conflictivos',(SELECT count(*) FROM public.periodos_escolares x WHERE x.ciclo_escolar=p.ciclo_escolar AND (x.numero_periodo IS NULL OR x.numero_periodo<1 OR x.fecha_inicio IS NULL OR x.fecha_fin IS NULL OR x.fecha_fin<x.fecha_inicio OR EXISTS(SELECT 1 FROM public.periodos_escolares y WHERE y.ciclo_escolar=x.ciclo_escolar AND y.id<>x.id AND y.numero_periodo=x.numero_periodo))),'notas_registradas',(SELECT count(*) FROM public.calificaciones WHERE periodo_id=p.id AND calificacion IS NOT NULL));
 o:=o||jsonb_build_object('notas_por_periodo',coalesce((SELECT jsonb_agg(jsonb_build_object('periodo',z.numero_periodo,'cantidad',z.cantidad) ORDER BY z.numero_periodo) FROM (SELECT pe.numero_periodo,count(c.id) cantidad FROM public.periodos_escolares pe LEFT JOIN public.calificaciones c ON c.periodo_id=pe.id AND c.calificacion IS NOT NULL WHERE pe.ciclo_escolar=p.ciclo_escolar AND pe.numero_periodo BETWEEN 1 AND 6 GROUP BY pe.numero_periodo HAVING count(DISTINCT pe.id)=1) z),'[]'::jsonb));
 END IF;
 IF r IN ('direccion_escolar','servicios_docentes','coordinacion_academica') THEN
 o:=o||jsonb_build_object('docentes',(SELECT count(*) FROM public.docentes WHERE activo AND coalesce(estado_profesional,'activo') NOT IN ('archivado','baja','inactivo')),'sin_docente',(SELECT count(*) FROM public.grupo_materias gm JOIN public.grupos g ON g.id=gm.grupo_id AND g.activo JOIN public.materias m ON m.id=gm.materia_id AND m.activa WHERE gm.activo AND NOT EXISTS(SELECT 1 FROM public.asignaciones_docentes a JOIN public.docentes d ON d.id=a.docente_id AND d.activo AND coalesce(d.estado_profesional,'activo') NOT IN ('archivado','baja','inactivo') WHERE a.grupo_materia_id=gm.id AND a.activo AND a.ciclo_escolar=p.ciclo_escolar)),'planeaciones',(SELECT count(*) FROM public.planeaciones_docentes WHERE ciclo_escolar=p.ciclo_escolar),'planeaciones_revision',(SELECT count(*) FROM public.planeaciones_docentes WHERE ciclo_escolar=p.ciclo_escolar AND estado='enviada'));
 END IF;
 IF r IN ('direccion_escolar','control_escolar','control','coordinacion_academica','servicios_docentes','servicios_estudiantiles','prefectura') THEN
 o:=o||jsonb_build_object('solicitudes',(SELECT count(*) FROM public.solicitudes_estudiantiles s WHERE s.estado='pendiente' AND s.tipo IN ('grupo','grado','turno','taller','otro') AND (r='direccion_escolar' OR (r IN ('control_escolar','control') AND s.tipo='grupo') OR (r='servicios_estudiantiles' AND s.tipo IN ('grado','turno','taller')) OR (s.tipo='otro' AND s.departamento_destino=CASE WHEN r='control' THEN 'control_escolar' ELSE r END)))); END IF;
 IF r IN ('direccion_escolar','prefectura') THEN SELECT min(fecha_inicio),max(fecha_fin) INTO lo,hi FROM public.periodos_escolares WHERE ciclo_escolar=p.ciclo_escolar; IF lo IS NOT NULL AND hi>=lo THEN o:=o||jsonb_build_object('incidencias',(SELECT count(*) FROM public.incidencias_prefectura WHERE fecha BETWEEN lo AND hi)); END IF; END IF;
 IF r IN ('direccion_escolar','archivo_escolar') THEN o:=o||jsonb_build_object('archivo_pendiente',(SELECT count(*) FROM public.solicitudes_archivo_escolar WHERE estado='pendiente')); END IF;
 IF r IN ('direccion_escolar','recursos_monetarios') THEN o:=o||jsonb_build_object('pagos_registrados',(SELECT count(*) FROM public.recursos_pagos WHERE ciclo_escolar=p.ciclo_escolar)); END IF;
 IF r='docente' THEN SELECT id INTO STRICT t FROM public.docentes WHERE auth_user_id=p_actor AND activo AND coalesce(estado_profesional,'activo') NOT IN ('archivado','baja','inactivo');
 o:=o||jsonb_build_object('asignaciones',(SELECT count(DISTINCT grupo_materia_id) FROM public.asignaciones_docentes WHERE docente_id=t AND activo AND ciclo_escolar=p.ciclo_escolar),'planeaciones',(SELECT count(*) FROM public.planeaciones_docentes WHERE docente_id=t AND ciclo_escolar=p.ciclo_escolar),'notas_registradas',(SELECT count(*) FROM public.calificaciones c WHERE c.periodo_id=p.id AND c.calificacion IS NOT NULL AND EXISTS(SELECT 1 FROM public.asignaciones_docentes a WHERE a.docente_id=t AND a.activo AND a.ciclo_escolar=p.ciclo_escolar AND a.grupo_materia_id=c.grupo_materia_id))); END IF;
 RETURN o;
END $$;
REVOKE ALL ON FUNCTION public.jaguar_nexo_corte_v45(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar_nexo_corte_v45(uuid) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
