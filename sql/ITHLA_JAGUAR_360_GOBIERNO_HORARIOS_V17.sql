-- Experimental documentary governance and timetable proposals; no role or schedule writes.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar360_gobierno_expedientes (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 persona uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE RESTRICT,
 persona_nombre text NOT NULL,
 departamento text NOT NULL CHECK(departamento IN ('control_escolar','coordinacion_academica','servicios_docentes','prefectura','servicios_estudiantiles','archivo_escolar','recursos_monetarios')),
 contenido jsonb NOT NULL CHECK(jsonb_typeof(contenido)='object'),
 actor uuid NOT NULL, actor_nombre text NOT NULL, referencia text NOT NULL, motivo text NOT NULL,
 creado_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.jaguar360_gobierno_resoluciones (
 expediente_id bigint NOT NULL REFERENCES public.jaguar360_gobierno_expedientes(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version BETWEEN 2 AND 3),
 estado text NOT NULL CHECK(estado IN ('approved','rejected','revoked')),
 actor uuid NOT NULL, actor_nombre text NOT NULL, referencia text NOT NULL, motivo text NOT NULL,
 creado_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(expediente_id,version)
);
ALTER TABLE public.jaguar360_gobierno_expedientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar360_gobierno_resoluciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_gobierno_expedientes,public.jaguar360_gobierno_resoluciones FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_gobierno(p_actor uuid,p_op text DEFAULT NULL,p_id bigint DEFAULT NULL,p_version integer DEFAULT NULL,p_record jsonb DEFAULT NULL,p_reference text DEFAULT NULL,p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; e public.jaguar360_gobierno_expedientes; r public.jaguar360_gobierno_resoluciones; linked public.jaguar360_gobierno_expedientes; ls text; person uuid; dept text; st date; en date; h jsonb; depScope text; rows jsonb; targetState text;
BEGIN
 IF p_op IS NOT NULL THEN
  LOCK TABLE public.perfiles IN SHARE MODE NOWAIT;
  LOCK TABLE public.jaguar360_gobierno_expedientes,public.jaguar360_gobierno_resoluciones IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 END IF;
 SELECT rol,nombre_completo INTO a FROM public.perfiles WHERE id=p_actor AND activo IS TRUE;
 IF NOT FOUND OR a.rol NOT IN ('direccion_escolar','control_escolar','control') THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF p_op IS NOT NULL THEN
  IF p_reference IS NULL OR char_length(btrim(p_reference)) NOT BETWEEN 5 AND 300 OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Referencia y motivo requeridos.'; END IF;
  IF p_op='propose' THEN
   IF a.rol NOT IN ('control_escolar','control') THEN RAISE EXCEPTION 'Solo Control Escolar prepara el expediente documental.' USING ERRCODE='42501'; END IF;
   IF jsonb_typeof(p_record) IS DISTINCT FROM 'object' OR octet_length(p_record::text)>12000 OR coalesce(p_record->>'kind','') NOT IN ('appointment','delegation') OR coalesce(p_record->>'department','') NOT IN ('control_escolar','coordinacion_academica','servicios_docentes','prefectura','servicios_estudiantiles','archivo_escolar','recursos_monetarios') THEN RAISE EXCEPTION 'Registro inválido.'; END IF;
   person:=(p_record->>'person')::uuid; dept:=p_record->>'department'; st:=(p_record->>'start')::date; en:=(p_record->>'end')::date;
   IF person IS NULL OR st IS NULL OR en<st OR NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=person AND activo IS TRUE AND rol NOT IN ('alumno','direccion_escolar')) THEN RAISE EXCEPTION 'Identidad o vigencia inválida. Dirección requiere autoridad externa.'; END IF;
   IF p_record->>'kind'='appointment' THEN
    IF coalesce(p_record->>'title','') NOT IN ('titular','suplente','encargado','auxiliar') OR (p_record->>'title'<>'titular' AND en IS NULL) THEN RAISE EXCEPTION 'Cargo o vigencia inválidos.'; END IF;
    IF p_record->>'title'='titular' THEN
     h:=p_record->'handover';
     IF jsonb_typeof(h) IS DISTINCT FROM 'object' OR coalesce(h->>'mode','') NOT IN ('initial','participated','absent') OR coalesce(char_length(btrim(h->>'inventory')),0) NOT BETWEEN 15 AND 3000 OR coalesce(char_length(btrim(h->>'reference')),0) NOT BETWEEN 5 AND 300 OR (h->>'mode'='initial' AND h->>'previous' IS NOT NULL) OR (h->>'mode'<>'initial' AND (h->>'previous' IS NULL OR (h->>'previous')::uuid=person OR NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=(h->>'previous')::uuid))) THEN RAISE EXCEPTION 'Entrega–recepción incompleta.'; END IF;
    END IF;
   ELSE
    IF en IS NULL OR (p_record->>'appointment') IS NULL THEN RAISE EXCEPTION 'Delegación requiere nombramiento y caducidad.'; END IF;
    depScope:=p_record->>'scope';
    IF depScope IS NULL OR NOT (CASE dept WHEN 'control_escolar' THEN depScope IN ('expedientes','inscripciones','documentacion') WHEN 'coordinacion_academica' THEN depScope IN ('planeaciones','horarios','regularizacion') WHEN 'servicios_docentes' THEN depScope IN ('expedientes_docentes','disponibilidad','cobertura') WHEN 'prefectura' THEN depScope IN ('incidencias','justificantes') WHEN 'servicios_estudiantiles' THEN depScope IN ('tramites','apoyos') WHEN 'archivo_escolar' THEN depScope IN ('resguardo','tramites_archivo') WHEN 'recursos_monetarios' THEN depScope='registro_administrativo' ELSE false END) THEN RAISE EXCEPTION 'Atribución no catalogada.'; END IF;
    SELECT * INTO linked FROM public.jaguar360_gobierno_expedientes WHERE id=(p_record->>'appointment')::bigint;
    SELECT estado INTO ls FROM public.jaguar360_gobierno_resoluciones WHERE expediente_id=linked.id ORDER BY version DESC LIMIT 1;
    IF linked.id IS NULL OR ls IS DISTINCT FROM 'approved' OR linked.contenido->>'kind'<>'appointment' OR linked.contenido->>'title'<>'titular' OR linked.departamento<>dept OR linked.persona=person OR st<(linked.contenido->>'start')::date OR ((linked.contenido->>'end') IS NOT NULL AND en>(linked.contenido->>'end')::date) OR NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=linked.persona AND activo IS TRUE) THEN RAISE EXCEPTION 'Nombramiento de origen incompatible.'; END IF;
   END IF;
   INSERT INTO public.jaguar360_gobierno_expedientes(persona,persona_nombre,departamento,contenido,actor,actor_nombre,referencia,motivo) VALUES(person,(SELECT coalesce(nombre_completo,'Sin nombre') FROM public.perfiles WHERE id=person),dept,p_record,p_actor,coalesce(a.nombre_completo,'Sin nombre'),btrim(p_reference),btrim(p_reason));
  ELSE
   IF a.rol<>'direccion_escolar' OR p_op NOT IN ('approve','reject','revoke') THEN RAISE EXCEPTION 'Solo Dirección resuelve.' USING ERRCODE='42501'; END IF;
   SELECT * INTO e FROM public.jaguar360_gobierno_expedientes WHERE id=p_id;
   IF NOT FOUND OR e.actor=p_actor OR e.persona=p_actor THEN RAISE EXCEPTION 'Conflicto de interés o expediente inexistente.' USING ERRCODE='42501'; END IF;
   SELECT * INTO r FROM public.jaguar360_gobierno_resoluciones WHERE expediente_id=e.id ORDER BY version DESC LIMIT 1;
   IF p_version IS DISTINCT FROM coalesce(r.version,1) OR (p_op IN ('approve','reject') AND r.version IS NOT NULL) OR (p_op='revoke' AND r.estado IS DISTINCT FROM 'approved') THEN RAISE EXCEPTION 'La versión cambió o transición no permitida.'; END IF;
   IF p_op='approve' THEN
    IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=e.persona AND activo IS TRUE AND rol NOT IN ('alumno','direccion_escolar')) THEN RAISE EXCEPTION 'La identidad dejó de ser elegible.'; END IF;
    IF e.contenido->>'kind'='appointment' AND EXISTS(SELECT 1 FROM public.jaguar360_gobierno_expedientes x JOIN LATERAL (SELECT estado FROM public.jaguar360_gobierno_resoluciones WHERE expediente_id=x.id ORDER BY version DESC LIMIT 1) z ON z.estado='approved' WHERE x.persona=e.persona AND x.departamento=e.departamento AND x.contenido->>'kind'='appointment' AND x.contenido->>'title'=e.contenido->>'title' AND daterange((x.contenido->>'start')::date,(x.contenido->>'end')::date,'[]') && daterange((e.contenido->>'start')::date,(e.contenido->>'end')::date,'[]')) THEN RAISE EXCEPTION 'Nombramiento duplicado en esa vigencia.'; END IF;
    IF e.contenido->>'kind'='appointment' AND e.contenido->>'title'='titular' THEN
     SELECT x.* INTO linked FROM public.jaguar360_gobierno_expedientes x WHERE x.departamento=e.departamento AND x.contenido->>'kind'='appointment' AND x.contenido->>'title'='titular' AND x.id<>e.id AND (x.contenido->>'start')::date<=(e.contenido->>'start')::date AND EXISTS(SELECT 1 FROM public.jaguar360_gobierno_resoluciones yy WHERE yy.expediente_id=x.id AND yy.estado='approved') ORDER BY (x.contenido->>'start')::date DESC,x.id DESC LIMIT 1;
     IF FOUND AND (e.contenido->'handover'->>'mode'='initial' OR (e.contenido->'handover'->>'previous')::uuid IS DISTINCT FROM linked.persona) THEN RAISE EXCEPTION 'La entrega–recepción debe identificar al titular histórico documentado.'; END IF;
     IF EXISTS(SELECT 1 FROM public.jaguar360_gobierno_expedientes x JOIN LATERAL (SELECT estado FROM public.jaguar360_gobierno_resoluciones WHERE expediente_id=x.id ORDER BY version DESC LIMIT 1) z ON z.estado='approved' WHERE x.departamento=e.departamento AND x.contenido->>'kind'='appointment' AND x.contenido->>'title'='titular' AND daterange((x.contenido->>'start')::date,(x.contenido->>'end')::date,'[]') && daterange((e.contenido->>'start')::date,(e.contenido->>'end')::date,'[]')) THEN RAISE EXCEPTION 'Hay otro titular aprobado en esa vigencia.'; END IF;
    ELSIF e.contenido->>'kind'='delegation' THEN
     SELECT * INTO linked FROM public.jaguar360_gobierno_expedientes WHERE id=(e.contenido->>'appointment')::bigint;
     SELECT estado INTO ls FROM public.jaguar360_gobierno_resoluciones WHERE expediente_id=linked.id ORDER BY version DESC LIMIT 1;
     IF ls IS DISTINCT FROM 'approved' OR NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=linked.persona AND activo IS TRUE) THEN RAISE EXCEPTION 'Nombramiento de origen dejó de estar aprobado.'; END IF;
    END IF;
   END IF;
   targetState:=CASE p_op WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'revoked' END;
   INSERT INTO public.jaguar360_gobierno_resoluciones(expediente_id,version,estado,actor,actor_nombre,referencia,motivo) VALUES(e.id,p_version+1,targetState,p_actor,coalesce(a.nombre_completo,'Sin nombre'),btrim(p_reference),btrim(p_reason));
  END IF;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id::text,'record',x.contenido,'personName',x.persona_nombre,'actor',x.actor::text,'actorName',x.actor_nombre,'reference',x.referencia,'reason',x.motivo,'at',x.creado_at,'version',coalesce(r.version,1),'state',coalesce(r.estado,'proposed'),'documentaryValidity',CASE WHEN r.estado IS DISTINCT FROM 'approved' THEN 'not_approved' WHEN p.activo IS DISTINCT FROM true THEN 'inactive_person' WHEN (x.contenido->>'start')::date>(now() AT TIME ZONE 'America/Mexico_City')::date THEN 'future' WHEN (x.contenido->>'end')::date<(now() AT TIME ZONE 'America/Mexico_City')::date THEN 'expired' WHEN x.contenido->>'kind'='delegation' AND NOT EXISTS(SELECT 1 FROM public.jaguar360_gobierno_expedientes l JOIN public.perfiles lp ON lp.id=l.persona AND lp.activo LEFT JOIN LATERAL (SELECT estado FROM public.jaguar360_gobierno_resoluciones WHERE expediente_id=l.id ORDER BY version DESC LIMIT 1) lr ON true WHERE l.id=(x.contenido->>'appointment')::bigint AND lr.estado='approved') THEN 'origin_not_approved' ELSE 'within_documented_dates' END,'history',coalesce((SELECT jsonb_agg(to_jsonb(y)-'expediente_id' ORDER BY y.version) FROM public.jaguar360_gobierno_resoluciones y WHERE y.expediente_id=x.id),'[]'::jsonb)) ORDER BY x.id DESC),'[]'::jsonb) INTO rows FROM (SELECT * FROM public.jaguar360_gobierno_expedientes WHERE a.rol='direccion_escolar' OR actor=p_actor ORDER BY id DESC LIMIT 100) x JOIN public.perfiles p ON p.id=x.persona LEFT JOIN LATERAL (SELECT * FROM public.jaguar360_gobierno_resoluciones WHERE expediente_id=x.id ORDER BY version DESC LIMIT 1) r ON true;
 RETURN jsonb_build_object('rows',rows,'people',CASE WHEN a.rol IN ('control_escolar','control') THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',nombre_completo,'active',activo) ORDER BY nombre_completo,id) FROM (SELECT id,nombre_completo,activo FROM public.perfiles WHERE rol NOT IN ('alumno','direccion_escolar') ORDER BY nombre_completo,id LIMIT 1000) q),'[]'::jsonb) ELSE '[]'::jsonb END);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_gobierno(uuid,text,bigint,integer,jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_gobierno(uuid,text,bigint,integer,jsonb,text,text) TO service_role;

-- Current catalogue snapshot; no claims about future enrollments, legal work hours or calendar.
CREATE TABLE IF NOT EXISTS public.jaguar360_semanas_propuestas (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,ciclo text NOT NULL, periodo integer NOT NULL CHECK(periodo BETWEEN 1 AND 6),
 version_plan integer NOT NULL, huella text NOT NULL, propuesta jsonb NOT NULL,
 actor uuid NOT NULL, actor_nombre text NOT NULL, motivo text NOT NULL, creado_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.jaguar360_semanas_resoluciones (
 propuesta_id bigint PRIMARY KEY REFERENCES public.jaguar360_semanas_propuestas(id) ON DELETE RESTRICT,
 estado text NOT NULL CHECK(estado IN ('reviewed','rejected')), actor uuid NOT NULL, actor_nombre text NOT NULL, motivo text NOT NULL, creado_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.jaguar360_semanas_propuestas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar360_semanas_resoluciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_semanas_propuestas,public.jaguar360_semanas_resoluciones FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_contexto_semana(p_actor uuid,p_ciclo text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; planrow public.jaguar360_planes_ciclo; ctx jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('direccion_escolar','coordinacion_academica')) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 SELECT * INTO planrow FROM public.jaguar360_planes_ciclo WHERE ciclo=p_ciclo AND estado='validada_para_planificacion' ORDER BY version DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'No hay plan validado.'; END IF;
 IF (SELECT count(*) FROM public.grupo_materias gm JOIN public.grupos g ON g.id=gm.grupo_id WHERE gm.activo AND g.activo)>1000 OR (SELECT count(*) FROM public.docente_disponibilidad)>20000 THEN RAISE EXCEPTION 'Catálogo demasiado extenso para esta revisión.'; END IF;
 SELECT jsonb_build_object('plan',planrow.plan,'version',planrow.version,
  'groups',coalesce((SELECT jsonb_agg(jsonb_build_object('id',g.id::text,'name',g.clave,'grade',g.grado,'turn',g.turno,'start',g.hora_inicio,'end',g.hora_fin,'students',(SELECT count(*) FROM public.alumnos al WHERE al.grupo_id=g.id AND al.activo)) ORDER BY g.id) FROM public.grupos g WHERE g.activo),'[]'::jsonb),
  'subjects',coalesce((SELECT jsonb_agg(jsonb_build_object('id',gm.id::text,'group',gm.grupo_id::text,'subject',gm.materia_id::text,'teachers',coalesce((SELECT jsonb_agg(DISTINCT ad.docente_id::text ORDER BY ad.docente_id::text) FROM public.asignaciones_docentes ad JOIN public.docentes d ON d.id=ad.docente_id JOIN public.perfiles p ON p.id=d.auth_user_id WHERE ad.grupo_materia_id=gm.id AND ad.activo AND ad.ciclo_escolar=p_ciclo AND d.activo AND p.activo AND p.rol='docente'),'[]'::jsonb)) ORDER BY gm.id) FROM public.grupo_materias gm JOIN public.grupos g ON g.id=gm.grupo_id WHERE gm.activo AND g.activo),'[]'::jsonb),
  'rooms',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id::text,'name',nombre,'code',codigo,'capacity',capacidad) ORDER BY id) FROM public.jaguar_aulas WHERE activo),'[]'::jsonb),
  'teachers',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id::text,'name',d.nombre_completo) ORDER BY d.id) FROM public.docentes d JOIN public.perfiles p ON p.id=d.auth_user_id WHERE d.activo AND p.activo AND p.rol='docente'),'[]'::jsonb),
  'availability',coalesce((SELECT jsonb_agg(jsonb_build_object('teacher',docente_id::text,'day',dia_semana,'start',hora_inicio,'end',hora_fin,'available',disponible) ORDER BY id) FROM public.docente_disponibilidad),'[]'::jsonb),
  'unscoped',(SELECT count(*) FROM public.horarios WHERE ciclo_escolar IS NULL)) INTO ctx;
 RETURN ctx||jsonb_build_object('fingerprint',md5(ctx::text));
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_contexto_semana(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_contexto_semana(uuid,text) TO service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_semana(p_actor uuid,p_ciclo text,p_op text DEFAULT NULL,p_id bigint DEFAULT NULL,p_fingerprint text DEFAULT NULL,p_proposal jsonb DEFAULT NULL,p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; ctx jsonb; prev public.jaguar360_semanas_propuestas; rows jsonb;
BEGIN
 IF p_op IS NOT NULL THEN
  LOCK TABLE public.perfiles,public.jaguar360_planes_ciclo,public.grupos,public.grupo_materias,public.alumnos,public.asignaciones_docentes,public.docentes,public.docente_disponibilidad,public.jaguar_aulas,public.horarios IN SHARE MODE NOWAIT;
  LOCK TABLE public.jaguar360_semanas_propuestas,public.jaguar360_semanas_resoluciones IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 END IF;
 SELECT rol,nombre_completo INTO a FROM public.perfiles WHERE id=p_actor AND activo IS TRUE;
 IF NOT FOUND OR a.rol NOT IN ('direccion_escolar','coordinacion_academica') THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 ctx:=public.jaguar360_contexto_semana(p_actor,p_ciclo);
 IF p_op IS NOT NULL THEN
  IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Motivo inválido.'; END IF;
  IF p_op='save' THEN
   IF a.rol<>'coordinacion_academica' THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
   IF p_fingerprint IS DISTINCT FROM ctx->>'fingerprint' OR jsonb_typeof(p_proposal) IS DISTINCT FROM 'object' OR octet_length(p_proposal::text)>1500000 OR p_proposal->>'compatible' IS DISTINCT FROM 'true' OR p_proposal->>'official' IS DISTINCT FROM 'false' OR jsonb_typeof(p_proposal->'slots') IS DISTINCT FROM 'array' OR jsonb_array_length(p_proposal->'slots') NOT BETWEEN 1 AND 5000 OR (p_proposal->>'period')::integer NOT BETWEEN 1 AND (ctx->'plan'->'policy'->>'periods')::integer THEN RAISE EXCEPTION 'Propuesta incompatible o catálogo modificado.'; END IF;
   IF EXISTS(SELECT 1 FROM public.jaguar360_semanas_propuestas s WHERE s.ciclo=p_ciclo AND s.huella=p_fingerprint AND s.propuesta=p_proposal) THEN RAISE EXCEPTION 'Propuesta ya registrada.'; END IF;
   INSERT INTO public.jaguar360_semanas_propuestas(ciclo,periodo,version_plan,huella,propuesta,actor,actor_nombre,motivo) VALUES(p_ciclo,(p_proposal->>'period')::integer,(ctx->>'version')::integer,p_fingerprint,p_proposal,p_actor,coalesce(a.nombre_completo,'Sin nombre'),btrim(p_reason));
  ELSIF p_op IN ('review','reject') THEN
   IF a.rol<>'direccion_escolar' THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
   SELECT * INTO prev FROM public.jaguar360_semanas_propuestas WHERE id=p_id AND ciclo=p_ciclo;
   IF NOT FOUND OR prev.actor=p_actor THEN RAISE EXCEPTION 'Sin propuesta independiente.' USING ERRCODE='42501'; END IF;
   IF EXISTS(SELECT 1 FROM public.jaguar360_semanas_resoluciones WHERE propuesta_id=p_id) OR (p_op='review' AND prev.huella IS DISTINCT FROM ctx->>'fingerprint') THEN RAISE EXCEPTION 'Propuesta resuelta o catálogo desactualizado.'; END IF;
   INSERT INTO public.jaguar360_semanas_resoluciones(propuesta_id,estado,actor,actor_nombre,motivo) VALUES(p_id,CASE WHEN p_op='review' THEN 'reviewed' ELSE 'rejected' END,p_actor,coalesce(a.nombre_completo,'Sin nombre'),btrim(p_reason));
  ELSE RAISE EXCEPTION 'Acción inválida.'; END IF;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id::text,'period',x.periodo,'actor',x.actor_nombre,'reason',x.motivo,'at',x.creado_at,'planVersion',x.version_plan,'proposal',x.propuesta,'current',x.huella=(ctx->>'fingerprint'),'state',coalesce(r.estado,'proposed'),'review',to_jsonb(r)-'propuesta_id') ORDER BY x.id DESC),'[]'::jsonb) INTO rows FROM (SELECT * FROM public.jaguar360_semanas_propuestas WHERE ciclo=p_ciclo ORDER BY id DESC LIMIT 20) x LEFT JOIN public.jaguar360_semanas_resoluciones r ON r.propuesta_id=x.id;
 RETURN jsonb_build_object('context',ctx,'rows',rows);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_semana(uuid,text,text,bigint,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_semana(uuid,text,text,bigint,text,jsonb,text) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
