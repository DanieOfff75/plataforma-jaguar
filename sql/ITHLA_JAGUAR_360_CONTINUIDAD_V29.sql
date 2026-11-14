-- V29: pending recourse reservations enter the trajectory fingerprint; existing writes serialize against them.

BEGIN;

CREATE OR REPLACE FUNCTION public.jaguar360_contexto_trayectoria(p_actor uuid,p_ciclo text,p_alumno bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE src jsonb; attempts jsonb; ctx jsonb; pending jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('direccion_escolar','coordinacion_academica','control_escolar','control')) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 src:=public.jaguar360_fuentes_selladas(p_actor,p_ciclo,p_alumno);
 SELECT coalesce(jsonb_agg(jsonb_build_object('call',i.convocatoria_id::text,'subjectKey',i.materia_clave,'outcome',i.resultado,'actFingerprint',a.huella,'snapshot',jsonb_build_object('call',a.evidencia->'call','students',coalesce((SELECT jsonb_agg(s-'name') FROM jsonb_array_elements(a.evidencia->'students') s WHERE s->>'student'=p_alumno::text AND s->>'reservation'=i.reserva_id::text),'[]'::jsonb)),'recordedEvaluation',(SELECT r->'evaluation' FROM jsonb_array_elements(a.resultados) r WHERE r->>'student'=p_alumno::text),'application',CASE WHEN ap.reserva_id IS NULL THEN NULL ELSE jsonb_build_object('state',CASE WHEN au.reserva_id IS NULL THEN 'proposed' ELSE 'authorized' END,'payload',ap.payload,'actor',coalesce(au.actor_nombre,ap.actor_nombre),'reference',coalesce(au.referencia,ap.referencia),'at',coalesce(au.creado_at,ap.creado_at)) END) ORDER BY i.materia_clave),'[]'::jsonb) INTO attempts
 FROM public.jaguar360_intentos_recursamiento i JOIN public.jaguar360_actas_recursamiento a ON a.convocatoria_id=i.convocatoria_id
 LEFT JOIN public.jaguar360_aplicaciones_recursamiento ap ON ap.reserva_id=i.reserva_id LEFT JOIN public.jaguar360_aplicacion_autorizaciones au ON au.reserva_id=i.reserva_id
 WHERE i.ciclo=p_ciclo AND i.alumno_id=p_alumno;
 SELECT coalesce(jsonb_agg(DISTINCT r.materia_clave ORDER BY r.materia_clave),'[]'::jsonb) INTO pending
 FROM public.jaguar360_reservas_recursamiento r JOIN public.jaguar360_convocatorias c ON c.id=r.convocatoria_id
 WHERE r.ciclo=p_ciclo AND r.alumno_id=p_alumno AND r.estado='reservada' AND c.estado<>'cancelada'
 AND NOT EXISTS(SELECT 1 FROM public.jaguar360_intentos_recursamiento i WHERE i.reserva_id=r.id);
 src:=src||jsonb_build_object('pendingRecourse',pending);
 ctx:=jsonb_build_object('source',src,'attempts',attempts);
 RETURN ctx||jsonb_build_object('fingerprint',md5(ctx::text));
END $$;

CREATE OR REPLACE FUNCTION public.jaguar360_aplicar_recursamiento(p_actor uuid,p_ciclo text,p_alumno bigint,p_call bigint,p_accion text,p_huella text,p_payload jsonb,p_referencia text,p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; i public.jaguar360_intentos_recursamiento; ap public.jaguar360_aplicaciones_recursamiento; ctx jsonb; atp jsonb;
BEGIN
 LOCK TABLE public.perfiles,public.alumnos,public.periodos_escolares,public.jaguar360_planes_ciclo,public.jaguar360_cierres_periodo,public.jaguar360_rectificaciones,public.jaguar360_rectificacion_resoluciones,public.jaguar360_actas_recursamiento,public.jaguar360_intentos_recursamiento,public.jaguar360_convocatorias,public.jaguar360_reservas_recursamiento,public.jaguar360_recuperaciones IN SHARE MODE NOWAIT;
 LOCK TABLE public.jaguar360_aplicaciones_recursamiento,public.jaguar360_aplicacion_autorizaciones IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 SELECT rol,nombre_completo INTO a FROM public.perfiles WHERE id=p_actor AND activo IS TRUE;
 IF NOT FOUND OR p_accion IS NULL OR p_accion NOT IN ('proponer','autorizar') OR (p_accion='proponer' AND a.rol NOT IN ('control_escolar','control')) OR (p_accion='autorizar' AND a.rol<>'direccion_escolar') THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF p_referencia IS NULL OR char_length(btrim(p_referencia)) NOT BETWEEN 5 AND 300 OR p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500 OR p_huella IS NULL OR p_huella !~ '^[a-f0-9]{32}$' OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>200000 THEN RAISE EXCEPTION 'Referencia, motivo, huella o resultado inválidos.'; END IF;
 SELECT * INTO i FROM public.jaguar360_intentos_recursamiento WHERE convocatoria_id=p_call AND ciclo=p_ciclo AND alumno_id=p_alumno;
 IF NOT FOUND THEN RAISE EXCEPTION 'Intento no registrado.'; END IF;
 ctx:=public.jaguar360_contexto_trayectoria(p_actor,p_ciclo,p_alumno);
 IF ctx->>'fingerprint' IS DISTINCT FROM p_huella THEN RAISE EXCEPTION 'Cambió la evidencia. Consulta nuevamente.'; END IF;
 SELECT z INTO atp FROM jsonb_array_elements(ctx->'attempts') z WHERE z->>'call'=p_call::text;
 -- Payload derived by the trusted backend, never from browser input. Check binding to immutable act and plan.
 IF atp IS NULL OR p_payload->>'subjectKey' IS DISTINCT FROM i.materia_clave OR p_payload->>'call' IS DISTINCT FROM p_call::text OR p_payload->>'actFingerprint' IS DISTINCT FROM atp->>'actFingerprint' OR p_payload->>'planVersion' IS DISTINCT FROM ctx->'source'->>'version' OR p_payload->>'official' IS DISTINCT FROM 'false' OR coalesce(p_payload->'result'->>'state','') NOT IN ('accredited','candidate') THEN RAISE EXCEPTION 'Resultado incompatible con el intento.'; END IF;
 SELECT * INTO ap FROM public.jaguar360_aplicaciones_recursamiento WHERE reserva_id=i.reserva_id;
 IF p_accion='proponer' THEN
  IF FOUND THEN RAISE EXCEPTION 'Ya existe una propuesta.'; END IF;
  INSERT INTO public.jaguar360_aplicaciones_recursamiento(reserva_id,convocatoria_id,payload,actor_id,actor_nombre,referencia,motivo) VALUES(i.reserva_id,p_call,p_payload,p_actor,coalesce(a.nombre_completo,'Sin nombre'),btrim(p_referencia),btrim(p_motivo));
 ELSE
  IF NOT FOUND OR ap.actor_id=p_actor OR ap.payload IS DISTINCT FROM p_payload OR EXISTS(SELECT 1 FROM public.jaguar360_aplicacion_autorizaciones WHERE reserva_id=i.reserva_id) THEN RAISE EXCEPTION 'Falta propuesta vigente, revisión independiente o la aplicación ya fue autorizada.'; END IF;
  INSERT INTO public.jaguar360_aplicacion_autorizaciones(reserva_id,actor_id,actor_nombre,referencia,motivo) VALUES(i.reserva_id,p_actor,coalesce(a.nombre_completo,'Sin nombre'),btrim(p_referencia),btrim(p_motivo));
 END IF;
 RETURN public.jaguar360_contexto_trayectoria(p_actor,p_ciclo,p_alumno);
END $$;

CREATE OR REPLACE FUNCTION public.jaguar360_continuidad(p_actor uuid,p_ciclo text,p_alumno bigint,p_huella text DEFAULT NULL,p_payload jsonb DEFAULT NULL,p_referencia text DEFAULT NULL,p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; ctx jsonb; history jsonb;
BEGIN
 IF p_payload IS NOT NULL THEN
  LOCK TABLE public.perfiles,public.alumnos,public.periodos_escolares,public.jaguar360_planes_ciclo,public.jaguar360_cierres_periodo,public.jaguar360_rectificaciones,public.jaguar360_rectificacion_resoluciones,public.jaguar360_actas_recursamiento,public.jaguar360_intentos_recursamiento,public.jaguar360_aplicaciones_recursamiento,public.jaguar360_aplicacion_autorizaciones,public.jaguar360_convocatorias,public.jaguar360_reservas_recursamiento,public.jaguar360_recuperaciones IN SHARE MODE NOWAIT;
  LOCK TABLE public.jaguar360_dictamen_continuidad IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 END IF;
 SELECT rol,nombre_completo INTO a FROM public.perfiles WHERE id=p_actor AND activo IS TRUE;
 IF NOT FOUND OR a.rol NOT IN ('direccion_escolar','coordinacion_academica','control_escolar','control') OR (p_payload IS NOT NULL AND a.rol NOT IN ('control_escolar','control')) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 ctx:=public.jaguar360_contexto_trayectoria(p_actor,p_ciclo,p_alumno);
 IF p_payload IS NOT NULL THEN
  IF p_huella IS NULL OR p_huella IS DISTINCT FROM ctx->>'fingerprint' THEN RAISE EXCEPTION 'Cambió la evidencia. Consulta nuevamente.'; END IF;
  -- The trusted backend computes the decision. Check source binding and structural constraints.
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>100000 OR p_payload->>'sourceCycle' IS DISTINCT FROM p_ciclo OR p_payload->>'canRecord' IS DISTINCT FROM 'true' OR coalesce(p_payload->>'state','') NOT IN ('academic_completion','promotion_eligible','repeat_grade','repeat_subjects','provisional_eligible') OR p_referencia IS NULL OR char_length(btrim(p_referencia)) NOT BETWEEN 5 AND 300 OR p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Determinación o evidencia inválida.'; END IF;
  INSERT INTO public.jaguar360_dictamen_continuidad(alumno_id,ciclo,huella,version_plan,payload,actor_id,actor_nombre,referencia,motivo) VALUES(p_alumno,p_ciclo,p_huella,(ctx->'source'->>'version')::integer,p_payload,p_actor,coalesce(a.nombre_completo,'Sin nombre'),btrim(p_referencia),btrim(p_motivo));
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id::text,'fingerprint',d.huella,'planVersion',d.version_plan,'decision',d.payload,'actor',d.actor_nombre,'reference',d.referencia,'reason',d.motivo,'at',d.creado_at) ORDER BY d.id DESC),'[]'::jsonb) INTO history FROM (SELECT * FROM public.jaguar360_dictamen_continuidad WHERE alumno_id=p_alumno AND ciclo=p_ciclo ORDER BY id DESC LIMIT 100) d;
 RETURN jsonb_build_object('context',ctx,'history',history);
END $$;

CREATE OR REPLACE FUNCTION public.jaguar360_egreso(p_actor uuid,p_ciclo text,p_alumno bigint,p_huella text DEFAULT NULL,p_referencia text DEFAULT NULL,p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; st public.alumnos; d public.jaguar360_dictamen_continuidad; result public.jaguar360_egresos; ctx jsonb; ready boolean; prior jsonb; nextrow jsonb; lastperiod jsonb;
BEGIN
 IF p_huella IS NOT NULL THEN
  LOCK TABLE public.perfiles,public.periodos_escolares,public.grupos,public.grupo_materias,public.jaguar360_planes_ciclo,public.jaguar360_cierres_periodo,public.jaguar360_rectificaciones,public.jaguar360_rectificacion_resoluciones,public.jaguar360_actas_recursamiento,public.jaguar360_intentos_recursamiento,public.jaguar360_aplicaciones_recursamiento,public.jaguar360_aplicacion_autorizaciones,public.jaguar360_dictamen_continuidad,public.jaguar360_convocatorias,public.jaguar360_reservas_recursamiento,public.jaguar360_recuperaciones IN SHARE MODE NOWAIT;
  LOCK TABLE public.alumnos,public.jaguar360_egresos IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 END IF;
 SELECT rol,nombre_completo INTO a FROM public.perfiles WHERE id=p_actor AND activo IS TRUE;
 IF NOT FOUND OR coalesce(a.rol,'') NOT IN ('control_escolar','control','direccion_escolar') OR (p_huella IS NOT NULL AND a.rol NOT IN ('control_escolar','control')) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 ctx:=public.jaguar360_contexto_trayectoria(p_actor,p_ciclo,p_alumno);
 SELECT * INTO st FROM public.alumnos WHERE id=p_alumno;
 SELECT * INTO d FROM public.jaguar360_dictamen_continuidad WHERE alumno_id=p_alumno AND ciclo=p_ciclo AND huella=ctx->>'fingerprint';
 SELECT * INTO result FROM public.jaguar360_egresos WHERE alumno_id=p_alumno AND ciclo=p_ciclo;
 lastperiod:=ctx->'source'->'periods'->-1;
 ready:=coalesce(result.id IS NULL AND d.id IS NOT NULL AND d.payload->>'state'='academic_completion' AND d.payload->>'sourceGrade'='3' AND st.activo IS TRUE AND st.estado_escolar='activo' AND st.grupo_id IS NOT NULL AND (SELECT count(*) FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE)=1 AND EXISTS(SELECT 1 FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE AND ciclo_escolar=p_ciclo AND numero_periodo=(lastperiod->>'number')::integer AND fecha_fin< (now() AT TIME ZONE 'America/Mexico_City')::date) AND EXISTS(SELECT 1 FROM public.grupos WHERE id=st.grupo_id AND grado=3 AND activo IS TRUE) AND jsonb_array_length(lastperiod->'rows')>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(lastperiod->'rows') r WHERE NOT EXISTS(SELECT 1 FROM public.grupo_materias gm WHERE gm.id=(r->>'groupMaterialId')::bigint AND gm.grupo_id=st.grupo_id)) AND NOT EXISTS(SELECT 1 FROM public.jaguar360_egresos WHERE alumno_id=p_alumno),false);
 IF p_huella IS NOT NULL THEN
  IF NOT ready OR p_huella IS DISTINCT FROM ctx->>'fingerprint' OR p_referencia IS NULL OR char_length(btrim(p_referencia)) NOT BETWEEN 5 AND 300 OR p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Egreso no elegible, evidencia modificada o referencia incompleta.'; END IF;
  prior:=jsonb_build_object('grupo_id',st.grupo_id::text,'activo',st.activo,'estado_escolar',st.estado_escolar);
  -- Same terminal state as legacy egreso, but only after evidence-based confirmation. No deletion, grades or financial checks.
  UPDATE public.alumnos SET activo=false,grupo_id=NULL,estado_escolar='egresado' WHERE id=p_alumno RETURNING * INTO st;
  IF st.estado_escolar IS DISTINCT FROM 'egresado' OR st.activo IS DISTINCT FROM false OR st.grupo_id IS NOT NULL THEN RAISE EXCEPTION 'El estado devuelto no corresponde a egreso.'; END IF;
  nextrow:=jsonb_build_object('grupo_id',st.grupo_id,'activo',st.activo,'estado_escolar',st.estado_escolar);
  INSERT INTO public.jaguar360_egresos(alumno_id,ciclo,dictamen_id,huella,antes,despues,actor_id,actor_nombre,referencia,motivo) VALUES(p_alumno,p_ciclo,d.id,p_huella,prior,nextrow,p_actor,coalesce(a.nombre_completo,'Sin nombre'),btrim(p_referencia),btrim(p_motivo)) RETURNING * INTO result;
  ready:=false;
 END IF;
 RETURN jsonb_build_object('context',ctx,'eligible',ready,'record',CASE WHEN result.id IS NULL THEN NULL ELSE jsonb_build_object('id',result.id::text,'before',result.antes,'after',result.despues,'reference',result.referencia,'actor',result.actor_nombre,'at',result.creado_at,'current',result.huella=ctx->>'fingerprint') END);
END $$;

CREATE OR REPLACE FUNCTION public.jaguar360_reinscribir(p_actor uuid,p_ciclo text,p_alumno bigint,p_grupo bigint,p_huella text DEFAULT NULL,p_destino_huella text DEFAULT NULL,p_referencia text DEFAULT NULL,p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r text; st public.alumnos; oldg public.grupos; newg public.grupos; d public.jaguar360_dictamen_continuidad; b public.jaguar360_grupos_ciclo; rec public.jaguar360_reinscripciones; ctx jsonb; cat jsonb; lastperiod jsonb; target text; ready boolean; before_row jsonb; after_row jsonb; currentperiod public.periodos_escolares;
BEGIN
 IF p_huella IS NOT NULL THEN
  LOCK TABLE public.perfiles,public.periodos_escolares,public.grupos,public.grupo_materias,public.jaguar360_planes_ciclo,public.jaguar360_cierres_periodo,public.jaguar360_rectificaciones,public.jaguar360_rectificacion_resoluciones,public.jaguar360_actas_recursamiento,public.jaguar360_intentos_recursamiento,public.jaguar360_aplicaciones_recursamiento,public.jaguar360_aplicacion_autorizaciones,public.jaguar360_dictamen_continuidad,public.jaguar360_grupos_ciclo,public.horarios,public.asignaciones_docentes,public.rubricas_evaluacion,public.bitacora_excel_diaria,public.calificaciones,public.jaguar360_convocatorias,public.jaguar360_reservas_recursamiento,public.jaguar360_recuperaciones IN SHARE MODE NOWAIT;
  LOCK TABLE public.alumnos,public.jaguar360_reinscripciones IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 END IF;
 SELECT rol INTO r FROM public.perfiles WHERE id=p_actor AND activo IS TRUE;
 IF coalesce(r,'') NOT IN ('control_escolar','control','direccion_escolar') OR (p_huella IS NOT NULL AND r NOT IN ('control_escolar','control')) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 ctx:=public.jaguar360_contexto_trayectoria(p_actor,p_ciclo,p_alumno);
 SELECT * INTO d FROM public.jaguar360_dictamen_continuidad WHERE alumno_id=p_alumno AND ciclo=p_ciclo AND huella=ctx->>'fingerprint';
 target:=d.payload->>'targetCycle';
 IF target IS NULL THEN
  IF p_huella IS NOT NULL THEN RAISE EXCEPTION 'Cambió el dictamen vigente.'; END IF;
  RETURN jsonb_build_object('context',ctx,'eligible',false,'reason','Falta dictamen vigente con ciclo destino.');
 END IF;
 cat:=public.jaguar360_destino_ciclo(p_actor,target,p_grupo);
 SELECT * INTO b FROM public.jaguar360_grupos_ciclo WHERE grupo_id=p_grupo;
 SELECT * INTO st FROM public.alumnos WHERE id=p_alumno;
 SELECT * INTO oldg FROM public.grupos WHERE id=st.grupo_id;
 SELECT * INTO newg FROM public.grupos WHERE id=p_grupo;
 SELECT * INTO rec FROM public.jaguar360_reinscripciones WHERE alumno_id=p_alumno AND ciclo_destino=target;
 SELECT * INTO currentperiod FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE LIMIT 1;
 lastperiod:=ctx->'source'->'periods'->-1;
 ready:=coalesce(rec.id IS NULL AND d.payload->>'state' IN ('promotion_eligible','repeat_grade') AND d.payload->>'sourceGrade'=oldg.grado::text AND d.payload->>'targetGrade'=newg.grado::text AND target=(substring(p_ciclo,6,4)||'-'||((substring(p_ciclo,6,4)::int)+1)::text)
 AND st.activo IS TRUE AND st.estado_escolar='activo' AND oldg.activo IS FALSE AND oldg.id<>newg.id AND newg.activo IS TRUE AND newg.turno=oldg.turno
 AND (d.payload->>'groupDistribution'='redistribute' OR (d.payload->>'groupDistribution'='continuity' AND oldg.letra=newg.letra))
 AND cat->'binding'->>'current'='true' AND (cat->>'occupancy')::int<b.cupo
 AND (SELECT count(*) FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE)=1 AND currentperiod.ciclo_escolar=target AND currentperiod.numero_periodo=1 AND currentperiod.fecha_inicio>= (now() AT TIME ZONE 'America/Mexico_City')::date AND currentperiod.fecha_inicio>(lastperiod->>'end')::date
 AND (lastperiod->>'end')::date < (now() AT TIME ZONE 'America/Mexico_City')::date
 AND EXISTS(SELECT 1 FROM public.jaguar360_planes_ciclo p WHERE p.ciclo=target AND p.version=b.version_plan AND jsonb_array_length(p.plan->'calendar')=(SELECT count(*) FROM public.periodos_escolares WHERE ciclo_escolar=target) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.plan->'calendar') pc WHERE (SELECT count(*) FROM public.periodos_escolares pe WHERE pe.ciclo_escolar=target AND pe.numero_periodo=(pc->>'number')::int AND pe.fecha_inicio=(pc->>'start')::date AND pe.fecha_fin=(pc->>'end')::date)<>1))
 AND NOT EXISTS(SELECT 1 FROM public.jaguar360_cierres_periodo WHERE ciclo=target)
 AND jsonb_array_length(lastperiod->'rows')>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(lastperiod->'rows') x WHERE NOT EXISTS(SELECT 1 FROM public.grupo_materias gm WHERE gm.id::text=x->>'groupMaterialId' AND gm.grupo_id=oldg.id)),false);
 IF p_huella IS NOT NULL THEN
  IF NOT ready OR p_huella IS DISTINCT FROM ctx->>'fingerprint' OR p_destino_huella IS DISTINCT FROM cat->>'fingerprint' OR p_referencia IS NULL OR char_length(btrim(p_referencia)) NOT BETWEEN 5 AND 300 OR p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Reinscripción incompatible o evidencia modificada.'; END IF;
  before_row:=jsonb_build_object('grupo_id',st.grupo_id::text,'grado_ingreso',st.grado_ingreso,'turno',st.turno,'estado_escolar',st.estado_escolar);
  UPDATE public.alumnos SET grupo_id=p_grupo,grado_ingreso=newg.grado,turno=newg.turno WHERE id=p_alumno RETURNING * INTO st;
  IF st.grupo_id IS DISTINCT FROM p_grupo OR st.grado_ingreso IS DISTINCT FROM newg.grado OR st.activo IS DISTINCT FROM true OR st.estado_escolar IS DISTINCT FROM 'activo' THEN RAISE EXCEPTION 'Estado de reinscripción incompatible.'; END IF;
  after_row:=jsonb_build_object('grupo_id',st.grupo_id::text,'grado_ingreso',st.grado_ingreso,'turno',st.turno,'estado_escolar',st.estado_escolar);
  INSERT INTO public.jaguar360_reinscripciones(alumno_id,ciclo_origen,ciclo_destino,grupo_destino,dictamen_id,huella,antes,despues,referencia,motivo,actor_id) VALUES(p_alumno,p_ciclo,target,p_grupo,d.id,p_huella,before_row,after_row,btrim(p_referencia),btrim(p_motivo),p_actor) RETURNING * INTO rec;
  ready:=false;
 END IF;
 RETURN jsonb_build_object('context',ctx,'eligible',ready,'destination',cat,'record',CASE WHEN rec.id IS NULL THEN NULL ELSE jsonb_build_object('id',rec.id::text,'before',rec.antes,'after',rec.despues,'reference',rec.referencia,'current',rec.huella=ctx->>'fingerprint') END);
END $$;

REVOKE ALL ON FUNCTION public.jaguar360_contexto_trayectoria(uuid,text,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_contexto_trayectoria(uuid,text,bigint) TO service_role;

REVOKE ALL ON FUNCTION public.jaguar360_aplicar_recursamiento(uuid,text,bigint,bigint,text,text,jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_aplicar_recursamiento(uuid,text,bigint,bigint,text,text,jsonb,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.jaguar360_continuidad(uuid,text,bigint,text,jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_continuidad(uuid,text,bigint,text,jsonb,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.jaguar360_egreso(uuid,text,bigint,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_egreso(uuid,text,bigint,text,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.jaguar360_reinscribir(uuid,text,bigint,bigint,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_reinscribir(uuid,text,bigint,bigint,text,text,text,text) TO service_role;

COMMIT;

NOTIFY pgrst,'reload schema';
