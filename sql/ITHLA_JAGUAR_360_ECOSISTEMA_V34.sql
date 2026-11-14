-- Validar primero sobre clon aislado. Compatible con catálogo exportado PostgreSQL 17.6.
BEGIN;
-- V26 ya añadió rol_activo. Invalidar sesiones anteriores de los dos sitios externos.
UPDATE public.ithla_sesiones SET revocada_en=now()
 WHERE aplicacion IN ('admisiones','centro') AND rol_activo IS NULL AND revocada_en IS NULL;
CREATE OR REPLACE FUNCTION public.jaguar360_revocar_operador_centro() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.ithla_sesiones SET revocada_en=now() WHERE usuario_id=OLD.usuario_id AND aplicacion='centro' AND revocada_en IS NULL;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.usuario_id IS DISTINCT FROM OLD.usuario_id THEN
  UPDATE public.ithla_sesiones SET revocada_en=now() WHERE usuario_id=NEW.usuario_id AND aplicacion='centro' AND revocada_en IS NULL;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_revocar_operador_centro() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS jaguar360_revocar_operador_centro ON public.ithla_centro_operadores;
CREATE TRIGGER jaguar360_revocar_operador_centro AFTER UPDATE OR DELETE ON public.ithla_centro_operadores FOR EACH ROW EXECUTE FUNCTION public.jaguar360_revocar_operador_centro();
-- Prevent legacy portal JSON edits bypassing the independent editorial review.
-- Existing notices are retained; migration or withdrawal of these legacy JSON items requires an explicit authorized workflow.
CREATE OR REPLACE FUNCTION public.jaguar360_guardar_config_editorial() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.clave='portal' AND (NEW.clave IS DISTINCT FROM OLD.clave OR NEW.valor->'avisos' IS DISTINCT FROM OLD.valor->'avisos') THEN
   RAISE EXCEPTION 'Gestiona los avisos públicos en el Centro editorial de Jaguar.' USING ERRCODE='42501';
  END IF;
 ELSIF OLD.clave='portal' THEN RAISE EXCEPTION 'No se permite eliminar la configuración del portal.' USING ERRCODE='42501';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_guardar_config_editorial() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS jaguar360_guardar_config_editorial ON public.ithla_config;
CREATE TRIGGER jaguar360_guardar_config_editorial BEFORE UPDATE OR DELETE ON public.ithla_config FOR EACH ROW EXECUTE FUNCTION public.jaguar360_guardar_config_editorial();
-- Accept/reject and queue insertion in one transaction, lock the row and check real actor.
CREATE OR REPLACE FUNCTION public.jaguar360_resolver_admision(p_actor uuid,p_aspirante bigint,p_accion text,p_motivo text,p_nota numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE oldrow public.aspirantes%ROWTYPE; updated public.aspirantes%ROWTYPE; correo_actor text; minimo numeric; config_min text; outcome text; motivo text; ts timestamptz:=now();
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Acceso exclusivo del servidor' USING ERRCODE='42501'; END IF;
 SELECT coalesce(correo,id::text) INTO correo_actor FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('control','control_escolar','direccion_escolar') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Perfil no autorizado' USING ERRCODE='42501'; END IF;
 IF p_accion IS NULL OR p_accion NOT IN ('aceptar','rechazar','examen') THEN RAISE EXCEPTION 'Acción inválida'; END IF;
 IF length(coalesce(p_motivo,''))>1500 THEN RAISE EXCEPTION 'Motivo demasiado largo'; END IF;
 SELECT * INTO oldrow FROM public.aspirantes WHERE id=p_aspirante FOR UPDATE;
 IF NOT FOUND OR oldrow.numero_matricula IS NOT NULL THEN RAISE EXCEPTION 'Solicitud no disponible'; END IF;
 IF p_accion='examen' THEN
  IF oldrow.estado NOT IN ('cita_examen','examen_presentado') OR p_nota IS NULL OR p_nota<0 OR p_nota>100 OR p_nota<>trunc(p_nota,2) THEN RAISE EXCEPTION 'Estado o calificación inválida'; END IF;
  SELECT valor INTO config_min FROM public.configuracion_admision WHERE clave='puntaje_minimo_examen' FOR SHARE;
  IF NOT FOUND THEN minimo:=70;
  ELSE
   IF config_min !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' THEN RAISE EXCEPTION 'Puntaje mínimo inválido'; END IF;
   minimo:=config_min::numeric;
   IF minimo<0 OR minimo>100 THEN RAISE EXCEPTION 'Puntaje mínimo inválido'; END IF;
  END IF;
  outcome:=CASE WHEN p_nota>=minimo THEN 'aceptado' ELSE 'rechazado' END;
  motivo:=CASE WHEN outcome='rechazado' THEN 'Calificación de examen: '||p_nota||'. Puntaje mínimo requerido: '||minimo||'.' END;
 ELSE
  IF oldrow.estado NOT IN ('pendiente','pendiente_promedio','pendiente_beca','cita_beca') OR p_nota IS NOT NULL THEN RAISE EXCEPTION 'La solicitud exige un procedimiento distinto o ya fue resuelta'; END IF;
  outcome:=CASE WHEN p_accion='aceptar' THEN 'aceptado' ELSE 'rechazado' END;
  IF outcome='rechazado' THEN motivo:=nullif(btrim(p_motivo),''); IF motivo IS NULL THEN RAISE EXCEPTION 'Indica el motivo de rechazo'; END IF; END IF;
 END IF;
 UPDATE public.aspirantes SET estado=outcome,motivo_rechazo=motivo,fecha_resolucion=ts,resuelto_por=correo_actor,
  calificacion_examen=CASE WHEN p_accion='examen' THEN p_nota ELSE calificacion_examen END,
  puntaje_minimo_examen=CASE WHEN p_accion='examen' THEN minimo ELSE puntaje_minimo_examen END,
  examen_presentado_fecha=CASE WHEN p_accion='examen' THEN ts ELSE examen_presentado_fecha END,
  examen_calificado_por=CASE WHEN p_accion='examen' THEN correo_actor ELSE examen_calificado_por END,
  examen_observaciones=CASE WHEN p_accion='examen' THEN nullif(btrim(p_motivo),'') ELSE examen_observaciones END,
  notificacion_email_enviada=false,notificacion_email_fecha=NULL,notificacion_email_error=NULL
 WHERE id=p_aspirante RETURNING * INTO updated;
 IF outcome='aceptado' THEN
  INSERT INTO public.ithla_inscripciones_pendientes(aspirante_id,aceptado_en) VALUES(p_aspirante,ts)
  ON CONFLICT(aspirante_id) DO NOTHING;
  IF EXISTS(SELECT 1 FROM public.ithla_inscripciones_pendientes WHERE aspirante_id=p_aspirante AND matriculado_en IS NOT NULL) THEN RAISE EXCEPTION 'Inscripción previa incompatible'; END IF;
 END IF;
 INSERT INTO public.ithla_auditoria(accion,actor,clave,anterior,posterior)
 VALUES('resolucion_admision',p_actor,'admisiones',jsonb_build_object('aspirante_id',p_aspirante::text,'estado',oldrow.estado),jsonb_build_object('aspirante_id',p_aspirante::text,'estado',outcome,'calificacion',p_nota,'minimo',minimo));
 RETURN to_jsonb(updated);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_resolver_admision(uuid,bigint,text,text,numeric) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_resolver_admision(uuid,bigint,text,text,numeric) TO service_role;

-- Restrict direct terminal state edits via older application versions. The named
-- SECURITY DEFINER RPC runs as its owner; trusted DB owner maintenance remains possible.
CREATE OR REPLACE FUNCTION public.jaguar360_proteger_resolucion_admision() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.estado IS DISTINCT FROM OLD.estado AND (NEW.estado IN ('aceptado','rechazado') OR OLD.estado IN ('aceptado','rechazado')) THEN
  IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.jaguar360_resolver_admision(uuid,bigint,text,text,numeric)'::regprocedure) THEN
   RAISE EXCEPTION 'Resolución exclusiva del servicio de Admisiones autorizado.' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_proteger_resolucion_admision() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS jaguar360_proteger_resolucion_admision ON public.aspirantes;
CREATE TRIGGER jaguar360_proteger_resolucion_admision BEFORE UPDATE OF estado ON public.aspirantes FOR EACH ROW EXECUTE FUNCTION public.jaguar360_proteger_resolucion_admision();
-- Adapt the existing confirmation RPC, based on the supplied actual function definition.
CREATE OR REPLACE FUNCTION public.ithla_confirmar_inscripcion(p_aspirante_id bigint, p_matricula text, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_asp public.aspirantes%ROWTYPE; v_alumno_id bigint;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Acceso sólo desde el servidor'; END IF;
 PERFORM 1 FROM public.perfiles WHERE id=p_actor AND rol IN ('control','control_escolar') AND activo=true FOR SHARE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Se requiere Control Escolar activo';
 END IF;
 IF p_matricula IS NULL OR length(trim(p_matricula)) NOT BETWEEN 4 AND 30 THEN RAISE EXCEPTION 'Matrícula inválida'; END IF;
 SELECT * INTO v_asp FROM public.aspirantes WHERE id=p_aspirante_id FOR UPDATE;
 IF NOT FOUND OR v_asp.estado<>'aceptado' THEN RAISE EXCEPTION 'Aspirante no aceptado'; END IF;
 IF v_asp.numero_matricula IS NOT NULL THEN RAISE EXCEPTION 'La inscripción ya tiene matrícula asignada'; END IF;
 IF EXISTS(SELECT 1 FROM public.ithla_inscripciones_pendientes WHERE aspirante_id=p_aspirante_id AND matriculado_en IS NOT NULL) THEN RAISE EXCEPTION 'La inscripción ya fue confirmada'; END IF;
 -- Nunca enlazamos únicamente por nombre: ambas identidades deben coincidir.
 SELECT id INTO STRICT v_alumno_id FROM public.alumnos
 WHERE upper(trim(matricula))=upper(trim(p_matricula))
   AND upper(trim(curp))=upper(trim(v_asp.curp)) AND grupo_id IS NOT NULL
   AND activo IS TRUE AND estado_escolar='activo'
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'No existe un alumno activo de Jaguar con esa matrícula, CURP y grupo confirmado'; END IF;
 PERFORM 1 FROM public.grupos g JOIN public.alumnos a ON a.grupo_id=g.id WHERE a.id=v_alumno_id AND g.activo IS TRUE FOR SHARE OF g;
 IF NOT FOUND THEN RAISE EXCEPTION 'Grupo de ingreso no vigente'; END IF;
 UPDATE public.aspirantes SET numero_matricula=upper(trim(p_matricula)) WHERE id=p_aspirante_id;
 INSERT INTO public.ithla_inscripciones_pendientes(aspirante_id,aceptado_en,documentos_confirmados_en,confirmado_por,matriculado_en)
 VALUES(p_aspirante_id,coalesce(v_asp.fecha_resolucion,now()),now(),p_actor,now())
 ON CONFLICT(aspirante_id) DO UPDATE SET documentos_confirmados_en=now(),confirmado_por=p_actor,matriculado_en=now();
 INSERT INTO public.ithla_auditoria(accion,actor,clave,posterior)
 VALUES('inscripcion_confirmada',p_actor,'admisiones',jsonb_build_object('aspirante_id',p_aspirante_id,'alumno_id',v_alumno_id));
 RETURN jsonb_build_object('ok',true,'alumno_id',v_alumno_id,'matricula',upper(trim(p_matricula)));
END
$function$;
REVOKE ALL ON FUNCTION public.ithla_confirmar_inscripcion(bigint,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ithla_confirmar_inscripcion(bigint,text,uuid) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
