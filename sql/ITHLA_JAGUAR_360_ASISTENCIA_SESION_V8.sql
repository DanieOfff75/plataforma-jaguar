-- V8: captura operativa de listas completas sobre padrón y sesiones revisados.
-- La marca por fecha antigua permanece intacta. Requiere las migraciones V3-V7 de este paquete.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar360_listas_sesion (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 periodo_id bigint NOT NULL REFERENCES public.periodos_escolares(id) ON DELETE RESTRICT,
 grupo_materia_id bigint NOT NULL REFERENCES public.grupo_materias(id) ON DELETE RESTRICT,
 fecha date NOT NULL, inicio time NOT NULL, fin time NOT NULL CHECK(fin>inicio),
 version integer NOT NULL CHECK(version>0),padron_version integer NOT NULL,sesiones_version integer NOT NULL,
 marcas jsonb NOT NULL CHECK(jsonb_typeof(marcas)='array'),
 actor_id uuid NOT NULL,actor_nombre text NOT NULL,actor_cargo text NOT NULL,
 operacion text NOT NULL CHECK(operacion IN ('save','justify')),motivo text NOT NULL CHECK(char_length(motivo) BETWEEN 15 AND 1500),
 creado_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(periodo_id,grupo_materia_id,fecha,inicio,version)
);
ALTER TABLE public.jaguar360_listas_sesion ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_listas_sesion FROM PUBLIC,anon,authenticated,service_role;
-- Accessible only through service role, with actor, role, cycle and teacher assignment checks.
CREATE OR REPLACE FUNCTION public.jaguar360_contexto_sesion(p_actor uuid,p_periodo bigint,p_gm bigint,p_fecha date,p_inicio time)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; pe record; pa public.jaguar360_evidencias_periodo; se public.jaguar360_evidencias_periodo; ss record; l public.jaguar360_listas_sesion; roster jsonb; allowed boolean; compatible boolean;
BEGIN
 SELECT id,rol,activo INTO a FROM public.perfiles WHERE id=p_actor;
 IF NOT FOUND OR a.activo IS DISTINCT FROM true OR coalesce(a.rol,'') NOT IN ('docente','prefectura','direccion_escolar','coordinacion_academica','control_escolar','control') THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 SELECT id,ciclo_escolar,fecha_inicio,fecha_fin INTO pe FROM public.periodos_escolares WHERE id=p_periodo;
 IF NOT FOUND OR p_fecha IS NULL OR p_inicio IS NULL OR pe.fecha_inicio IS NULL OR pe.fecha_fin IS NULL OR p_fecha NOT BETWEEN pe.fecha_inicio AND pe.fecha_fin OR p_fecha>(now() AT TIME ZONE 'America/Mexico_City')::date THEN RAISE EXCEPTION 'Fecha o periodo no disponible.'; END IF;
 IF a.rol='docente' AND (NOT EXISTS(SELECT 1 FROM public.docentes d JOIN public.asignaciones_docentes ad ON ad.docente_id=d.id WHERE d.auth_user_id=p_actor AND d.activo IS TRUE AND ad.activo IS TRUE AND ad.ciclo_escolar=pe.ciclo_escolar AND ad.grupo_materia_id=p_gm) OR (SELECT count(*) FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE)<>1 OR NOT EXISTS(SELECT 1 FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE AND ciclo_escolar=pe.ciclo_escolar)) THEN RAISE EXCEPTION 'Asignación o ciclo no autorizado.' USING ERRCODE='42501'; END IF;
 SELECT * INTO pa FROM public.jaguar360_evidencias_periodo WHERE periodo_id=p_periodo AND tipo='padron' ORDER BY version DESC LIMIT 1;
 SELECT * INTO se FROM public.jaguar360_evidencias_periodo WHERE periodo_id=p_periodo AND tipo='sesiones' ORDER BY version DESC LIMIT 1;
 IF pa.estado IS DISTINCT FROM 'revisada' OR se.estado IS DISTINCT FROM 'revisada' THEN RAISE EXCEPTION 'Se requiere padrón y sesiones vigentes revisados.'; END IF;
 SELECT * INTO ss FROM jsonb_to_recordset(se.contenido->'rows') AS x(grupo_materia_id bigint,fecha date,inicio time,fin time,estado text) WHERE grupo_materia_id=p_gm AND fecha=p_fecha AND inicio=p_inicio;
 IF NOT FOUND OR ss.estado NOT IN ('programada','impartida') THEN RAISE EXCEPTION 'Sesión no definida o cancelada.'; END IF;
 SELECT * INTO l FROM public.jaguar360_listas_sesion WHERE periodo_id=p_periodo AND grupo_materia_id=p_gm AND fecha=p_fecha AND inicio=p_inicio ORDER BY version DESC LIMIT 1;
 WITH expected AS (SELECT alumno_id FROM jsonb_to_recordset(pa.contenido->'rows') AS r(alumno_id bigint,grupo_materia_id bigint,desde date,hasta date) WHERE r.grupo_materia_id=p_gm AND p_fecha BETWEEN r.desde AND r.hasta),
 marks AS (SELECT * FROM jsonb_to_recordset(coalesce(l.marcas,'[]'::jsonb)) AS m(student bigint,state text))
 SELECT coalesce(jsonb_agg(jsonb_build_object('student',e.alumno_id::text,'name',al.nombre_completo,'registration',al.matricula,'state',m.state) ORDER BY al.nombre_completo,e.alumno_id),'[]'::jsonb) INTO roster FROM expected e LEFT JOIN public.alumnos al ON al.id=e.alumno_id LEFT JOIN marks m ON m.student=e.alumno_id;
 IF jsonb_array_length(roster) NOT BETWEEN 1 AND 1000 OR EXISTS(SELECT 1 FROM jsonb_array_elements(roster) x WHERE x->>'name' IS NULL) THEN RAISE EXCEPTION 'Padrón de la sesión vacío o excesivo.'; END IF;
 compatible:=l.id IS NULL OR (l.fin=ss.fin AND jsonb_array_length(l.marcas)=jsonb_array_length(roster) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(roster) x WHERE x->>'state' IS NULL));
 allowed:=compatible AND (p_fecha<(now() AT TIME ZONE 'America/Mexico_City')::date OR p_inicio<=(now() AT TIME ZONE 'America/Mexico_City')::time) AND a.rol IN ('docente','prefectura') AND EXISTS(SELECT 1 FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE AND ciclo_escolar=pe.ciclo_escolar) AND (SELECT count(*) FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE)=1;
 RETURN jsonb_build_object('rosterVersion',pa.version,'scheduleVersion',se.version,'version',coalesce(l.version,0),'sessionState',CASE WHEN l.id IS NOT NULL AND compatible THEN 'impartida' ELSE ss.estado END,'compatible',compatible,'canWrite',allowed,'end',to_char(ss.fin,'HH24:MI'),'rows',roster,'lastActor',l.actor_nombre,'lastDate',l.creado_at);
END $$;
CREATE OR REPLACE FUNCTION public.jaguar360_registrar_sesion(p_actor uuid,p_periodo bigint,p_gm bigint,p_fecha date,p_inicio time,p_accion text,p_version integer,p_padron integer,p_sesiones integer,p_marcas jsonb,p_alumno bigint,p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; ctx jsonb; marks jsonb; saved public.jaguar360_listas_sesion; oldstate text;
BEGIN
 SELECT id,rol,nombre_completo INTO a FROM public.perfiles WHERE id=p_actor AND activo IS TRUE;
 IF NOT FOUND OR p_accion IS NULL OR (p_accion='save' AND a.rol IS DISTINCT FROM 'docente') OR (p_accion='justify' AND a.rol IS DISTINCT FROM 'prefectura') OR p_accion NOT IN ('save','justify') THEN RAISE EXCEPTION 'Docente captura y Prefectura justifica.' USING ERRCODE='42501'; END IF;
 IF p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Motivo inválido.'; END IF;
 -- Same order as the evidence RPC; every list writer serializes against evidence updates.
 PERFORM 1 FROM public.periodos_escolares WHERE id=p_periodo FOR SHARE;
 PERFORM pg_advisory_xact_lock(hashtext('j360-evidencia:'||p_periodo));
 PERFORM pg_advisory_xact_lock(hashtext('j360-asistencia-fecha:'||p_gm||':'||p_fecha));
 ctx:=public.jaguar360_contexto_sesion(p_actor,p_periodo,p_gm,p_fecha,p_inicio);
 IF (ctx->>'canWrite')::boolean IS DISTINCT FROM true OR (ctx->>'compatible')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Lista no conciliada o ciclo no disponible para captura.'; END IF;
 IF (ctx->>'version')::integer IS DISTINCT FROM p_version OR (ctx->>'rosterVersion')::integer IS DISTINCT FROM p_padron OR (ctx->>'scheduleVersion')::integer IS DISTINCT FROM p_sesiones THEN RAISE EXCEPTION 'Cambió la lista o la evidencia; actualiza la consulta.'; END IF;
 IF p_accion='save' THEN
  IF jsonb_typeof(p_marcas) IS DISTINCT FROM 'array' OR jsonb_array_length(p_marcas)<>jsonb_array_length(ctx->'rows') THEN RAISE EXCEPTION 'La lista debe estar completa.'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_marcas) AS z(student bigint,state text) GROUP BY student HAVING count(*)>1) OR EXISTS(SELECT 1 FROM jsonb_to_recordset(p_marcas) AS z(student bigint,state text) WHERE z.student IS NULL OR z.state IS NULL OR z.state NOT IN ('presente','falta','retardo','justificada') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(ctx->'rows') x WHERE x->>'student'=z.student::text AND ((z.state='justificada' AND x->>'state'='justificada') OR (z.state<>'justificada' AND x->>'state' IS DISTINCT FROM 'justificada')))) THEN RAISE EXCEPTION 'Lista incompleta, ajena al padrón o modificación indebida de justificante.'; END IF;
  SELECT jsonb_agg(jsonb_build_object('student',student::text,'state',state) ORDER BY student) INTO marks FROM jsonb_to_recordset(p_marcas) AS z(student bigint,state text);
 ELSE
  SELECT x->>'state' INTO oldstate FROM jsonb_array_elements(ctx->'rows') x WHERE x->>'student'=p_alumno::text;
  IF p_version<1 OR oldstate IS DISTINCT FROM 'falta' THEN RAISE EXCEPTION 'Solo puede justificarse una falta registrada en la sesión.'; END IF;
  SELECT jsonb_agg(jsonb_build_object('student',x->>'student','state',CASE WHEN x->>'student'=p_alumno::text THEN 'justificada' ELSE x->>'state' END) ORDER BY (x->>'student')::bigint) INTO marks FROM jsonb_array_elements(ctx->'rows') x;
 END IF;
 -- An old date-only mark may not silently be overwritten. If the date has two
 -- or more non-cancelled sessions it is ambiguous and is not adapted to either.
 IF (SELECT count(*) FROM jsonb_to_recordset((SELECT contenido->'rows' FROM public.jaguar360_evidencias_periodo WHERE periodo_id=p_periodo AND tipo='sesiones' ORDER BY version DESC LIMIT 1)) AS h(grupo_materia_id bigint,fecha date,estado text) WHERE h.grupo_materia_id=p_gm AND h.fecha=p_fecha AND h.estado<>'cancelada')=1
 AND EXISTS(SELECT 1 FROM jsonb_to_recordset(marks) AS m(student bigint,state text) JOIN public.asistencias a ON a.alumno_id=m.student AND a.grupo_materia_id=p_gm AND a.fecha=p_fecha WHERE m.state<>a.estado AND NOT(m.state='justificada' AND a.estado='falta')) THEN RAISE EXCEPTION 'La lista contradice un registro previo por fecha; concilia primero su evidencia.'; END IF;
 INSERT INTO public.jaguar360_listas_sesion(periodo_id,grupo_materia_id,fecha,inicio,fin,version,padron_version,sesiones_version,marcas,actor_id,actor_nombre,actor_cargo,operacion,motivo)
 VALUES(p_periodo,p_gm,p_fecha,p_inicio,(ctx->>'end')::time,p_version+1,p_padron,p_sesiones,marks,p_actor,coalesce(a.nombre_completo,'Sin nombre'),a.rol,p_accion,btrim(p_motivo)) RETURNING * INTO saved;
 RETURN jsonb_build_object('id',saved.id::text,'version',saved.version,'sessionState','impartida','count',jsonb_array_length(saved.marcas));
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_contexto_sesion(uuid,bigint,bigint,date,time),public.jaguar360_registrar_sesion(uuid,bigint,bigint,date,time,text,integer,integer,integer,jsonb,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_contexto_sesion(uuid,bigint,bigint,date,time),public.jaguar360_registrar_sesion(uuid,bigint,bigint,date,time,text,integer,integer,integer,jsonb,bigint,text) TO service_role;

-- Do not let the old per-day editor overwrite date-only evidence once a real
-- per-session list exists for that group/date. The old table remains readable.
CREATE OR REPLACE FUNCTION public.jaguar360_proteger_fecha_legacy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb; k bigint; f date;
BEGIN
 FOR r IN SELECT value FROM jsonb_array_elements(CASE TG_OP WHEN 'INSERT' THEN jsonb_build_array(to_jsonb(NEW)) WHEN 'DELETE' THEN jsonb_build_array(to_jsonb(OLD)) ELSE jsonb_build_array(to_jsonb(OLD),to_jsonb(NEW)) END) LOOP
  k:=(r->>'grupo_materia_id')::bigint; f:=(r->>'fecha')::date;
  IF k IS NOT NULL AND f IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(hashtext('j360-asistencia-fecha:'||k||':'||f));
   IF EXISTS(SELECT 1 FROM public.jaguar360_listas_sesion WHERE grupo_materia_id=k AND fecha=f) THEN RAISE EXCEPTION 'Existe lista individual de sesión. Usa el registro por sesión; la evidencia anterior por fecha se conserva.' USING ERRCODE='23514'; END IF;
  END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_proteger_fecha_legacy() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS jaguar360_proteger_fecha_legacy ON public.asistencias;
CREATE TRIGGER jaguar360_proteger_fecha_legacy BEFORE INSERT OR UPDATE OR DELETE ON public.asistencias FOR EACH ROW EXECUTE FUNCTION public.jaguar360_proteger_fecha_legacy();

-- Reutiliza y amplía el comprobador V6; ahora consume listas operativas válidas.
CREATE OR REPLACE FUNCTION public.jaguar360_snapshot_verificacion(p_periodo bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE pe record; p public.jaguar360_evidencias_periodo; s public.jaguar360_evidencias_periodo; m public.jaguar360_evidencias_periodo; q public.jaguar360_evidencias_periodo; result jsonb; mv boolean; qv boolean;
BEGIN
 SELECT id,ciclo_escolar,numero_periodo,fecha_inicio,fecha_fin INTO pe FROM public.periodos_escolares WHERE id=p_periodo;
 IF NOT FOUND THEN RAISE EXCEPTION 'Periodo inexistente.'; END IF;
 SELECT * INTO p FROM public.jaguar360_evidencias_periodo WHERE periodo_id=p_periodo AND tipo='padron' ORDER BY version DESC LIMIT 1;
 SELECT * INTO s FROM public.jaguar360_evidencias_periodo WHERE periodo_id=p_periodo AND tipo='sesiones' ORDER BY version DESC LIMIT 1;
 SELECT * INTO m FROM public.jaguar360_evidencias_periodo WHERE periodo_id=p_periodo AND tipo='marcas' ORDER BY version DESC LIMIT 1;
 SELECT * INTO q FROM public.jaguar360_evidencias_periodo WHERE periodo_id=p_periodo AND tipo='cualitativas' ORDER BY version DESC LIMIT 1;
 mv:=coalesce(m.estado='revisada' AND m.contenido->>'padron_version'=p.version::text AND m.contenido->>'sesiones_version'=s.version::text,false);
 qv:=coalesce(q.estado='revisada' AND q.contenido->>'padron_version'=p.version::text,false);
 WITH roster AS (SELECT * FROM jsonb_to_recordset(coalesce(p.contenido->'rows','[]'::jsonb)) AS r(alumno_id bigint,grupo_materia_id bigint,desde date,hasta date,evaluacion text)),
 sessions AS (SELECT * FROM jsonb_to_recordset(coalesce(s.contenido->'rows','[]'::jsonb)) AS h(grupo_materia_id bigint,fecha date,inicio time,fin time,estado text)),
 op_latest AS (SELECT DISTINCT ON(grupo_materia_id,fecha,inicio) * FROM public.jaguar360_listas_sesion WHERE periodo_id=p_periodo ORDER BY grupo_materia_id,fecha,inicio,version DESC),
 op_valid AS (SELECT o.* FROM op_latest o JOIN sessions h USING(grupo_materia_id,fecha,inicio) WHERE p.estado='revisada' AND s.estado='revisada' AND h.estado IN ('programada','impartida') AND h.fin=o.fin
 AND jsonb_array_length(o.marcas)=(SELECT count(*) FROM roster r WHERE r.grupo_materia_id=o.grupo_materia_id AND o.fecha BETWEEN r.desde AND r.hasta)
 AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(o.marcas) AS m(student bigint,state text) WHERE NOT EXISTS(SELECT 1 FROM roster r WHERE r.alumno_id=m.student AND r.grupo_materia_id=o.grupo_materia_id AND o.fecha BETWEEN r.desde AND r.hasta))),
 op_marks AS (SELECT v.grupo_materia_id,v.fecha,v.inicio,v.version,m.student AS alumno_id,m.state AS estado FROM op_valid v CROSS JOIN LATERAL jsonb_to_recordset(v.marcas) AS m(student bigint,state text)),
 held AS (SELECT h.*,count(*) OVER(PARTITION BY h.grupo_materia_id,h.fecha) AS n FROM sessions h WHERE h.estado='impartida' OR (h.estado='programada' AND EXISTS(SELECT 1 FROM op_valid o WHERE o.grupo_materia_id=h.grupo_materia_id AND o.fecha=h.fecha AND o.inicio=h.inicio))),
 marks AS (SELECT * FROM jsonb_to_recordset(CASE WHEN mv THEN m.contenido->'rows' ELSE '[]'::jsonb END) AS z(alumno_id bigint,grupo_materia_id bigint,fecha date,inicio time,estado text)),
 qualitative AS (SELECT * FROM jsonb_to_recordset(CASE WHEN qv THEN q.contenido->'rows' ELSE '[]'::jsonb END) AS z(alumno_id bigint,grupo_materia_id bigint,resultado text)),
 expected AS (SELECT r.alumno_id,r.grupo_materia_id,h.fecha,h.inicio,h.fin,h.n FROM roster r JOIN held h ON h.grupo_materia_id=r.grupo_materia_id AND h.fecha BETWEEN r.desde AND r.hasta),
 attendance AS (SELECT e.*,z.estado AS marca,CASE WHEN e.n=1 THEN a.estado ELSE NULL END AS legado,op.estado AS operativa,op.version AS version_operativa,
 CASE WHEN op.estado IS NOT NULL THEN op.estado WHEN z.estado IS NOT NULL THEN z.estado WHEN e.n=1 THEN a.estado ELSE NULL END AS estado
 FROM expected e LEFT JOIN marks z USING(alumno_id,grupo_materia_id,fecha,inicio) LEFT JOIN op_marks op USING(alumno_id,grupo_materia_id,fecha,inicio) LEFT JOIN public.asistencias a USING(alumno_id,grupo_materia_id,fecha)),
 grades AS (SELECT r.alumno_id,r.grupo_materia_id,r.evaluacion,c.calificacion,c.calificacion_calculada,to_jsonb(c)->'calificacion_original_politica' AS fuente_original,c.observaciones,qq.resultado
 FROM roster r LEFT JOIN public.calificaciones c ON c.alumno_id=r.alumno_id AND c.grupo_materia_id=r.grupo_materia_id AND c.periodo_id=p_periodo
 LEFT JOIN qualitative qq ON qq.alumno_id=r.alumno_id AND qq.grupo_materia_id=r.grupo_materia_id),
 counts AS (SELECT jsonb_build_object(
 'obligaciones',(SELECT count(*) FROM roster),
 'sesiones_sin_confirmar',(SELECT count(*) FROM sessions h WHERE h.estado='programada' AND NOT EXISTS(SELECT 1 FROM op_valid o WHERE o.grupo_materia_id=h.grupo_materia_id AND o.fecha=h.fecha AND o.inicio=h.inicio)),
 'listas_operativas_obsoletas',(SELECT count(*) FROM op_latest)-(SELECT count(*) FROM op_valid),
 'evidencias_sin_revision',(CASE WHEN m.id IS NOT NULL AND NOT mv THEN 1 ELSE 0 END)+(CASE WHEN q.id IS NOT NULL AND NOT qv THEN 1 ELSE 0 END),
 'vigencias_invalidas',(SELECT count(*) FROM roster r WHERE r.desde<pe.fecha_inicio OR r.hasta>pe.fecha_fin OR NOT EXISTS(SELECT 1 FROM public.alumnos al WHERE al.id=r.alumno_id) OR NOT EXISTS(SELECT 1 FROM public.grupo_materias gm WHERE gm.id=r.grupo_materia_id))+(SELECT count(*) FROM jsonb_to_recordset(coalesce(s.contenido->'rows','[]'::jsonb)) AS h(grupo_materia_id bigint,fecha date) WHERE h.fecha NOT BETWEEN pe.fecha_inicio AND pe.fecha_fin OR NOT EXISTS(SELECT 1 FROM public.grupo_materias gm WHERE gm.id=h.grupo_materia_id)),
 'sin_nota_numerica',(SELECT count(*) FROM grades WHERE evaluacion='numerica' AND calificacion IS NULL),
 'sin_resultado_ap_rp',(SELECT count(*) FROM grades WHERE evaluacion='cualitativa' AND resultado IS NULL),
 'notas_incompatibles',(SELECT count(*) FROM grades WHERE evaluacion<>'numerica' AND calificacion IS NOT NULL),
 'notas_fuera_padron',(SELECT count(*) FROM public.calificaciones c WHERE c.periodo_id=p_periodo AND NOT EXISTS(SELECT 1 FROM roster r WHERE r.alumno_id=c.alumno_id AND r.grupo_materia_id=c.grupo_materia_id)),
 'sesiones_exigibles',(SELECT count(*) FROM expected),
 'asistencia_pendiente',(SELECT count(*) FROM attendance WHERE estado IS NULL),
 'asistencia_en_conflicto',(SELECT count(*) FROM attendance WHERE (marca IS NOT NULL AND legado IS NOT NULL AND marca<>legado) OR (operativa IS NOT NULL AND marca IS NOT NULL AND operativa<>marca AND NOT(operativa='justificada' AND marca='falta')) OR (operativa IS NOT NULL AND legado IS NOT NULL AND operativa<>legado AND NOT(operativa='justificada' AND legado='falta'))),
 'obligaciones_sin_sesiones',(SELECT count(*) FROM roster r WHERE NOT EXISTS(SELECT 1 FROM held h WHERE h.grupo_materia_id=r.grupo_materia_id AND h.fecha BETWEEN r.desde AND r.hasta))) AS data)
 SELECT jsonb_build_object('periodo',to_jsonb(pe),'versiones',jsonb_build_object('padron',p.version,'sesiones',s.version,'marcas',m.version,'cualitativas',q.version),
 'padrón_y_sesiones_revisados',coalesce(p.estado='revisada' AND s.estado='revisada',false),
 'periodo_transcurrido',coalesce(pe.fecha_fin<(now() AT TIME ZONE 'America/Mexico_City')::date AND pe.fecha_inicio<=pe.fecha_fin,false),
 'resumen',counts.data,
 'notas',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.alumno_id,g.grupo_materia_id) FROM grades g),'[]'::jsonb),
 'asistencias',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.alumno_id,a.grupo_materia_id,a.fecha,a.inicio) FROM attendance a),'[]'::jsonb)) INTO result FROM counts;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_snapshot_verificacion(bigint) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_verificar_cierre(p_actor uuid,p_periodo bigint,p_huella text DEFAULT NULL,p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; snap jsonb; h text; r jsonb; ready boolean; prev record; saved bigint;
BEGIN
 SELECT id,nombre_completo,rol,activo INTO a FROM public.perfiles WHERE id=p_actor;
 IF NOT FOUND OR a.activo IS DISTINCT FROM true OR coalesce(a.rol,'') NOT IN ('direccion_escolar','coordinacion_academica','control_escolar','control') THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF p_huella IS NOT NULL THEN
  IF a.rol<>'direccion_escolar' THEN RAISE EXCEPTION 'Solo Dirección registra una verificación.' USING ERRCODE='42501'; END IF;
  IF p_huella !~ '^[a-f0-9]{32}$' OR p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Huella o motivo inválido.'; END IF;
  -- Solo en copia de pruebas: no esperar bloqueos de escritores ordinarios.
  LOCK TABLE public.periodos_escolares,public.jaguar360_evidencias_periodo,public.calificaciones,public.asistencias,public.alumnos,public.grupo_materias,public.jaguar360_listas_sesion IN SHARE MODE NOWAIT;
  PERFORM pg_advisory_xact_lock(hashtext('j360-verificacion:'||p_periodo));
 END IF;
 snap:=public.jaguar360_snapshot_verificacion(p_periodo); h:=md5(snap::text); r:=snap->'resumen';
 ready:=coalesce((snap->>'padrón_y_sesiones_revisados')::boolean AND (snap->>'periodo_transcurrido')::boolean
 AND (r->>'obligaciones')::bigint>0 AND (r->>'sesiones_exigibles')::bigint>0
 AND (r->>'evidencias_sin_revision')::bigint=0 AND (r->>'vigencias_invalidas')::bigint=0
 AND (r->>'sin_nota_numerica')::bigint=0 AND (r->>'sin_resultado_ap_rp')::bigint=0 AND (r->>'notas_incompatibles')::bigint=0
 AND (r->>'notas_fuera_padron')::bigint=0 AND (r->>'asistencia_pendiente')::bigint=0 AND (r->>'asistencia_en_conflicto')::bigint=0
 AND (r->>'obligaciones_sin_sesiones')::bigint=0 AND (r->>'sesiones_sin_confirmar')::bigint=0 AND (r->>'listas_operativas_obsoletas')::bigint=0,false);
 IF p_huella IS NOT NULL THEN
  IF h<>p_huella THEN RAISE EXCEPTION 'La evidencia o las calificaciones cambiaron; actualiza la verificación.'; END IF;
  IF NOT ready THEN RAISE EXCEPTION 'La verificación contiene pendientes.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM (SELECT huella FROM public.jaguar360_verificaciones_cierre WHERE periodo_id=p_periodo ORDER BY id DESC LIMIT 1) previous WHERE previous.huella=h) THEN
  INSERT INTO public.jaguar360_verificaciones_cierre(periodo_id,huella,evidencia,actor_id,actor_nombre,motivo)
  VALUES(p_periodo,h,snap,p_actor,coalesce(a.nombre_completo,'Sin nombre'),btrim(p_motivo)) RETURNING id INTO saved;
  END IF;
 END IF;
 SELECT id::text AS id,huella,actor_nombre,creado_at INTO prev FROM public.jaguar360_verificaciones_cierre WHERE periodo_id=p_periodo ORDER BY id DESC LIMIT 1;
 RETURN jsonb_build_object('resumen',r,'versiones',snap->'versiones','evidencias_revisadas',snap->'padrón_y_sesiones_revisados','periodo_transcurrido',snap->'periodo_transcurrido','verificacion_posible',ready,'huella',h,'ultima_verificacion',CASE WHEN prev.id IS NULL THEN NULL ELSE to_jsonb(prev)-'huella' END,'verificacion_vigente',coalesce(prev.huella=h,false),'cierre_definitivo',false);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_verificar_cierre(uuid,bigint,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_verificar_cierre(uuid,bigint,text,text) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
