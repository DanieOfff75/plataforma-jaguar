-- V7. Proyección desde evidencias verificadas, convocatoria versionada y consulta de cargas.
-- No activa políticas, no cierra periodos, no matricula ni altera calificaciones u horarios.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar360_convocatorias (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 ciclo text NOT NULL, plan_version integer NOT NULL,
 nombre text NOT NULL CHECK(char_length(nombre) BETWEEN 1 AND 100),
 estado text NOT NULL CHECK(estado IN ('propuesta','autorizada_para_planeacion','cancelada')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 reglas jsonb NOT NULL CHECK(jsonb_typeof(reglas)='object'),
 actor_id uuid NOT NULL, actor_nombre text NOT NULL,
 creado_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(ciclo,nombre), FOREIGN KEY(ciclo,plan_version) REFERENCES public.jaguar360_planes_ciclo(ciclo,version) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS public.jaguar360_convocatoria_eventos (
 convocatoria_id bigint NOT NULL REFERENCES public.jaguar360_convocatorias(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version>0), estado text NOT NULL,
 actor_id uuid NOT NULL, actor_nombre text NOT NULL, actor_cargo text NOT NULL,
 motivo text NOT NULL CHECK(char_length(motivo) BETWEEN 15 AND 1500), creado_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(convocatoria_id,version)
);
ALTER TABLE public.jaguar360_convocatorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar360_convocatoria_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_convocatorias,public.jaguar360_convocatoria_eventos FROM PUBLIC,anon,authenticated,service_role;
-- No direct SELECT, use role-checked RPC. Functions are not callable by browser JWTs.
CREATE OR REPLACE FUNCTION public.jaguar360_consultar_convocatorias(p_actor uuid,p_ciclo text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('direccion_escolar','coordinacion_academica','control_escolar','control')) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg((to_jsonb(c)-'id')||jsonb_build_object('id',c.id::text,'eventos',coalesce((SELECT jsonb_agg(to_jsonb(e)-'convocatoria_id' ORDER BY e.version) FROM public.jaguar360_convocatoria_eventos e WHERE e.convocatoria_id=c.id),'[]'::jsonb)) ORDER BY c.id DESC) FROM (SELECT * FROM public.jaguar360_convocatorias WHERE ciclo=p_ciclo ORDER BY id DESC LIMIT 100) c),'[]'::jsonb);
END $$;
CREATE OR REPLACE FUNCTION public.jaguar360_registrar_convocatoria(p_actor uuid,p_ciclo text,p_plan_version integer,p_accion text,p_id bigint,p_version integer,p_reglas jsonb,p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; plan jsonb; pol jsonb; mat jsonb; r jsonb; b jsonb; c public.jaguar360_convocatorias; kind text; template text; label text; periods integer; min_grade numeric; seen integer[]:=ARRAY[]::integer[]; n integer; seq bigint; token text;
BEGIN
 SELECT id,rol,nombre_completo INTO a FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol='coordinacion_academica';
 IF NOT FOUND THEN RAISE EXCEPTION 'Solo Coordinación gestiona convocatorias.' USING ERRCODE='42501'; END IF;
 IF p_ciclo IS NULL OR p_ciclo !~ '^[0-9]{4}-[0-9]{4}$' OR p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Ciclo o motivo inválido.'; END IF;
 -- Serialize naming and transitions against the same cycle's planning operations.
 PERFORM pg_advisory_xact_lock(hashtext('jaguar360-plan:'||p_ciclo));
 IF p_accion='proponer' THEN
  IF p_id IS NOT NULL OR p_version IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Propuesta inválida.'; END IF;
  SELECT t.plan INTO plan FROM public.jaguar360_planes_ciclo t WHERE t.ciclo=p_ciclo AND t.version=p_plan_version AND t.estado='validada_para_planificacion' AND t.version=(SELECT max(v.version) FROM public.jaguar360_planes_ciclo v WHERE v.ciclo=p_ciclo AND v.estado='validada_para_planificacion');
  IF NOT FOUND THEN RAISE EXCEPTION 'Selecciona la última versión validada del ciclo.'; END IF;
  pol:=plan->'policy'; periods:=(pol->>'periods')::integer; min_grade:=(pol->>'minimum')::numeric;
  r:=p_reglas; kind:=r->>'kind';
  SELECT value INTO mat FROM jsonb_array_elements(plan->'curriculum') WHERE value->>'key'=r->>'subjectKey';
  IF NOT FOUND OR mat->>'evaluation' NOT IN ('numerica','cualitativa') OR coalesce(kind,'') NOT IN ('recovery','recourse') OR jsonb_typeof(r) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Asignatura o tipo inválido.'; END IF;
  IF r->>'start' IS NULL OR r->>'end' IS NULL OR (r->>'start')::date>(r->>'end')::date OR (r->>'start')::date<=(now() AT TIME ZONE 'America/Mexico_City')::date OR (r->>'start')::date<(substring(p_ciclo,1,4)||'-01-01')::date THEN RAISE EXCEPTION 'Fechas inválidas o anteriores a hoy.'; END IF;
  IF jsonb_typeof(r->'blocks') IS DISTINCT FROM 'array' OR jsonb_array_length(r->'blocks') NOT BETWEEN 1 AND periods OR (kind='recovery' AND jsonb_array_length(r->'blocks')<>1) THEN RAISE EXCEPTION 'Bloques inválidos.'; END IF;
  FOR b IN SELECT value FROM jsonb_array_elements(r->'blocks') LOOP
   IF jsonb_typeof(b->'period') IS DISTINCT FROM 'number' OR jsonb_typeof(b->'minutes') IS DISTINCT FROM 'number' OR (b->>'period')::numeric<>trunc((b->>'period')::numeric) OR (b->>'minutes')::numeric<>trunc((b->>'minutes')::numeric) OR (b->>'minutes')::numeric NOT BETWEEN 1 AND 525600 THEN RAISE EXCEPTION 'Bloque inválido.'; END IF;
   n:=(b->>'period')::integer; IF n NOT BETWEEN 1 AND periods OR n=ANY(seen) THEN RAISE EXCEPTION 'Periodo objetivo inválido o repetido.'; END IF; seen:=array_append(seen,n);
  END LOOP;
  IF jsonb_typeof(r->'attendancePct') IS DISTINCT FROM 'number' OR (r->>'attendancePct')::numeric NOT BETWEEN 0 AND 100 OR jsonb_typeof(r->'capacity') IS DISTINCT FROM 'number' OR (r->>'capacity')::numeric<>trunc((r->>'capacity')::numeric) OR (r->>'capacity')::numeric NOT BETWEEN 1 AND 1000 OR jsonb_typeof(r->'attempts') IS DISTINCT FROM 'number' OR (r->>'attempts')::numeric<>trunc((r->>'attempts')::numeric) OR (r->>'attempts')::numeric NOT BETWEEN 1 AND 10 OR coalesce(r->>'eligibility','') NOT IN ('failed','improve') OR coalesce(r->>'teacherMode','') NOT IN ('holder','support','either') OR coalesce(r->>'turn','') NOT IN ('MATUTINO','VESPERTINO') OR r->>'modality' IS NULL OR char_length(btrim(r->>'modality')) NOT BETWEEN 3 AND 120 THEN RAISE EXCEPTION 'Reglas de convocatoria inválidas.'; END IF;
  IF mat->>'evaluation'='cualitativa' THEN
   IF r->>'method' IS DISTINCT FROM 'qualitative' OR r->>'cap' IS NOT NULL THEN RAISE EXCEPTION 'AP/RP no admite tope numérico.'; END IF;
  ELSE
   IF coalesce(r->>'method','') NOT IN ('direct','proportional') OR jsonb_typeof(r->'cap') IS DISTINCT FROM 'number' OR (r->>'cap')::numeric NOT BETWEEN min_grade AND 10 THEN RAISE EXCEPTION 'Escala inválida.'; END IF;
  END IF;
  IF kind='recourse' AND ((r->>'attempts')::numeric<>1 OR r->>'eligibility'<>'failed' OR r->>'teacherMode'<>'support' OR (mat->>'evaluation'='numerica' AND (r->>'method' IS DISTINCT FROM pol->>'recourseMethod' OR (r->>'cap')::numeric IS DISTINCT FROM (pol->>'recourseCap')::numeric))) THEN RAISE EXCEPTION 'El recursamiento debe respetar la política del ciclo, un intento y docente de apoyo.'; END IF;
  -- Keep only fields of the validated contract. No private free-form payload.
  r:=jsonb_build_object('kind',kind,'subjectKey',mat->>'key','start',r->>'start','end',r->>'end','blocks', (SELECT jsonb_agg(jsonb_build_object('period',(z->>'period')::int,'minutes',(z->>'minutes')::int) ORDER BY (z->>'period')::int) FROM jsonb_array_elements(r->'blocks') z),'method',r->>'method','cap',r->'cap','attendancePct',r->'attendancePct','capacity',r->'capacity','attempts',r->'attempts','eligibility',r->>'eligibility','teacherMode',r->>'teacherMode','letter',r->>'letter','turn',r->>'turn','modality',btrim(r->>'modality'));
  template:=pol->>(CASE WHEN kind='recovery' THEN 'recoveryTemplate' ELSE 'recourseTemplate' END);
  IF r->>'letter' IS NOT NULL AND r->>'letter' !~ '^[A-Z]$' OR position('{LETRA}' IN template)>0 AND r->>'letter' IS NULL THEN RAISE EXCEPTION 'Letra inválida para la nomenclatura.'; END IF;
  SELECT count(*)+1 INTO seq FROM public.jaguar360_convocatorias WHERE ciclo=p_ciclo;
  label:=template;
  label:=replace(label,'{TIPO}',CASE WHEN kind='recovery' THEN 'RE' ELSE 'RC' END);
  label:=replace(label,'{MATERIA}',mat->>'key'); label:=replace(label,'{GRADO}',mat->>'grade');
  label:=replace(label,'{PERIODO}',array_to_string(ARRAY(SELECT unnest(seen) ORDER BY 1),'-'));
  label:=replace(label,'{LETRA}',coalesce(r->>'letter',''));label:=replace(label,'{TURNO}',r->>'turn');label:=replace(label,'{CICLO}',p_ciclo);
  label:=replace(label,'{CONSECUTIVO}',lpad(seq::text,greatest(3,length(seq::text)),'0'));
  IF label IS NULL OR label !~ '^[A-Z0-9_ -]{1,100}$' THEN RAISE EXCEPTION 'Plantilla no resoluble. Revisa las variables de nombre.'; END IF;
  IF EXISTS(SELECT 1 FROM public.jaguar360_convocatorias WHERE ciclo=p_ciclo AND nombre=label) THEN RAISE EXCEPTION 'Nombre repetido; utiliza una plantilla con consecutivo.'; END IF;
  INSERT INTO public.jaguar360_convocatorias(ciclo,plan_version,nombre,estado,reglas,actor_id,actor_nombre) VALUES(p_ciclo,p_plan_version,label,'propuesta',r,p_actor,coalesce(a.nombre_completo,'Sin nombre')) RETURNING * INTO c;
 ELSIF p_accion IN ('autorizar','cancelar') THEN
  SELECT * INTO c FROM public.jaguar360_convocatorias WHERE id=p_id AND ciclo=p_ciclo FOR UPDATE;
  IF NOT FOUND OR c.version IS DISTINCT FROM p_version OR c.estado='cancelada' THEN RAISE EXCEPTION 'Convocatoria inexistente o versión desactualizada.'; END IF;
  IF (c.reglas->>'start')::date<=(now() AT TIME ZONE 'America/Mexico_City')::date THEN RAISE EXCEPTION 'No se modifica una convocatoria iniciada; requiere otro procedimiento con Dirección.'; END IF;
  IF p_accion='autorizar' AND (c.estado<>'propuesta' OR c.plan_version IS DISTINCT FROM (SELECT max(v.version) FROM public.jaguar360_planes_ciclo v WHERE v.ciclo=p_ciclo AND v.estado='validada_para_planificacion')) THEN RAISE EXCEPTION 'Convocatoria o política obsoleta.'; END IF;
  UPDATE public.jaguar360_convocatorias SET estado=CASE WHEN p_accion='autorizar' THEN 'autorizada_para_planeacion' ELSE 'cancelada' END,version=version+1 WHERE id=c.id RETURNING * INTO c;
 ELSE RAISE EXCEPTION 'Acción inválida.';
 END IF;
 INSERT INTO public.jaguar360_convocatoria_eventos(convocatoria_id,version,estado,actor_id,actor_nombre,actor_cargo,motivo) VALUES(c.id,c.version,c.estado,p_actor,coalesce(a.nombre_completo,'Sin nombre'),a.rol,btrim(p_motivo));
 RETURN (to_jsonb(c)-'id')||jsonb_build_object('id',c.id::text);
END $$;
-- All sources are evaluated in the same STABLE statement. Only the selected student is returned.
CREATE OR REPLACE FUNCTION public.jaguar360_fuentes_acreditacion(p_actor uuid,p_ciclo text,p_alumno bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE plan record; pe record; snap jsonb; rows jsonb; outrows jsonb:='[]'::jsonb; verified boolean;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('direccion_escolar','coordinacion_academica','control_escolar','control')) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.alumnos WHERE id=p_alumno) THEN RAISE EXCEPTION 'Alumno inexistente.'; END IF;
 SELECT t.version,t.plan INTO plan FROM public.jaguar360_planes_ciclo t WHERE ciclo=p_ciclo AND estado='validada_para_planificacion' ORDER BY version DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'No existe plan validado; faltan criterios de referencia.'; END IF;
 IF (SELECT count(*) FROM public.periodos_escolares WHERE ciclo_escolar=p_ciclo)>6 THEN RAISE EXCEPTION 'Periodos no conciliados (más de seis).'; END IF;
 FOR pe IN SELECT id,numero_periodo,fecha_inicio,fecha_fin FROM public.periodos_escolares WHERE ciclo_escolar=p_ciclo ORDER BY numero_periodo,id LOOP
  snap:=public.jaguar360_snapshot_verificacion(pe.id);
  verified:=coalesce((SELECT huella=md5(snap::text) FROM public.jaguar360_verificaciones_cierre WHERE periodo_id=pe.id ORDER BY id DESC LIMIT 1),false);
  -- Do not return unverified grades. Map legacy group-material IDs explicitly; this mapping is a provisional reference.
  rows:='[]'::jsonb;
  IF verified THEN
   WITH notes AS (SELECT * FROM jsonb_to_recordset(snap->'notas') AS n(alumno_id bigint,grupo_materia_id bigint,evaluacion text,calificacion numeric,fuente_original numeric,resultado text) WHERE alumno_id=p_alumno),
   marks AS (SELECT grupo_materia_id,count(*) FILTER(WHERE estado='presente') AS present,count(*) FILTER(WHERE estado='falta') AS absent,count(*) FILTER(WHERE estado='retardo') AS late,count(*) FILTER(WHERE estado='justificada') AS justified,count(*) FILTER(WHERE estado IS NULL) AS unknown FROM jsonb_to_recordset(snap->'asistencias') AS s(alumno_id bigint,grupo_materia_id bigint,estado text) WHERE alumno_id=p_alumno GROUP BY grupo_materia_id)
   SELECT coalesce(jsonb_agg(jsonb_build_object('subjectId',gm.materia_id::text,'groupMaterialId',n.grupo_materia_id::text,'grade',g.grado,'evaluation',n.evaluacion,'official',n.calificacion,'original',n.fuente_original,'result',n.resultado,'attendance',jsonb_build_object('present',coalesce(m.present,0),'absent',coalesce(m.absent,0),'late',coalesce(m.late,0),'justified',coalesce(m.justified,0),'unknown',coalesce(m.unknown,0))) ORDER BY n.grupo_materia_id),'[]'::jsonb) INTO rows FROM notes n LEFT JOIN public.grupo_materias gm ON gm.id=n.grupo_materia_id LEFT JOIN public.grupos g ON g.id=gm.grupo_id LEFT JOIN marks m ON m.grupo_materia_id=n.grupo_materia_id;
  END IF;
  outrows:=outrows||jsonb_build_array(jsonb_build_object('number',pe.numero_periodo,'start',pe.fecha_inicio,'end',pe.fecha_fin,'verified',verified,'rows',rows));
 END LOOP;
 RETURN jsonb_build_object('plan',plan.plan,'version',plan.version,'periods',outrows);
END $$;
CREATE OR REPLACE FUNCTION public.jaguar360_fuentes_carga_docente(p_actor uuid,p_ciclo text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb; n bigint;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('direccion_escolar','coordinacion_academica','servicios_docentes')) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO n FROM public.horarios WHERE ciclo_escolar=p_ciclo;
 IF n>10000 THEN RAISE EXCEPTION 'Demasiadas franjas para esta consulta.'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('teacherId',h.docente_id::text,'name',d.nombre_completo,'day',h.dia_semana,'start',h.hora_inicio,'end',h.hora_fin) ORDER BY h.id),'[]'::jsonb) INTO r FROM public.horarios h LEFT JOIN public.docentes d ON d.id=h.docente_id WHERE h.ciclo_escolar=p_ciclo;
 RETURN jsonb_build_object('rows',r,'unscoped',(SELECT count(*) FROM public.horarios WHERE ciclo_escolar IS NULL));
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_consultar_convocatorias(uuid,text),public.jaguar360_registrar_convocatoria(uuid,text,integer,text,bigint,integer,jsonb,text),public.jaguar360_fuentes_acreditacion(uuid,text,bigint),public.jaguar360_fuentes_carga_docente(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_consultar_convocatorias(uuid,text),public.jaguar360_registrar_convocatoria(uuid,text,integer,text,bigint,integer,jsonb,text),public.jaguar360_fuentes_acreditacion(uuid,text,bigint),public.jaguar360_fuentes_carga_docente(uuid,text) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
