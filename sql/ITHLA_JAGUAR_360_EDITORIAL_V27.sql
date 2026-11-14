-- Experimental public editorial workflow. No internal notice or recipient is copied.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar360_editorial_propuestas (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE RESTRICT,
 cargo text NOT NULL,
 titulo text NOT NULL CHECK(char_length(titulo) BETWEEN 6 AND 180),
 contenido text NOT NULL CHECK(char_length(contenido) BETWEEN 15 AND 6000),
 referencia text NOT NULL CHECK(char_length(referencia) BETWEEN 5 AND 300),
 motivo text NOT NULL CHECK(char_length(motivo) BETWEEN 15 AND 1500),
 creado_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.jaguar360_editorial_resoluciones (
 propuesta_id bigint NOT NULL REFERENCES public.jaguar360_editorial_propuestas(id) ON DELETE RESTRICT,
 estado text NOT NULL CHECK(estado IN ('publicado','rechazado','retirado')),
 actor uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE RESTRICT,
 motivo text NOT NULL CHECK(char_length(motivo) BETWEEN 15 AND 1500),
 creado_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(propuesta_id,estado)
);
ALTER TABLE public.jaguar360_editorial_propuestas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar360_editorial_resoluciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_editorial_propuestas,public.jaguar360_editorial_resoluciones FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_editorial_publica()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(x.item ORDER BY x.id DESC),'[]'::jsonb) FROM (
 SELECT p.id,jsonb_build_object('id','editorial-'||p.id::text,'titulo',p.titulo,'contenido',p.contenido,'fecha_publicacion',r.creado_at,'responsable_nombre','Dirección Escolar') item
 FROM public.jaguar360_editorial_propuestas p JOIN public.jaguar360_editorial_resoluciones r ON r.propuesta_id=p.id AND r.estado='publicado'
 WHERE NOT EXISTS(SELECT 1 FROM public.jaguar360_editorial_resoluciones x WHERE x.propuesta_id=p.id AND x.estado IN ('retirado','rechazado'))
 ORDER BY p.id DESC LIMIT 40) x;
$$;
CREATE OR REPLACE FUNCTION public.jaguar360_editorial_gestion(p_actor uuid,p_op text DEFAULT NULL,p_id bigint DEFAULT NULL,p_titulo text DEFAULT NULL,p_contenido text DEFAULT NULL,p_referencia text DEFAULT NULL,p_motivo text DEFAULT NULL,p_confirmed_public boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cargo_actor text; proposed public.jaguar360_editorial_propuestas; rows_json jsonb;
roles constant text[]:=ARRAY['control_escolar','control','coordinacion_academica','servicios_docentes','servicios_estudiantiles','prefectura','archivo_escolar','recursos_monetarios','direccion_escolar'];
BEGIN
 IF p_op IS NOT NULL THEN
  LOCK TABLE public.perfiles IN SHARE MODE NOWAIT;
  LOCK TABLE public.jaguar360_editorial_propuestas,public.jaguar360_editorial_resoluciones IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 END IF;
 SELECT rol INTO cargo_actor FROM public.perfiles WHERE id=p_actor AND activo IS TRUE;
 IF cargo_actor IS NULL OR NOT cargo_actor=ANY(roles) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF p_op IS NOT NULL AND (p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500) THEN RAISE EXCEPTION 'Motivo requerido.'; END IF;
 IF p_op='propose' THEN
  IF cargo_actor='direccion_escolar' THEN RAISE EXCEPTION 'Propuesta departamental requerida.' USING ERRCODE='42501'; END IF;
  IF p_confirmed_public IS DISTINCT FROM true OR p_titulo IS NULL OR char_length(btrim(p_titulo)) NOT BETWEEN 6 AND 180 OR p_contenido IS NULL OR char_length(btrim(p_contenido)) NOT BETWEEN 15 AND 6000 OR p_referencia IS NULL OR char_length(btrim(p_referencia)) NOT BETWEEN 5 AND 300 THEN RAISE EXCEPTION 'Texto público y confirmación requeridos.'; END IF;
  INSERT INTO public.jaguar360_editorial_propuestas(actor,cargo,titulo,contenido,referencia,motivo) VALUES(p_actor,cargo_actor,btrim(p_titulo),btrim(p_contenido),btrim(p_referencia),btrim(p_motivo));
 ELSIF p_op IN ('publish','reject','withdraw') THEN
  IF cargo_actor<>'direccion_escolar' THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
  SELECT * INTO proposed FROM public.jaguar360_editorial_propuestas WHERE id=p_id;
  IF NOT FOUND OR proposed.actor=p_actor THEN RAISE EXCEPTION 'Revisión independiente requerida.'; END IF;
  IF p_op='withdraw' THEN
   IF NOT EXISTS(SELECT 1 FROM public.jaguar360_editorial_resoluciones WHERE propuesta_id=p_id AND estado='publicado') OR EXISTS(SELECT 1 FROM public.jaguar360_editorial_resoluciones WHERE propuesta_id=p_id AND estado IN ('rechazado','retirado')) THEN RAISE EXCEPTION 'Publicación no vigente.'; END IF;
  ELSE
   IF EXISTS(SELECT 1 FROM public.jaguar360_editorial_resoluciones WHERE propuesta_id=p_id) THEN RAISE EXCEPTION 'Propuesta ya resuelta.'; END IF;
   IF p_op='publish' AND p_confirmed_public IS DISTINCT FROM true THEN RAISE EXCEPTION 'Confirma revisión de privacidad.'; END IF;
  END IF;
  INSERT INTO public.jaguar360_editorial_resoluciones(propuesta_id,estado,actor,motivo) VALUES(p_id,CASE p_op WHEN 'publish' THEN 'publicado' WHEN 'reject' THEN 'rechazado' ELSE 'retirado' END,p_actor,btrim(p_motivo));
 ELSIF p_op IS NOT NULL THEN RAISE EXCEPTION 'Operación inválida.';
 END IF;
 SELECT coalesce(jsonb_agg(x.item ORDER BY x.id DESC),'[]'::jsonb) INTO rows_json FROM (
 SELECT p.id,jsonb_build_object('id',p.id::text,'title',p.titulo,'body',p.contenido,'senderRole',p.cargo,'reference',p.referencia,'reason',p.motivo,'createdAt',p.creado_at,'state',coalesce((SELECT r.estado FROM public.jaguar360_editorial_resoluciones r WHERE r.propuesta_id=p.id ORDER BY CASE WHEN r.estado='retirado' THEN 1 ELSE 0 END DESC,r.creado_at DESC LIMIT 1),'propuesta')) item
 FROM public.jaguar360_editorial_propuestas p WHERE cargo_actor='direccion_escolar' OR p.actor=p_actor AND p.cargo=cargo_actor ORDER BY p.id DESC LIMIT 100) x;
 RETURN jsonb_build_object('rows',rows_json,'canResolve',cargo_actor='direccion_escolar','canPropose',cargo_actor<>'direccion_escolar');
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_editorial_publica(),public.jaguar360_editorial_gestion(uuid,text,bigint,text,text,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_editorial_publica(),public.jaguar360_editorial_gestion(uuid,text,bigint,text,text,text,text,boolean) TO service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_proteger_aviso_publico_legacy()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.destino_publicacion IN ('publica','ambas') THEN RAISE EXCEPTION 'Conserva el aviso público histórico.'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.destino_publicacion IN ('publica','ambas') THEN RAISE EXCEPTION 'Utiliza revisión editorial para nuevas publicaciones.'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.destino_publicacion IN ('publica','ambas') THEN
  IF NEW IS DISTINCT FROM OLD THEN
   IF current_user <> (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.avisos'::regclass) THEN RAISE EXCEPTION 'Retiro exclusivo de la API institucional.' USING ERRCODE='42501'; END IF;
   IF OLD.activo IS DISTINCT FROM true OR NEW.activo IS DISTINCT FROM false OR (to_jsonb(NEW)-'activo'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'activo'-'updated_at') THEN RAISE EXCEPTION 'Solo retiro de aviso público permitido.'; END IF;
  END IF;
 ELSIF NEW.destino_publicacion IN ('publica','ambas') THEN RAISE EXCEPTION 'Utiliza revisión editorial para nuevas publicaciones.';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_proteger_aviso_publico_legacy() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS jaguar360_proteger_aviso_publico_legacy ON public.avisos;
CREATE TRIGGER jaguar360_proteger_aviso_publico_legacy BEFORE INSERT OR UPDATE OR DELETE ON public.avisos FOR EACH ROW EXECUTE FUNCTION public.jaguar360_proteger_aviso_publico_legacy();
CREATE TABLE IF NOT EXISTS public.jaguar360_editorial_retiros_legacy (
 aviso_id text PRIMARY KEY,
 actor uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE RESTRICT,
 motivo text NOT NULL CHECK(char_length(motivo) BETWEEN 15 AND 1500),
 antes jsonb NOT NULL, creado_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.jaguar360_editorial_retiros_legacy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_editorial_retiros_legacy FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_editorial_legacy(p_actor uuid,p_id text DEFAULT NULL,p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_row public.avisos; items jsonb;
BEGIN
 IF p_id IS NOT NULL THEN LOCK TABLE public.perfiles IN SHARE MODE NOWAIT; LOCK TABLE public.avisos,public.jaguar360_editorial_retiros_legacy IN SHARE ROW EXCLUSIVE MODE NOWAIT; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol='direccion_escolar') THEN RAISE EXCEPTION 'Solo Dirección.' USING ERRCODE='42501'; END IF;
 IF p_id IS NOT NULL THEN
  IF p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Motivo requerido.'; END IF;
  SELECT * INTO old_row FROM public.avisos WHERE id::text=p_id AND activo IS TRUE AND destino_publicacion IN ('publica','ambas');
  IF NOT FOUND THEN RAISE EXCEPTION 'Aviso no vigente.'; END IF;
  UPDATE public.avisos SET activo=false WHERE id::text=p_id;
  INSERT INTO public.jaguar360_editorial_retiros_legacy(aviso_id,actor,motivo,antes) VALUES(p_id,p_actor,btrim(p_motivo),to_jsonb(old_row));
 END IF;
 SELECT coalesce(jsonb_agg(x.item ORDER BY x.id DESC),'[]'::jsonb) INTO items FROM (SELECT id,jsonb_build_object('id',id::text,'title',titulo,'body',contenido,'scope',destino_publicacion) item FROM public.avisos WHERE activo IS TRUE AND destino_publicacion IN ('publica','ambas') ORDER BY id DESC LIMIT 100) x;
 RETURN items;
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_editorial_legacy(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_editorial_legacy(uuid,text,text) TO service_role;
-- Suppress resurrection through the V7 public JSON fallback, including matching titles from retired legacy notices.
CREATE OR REPLACE FUNCTION public.jaguar360_editorial_titulos_retirados()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM (SELECT antes->>'titulo' t FROM public.jaguar360_editorial_retiros_legacy UNION SELECT p.titulo FROM public.jaguar360_editorial_propuestas p JOIN public.jaguar360_editorial_resoluciones r ON p.id=r.propuesta_id WHERE r.estado='retirado') x;
$$;
REVOKE ALL ON FUNCTION public.jaguar360_editorial_titulos_retirados() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_editorial_titulos_retirados() TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
