-- Evidencia de padrón y sesiones, independiente del padrón actual. No activa cierres.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar360_evidencias_periodo (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 periodo_id bigint NOT NULL REFERENCES public.periodos_escolares(id) ON DELETE RESTRICT,
 tipo text NOT NULL CHECK(tipo IN ('padron','sesiones','marcas','cualitativas')),
 version integer NOT NULL CHECK(version>0),
 estado text NOT NULL CHECK(estado IN ('propuesta','revisada','devuelta')),
 contenido jsonb NOT NULL CHECK(jsonb_typeof(contenido)='object'),
 actor_id uuid NOT NULL, actor_nombre text NOT NULL, actor_cargo text NOT NULL,
 motivo text NOT NULL CHECK(char_length(motivo) BETWEEN 15 AND 1500),
 creado_at timestamptz NOT NULL DEFAULT now(),
 precedente_id bigint REFERENCES public.jaguar360_evidencias_periodo(id) ON DELETE RESTRICT,
 UNIQUE(periodo_id,tipo,version)
);
-- Compatibilidad con copia de pruebas que hubiera ejecutado el V3 anterior.
ALTER TABLE public.jaguar360_evidencias_periodo DROP CONSTRAINT IF EXISTS jaguar360_evidencias_periodo_tipo_check;
ALTER TABLE public.jaguar360_evidencias_periodo ADD CONSTRAINT jaguar360_evidencias_periodo_tipo_check CHECK(tipo IN ('padron','sesiones','marcas','cualitativas'));
ALTER TABLE public.jaguar360_evidencias_periodo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_evidencias_periodo FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.jaguar360_evidencias_periodo TO service_role;
-- Roles actuales comprobados aquí además del API. Sin permisos de escritura directos.
CREATE OR REPLACE FUNCTION public.jaguar360_registrar_evidencia(p_actor uuid,p_periodo bigint,p_tipo text,p_version integer,p_accion text,p_contenido jsonb,p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; p record; prev public.jaguar360_evidencias_periodo; outrow public.jaguar360_evidencias_periodo; body jsonb; n integer; pr public.jaguar360_evidencias_periodo; sr public.jaguar360_evidencias_periodo;
BEGIN
 SELECT id,nombre_completo,rol,activo INTO a FROM public.perfiles WHERE id=p_actor;
 IF NOT FOUND OR a.activo IS DISTINCT FROM true OR coalesce(a.rol,'') NOT IN ('direccion_escolar','coordinacion_academica','control_escolar','control') THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF p_tipo IS NULL OR p_tipo NOT IN ('padron','sesiones','marcas','cualitativas') OR p_version IS NULL OR p_version<0 OR p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Evidencia, versión o motivo inválido.'; END IF;
 SELECT id,fecha_inicio,fecha_fin INTO p FROM public.periodos_escolares WHERE id=p_periodo FOR SHARE;
 IF NOT FOUND OR p.fecha_inicio IS NULL OR p.fecha_fin IS NULL OR p.fecha_fin<p.fecha_inicio THEN RAISE EXCEPTION 'Periodo no verificable.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('j360-evidencia:'||p_periodo));
 SELECT * INTO prev FROM public.jaguar360_evidencias_periodo WHERE periodo_id=p_periodo AND tipo=p_tipo ORDER BY version DESC LIMIT 1;
 IF coalesce(prev.version,0)<>p_version THEN RAISE EXCEPTION 'La versión cambió; actualiza la consulta.'; END IF;
 IF p_accion='proponer' THEN
  IF (p_tipo IN ('padron','cualitativas') AND a.rol NOT IN ('control_escolar','control')) OR (p_tipo IN ('sesiones','marcas') AND a.rol<>'coordinacion_academica') THEN RAISE EXCEPTION 'El padrón corresponde a Control Escolar y las sesiones a Coordinación.' USING ERRCODE='42501'; END IF;
  body:=p_contenido;
 ELSIF p_accion IN ('revisar','devolver') THEN
  IF a.rol<>'direccion_escolar' OR prev.estado IS DISTINCT FROM 'propuesta' OR prev.actor_id=p_actor THEN RAISE EXCEPTION 'Dirección debe revisar una propuesta ajena.' USING ERRCODE='42501'; END IF;
  body:=prev.contenido;
 ELSE RAISE EXCEPTION 'Acción inválida.';
 END IF;
 IF body IS NULL OR jsonb_typeof(body->'rows') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Se requiere una lista documentada.'; END IF;
 n:=jsonb_array_length(body->'rows');
 IF n<1 OR n>(CASE WHEN p_tipo='sesiones' THEN 30000 ELSE 20000 END) THEN RAISE EXCEPTION 'Cantidad de registros inválida.'; END IF;
 IF p_tipo='padron' THEN
  IF EXISTS(SELECT 1 FROM jsonb_to_recordset(body->'rows') AS r(alumno_id bigint,grupo_materia_id bigint,desde date,hasta date,evaluacion text,referencia text)
   LEFT JOIN public.alumnos al ON al.id=r.alumno_id LEFT JOIN public.grupo_materias gm ON gm.id=r.grupo_materia_id
   WHERE al.id IS NULL OR gm.id IS NULL OR r.desde IS NULL OR r.hasta IS NULL OR r.desde<p.fecha_inicio OR r.hasta>p.fecha_fin OR r.desde>r.hasta OR r.evaluacion IS NULL OR r.evaluacion NOT IN ('numerica','cualitativa','no_aplica') OR r.referencia IS NULL OR char_length(btrim(r.referencia)) NOT BETWEEN 8 AND 350) THEN RAISE EXCEPTION 'Padrón con identificador, vigencia, tipo o referencia inválidos.'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_to_recordset(body->'rows') AS r(alumno_id bigint,grupo_materia_id bigint) GROUP BY 1,2 HAVING count(*)>1) THEN RAISE EXCEPTION 'Obligaciones duplicadas.'; END IF;
 ELSIF p_tipo='sesiones' THEN
  IF EXISTS(SELECT 1 FROM jsonb_to_recordset(body->'rows') AS r(grupo_materia_id bigint,fecha date,inicio time,fin time,estado text,referencia text) LEFT JOIN public.grupo_materias gm ON gm.id=r.grupo_materia_id
   WHERE gm.id IS NULL OR r.fecha IS NULL OR r.fecha NOT BETWEEN p.fecha_inicio AND p.fecha_fin OR r.inicio IS NULL OR r.fin IS NULL OR r.inicio>=r.fin OR r.estado IS NULL OR r.estado NOT IN ('programada','impartida','cancelada') OR r.referencia IS NULL OR char_length(btrim(r.referencia)) NOT BETWEEN 8 AND 350) THEN RAISE EXCEPTION 'Sesiones con fecha, franja, asignación, estado o referencia inválidos.'; END IF;
  IF EXISTS(WITH seq AS (SELECT *,max(fin) OVER(PARTITION BY grupo_materia_id,fecha ORDER BY inicio,fin ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS anterior FROM jsonb_to_recordset(body->'rows') AS r(grupo_materia_id bigint,fecha date,inicio time,fin time)) SELECT 1 FROM seq WHERE anterior>inicio) THEN RAISE EXCEPTION 'Sesiones traslapadas.'; END IF;
 ELSIF p_tipo='cualitativas' THEN
  IF p_accion<>'devolver' THEN
   SELECT * INTO pr FROM public.jaguar360_evidencias_periodo WHERE periodo_id=p_periodo AND tipo='padron' ORDER BY version DESC LIMIT 1;
   IF pr.estado IS DISTINCT FROM 'revisada' OR pr.version::text IS DISTINCT FROM body->>'padron_version' THEN RAISE EXCEPTION 'El resultado AP/RP requiere el padrón vigente revisado.'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_to_recordset(body->'rows') AS q(alumno_id bigint,grupo_materia_id bigint,resultado text,referencia text)
    WHERE q.resultado IS NULL OR q.resultado NOT IN ('AP','RP') OR q.referencia IS NULL OR char_length(btrim(q.referencia)) NOT BETWEEN 8 AND 350
    OR NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(pr.contenido->'rows') AS r(alumno_id bigint,grupo_materia_id bigint,evaluacion text) WHERE r.alumno_id=q.alumno_id AND r.grupo_materia_id=q.grupo_materia_id AND r.evaluacion='cualitativa')) THEN RAISE EXCEPTION 'Resultado AP/RP fuera del padrón cualitativo o inválido.'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_to_recordset(body->'rows') AS q(alumno_id bigint,grupo_materia_id bigint) GROUP BY 1,2 HAVING count(*)>1) THEN RAISE EXCEPTION 'Resultado cualitativo duplicado.'; END IF;
  END IF;
 ELSE
  -- Marcas de sesión: conciliación histórica documentada, no escritura de asistencia oficial.
  -- Una devolución puede registrar el rechazo de una propuesta obsoleta, pero no revisarla.
  IF p_accion<>'devolver' THEN
   SELECT * INTO pr FROM public.jaguar360_evidencias_periodo WHERE periodo_id=p_periodo AND tipo='padron' ORDER BY version DESC LIMIT 1;
   SELECT * INTO sr FROM public.jaguar360_evidencias_periodo WHERE periodo_id=p_periodo AND tipo='sesiones' ORDER BY version DESC LIMIT 1;
   IF pr.estado IS DISTINCT FROM 'revisada' OR sr.estado IS DISTINCT FROM 'revisada' OR pr.version::text IS DISTINCT FROM body->>'padron_version' OR sr.version::text IS DISTINCT FROM body->>'sesiones_version' THEN RAISE EXCEPTION 'Las marcas requieren las versiones vigentes revisadas del padrón y las sesiones.'; END IF;
   IF EXISTS(
    WITH roster AS (SELECT * FROM jsonb_to_recordset(pr.contenido->'rows') AS r(alumno_id bigint,grupo_materia_id bigint,desde date,hasta date)),
    sessions AS (SELECT * FROM jsonb_to_recordset(sr.contenido->'rows') AS s(grupo_materia_id bigint,fecha date,inicio time,estado text))
    SELECT 1 FROM jsonb_to_recordset(body->'rows') AS m(alumno_id bigint,grupo_materia_id bigint,fecha date,inicio time,estado text,referencia text)
    WHERE m.estado IS NULL OR m.estado NOT IN ('presente','retardo','falta','justificada') OR m.referencia IS NULL OR char_length(btrim(m.referencia)) NOT BETWEEN 8 AND 350
      OR NOT EXISTS(SELECT 1 FROM roster r WHERE r.alumno_id=m.alumno_id AND r.grupo_materia_id=m.grupo_materia_id AND m.fecha BETWEEN r.desde AND r.hasta)
      OR NOT EXISTS(SELECT 1 FROM sessions s WHERE s.grupo_materia_id=m.grupo_materia_id AND s.fecha=m.fecha AND s.inicio=m.inicio AND s.estado='impartida')
   ) THEN RAISE EXCEPTION 'Marca inválida, fuera del padrón exigible o sesión no impartida.'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_to_recordset(body->'rows') AS m(alumno_id bigint,grupo_materia_id bigint,fecha date,inicio time) GROUP BY 1,2,3,4 HAVING count(*)>1) THEN RAISE EXCEPTION 'Marca de sesión duplicada.'; END IF;
  END IF;
 END IF;
 INSERT INTO public.jaguar360_evidencias_periodo(periodo_id,tipo,version,estado,contenido,actor_id,actor_nombre,actor_cargo,motivo,precedente_id)
 VALUES(p_periodo,p_tipo,p_version+1,CASE p_accion WHEN 'proponer' THEN 'propuesta' WHEN 'revisar' THEN 'revisada' ELSE 'devuelta' END,body,p_actor,coalesce(a.nombre_completo,'Sin nombre'),a.rol,btrim(p_motivo),prev.id) RETURNING * INTO outrow;
 RETURN jsonb_build_object('id',outrow.id::text,'version',outrow.version,'estado',outrow.estado,'registros',n);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_registrar_evidencia(uuid,bigint,text,integer,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jaguar360_registrar_evidencia(uuid,bigint,text,integer,text,jsonb,text) TO service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_conciliar_evidencia(p_actor uuid,p_periodo bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.jaguar360_evidencias_periodo; s public.jaguar360_evidencias_periodo; m public.jaguar360_evidencias_periodo; q public.jaguar360_evidencias_periodo; result jsonb; marcas_vigentes boolean; hist jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('direccion_escolar','coordinacion_academica','control_escolar','control')) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM public.jaguar360_evidencias_periodo WHERE periodo_id=p_periodo AND tipo='padron' ORDER BY version DESC LIMIT 1;
 SELECT * INTO s FROM public.jaguar360_evidencias_periodo WHERE periodo_id=p_periodo AND tipo='sesiones' ORDER BY version DESC LIMIT 1;
 SELECT * INTO m FROM public.jaguar360_evidencias_periodo WHERE periodo_id=p_periodo AND tipo='marcas' ORDER BY version DESC LIMIT 1;
 SELECT * INTO q FROM public.jaguar360_evidencias_periodo WHERE periodo_id=p_periodo AND tipo='cualitativas' ORDER BY version DESC LIMIT 1;
 marcas_vigentes:=coalesce(m.estado='revisada' AND p.estado='revisada' AND s.estado='revisada' AND m.contenido->>'padron_version'=p.version::text AND m.contenido->>'sesiones_version'=s.version::text,false);
 SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.tipo,h.version DESC),'[]'::jsonb) INTO hist FROM (SELECT tipo,version,estado,actor_nombre,actor_cargo,motivo,creado_at,jsonb_array_length(contenido->'rows') AS registros FROM public.jaguar360_evidencias_periodo WHERE periodo_id=p_periodo ORDER BY id DESC LIMIT 100) h;
 IF p.id IS NULL OR s.id IS NULL THEN RETURN jsonb_build_object('historial',hist,'padron_version',coalesce(p.version,0),'sesiones_version',coalesce(s.version,0),'marcas_version',coalesce(m.version,0),'cualitativas_version',coalesce(q.version,0),'cierre_disponible',false); END IF;
 WITH roster AS (SELECT * FROM jsonb_to_recordset(p.contenido->'rows') AS r(alumno_id bigint,grupo_materia_id bigint,desde date,hasta date,evaluacion text)),
 sessions AS (SELECT * FROM jsonb_to_recordset(s.contenido->'rows') AS r(grupo_materia_id bigint,fecha date,inicio time,fin time,estado text)),
 held AS (SELECT *,count(*) OVER(PARTITION BY grupo_materia_id,fecha) AS same_day FROM sessions WHERE estado='impartida'),
 expected AS (SELECT r.alumno_id,r.grupo_materia_id,h.fecha,h.inicio,h.same_day FROM roster r JOIN held h ON h.grupo_materia_id=r.grupo_materia_id AND h.fecha BETWEEN r.desde AND r.hasta),
 explicit_marks AS (SELECT * FROM jsonb_to_recordset(CASE WHEN marcas_vigentes THEN m.contenido->'rows' ELSE '[]'::jsonb END) AS z(alumno_id bigint,grupo_materia_id bigint,fecha date,inicio time,estado text)),
 marks AS (SELECT e.*,a.id AS attendance_id,z.estado AS explicit_state FROM expected e LEFT JOIN public.asistencias a ON a.alumno_id=e.alumno_id AND a.grupo_materia_id=e.grupo_materia_id AND a.fecha=e.fecha LEFT JOIN explicit_marks z ON z.alumno_id=e.alumno_id AND z.grupo_materia_id=e.grupo_materia_id AND z.fecha=e.fecha AND z.inicio=e.inicio)
 SELECT jsonb_build_object('historial',hist,'padron_version',p.version,'sesiones_version',s.version,'padron_revisado',p.estado='revisada','sesiones_revisadas',s.estado='revisada',
 'cualitativas_version',coalesce(q.version,0),'marcas_version',coalesce(m.version,0),'marcas_vigentes',marcas_vigentes,
 'asistencias_sesion_documentadas',(SELECT count(*) FROM marks WHERE explicit_state IS NOT NULL),
 'asistencias_sesion_ambiguas_pendientes',(SELECT count(*) FROM marks WHERE same_day>1 AND explicit_state IS NULL),
 'obligaciones',(SELECT count(*) FROM roster),'sesiones',(SELECT count(*) FROM held),
 'sin_nota_numerica',(SELECT count(*) FROM roster r WHERE r.evaluacion='numerica' AND NOT EXISTS(SELECT 1 FROM public.calificaciones c WHERE c.periodo_id=p_periodo AND c.alumno_id=r.alumno_id AND c.grupo_materia_id=r.grupo_materia_id AND c.calificacion IS NOT NULL)),
 'cualitativas_pendientes_integracion',(SELECT count(*) FROM roster r WHERE r.evaluacion='cualitativa' AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(CASE WHEN q.estado='revisada' AND q.contenido->>'padron_version'=p.version::text THEN q.contenido->'rows' ELSE '[]'::jsonb END) AS z(alumno_id bigint,grupo_materia_id bigint,resultado text) WHERE z.alumno_id=r.alumno_id AND z.grupo_materia_id=r.grupo_materia_id)),
 'registros_fuera_padron',(SELECT count(*) FROM public.calificaciones c WHERE c.periodo_id=p_periodo AND NOT EXISTS(SELECT 1 FROM roster r WHERE r.alumno_id=c.alumno_id AND r.grupo_materia_id=c.grupo_materia_id)),
 'asistencias_esperadas',(SELECT count(*) FROM marks),
 'asistencias_fecha_unica_con_registro',(SELECT count(*) FROM marks WHERE same_day=1 AND attendance_id IS NOT NULL),
 'asistencias_fecha_unica_sin_registro',(SELECT count(*) FROM marks WHERE same_day=1 AND attendance_id IS NULL),
 'asistencias_sesion_ambigua',(SELECT count(*) FROM marks WHERE same_day>1),
 'obligaciones_sin_sesiones',(SELECT count(*) FROM roster r WHERE NOT EXISTS(SELECT 1 FROM held h WHERE h.grupo_materia_id=r.grupo_materia_id AND h.fecha BETWEEN r.desde AND r.hasta)),
 'cierre_disponible',false)
 INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_conciliar_evidencia(uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jaguar360_conciliar_evidencia(uuid,bigint) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
