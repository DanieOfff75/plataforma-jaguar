-- V37: ordinary request and departmental notice in one transaction; no historical backfill.
BEGIN;
CREATE OR REPLACE FUNCTION public.jaguar360_crear_solicitud_ordinaria(p_actor uuid,p_tipo text,p_actual text,p_solicitado text,p_motivo text,p_destino text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.alumnos; g public.grupos; target public.grupos; w public.talleres; owner_role text; s public.solicitudes_estudiantiles; n bigint;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Acceso exclusivo del servidor.' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.perfiles WHERE id=p_actor AND rol='alumno' AND activo IS TRUE FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.alumnos WHERE auth_user_id=p_actor FOR UPDATE;
 IF NOT FOUND OR a.activo IS DISTINCT FROM TRUE OR a.estado_escolar IS DISTINCT FROM 'activo' THEN RAISE EXCEPTION 'Expediente sin acceso escolar activo.' USING ERRCODE='42501'; END IF;
 IF p_tipo IS NULL OR p_tipo NOT IN ('grupo','grado','turno','taller','otro') OR length(btrim(coalesce(p_motivo,''))) NOT BETWEEN 1 AND 2000 OR length(coalesce(p_actual,''))>500 OR length(coalesce(p_solicitado,''))>500 THEN RAISE EXCEPTION 'Solicitud inválida.' USING ERRCODE='22023'; END IF;
 owner_role:=CASE WHEN p_tipo='grupo' THEN 'control_escolar' WHEN p_tipo IN ('grado','turno','taller') THEN 'servicios_estudiantiles' ELSE p_destino END;
 IF owner_role IS NULL OR owner_role NOT IN ('direccion_escolar','control_escolar','servicios_estudiantiles','servicios_docentes','prefectura','coordinacion_academica') THEN RAISE EXCEPTION 'Departamento inválido.' USING ERRCODE='22023'; END IF;
 IF p_tipo='grupo' THEN
  IF p_solicitado IS NULL OR p_solicitado !~ '^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION 'Grupo inválido.' USING ERRCODE='22023'; END IF;
  SELECT * INTO g FROM public.grupos WHERE id=a.grupo_id FOR SHARE;
  SELECT * INTO target FROM public.grupos WHERE id=p_solicitado::bigint FOR SHARE;
  IF g.id IS NULL OR target.id IS NULL OR g.activo IS DISTINCT FROM TRUE OR target.activo IS DISTINCT FROM TRUE OR g.grado IS DISTINCT FROM target.grado OR g.id=target.id THEN RAISE EXCEPTION 'Grupo solicitado incompatible.' USING ERRCODE='23514'; END IF;
  p_actual:=g.id::text; p_solicitado:=target.id::text;
  IF EXISTS(SELECT 1 FROM public.solicitudes_estudiantiles WHERE alumno_id=a.id AND tipo='grupo' AND estado='pendiente') THEN RAISE EXCEPTION 'Ya tienes una solicitud de grupo pendiente.' USING ERRCODE='40001'; END IF;
 ELSIF p_tipo='taller' THEN
  IF p_solicitado IS NULL OR p_solicitado !~ '^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION 'Taller inválido.' USING ERRCODE='22023'; END IF;
  SELECT * INTO w FROM public.talleres WHERE id=p_solicitado::bigint FOR SHARE;
  IF NOT FOUND OR w.activo IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Taller no disponible.' USING ERRCODE='23514'; END IF;
  p_solicitado:=w.id::text;
 END IF;
 -- Group requests have a single pending request; exact duplicate of another ordinary request is refused.
 IF EXISTS(SELECT 1 FROM public.solicitudes_estudiantiles r WHERE r.alumno_id=a.id AND r.tipo=p_tipo AND r.estado='pendiente' AND r.departamento_destino=owner_role AND r.valor_solicitado IS NOT DISTINCT FROM p_solicitado AND r.motivo=btrim(p_motivo)) THEN RAISE EXCEPTION 'Ya existe una solicitud igual pendiente.' USING ERRCODE='40001'; END IF;
 INSERT INTO public.solicitudes_estudiantiles(alumno_id,tipo,valor_actual,valor_solicitado,motivo,estado,departamento_destino)
 VALUES(a.id,p_tipo,p_actual,p_solicitado,btrim(p_motivo),'pendiente',owner_role) RETURNING * INTO s;
 INSERT INTO public.notificaciones(usuario_id,titulo,contenido,tipo,solicitud_id,leida)
 SELECT p.id,'Nueva solicitud estudiantil','Consulta la bandeja de solicitudes de tu departamento.','solicitud_estudiantil',s.id,false
 FROM public.perfiles p JOIN auth.users u ON u.id=p.id WHERE p.activo IS TRUE AND (p.rol=owner_role OR (owner_role='control_escolar' AND p.rol='control'));
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN to_jsonb(s)||jsonb_build_object('id',s.id::text,'alumno_id',a.id::text,'notificaciones_registradas',n);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_crear_solicitud_ordinaria(uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_crear_solicitud_ordinaria(uuid,text,text,text,text,text) TO service_role;
-- Keep existing own-row RLS, but prevent clients from rewriting notice content or owner.
ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notificaciones FROM PUBLIC,anon,authenticated;
REVOKE ALL PRIVILEGES (id,usuario_id,titulo,contenido,tipo,solicitud_id,leida,created_at) ON public.notificaciones FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.notificaciones TO authenticated;
GRANT UPDATE(leida) ON public.notificaciones TO authenticated;
COMMIT;
NOTIFY pgrst,'reload schema';
