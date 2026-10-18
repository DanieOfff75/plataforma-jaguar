-- JAGUAR 6.0.2 · Contenido institucional publicado sólo por Dirección Escolar.
-- Ejecutar completo y UNA vez después de respaldo, primero en una base de pruebas.
-- No altera tablas, perfiles ni políticas RLS. Las modificaciones requieren actor,
-- motivo y revisión vigente; toda publicación queda auditada.
BEGIN;
CREATE OR REPLACE FUNCTION public.ithla_publicar_contenido_director(
 p_clave text, p_valor jsonb, p_revision integer, p_motivo text, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $ithla_602$
DECLARE old_val jsonb; old_rev integer; new_rev integer;
BEGIN
 IF auth.role() <> 'service_role' THEN
   RAISE EXCEPTION 'Operación exclusiva de la API institucional';
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM public.perfiles
   WHERE id = p_actor AND rol = 'direccion_escolar' AND activo = true
 ) THEN RAISE EXCEPTION 'Se requiere Dirección Escolar activa'; END IF;
 IF p_clave NOT IN ('institucion','portal','nexo') THEN
   RAISE EXCEPTION 'Esta configuración requiere autorización separada';
 END IF;
 IF jsonb_typeof(p_valor) IS DISTINCT FROM 'object'
   OR pg_catalog.octet_length(p_valor::text) > 30000 THEN
   RAISE EXCEPTION 'Datos de configuración inválidos';
 END IF;
 IF p_revision IS NULL OR p_revision < 1 THEN
   RAISE EXCEPTION 'Revisión inválida'; END IF;
 IF pg_catalog.length(pg_catalog.btrim(COALESCE(p_motivo,''))) NOT BETWEEN 12 AND 1500 THEN
   RAISE EXCEPTION 'El motivo debe contener entre 12 y 1500 caracteres'; END IF;
 SELECT valor, revision INTO old_val, old_rev FROM public.ithla_config
 WHERE clave = p_clave FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Configuración no encontrada'; END IF;
 IF old_rev <> p_revision THEN
   RAISE EXCEPTION 'La configuración cambió. Recarga antes de publicar'; END IF;
 IF old_val = p_valor THEN RAISE EXCEPTION 'No hay cambios que publicar'; END IF;
 UPDATE public.ithla_config SET valor=p_valor, revision=revision+1,
 actualizado_en=now() WHERE clave=p_clave RETURNING revision INTO new_rev;
 INSERT INTO public.ithla_auditoria
 (accion,actor,clave,anterior,posterior)
 VALUES ('contenido_publicado_por_direccion: ' || pg_catalog.left(p_motivo,140),p_actor,p_clave,old_val,p_valor);
 RETURN jsonb_build_object('ok',true,'clave',p_clave,'revision',new_rev);
END
$ithla_602$;
REVOKE ALL ON FUNCTION public.ithla_publicar_contenido_director(text,jsonb,integer,text,uuid)
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ithla_publicar_contenido_director(text,jsonb,integer,text,uuid)
 TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
