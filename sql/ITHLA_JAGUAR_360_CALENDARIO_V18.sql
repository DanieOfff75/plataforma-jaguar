BEGIN;
-- Documentary calendar, deliberately separate from actual sessions and attendance.
CREATE TABLE IF NOT EXISTS public.jaguar360_calendarios_propuestos (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 semana_id bigint NOT NULL REFERENCES public.jaguar360_semanas_propuestas(id) ON DELETE RESTRICT,
 ciclo text NOT NULL, huella text NOT NULL, propuesta jsonb NOT NULL,
 actor uuid NOT NULL, actor_nombre text NOT NULL, referencia text NOT NULL, motivo text NOT NULL,
 creado_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.jaguar360_calendarios_resoluciones (
 propuesta_id bigint PRIMARY KEY REFERENCES public.jaguar360_calendarios_propuestos(id) ON DELETE RESTRICT,
 estado text NOT NULL CHECK(estado IN ('reviewed','rejected')),
 actor uuid NOT NULL, actor_nombre text NOT NULL, referencia text NOT NULL, motivo text NOT NULL,
 creado_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.jaguar360_calendarios_propuestos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar360_calendarios_resoluciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_calendarios_propuestos, public.jaguar360_calendarios_resoluciones FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_calendario(p_actor uuid,p_ciclo text,p_op text DEFAULT NULL,p_id bigint DEFAULT NULL,p_week bigint DEFAULT NULL,p_fingerprint text DEFAULT NULL,p_proposal jsonb DEFAULT NULL,p_reference text DEFAULT NULL,p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; ctx jsonb; prev public.jaguar360_calendarios_propuestos; rows jsonb; w public.jaguar360_semanas_propuestas;
BEGIN
 IF p_op IS NOT NULL THEN
  LOCK TABLE public.perfiles,public.jaguar360_planes_ciclo,public.grupos,public.grupo_materias,public.alumnos,public.asignaciones_docentes,public.docentes,public.docente_disponibilidad,public.jaguar_aulas,public.horarios IN SHARE MODE NOWAIT;
  LOCK TABLE public.jaguar360_semanas_propuestas,public.jaguar360_semanas_resoluciones IN SHARE MODE NOWAIT;
  LOCK TABLE public.jaguar360_calendarios_propuestos,public.jaguar360_calendarios_resoluciones IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 END IF;
 SELECT rol,nombre_completo INTO a FROM public.perfiles WHERE id=p_actor AND activo IS TRUE;
 IF NOT FOUND OR a.rol NOT IN ('direccion_escolar','coordinacion_academica') THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 ctx:=public.jaguar360_contexto_semana(p_actor,p_ciclo);
 IF p_op IS NOT NULL THEN
  IF p_reference IS NULL OR char_length(btrim(p_reference)) NOT BETWEEN 5 AND 300 OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Referencia y motivo requeridos.'; END IF;
  IF p_op='save' THEN
   IF a.rol<>'coordinacion_academica' THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
   SELECT * INTO w FROM public.jaguar360_semanas_propuestas WHERE id=p_week AND ciclo=p_ciclo;
   IF NOT FOUND OR w.huella IS DISTINCT FROM ctx->>'fingerprint' OR p_fingerprint IS DISTINCT FROM ctx->>'fingerprint' OR NOT EXISTS(SELECT 1 FROM public.jaguar360_semanas_resoluciones WHERE propuesta_id=p_week AND estado='reviewed') THEN RAISE EXCEPTION 'Semana no revisada o desactualizada.'; END IF;
   IF jsonb_typeof(p_proposal) IS DISTINCT FROM 'object' OR octet_length(p_proposal::text)>1200000 OR p_proposal->>'official' IS DISTINCT FROM 'false' OR (p_proposal->>'period')::integer IS DISTINCT FROM w.periodo OR jsonb_typeof(p_proposal->'summary') IS DISTINCT FROM 'array' OR jsonb_typeof(p_proposal->'events') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Proyección inválida.'; END IF;
   IF EXISTS(SELECT 1 FROM public.jaguar360_calendarios_propuestos c WHERE c.semana_id=p_week AND c.huella=p_fingerprint AND c.propuesta=p_proposal) THEN RAISE EXCEPTION 'Proyección ya registrada.'; END IF;
   INSERT INTO public.jaguar360_calendarios_propuestos(semana_id,ciclo,huella,propuesta,actor,actor_nombre,referencia,motivo) VALUES(p_week,p_ciclo,p_fingerprint,p_proposal,p_actor,coalesce(a.nombre_completo,'Sin nombre'),btrim(p_reference),btrim(p_reason));
  ELSIF p_op IN ('review','reject') THEN
   IF a.rol<>'direccion_escolar' THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
   SELECT * INTO prev FROM public.jaguar360_calendarios_propuestos WHERE id=p_id AND ciclo=p_ciclo;
   IF NOT FOUND OR prev.actor=p_actor THEN RAISE EXCEPTION 'Sin propuesta independiente.' USING ERRCODE='42501'; END IF;
   IF EXISTS(SELECT 1 FROM public.jaguar360_calendarios_resoluciones WHERE propuesta_id=p_id) OR (p_op='review' AND prev.huella IS DISTINCT FROM ctx->>'fingerprint') THEN RAISE EXCEPTION 'Propuesta resuelta o catálogo modificado.'; END IF;
   INSERT INTO public.jaguar360_calendarios_resoluciones(propuesta_id,estado,actor,actor_nombre,referencia,motivo) VALUES(p_id,CASE WHEN p_op='review' THEN 'reviewed' ELSE 'rejected' END,p_actor,coalesce(a.nombre_completo,'Sin nombre'),btrim(p_reference),btrim(p_reason));
  ELSE RAISE EXCEPTION 'Operación inválida.'; END IF;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id::text,'week',x.semana_id::text,'period',x.propuesta->'period','summary',x.propuesta->'summary','events',x.propuesta->'events','sessionCount',x.propuesta->'sessionCount','actor',x.actor_nombre,'reference',x.referencia,'reason',x.motivo,'at',x.creado_at,'current',x.huella=(ctx->>'fingerprint'),'state',coalesce(r.estado,'proposed'),'review',to_jsonb(r)-'propuesta_id') ORDER BY x.id DESC),'[]'::jsonb) INTO rows FROM (SELECT * FROM public.jaguar360_calendarios_propuestos WHERE ciclo=p_ciclo ORDER BY id DESC LIMIT 20) x LEFT JOIN public.jaguar360_calendarios_resoluciones r ON r.propuesta_id=x.id;
 RETURN jsonb_build_object('rows',rows);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_calendario(uuid,text,text,bigint,bigint,text,jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_calendario(uuid,text,text,bigint,bigint,text,jsonb,text,text) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
