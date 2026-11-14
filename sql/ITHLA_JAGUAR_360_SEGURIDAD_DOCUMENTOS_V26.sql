-- Experimental migration. Revoke old protected Jaguar sessions, bind new sessions to exact existing role,
-- and prevent issuance of obsolete legacy report cards. Does not alter Auth tokens or grant roles.
BEGIN;
ALTER TABLE public.ithla_sesiones ADD COLUMN IF NOT EXISTS rol_activo text;
UPDATE public.ithla_sesiones SET revocada_en=now() WHERE aplicacion='jaguar' AND rol_activo IS NULL AND revocada_en IS NULL;
CREATE OR REPLACE FUNCTION public.jaguar360_revocar_sesiones_cambio() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid; olduid uuid;
BEGIN
 IF TG_TABLE_NAME='perfiles' THEN
  IF OLD.rol IS NOT DISTINCT FROM NEW.rol AND OLD.activo IS NOT DISTINCT FROM NEW.activo THEN RETURN NEW; END IF;
  uid:=NEW.id; olduid:=OLD.id;
 ELSIF TG_TABLE_NAME='alumnos' THEN
  IF OLD.estado_escolar IS NOT DISTINCT FROM NEW.estado_escolar AND OLD.activo IS NOT DISTINCT FROM NEW.activo AND OLD.auth_user_id IS NOT DISTINCT FROM NEW.auth_user_id THEN RETURN NEW; END IF;
  uid:=NEW.auth_user_id; olduid:=OLD.auth_user_id;
 ELSIF TG_TABLE_NAME='docentes' THEN
  IF OLD.estado_profesional IS NOT DISTINCT FROM NEW.estado_profesional AND OLD.activo IS NOT DISTINCT FROM NEW.activo AND OLD.auth_user_id IS NOT DISTINCT FROM NEW.auth_user_id THEN RETURN NEW; END IF;
  uid:=NEW.auth_user_id; olduid:=OLD.auth_user_id;
 ELSE RAISE EXCEPTION 'Origen de revocación inválido.';
 END IF;
 UPDATE public.ithla_sesiones SET revocada_en=now() WHERE usuario_id IN (uid,olduid) AND revocada_en IS NULL;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_revocar_sesiones_cambio() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS jaguar360_revocar_perfil ON public.perfiles;
CREATE TRIGGER jaguar360_revocar_perfil AFTER UPDATE OF rol,activo ON public.perfiles FOR EACH ROW EXECUTE FUNCTION public.jaguar360_revocar_sesiones_cambio();
DROP TRIGGER IF EXISTS jaguar360_revocar_alumno ON public.alumnos;
CREATE TRIGGER jaguar360_revocar_alumno AFTER UPDATE OF estado_escolar,activo,auth_user_id ON public.alumnos FOR EACH ROW EXECUTE FUNCTION public.jaguar360_revocar_sesiones_cambio();
DROP TRIGGER IF EXISTS jaguar360_revocar_docente ON public.docentes;
CREATE TRIGGER jaguar360_revocar_docente AFTER UPDATE OF estado_profesional,activo,auth_user_id ON public.docentes FOR EACH ROW EXECUTE FUNCTION public.jaguar360_revocar_sesiones_cambio();
-- A boolean + codes only. No student data are exposed to client roles.
CREATE OR REPLACE FUNCTION public.jaguar360_boleta_bloqueos(p_alumno bigint,p_ciclo text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE reasons text[]:=ARRAY[]::text[];
BEGIN
 IF p_alumno IS NULL OR p_ciclo IS NULL OR p_ciclo !~ '^\d{4}-\d{4}$' OR NOT EXISTS(SELECT 1 FROM public.alumnos WHERE id=p_alumno) THEN RAISE EXCEPTION 'Expediente o ciclo inválido.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.alumnos a JOIN public.grupos g ON g.id=a.grupo_id WHERE a.id=p_alumno AND a.activo AND a.estado_escolar NOT IN ('baja','traslado','archivado','egresado') AND g.activo) THEN reasons:=array_append(reasons,'sin_grupo_vigente'); END IF;
 IF EXISTS(SELECT 1 FROM public.jaguar360_cierres_periodo s CROSS JOIN LATERAL jsonb_array_elements(s.evidencia->'notas') n WHERE s.ciclo=p_ciclo AND n->>'alumno_id'=p_alumno::text) THEN reasons:=array_append(reasons,'sello_academico'); END IF;
 IF EXISTS(SELECT 1 FROM public.jaguar360_rectificaciones r JOIN public.jaguar360_rectificacion_resoluciones d ON d.rectificacion_id=r.id AND d.estado='autorizada' JOIN public.periodos_escolares pe ON pe.id=r.periodo_id WHERE r.alumno_id=p_alumno AND pe.ciclo_escolar=p_ciclo) THEN reasons:=array_append(reasons,'rectificacion'); END IF;
 IF EXISTS(SELECT 1 FROM public.jaguar360_recuperaciones WHERE alumno_id=p_alumno AND ciclo=p_ciclo AND estado='autorizada') THEN reasons:=array_append(reasons,'recuperacion'); END IF;
 IF EXISTS(SELECT 1 FROM public.jaguar360_intentos_recursamiento i JOIN public.jaguar360_aplicacion_autorizaciones a ON a.reserva_id=i.reserva_id WHERE i.alumno_id=p_alumno AND i.ciclo=p_ciclo) THEN reasons:=array_append(reasons,'recursamiento'); END IF;
 IF EXISTS(SELECT 1 FROM public.jaguar360_listas_sesion l JOIN public.periodos_escolares pe ON pe.id=l.periodo_id CROSS JOIN LATERAL jsonb_array_elements(l.marcas) m WHERE pe.ciclo_escolar=p_ciclo AND m->>'student'=p_alumno::text) THEN reasons:=array_append(reasons,'asistencia_por_sesion'); END IF;
 IF EXISTS(SELECT 1 FROM public.jaguar360_evidencias_periodo e JOIN public.periodos_escolares pe ON pe.id=e.periodo_id CROSS JOIN LATERAL jsonb_array_elements(e.contenido->'rows') m WHERE pe.ciclo_escolar=p_ciclo AND e.tipo='cualitativas' AND e.estado='revisada' AND m->>'alumno_id'=p_alumno::text) THEN reasons:=array_append(reasons,'evaluacion_cualitativa'); END IF;
 RETURN jsonb_build_object('allowed',cardinality(reasons)=0,'reasons',to_jsonb(reasons));
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_boleta_bloqueos(bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_boleta_bloqueos(bigint,text) TO service_role;
-- Final check when issuing a verifiable official legacy report. Existing documents are unchanged.
CREATE OR REPLACE FUNCTION public.jaguar360_guardar_boleta_legacy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cyc text;
BEGIN
 IF lower(NEW.tipo) IS DISTINCT FROM 'boleta' THEN RETURN NEW; END IF;
 -- Prevent a concurrent change to evidence between this guard and the document insert.
 LOCK TABLE public.alumnos,public.grupos,public.periodos_escolares,public.jaguar360_cierres_periodo,public.jaguar360_rectificaciones,public.jaguar360_rectificacion_resoluciones,public.jaguar360_recuperaciones,public.jaguar360_intentos_recursamiento,public.jaguar360_aplicacion_autorizaciones,public.jaguar360_listas_sesion,public.jaguar360_evidencias_periodo IN SHARE MODE NOWAIT;
 IF (SELECT count(*) FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE)<>1 THEN RAISE EXCEPTION 'No se ha identificado un ciclo vigente único.'; END IF;
 SELECT ciclo_escolar INTO cyc FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE;
 IF (public.jaguar360_boleta_bloqueos(NEW.alumno_id,cyc)->>'allowed') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Boleta antigua incompatible con expediente Jaguar 360. Consulta revisión histórica en Control Escolar.'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_guardar_boleta_legacy() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS jaguar360_guardar_boleta_legacy ON public.documentos_verificables;
CREATE TRIGGER jaguar360_guardar_boleta_legacy BEFORE INSERT ON public.documentos_verificables FOR EACH ROW EXECUTE FUNCTION public.jaguar360_guardar_boleta_legacy();
COMMIT;
NOTIFY pgrst,'reload schema';
