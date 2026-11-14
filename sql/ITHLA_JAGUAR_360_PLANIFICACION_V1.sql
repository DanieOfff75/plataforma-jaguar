-- Piloto de planificación. No activa políticas ni transforma alumnos, notas u horarios.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar360_planes_ciclo (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 ciclo text NOT NULL CHECK (ciclo ~ '^[0-9]{4}-[0-9]{4}$'),
 version integer NOT NULL CHECK (version > 0),
 estado text NOT NULL CHECK (estado IN ('propuesta','validada_para_planificacion')),
 plan jsonb NOT NULL CHECK (jsonb_typeof(plan)='object'),
 motivo text NOT NULL CHECK (char_length(motivo) BETWEEN 15 AND 1500),
 actor_id uuid NOT NULL,
 actor_nombre text NOT NULL,
 actor_cargo text NOT NULL,
 creado_at timestamptz NOT NULL DEFAULT now(),
 precedente_id bigint REFERENCES public.jaguar360_planes_ciclo(id),
 UNIQUE(ciclo,version)
);
ALTER TABLE public.jaguar360_planes_ciclo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_planes_ciclo FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.jaguar360_planes_ciclo TO service_role;
-- Validación de los planes de estudio propuestos; catálogo activo no se modifica.
CREATE OR REPLACE FUNCTION public.jaguar360_validar_curriculum(p_rows jsonb,p_periodos integer)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r jsonb; n numeric; f text; k text; v jsonb; total numeric;
BEGIN
 IF p_rows IS NULL THEN RETURN; END IF; -- versiones anteriores sin currículo
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR p_periodos IS NULL OR p_periodos NOT BETWEEN 1 AND 6 THEN RAISE EXCEPTION 'Plan de estudios inválido.'; END IF;
 IF jsonb_array_length(p_rows)>300 THEN RAISE EXCEPTION 'Demasiadas asignaciones.'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR coalesce(r->>'key','') !~ '^[A-Z0-9_-]{1,64}$' OR jsonb_typeof(r->'name') IS DISTINCT FROM 'string' OR char_length(btrim(r->>'name')) NOT BETWEEN 2 AND 120 OR coalesce(r->>'evaluation','') NOT IN ('numerica','cualitativa','no_aplica') OR jsonb_typeof(r->'required') IS DISTINCT FROM 'boolean' OR (r->>'evaluation'='no_aplica' AND r->>'required'='true') OR coalesce(r->>'distribution','') NOT IN ('fixed','flexible') OR coalesce(r->>'shortfall','') NOT IN ('block','resolution') THEN RAISE EXCEPTION 'Asignatura o criterio inválido.'; END IF;
  IF r->>'evaluation'='cualitativa' AND coalesce(r->>'qualitativeMode','') NOT IN ('all','final') OR r->>'evaluation'<>'cualitativa' AND r->>'qualitativeMode' IS NOT NULL THEN RAISE EXCEPTION 'Criterio cualitativo inválido.'; END IF;
  FOREACH f IN ARRAY ARRAY['grade','sessionMinutes','dailyMin','dailyMax','weeklyMinutes','monthlyMinutes','totalMinutes'] LOOP
   IF jsonb_typeof(r->f) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Carga o grado requerido: %',f; END IF;
   n:=(r->>f)::numeric; IF n<>trunc(n) OR n<0 OR n>525600 THEN RAISE EXCEPTION 'Carga o grado inválido: %',f; END IF;
  END LOOP;
  IF (r->>'grade')::integer NOT BETWEEN 1 AND 3 OR (r->>'sessionMinutes')::integer NOT BETWEEN 1 AND 240 OR (r->>'dailyMax')::integer NOT BETWEEN (r->>'sessionMinutes')::integer AND 1440 OR (r->>'dailyMin')::integer>(r->>'dailyMax')::integer OR (r->>'weeklyMinutes')::integer>10080 OR (r->>'monthlyMinutes')::integer>44640 OR (r->>'totalMinutes')::integer<1 OR (r->>'distribution'='fixed' AND (r->>'weeklyMinutes')::integer=0) THEN RAISE EXCEPTION 'Límites de carga inválidos.'; END IF;
  IF r->>'legacyId' IS NOT NULL THEN
   IF jsonb_typeof(r->'legacyId') IS DISTINCT FROM 'string' OR r->>'legacyId' !~ '^[1-9][0-9]{0,18}$' OR NOT EXISTS(SELECT 1 FROM public.materias m WHERE m.id::text=r->>'legacyId') THEN RAISE EXCEPTION 'Materia de origen inexistente.'; END IF;
  END IF;
  IF jsonb_typeof(r->'periodMinutes') IS DISTINCT FROM 'array' OR jsonb_array_length(r->'periodMinutes')<>p_periodos OR jsonb_typeof(r->'periodAttendancePct') IS DISTINCT FROM 'array' OR jsonb_array_length(r->'periodAttendancePct')<>p_periodos THEN RAISE EXCEPTION 'Carga y asistencia por periodo incompletas.'; END IF;
  total:=0;
  FOR v IN SELECT value FROM jsonb_array_elements(r->'periodMinutes') LOOP
   IF jsonb_typeof(v) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Carga por periodo inválida.'; END IF;
   n:=(v#>>'{}')::numeric; IF n<>trunc(n) OR n<0 OR n>525600 THEN RAISE EXCEPTION 'Carga por periodo inválida.'; END IF; total:=total+n;
  END LOOP;
  IF total<>(r->>'totalMinutes')::numeric THEN RAISE EXCEPTION 'La suma de periodos no coincide con la carga total.'; END IF;
  IF r->>'attendancePct' IS NOT NULL THEN
   IF jsonb_typeof(r->'attendancePct') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Mínimo de asistencia inválido.'; END IF;
   n:=(r->>'attendancePct')::numeric; IF n NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'Mínimo de asistencia inválido.'; END IF;
  END IF;
  FOR v IN SELECT value FROM jsonb_array_elements(r->'periodAttendancePct') LOOP
   IF v='null'::jsonb THEN CONTINUE; END IF;
   IF jsonb_typeof(v) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Asistencia por periodo inválida.'; END IF;
   n:=(v#>>'{}')::numeric; IF n NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'Asistencia por periodo inválida.'; END IF;
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) a GROUP BY a->>'key' HAVING count(*)>1) OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) a GROUP BY a->>'grade',lower(btrim(a->>'name')) HAVING count(*)>1) OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) a WHERE a->>'legacyId' IS NOT NULL GROUP BY a->>'grade',a->>'legacyId' HAVING count(*)>1) THEN RAISE EXCEPTION 'Asignatura duplicada en el plan.'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_validar_curriculum(jsonb,integer) FROM PUBLIC,anon,authenticated,service_role;
-- Una transacción por nueva versión. La aprobación copia exactamente la propuesta previa.
CREATE OR REPLACE FUNCTION public.jaguar360_registrar_plan(p_actor uuid,p_ciclo text,p_version integer,p_accion text,p_plan jsonb,p_motivo text)
RETURNS public.jaguar360_planes_ciclo LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_actor record; v_prev public.jaguar360_planes_ciclo; v_out public.jaguar360_planes_ciclo; v_plan jsonb;
BEGIN
 IF coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role',nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('role',true),'none'),'') <> 'service_role' THEN
   RAISE EXCEPTION 'Solo el servidor autorizado puede registrar propuestas.';
 END IF;
 SELECT id,nombre_completo,rol,activo INTO v_actor FROM public.perfiles WHERE id=p_actor;
 IF NOT FOUND OR v_actor.activo IS DISTINCT FROM true OR coalesce(v_actor.rol,'') NOT IN ('direccion_escolar','coordinacion_academica') THEN RAISE EXCEPTION 'Actor sin atribuciones de planificación.'; END IF;
 IF p_ciclo IS NULL OR p_ciclo !~ '^[0-9]{4}-[0-9]{4}$' OR substring(p_ciclo,6,4)::int<>substring(p_ciclo,1,4)::int+1 THEN RAISE EXCEPTION 'Ciclo inválido.'; END IF;
 IF p_version IS NULL OR p_version<0 OR p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Versión o motivo inválido.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('jaguar360-plan:'||p_ciclo));
 SELECT * INTO v_prev FROM public.jaguar360_planes_ciclo WHERE ciclo=p_ciclo ORDER BY version DESC LIMIT 1;
 IF coalesce(v_prev.version,0)<>p_version THEN RAISE EXCEPTION 'La propuesta cambió; vuelve a consultarla.'; END IF;
 IF p_accion='proponer' THEN
   v_plan:=p_plan;
 ELSIF p_accion='validar' THEN
   IF v_actor.rol<>'direccion_escolar' OR v_prev.estado IS DISTINCT FROM 'propuesta' OR v_prev.actor_id=p_actor THEN RAISE EXCEPTION 'Se requiere Dirección y una propuesta de otra persona.'; END IF;
   v_plan:=v_prev.plan;
 ELSE RAISE EXCEPTION 'Acción desconocida.';
 END IF;
 IF v_plan IS NULL OR v_plan->>'cycle' IS DISTINCT FROM p_ciclo OR jsonb_typeof(v_plan->'policy') IS DISTINCT FROM 'object' OR jsonb_typeof(v_plan->'calendar') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Plan inválido.'; END IF;
 IF jsonb_array_length(v_plan->'calendar') NOT BETWEEN 1 AND 6 OR (v_plan->'policy'->>'periods')::integer IS DISTINCT FROM jsonb_array_length(v_plan->'calendar') OR coalesce(v_plan->'policy'->>'scheduleModel','') NOT IN ('fixed','flexible') THEN RAISE EXCEPTION 'Periodos o jornada inválidos.'; END IF;
 -- La referencia histórica debe apuntar a una versión autorizada previa; no copia registros académicos.
 IF v_plan->'template' IS NOT NULL AND v_plan->'template' <> 'null'::jsonb THEN
  IF jsonb_typeof(v_plan->'template') IS DISTINCT FROM 'object' OR NOT EXISTS(
   SELECT 1 FROM public.jaguar360_planes_ciclo t WHERE t.ciclo=(v_plan->'template'->>'cycle')
    AND t.ciclo<p_ciclo AND t.version::text=(v_plan->'template'->>'version') AND t.estado='validada_para_planificacion'
  ) THEN RAISE EXCEPTION 'Plantilla anterior no autorizada.'; END IF;
 END IF;
 IF coalesce(v_plan->'policy'->>'ordinaryRounding','nearest') NOT IN ('nearest','truncate') OR coalesce(v_plan->'policy'->>'recoveryRounding','exact') NOT IN ('exact','truncate','nearest') OR coalesce(v_plan->'policy'->>'recourseRounding','exact') NOT IN ('exact','truncate','nearest') THEN RAISE EXCEPTION 'Modo de redondeo inválido.'; END IF;
 IF (v_plan->'policy') ? 'recoveryDigits' AND (jsonb_typeof(v_plan->'policy'->'recoveryDigits') IS DISTINCT FROM 'number' OR coalesce(v_plan->'policy'->>'recoveryDigits','') !~ '^([0-9]|1[0-2])$') OR (v_plan->'policy') ? 'recourseDigits' AND (jsonb_typeof(v_plan->'policy'->'recourseDigits') IS DISTINCT FROM 'number' OR coalesce(v_plan->'policy'->>'recourseDigits','') !~ '^([0-9]|1[0-2])$') THEN RAISE EXCEPTION 'Precisión especial inválida.'; END IF;
 IF (v_plan->'policy') ? 'repeatThreshold' AND (jsonb_typeof(v_plan->'policy'->'repeatThreshold') IS DISTINCT FROM 'number' OR (v_plan->'policy'->>'repeatThreshold')::numeric NOT BETWEEN 0 AND 100) THEN RAISE EXCEPTION 'Umbral inválido.'; END IF;
 IF (v_plan->'policy') ? 'equivalenceSource' AND coalesce(v_plan->'policy'->>'equivalenceSource','') NOT IN ('points','official','original') THEN RAISE EXCEPTION 'Fuente de equivalencia inválida.'; END IF;
 PERFORM public.jaguar360_validar_curriculum(v_plan->'curriculum',jsonb_array_length(v_plan->'calendar'));
 INSERT INTO public.jaguar360_planes_ciclo(ciclo,version,estado,plan,motivo,actor_id,actor_nombre,actor_cargo,precedente_id)
 VALUES(p_ciclo,p_version+1,CASE WHEN p_accion='validar' THEN 'validada_para_planificacion' ELSE 'propuesta' END,v_plan,btrim(p_motivo),p_actor,coalesce(v_actor.nombre_completo,'Sin nombre'),v_actor.rol,v_prev.id) RETURNING * INTO v_out;
 RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_registrar_plan(uuid,text,integer,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jaguar360_registrar_plan(uuid,text,integer,text,jsonb,text) TO service_role;
COMMIT;
