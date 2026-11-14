-- Explicit student intent, not admission, promotion, withdrawal or authorization by itself.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar360_continuidad_confirmaciones (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 dictamen_id bigint NOT NULL REFERENCES public.jaguar360_dictamen_continuidad(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL,
 estado text NOT NULL CHECK(estado IN ('confirmada','retirada')),
 creado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jaguar360_continuidad_confirmaciones_dictamen_idx ON public.jaguar360_continuidad_confirmaciones(dictamen_id,id DESC);
ALTER TABLE public.jaguar360_continuidad_confirmaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_continuidad_confirmaciones FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_confirmar_continuidad(p_actor uuid,p_ciclo text,p_dictamen bigint DEFAULT NULL,p_accion text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sid bigint; d public.jaguar360_dictamen_continuidad; ev public.jaguar360_continuidad_confirmaciones; enrolled boolean;
BEGIN
 IF p_ciclo IS NULL OR p_ciclo !~ '^[0-9]{4}-[0-9]{4}$' OR (p_dictamen IS NULL) IS DISTINCT FROM (p_accion IS NULL) OR (p_accion IS NOT NULL AND p_accion NOT IN ('confirmada','retirada')) THEN RAISE EXCEPTION 'Consulta o acción inválida.'; END IF;
 IF p_accion IS NOT NULL THEN
  LOCK TABLE public.perfiles,public.alumnos,public.jaguar360_dictamen_continuidad,public.jaguar360_reinscripciones IN SHARE MODE NOWAIT;
  LOCK TABLE public.jaguar360_continuidad_confirmaciones IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol='alumno') THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM public.alumnos WHERE auth_user_id=p_actor AND activo IS TRUE AND estado_escolar='activo' AND (suspension_fecha IS NULL OR suspension_hasta < now()))<>1 THEN RAISE EXCEPTION 'Cuenta estudiantil no conciliada o suspendida.' USING ERRCODE='42501'; END IF;
 SELECT id INTO sid FROM public.alumnos WHERE auth_user_id=p_actor AND activo IS TRUE AND estado_escolar='activo' AND (suspension_fecha IS NULL OR suspension_hasta < now());
 SELECT * INTO d FROM public.jaguar360_dictamen_continuidad WHERE alumno_id=sid AND ciclo=p_ciclo ORDER BY id DESC LIMIT 1;
 IF d.id IS NULL OR coalesce(d.payload->>'state','') NOT IN ('promotion_eligible','repeat_grade','repeat_subjects','provisional_eligible') OR d.payload->>'targetCycle' IS NULL THEN
  IF p_accion IS NOT NULL THEN RAISE EXCEPTION 'No hay dictamen de continuidad disponible.'; END IF;
  RETURN jsonb_build_object('decision',NULL,'confirmation',NULL,'canRespond',false);
 END IF;
 SELECT * INTO ev FROM public.jaguar360_continuidad_confirmaciones WHERE dictamen_id=d.id AND actor_id=p_actor ORDER BY id DESC LIMIT 1;
 enrolled:=EXISTS(SELECT 1 FROM public.jaguar360_reinscripciones WHERE alumno_id=sid AND ciclo_destino=d.payload->>'targetCycle');
 IF p_accion IS NOT NULL THEN
  IF p_dictamen IS DISTINCT FROM d.id OR enrolled THEN RAISE EXCEPTION 'El dictamen cambió o ya existe reinscripción. Vuelve a consultar.'; END IF;
  IF p_accion='retirada' AND ev.estado IS DISTINCT FROM 'confirmada' THEN RAISE EXCEPTION 'No hay confirmación vigente para retirar.'; END IF;
  IF ev.estado IS DISTINCT FROM p_accion THEN
   INSERT INTO public.jaguar360_continuidad_confirmaciones(dictamen_id,actor_id,estado) VALUES(d.id,p_actor,p_accion) RETURNING * INTO ev;
  END IF;
 END IF;
 RETURN jsonb_build_object('decision',jsonb_build_object('id',d.id::text,'state',d.payload->>'state','sourceCycle',d.ciclo,'targetCycle',d.payload->>'targetCycle','targetGrade',d.payload->'targetGrade','recordedAt',d.creado_at), 'confirmation',CASE WHEN ev.id IS NULL THEN NULL ELSE jsonb_build_object('state',ev.estado,'at',ev.creado_at) END,'canRespond',NOT enrolled,'enrolled',enrolled,'requiresRevalidation',true);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_confirmar_continuidad(uuid,text,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_confirmar_continuidad(uuid,text,bigint,text) TO service_role;

-- Same guarded V29 transition plus latest student intent on exact live dictamen.
CREATE OR REPLACE FUNCTION public.jaguar360_reinscribir(p_actor uuid,p_ciclo text,p_alumno bigint,p_grupo bigint,p_huella text DEFAULT NULL,p_destino_huella text DEFAULT NULL,p_referencia text DEFAULT NULL,p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r text; st public.alumnos; oldg public.grupos; newg public.grupos; d public.jaguar360_dictamen_continuidad; b public.jaguar360_grupos_ciclo; rec public.jaguar360_reinscripciones; ctx jsonb; cat jsonb; lastperiod jsonb; target text; ready boolean; before_row jsonb; after_row jsonb; currentperiod public.periodos_escolares; confirmation public.jaguar360_continuidad_confirmaciones;
BEGIN
 IF p_huella IS NOT NULL THEN
  LOCK TABLE public.perfiles,public.periodos_escolares,public.grupos,public.grupo_materias,public.jaguar360_planes_ciclo,public.jaguar360_cierres_periodo,public.jaguar360_rectificaciones,public.jaguar360_rectificacion_resoluciones,public.jaguar360_actas_recursamiento,public.jaguar360_intentos_recursamiento,public.jaguar360_aplicaciones_recursamiento,public.jaguar360_aplicacion_autorizaciones,public.jaguar360_dictamen_continuidad,public.jaguar360_grupos_ciclo,public.horarios,public.asignaciones_docentes,public.rubricas_evaluacion,public.bitacora_excel_diaria,public.calificaciones,public.jaguar360_convocatorias,public.jaguar360_reservas_recursamiento,public.jaguar360_recuperaciones,public.jaguar360_continuidad_confirmaciones IN SHARE MODE NOWAIT;
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
 SELECT * INTO confirmation FROM public.jaguar360_continuidad_confirmaciones WHERE dictamen_id=d.id AND actor_id=st.auth_user_id ORDER BY id DESC LIMIT 1;
 SELECT * INTO oldg FROM public.grupos WHERE id=st.grupo_id;
 SELECT * INTO newg FROM public.grupos WHERE id=p_grupo;
 SELECT * INTO rec FROM public.jaguar360_reinscripciones WHERE alumno_id=p_alumno AND ciclo_destino=target;
 SELECT * INTO currentperiod FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE LIMIT 1;
 lastperiod:=ctx->'source'->'periods'->-1;
 ready:=coalesce(rec.id IS NULL AND confirmation.estado='confirmada' AND d.id=(SELECT max(id) FROM public.jaguar360_dictamen_continuidad WHERE alumno_id=p_alumno AND ciclo=p_ciclo) AND d.payload->>'state' IN ('promotion_eligible','repeat_grade') AND d.payload->>'sourceGrade'=oldg.grado::text AND d.payload->>'targetGrade'=newg.grado::text AND target=(substring(p_ciclo,6,4)||'-'||((substring(p_ciclo,6,4)::int)+1)::text)
 AND st.activo IS TRUE AND st.estado_escolar='activo' AND (st.suspension_fecha IS NULL OR st.suspension_hasta < now()) AND EXISTS(SELECT 1 FROM public.perfiles WHERE id=st.auth_user_id AND activo IS TRUE AND rol='alumno') AND oldg.activo IS FALSE AND oldg.id<>newg.id AND newg.activo IS TRUE AND newg.turno=oldg.turno
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
 RETURN jsonb_build_object('context',ctx,'eligible',ready,'destination',cat,'confirmation',CASE WHEN confirmation.id IS NULL THEN NULL ELSE jsonb_build_object('state',confirmation.estado,'at',confirmation.creado_at) END,'record',CASE WHEN rec.id IS NULL THEN NULL ELSE jsonb_build_object('id',rec.id::text,'before',rec.antes,'after',rec.despues,'reference',rec.referencia,'current',rec.huella=ctx->>'fingerprint') END);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_reinscribir(uuid,text,bigint,bigint,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_reinscribir(uuid,text,bigint,bigint,text,text,text,text) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
