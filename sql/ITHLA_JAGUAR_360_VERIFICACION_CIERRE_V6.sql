-- V6: verificación persistente documental, NO cierra ni activa el periodo.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar360_verificaciones_cierre (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 periodo_id bigint NOT NULL REFERENCES public.periodos_escolares(id) ON DELETE RESTRICT,
 huella text NOT NULL CHECK(huella ~ '^[a-f0-9]{32}$'),
 evidencia jsonb NOT NULL CHECK(jsonb_typeof(evidencia)='object'),
 actor_id uuid NOT NULL, actor_nombre text NOT NULL,
 motivo text NOT NULL CHECK(char_length(motivo) BETWEEN 15 AND 1500),
 creado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jaguar360_verificacion_periodo_idx ON public.jaguar360_verificaciones_cierre(periodo_id,id DESC);
ALTER TABLE public.jaguar360_verificaciones_cierre ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_verificaciones_cierre FROM PUBLIC,anon,authenticated,service_role;
-- No direct SELECT of private snapshots; only the aggregate RPC below is exposed.
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
 held AS (SELECT *,count(*) OVER(PARTITION BY grupo_materia_id,fecha) AS n FROM jsonb_to_recordset(coalesce(s.contenido->'rows','[]'::jsonb)) AS h(grupo_materia_id bigint,fecha date,inicio time,fin time,estado text) WHERE estado='impartida'),
 marks AS (SELECT * FROM jsonb_to_recordset(CASE WHEN mv THEN m.contenido->'rows' ELSE '[]'::jsonb END) AS z(alumno_id bigint,grupo_materia_id bigint,fecha date,inicio time,estado text)),
 qualitative AS (SELECT * FROM jsonb_to_recordset(CASE WHEN qv THEN q.contenido->'rows' ELSE '[]'::jsonb END) AS z(alumno_id bigint,grupo_materia_id bigint,resultado text)),
 expected AS (SELECT r.alumno_id,r.grupo_materia_id,h.fecha,h.inicio,h.fin,h.n FROM roster r JOIN held h ON h.grupo_materia_id=r.grupo_materia_id AND h.fecha BETWEEN r.desde AND r.hasta),
 attendance AS (SELECT e.*,z.estado AS marca,CASE WHEN e.n=1 THEN a.estado ELSE NULL END AS legado,
 CASE WHEN z.estado IS NOT NULL THEN z.estado WHEN e.n=1 THEN a.estado ELSE NULL END AS estado
 FROM expected e LEFT JOIN marks z USING(alumno_id,grupo_materia_id,fecha,inicio) LEFT JOIN public.asistencias a USING(alumno_id,grupo_materia_id,fecha)),
 grades AS (SELECT r.alumno_id,r.grupo_materia_id,r.evaluacion,c.calificacion,c.calificacion_calculada,to_jsonb(c)->'calificacion_original_politica' AS fuente_original,c.observaciones,qq.resultado
 FROM roster r LEFT JOIN public.calificaciones c ON c.alumno_id=r.alumno_id AND c.grupo_materia_id=r.grupo_materia_id AND c.periodo_id=p_periodo
 LEFT JOIN qualitative qq ON qq.alumno_id=r.alumno_id AND qq.grupo_materia_id=r.grupo_materia_id),
 counts AS (SELECT jsonb_build_object(
 'obligaciones',(SELECT count(*) FROM roster),
 'sesiones_sin_confirmar',(SELECT count(*) FROM jsonb_to_recordset(coalesce(s.contenido->'rows','[]'::jsonb)) AS h(estado text) WHERE h.estado='programada'),
 'evidencias_sin_revision',(CASE WHEN m.id IS NOT NULL AND NOT mv THEN 1 ELSE 0 END)+(CASE WHEN q.id IS NOT NULL AND NOT qv THEN 1 ELSE 0 END),
 'vigencias_invalidas',(SELECT count(*) FROM roster r WHERE r.desde<pe.fecha_inicio OR r.hasta>pe.fecha_fin OR NOT EXISTS(SELECT 1 FROM public.alumnos al WHERE al.id=r.alumno_id) OR NOT EXISTS(SELECT 1 FROM public.grupo_materias gm WHERE gm.id=r.grupo_materia_id))+(SELECT count(*) FROM jsonb_to_recordset(coalesce(s.contenido->'rows','[]'::jsonb)) AS h(grupo_materia_id bigint,fecha date) WHERE h.fecha NOT BETWEEN pe.fecha_inicio AND pe.fecha_fin OR NOT EXISTS(SELECT 1 FROM public.grupo_materias gm WHERE gm.id=h.grupo_materia_id)),
 'sin_nota_numerica',(SELECT count(*) FROM grades WHERE evaluacion='numerica' AND calificacion IS NULL),
 'sin_resultado_ap_rp',(SELECT count(*) FROM grades WHERE evaluacion='cualitativa' AND resultado IS NULL),
 'notas_incompatibles',(SELECT count(*) FROM grades WHERE evaluacion<>'numerica' AND calificacion IS NOT NULL),
 'notas_fuera_padron',(SELECT count(*) FROM public.calificaciones c WHERE c.periodo_id=p_periodo AND NOT EXISTS(SELECT 1 FROM roster r WHERE r.alumno_id=c.alumno_id AND r.grupo_materia_id=c.grupo_materia_id)),
 'sesiones_exigibles',(SELECT count(*) FROM expected),
 'asistencia_pendiente',(SELECT count(*) FROM attendance WHERE estado IS NULL),
 'asistencia_en_conflicto',(SELECT count(*) FROM attendance WHERE marca IS NOT NULL AND legado IS NOT NULL AND marca<>legado),
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
  LOCK TABLE public.periodos_escolares,public.jaguar360_evidencias_periodo,public.calificaciones,public.asistencias,public.alumnos,public.grupo_materias IN SHARE MODE NOWAIT;
  PERFORM pg_advisory_xact_lock(hashtext('j360-verificacion:'||p_periodo));
 END IF;
 snap:=public.jaguar360_snapshot_verificacion(p_periodo); h:=md5(snap::text); r:=snap->'resumen';
 ready:=coalesce((snap->>'padrón_y_sesiones_revisados')::boolean AND (snap->>'periodo_transcurrido')::boolean
 AND (r->>'obligaciones')::bigint>0 AND (r->>'sesiones_exigibles')::bigint>0
 AND (r->>'evidencias_sin_revision')::bigint=0 AND (r->>'vigencias_invalidas')::bigint=0
 AND (r->>'sin_nota_numerica')::bigint=0 AND (r->>'sin_resultado_ap_rp')::bigint=0 AND (r->>'notas_incompatibles')::bigint=0
 AND (r->>'notas_fuera_padron')::bigint=0 AND (r->>'asistencia_pendiente')::bigint=0 AND (r->>'asistencia_en_conflicto')::bigint=0
 AND (r->>'obligaciones_sin_sesiones')::bigint=0 AND (r->>'sesiones_sin_confirmar')::bigint=0,false);
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
