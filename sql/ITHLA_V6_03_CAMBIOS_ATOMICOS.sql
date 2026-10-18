-- Instalar luego de 00. El permiso académico requiere un director ACTIVO en perfiles.
BEGIN;
CREATE OR REPLACE FUNCTION public.ithla_resolver_cambio(p_cambio_id bigint, p_aprobar boolean, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $ithla$
DECLARE v_cambio public.ithla_cambios%ROWTYPE; v_anterior jsonb; v_revision integer;
BEGIN
 IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Acceso exclusivo del servidor'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND rol='direccion_escolar' AND activo=true) THEN
  RAISE EXCEPTION 'Sólo Dirección Escolar puede autorizar esta modificación';
 END IF;
 SELECT * INTO v_cambio FROM public.ithla_cambios WHERE id=p_cambio_id FOR UPDATE;
 IF NOT FOUND OR v_cambio.estado <> 'pendiente' THEN RAISE EXCEPTION 'La propuesta no está pendiente'; END IF;
 IF v_cambio.propuesto_por=p_actor THEN RAISE EXCEPTION 'La revisión requiere una persona distinta del solicitante'; END IF;
 IF p_aprobar THEN
  SELECT valor,revision INTO v_anterior,v_revision FROM public.ithla_config WHERE clave=v_cambio.clave FOR UPDATE;
  IF v_anterior IS NULL THEN RAISE EXCEPTION 'La configuración no existe'; END IF;
  IF v_revision<>v_cambio.revision_origen THEN RAISE EXCEPTION 'La propuesta parte de una versión antigua. Debe revisarse de nuevo'; END IF;
  UPDATE public.ithla_config SET valor=v_cambio.propuesto,revision=revision+1,actualizado_en=now()
   WHERE clave=v_cambio.clave RETURNING revision INTO v_revision;
 ELSE
  SELECT valor INTO v_anterior FROM public.ithla_config WHERE clave=v_cambio.clave;
 END IF;
 UPDATE public.ithla_cambios SET estado=CASE WHEN p_aprobar THEN 'aprobado' ELSE 'rechazado' END,
  resuelto_por=p_actor,resuelto_en=now() WHERE id=p_cambio_id;
 INSERT INTO public.ithla_auditoria(accion,actor,clave,anterior,posterior,cambio_id)
 VALUES(CASE WHEN p_aprobar THEN 'configuracion_aprobada' ELSE 'configuracion_rechazada' END,
 p_actor,v_cambio.clave,v_anterior,CASE WHEN p_aprobar THEN v_cambio.propuesto ELSE v_anterior END,p_cambio_id);
 RETURN jsonb_build_object('ok',true,'revision',v_revision,'estado',CASE WHEN p_aprobar THEN 'aprobado' ELSE 'rechazado' END);
END
$ithla$;
REVOKE ALL ON FUNCTION public.ithla_resolver_cambio(bigint,boolean,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ithla_resolver_cambio(bigint,boolean,uuid) TO service_role;
COMMIT;
