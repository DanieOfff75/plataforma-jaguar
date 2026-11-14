-- Atomic resolution of legacy ordinary student requests and exact group capacity.
BEGIN;
CREATE OR REPLACE FUNCTION public.jaguar360_cupos_grupos(p_grupos bigint[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Acceso exclusivo del servidor.' USING ERRCODE='42501'; END IF;
 IF p_grupos IS NULL OR cardinality(p_grupos)>500 OR EXISTS(SELECT 1 FROM unnest(p_grupos) x WHERE x IS NULL OR x<=0) THEN RAISE EXCEPTION 'Grupos inválidos.'; END IF;
 WITH counts AS (SELECT g.id,coalesce(b.cupo,40) AS limite,g.activo,count(a.id) AS ocupados FROM public.grupos g LEFT JOIN public.jaguar360_grupos_ciclo b ON b.grupo_id=g.id LEFT JOIN public.alumnos a ON a.grupo_id=g.id AND a.activo IS TRUE WHERE g.id=ANY(p_grupos) GROUP BY g.id,b.cupo,g.activo)
 SELECT coalesce(jsonb_object_agg(id::text,jsonb_build_object('ocupados',ocupados,'limite',limite,'cupo',greatest(0,limite-ocupados),'lleno',activo IS DISTINCT FROM TRUE OR ocupados>=limite)), '{}'::jsonb) INTO result FROM counts;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_cupos_grupos(bigint[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_cupos_grupos(bigint[]) TO service_role;

CREATE OR REPLACE FUNCTION public.jaguar360_resolver_solicitud(p_actor uuid,p_id bigint,p_estado text,p_modo text,p_observaciones text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r text; owner_role text; s public.solicitudes_estudiantiles; a public.alumnos; orig public.grupos; dest public.grupos; t public.talleres; active_cycle text; n integer; target bigint; prior public.inscripciones_talleres; result jsonb; recipient uuid; notification text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Acceso exclusivo del servidor.' USING ERRCODE='42501'; END IF;
 SELECT rol INTO r FROM public.perfiles WHERE id=p_actor AND activo IS TRUE FOR SHARE;
 IF r='control' THEN r:='control_escolar'; END IF;
 IF r IS NULL OR r NOT IN ('direccion_escolar','control_escolar','servicios_estudiantiles','servicios_docentes','prefectura','coordinacion_academica') THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF p_estado IS NULL OR p_estado NOT IN ('aprobada','rechazada') OR length(coalesce(p_observaciones,''))>2000 THEN RAISE EXCEPTION 'Resolución inválida.' USING ERRCODE='22023'; END IF;
 SELECT * INTO s FROM public.solicitudes_estudiantiles WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR s.tipo NOT IN ('grupo','grado','turno','taller','otro') THEN RAISE EXCEPTION 'Solicitud ordinaria no encontrada.' USING ERRCODE='42501'; END IF;
 owner_role:=CASE WHEN s.tipo='grupo' THEN 'control_escolar' WHEN s.tipo IN ('grado','turno','taller') THEN 'servicios_estudiantiles' ELSE s.departamento_destino END;
 IF r<>'direccion_escolar' AND owner_role IS DISTINCT FROM r THEN RAISE EXCEPTION 'Solicitud de otro departamento.' USING ERRCODE='42501'; END IF;
 IF s.estado IS DISTINCT FROM 'pendiente' THEN RAISE EXCEPTION 'La solicitud ya fue atendida.' USING ERRCODE='40001'; END IF;
 IF p_estado='aprobada' AND s.tipo IN ('grado','turno') THEN RAISE EXCEPTION 'Usa el procedimiento autorizado de cambio de grado, turno o movimiento escolar; no se modificó el expediente.' USING ERRCODE='23514'; END IF;
 IF p_estado='aprobada' AND s.tipo IN ('grupo','taller') THEN
  IF r IS DISTINCT FROM owner_role THEN RAISE EXCEPTION 'La ejecución corresponde al departamento titular.' USING ERRCODE='42501'; END IF;
  LOCK TABLE public.jaguar360_grupos_ciclo IN SHARE MODE;
  SELECT * INTO a FROM public.alumnos WHERE id=s.alumno_id FOR UPDATE;
  IF NOT FOUND OR a.activo IS DISTINCT FROM TRUE OR a.estado_escolar IS DISTINCT FROM 'activo' OR nullif(btrim(a.matricula),'') IS NULL OR a.grupo_id IS NULL THEN RAISE EXCEPTION 'Expediente sin inscripción activa conciliada.' USING ERRCODE='23514'; END IF;
  IF s.tipo='grupo' THEN
   SELECT * INTO orig FROM public.grupos WHERE id=a.grupo_id;
   IF NOT FOUND OR orig.activo IS DISTINCT FROM TRUE OR s.valor_actual IS DISTINCT FROM orig.id::text THEN RAISE EXCEPTION 'Grupo original cambió o no está conciliado.' USING ERRCODE='40001'; END IF;
   IF p_modo='random' THEN
    SELECT g.id INTO target FROM public.grupos g WHERE g.activo IS TRUE AND g.grado=orig.grado AND g.id<>orig.id AND NOT EXISTS(SELECT 1 FROM public.jaguar360_grupos_ciclo b WHERE b.grupo_id=g.id) AND (SELECT count(*) FROM public.alumnos z WHERE z.grupo_id=g.id AND z.activo IS TRUE)<40 ORDER BY random() LIMIT 1;
   ELSIF p_modo='solicitado' AND s.valor_solicitado ~ '^[1-9][0-9]{0,18}$' THEN target:=s.valor_solicitado::bigint;
   ELSE RAISE EXCEPTION 'Grupo solicitado inválido.' USING ERRCODE='22023'; END IF;
   SELECT * INTO dest FROM public.grupos WHERE id=target;
   IF NOT FOUND OR dest.activo IS DISTINCT FROM TRUE OR dest.grado IS DISTINCT FROM orig.grado OR dest.id=orig.id THEN RAISE EXCEPTION 'Grupo de destino no disponible.' USING ERRCODE='23514'; END IF;
   IF public.jaguar360_grupos_gestionados(ARRAY[orig.id,dest.id]) THEN RAISE EXCEPTION 'Grupo Jaguar 360: requiere movimiento escolar autorizado.' USING ERRCODE='23514'; END IF;
   -- V35 trigger serializes destination capacity; no identity or Auth change.
   UPDATE public.alumnos SET grupo_id=dest.id,grado_ingreso=dest.grado,turno=dest.turno WHERE id=a.id;
   result:=jsonb_build_object('grupo_anterior',orig.clave,'grupo_nuevo',dest.clave);
  ELSE
   IF public.jaguar360_grupos_gestionados(ARRAY[a.grupo_id]) THEN RAISE EXCEPTION 'El taller del ciclo gestionado requiere conciliación académica autorizada.' USING ERRCODE='23514'; END IF;
   SELECT count(DISTINCT ciclo_escolar),min(ciclo_escolar) INTO n,active_cycle FROM public.periodos_escolares WHERE activo IS TRUE;
   IF n<>1 OR active_cycle IS NULL THEN RAISE EXCEPTION 'Ciclo activo no inequívoco.' USING ERRCODE='23514'; END IF;
   IF s.valor_solicitado IS NULL OR s.valor_solicitado !~ '^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION 'Taller inválido.' USING ERRCODE='22023'; END IF;
   target:=s.valor_solicitado::bigint;
   SELECT * INTO t FROM public.talleres WHERE id=target FOR NO KEY UPDATE;
   IF NOT FOUND OR t.activo IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Taller de destino no activo.' USING ERRCODE='23514'; END IF;
   SELECT count(*) INTO n FROM public.inscripciones_talleres WHERE alumno_id=a.id AND ciclo_escolar=active_cycle AND estado='inscrito';
   IF n>1 THEN RAISE EXCEPTION 'Inscripciones múltiples: requiere conciliación.' USING ERRCODE='23514'; END IF;
   SELECT * INTO prior FROM public.inscripciones_talleres WHERE alumno_id=a.id AND ciclo_escolar=active_cycle AND estado='inscrito' FOR UPDATE;
   IF prior.taller_id IS NOT DISTINCT FROM target THEN RAISE EXCEPTION 'Ya está inscrito en ese taller.' USING ERRCODE='23514'; END IF;
   IF t.cupo IS NOT NULL AND (SELECT count(*) FROM public.inscripciones_talleres WHERE taller_id=target AND ciclo_escolar=active_cycle AND estado='inscrito')>=t.cupo THEN RAISE EXCEPTION 'Taller sin cupo.' USING ERRCODE='23514'; END IF;
   IF prior.id IS NOT NULL THEN UPDATE public.inscripciones_talleres SET estado='baja' WHERE id=prior.id; END IF;
   INSERT INTO public.inscripciones_talleres(alumno_id,taller_id,ciclo_escolar,estado,fecha_inscripcion) VALUES(a.id,target,active_cycle,'inscrito',current_date) ON CONFLICT(alumno_id,taller_id,ciclo_escolar) DO UPDATE SET estado='inscrito',fecha_inscripcion=excluded.fecha_inscripcion;
   result:=jsonb_build_object('taller',t.nombre,'ciclo',active_cycle);
  END IF;
 END IF;
 UPDATE public.solicitudes_estudiantiles SET estado=p_estado,observaciones_resolucion=nullif(btrim(p_observaciones),''),atendida_por=p_actor,atendida_at=now() WHERE id=s.id;
 -- V37: the inbox notice belongs to the same transaction as the resolution.
 SELECT auth_user_id INTO recipient FROM public.alumnos WHERE id=s.alumno_id FOR SHARE;
 notification:='sin_cuenta';
 IF recipient IS NOT NULL THEN
  INSERT INTO public.notificaciones(usuario_id,titulo,contenido,tipo,solicitud_id,leida)
  VALUES(recipient,'Solicitud '||p_estado,'Consulta el resultado y las observaciones en tus solicitudes.', 'resolucion_solicitud',s.id,false);
  notification:='registrada';
 END IF;
 RETURN jsonb_build_object('id',s.id::text,'estado',p_estado,'tipo',s.tipo,'alumno_id',s.alumno_id::text,'resultado',result,'notification',notification);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_resolver_solicitud(uuid,bigint,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_resolver_solicitud(uuid,bigint,text,text,text) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
