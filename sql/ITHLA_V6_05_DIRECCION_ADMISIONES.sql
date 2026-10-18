-- Dirección Escolar puede abrir, pausar y cerrar directamente desde Jaguar.
-- Operación atómica; bloquea mismo registro de config que usa el RPC público de inscripción.
BEGIN;
CREATE OR REPLACE FUNCTION public.ithla_direccion_cambiar_convocatoria(p_estado text,p_motivo text,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $ithla$
DECLARE v_old jsonb;v_new jsonb; v_revision integer;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Acceso sólo desde el servidor'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo=true AND rol='direccion_escolar') THEN
   RAISE EXCEPTION 'Únicamente Dirección Escolar autoriza cambios de convocatoria';
 END IF;
 IF p_estado NOT IN ('abierto','pausado','cerrado') THEN RAISE EXCEPTION 'Estado no permitido'; END IF;
 IF length(trim(coalesce(p_motivo,'')))<12 OR length(p_motivo)>1000 THEN RAISE EXCEPTION 'Motivo requerido de 12 a 1000 caracteres'; END IF;
 SELECT valor INTO v_old FROM public.ithla_config WHERE clave='admisiones' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Falta la configuración de admisiones'; END IF;
 -- Al reabrir manualmente, fechas caducadas anteriores no bloquean la autorización.
 v_new:=jsonb_set(v_old,'{estado}',to_jsonb(p_estado));
 IF p_estado='abierto' THEN
   v_new:=jsonb_set(jsonb_set(v_new,'{fecha_inicio}','null'::jsonb),'{fecha_fin}','null'::jsonb);
 END IF;
 UPDATE public.ithla_config SET valor=v_new,revision=revision+1,actualizado_en=now()
 WHERE clave='admisiones' RETURNING revision INTO v_revision;
 INSERT INTO public.ithla_auditoria(accion,actor,clave,anterior,posterior)
 VALUES('direccion_convocatoria_'||p_estado,p_actor,'admisiones',v_old,v_new);
 RETURN jsonb_build_object('estado',p_estado,'revision',v_revision,'ok',true);
END
$ithla$;
REVOKE ALL ON FUNCTION public.ithla_direccion_cambiar_convocatoria(text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ithla_direccion_cambiar_convocatoria(text,text,uuid) TO service_role;
COMMIT;
