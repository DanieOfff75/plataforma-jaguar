-- Exact personal unread count and outstanding acknowledgments. No read state mutations.
BEGIN;
CREATE OR REPLACE FUNCTION public.jaguar360_bandeja_totales(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE cargo_actor text; unread bigint; pending bigint:=0;
BEGIN
 SELECT rol INTO cargo_actor FROM public.perfiles WHERE id=p_actor AND activo IS TRUE;
 IF cargo_actor IS NULL THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO unread FROM public.notificaciones n WHERE n.usuario_id=p_actor AND n.leida IS NOT TRUE;
 -- The same account, exact recipient role and eligibility as the V26 inbox.
 IF cargo_actor=ANY(ARRAY['alumno','docente','direccion_escolar','control_escolar','control','coordinacion_academica','servicios_docentes','servicios_estudiantiles','prefectura','archivo_escolar','recursos_monetarios'])
 AND (cargo_actor<>'alumno' OR EXISTS(SELECT 1 FROM public.alumnos a WHERE a.auth_user_id=p_actor AND a.activo AND a.estado_escolar NOT IN ('baja','traslado','archivado','egresado')))
 AND (cargo_actor<>'docente' OR EXISTS(SELECT 1 FROM public.docentes d WHERE d.auth_user_id=p_actor AND d.activo AND d.estado_profesional NOT IN ('baja','archivado','inactivo'))) THEN
  SELECT count(*) INTO pending FROM public.jaguar360_comunicado_receptores r
   WHERE r.receptor=p_actor AND r.cargo=cargo_actor AND NOT EXISTS(SELECT 1 FROM public.jaguar360_comunicado_acuses a WHERE a.comunicado_id=r.comunicado_id AND a.receptor=r.receptor);
 END IF;
 RETURN jsonb_build_object('unread',unread,'pendingAcknowledgements',pending);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_bandeja_totales(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_bandeja_totales(uuid) TO service_role;
-- Preserve assigned identity, including through service-role updates.
CREATE OR REPLACE FUNCTION public.jaguar360_matricula_permanente() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD.matricula IS NOT NULL AND btrim(OLD.matricula)<>'' AND NEW.matricula IS DISTINCT FROM OLD.matricula THEN
  RAISE EXCEPTION 'Matrícula permanente: no se modifica una identidad ya asignada.';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_matricula_permanente() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS jaguar360_matricula_permanente ON public.alumnos;
CREATE TRIGGER jaguar360_matricula_permanente BEFORE UPDATE OF matricula ON public.alumnos FOR EACH ROW EXECUTE FUNCTION public.jaguar360_matricula_permanente();
CREATE OR REPLACE FUNCTION public.jaguar360_grupos_gestionados(p_grupos bigint[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.jaguar360_grupos_ciclo g WHERE g.grupo_id=ANY(p_grupos));
$$;
REVOKE ALL ON FUNCTION public.jaguar360_grupos_gestionados(bigint[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_grupos_gestionados(bigint[]) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
