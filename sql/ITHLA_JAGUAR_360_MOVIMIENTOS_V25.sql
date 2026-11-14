-- Experimental departures/return: only bound groups and outside the teaching cycle.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar360_movimientos_escolares (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 alumno_id bigint NOT NULL REFERENCES public.alumnos(id) ON DELETE RESTRICT,
 ciclo text NOT NULL, tipo text NOT NULL CHECK(tipo IN ('baja','traslado','retorno')),
 grupo_destino bigint REFERENCES public.jaguar360_grupos_ciclo(grupo_id) ON DELETE RESTRICT,
 huella text NOT NULL CHECK(huella ~ '^[a-f0-9]{32}$'), contexto jsonb NOT NULL,
 actor_id uuid NOT NULL, actor_nombre text NOT NULL, referencia text NOT NULL, motivo text NOT NULL,
 creado_at timestamptz NOT NULL DEFAULT now(),
 CHECK((tipo='retorno')=(grupo_destino IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS public.jaguar360_movimiento_resoluciones (
 movimiento_id bigint PRIMARY KEY REFERENCES public.jaguar360_movimientos_escolares(id) ON DELETE RESTRICT,
 estado text NOT NULL CHECK(estado IN ('applied','rejected')), actor_id uuid NOT NULL, actor_nombre text NOT NULL,
 referencia text NOT NULL, motivo text NOT NULL, antes jsonb NOT NULL, despues jsonb NOT NULL,
 creado_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.jaguar360_movimientos_escolares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar360_movimiento_resoluciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_movimientos_escolares,public.jaguar360_movimiento_resoluciones FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_contexto_movimiento(p_ciclo text,p_alumno bigint,p_tipo text,p_grupo bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE st public.alumnos; oldg public.grupos; dest public.grupos; bind public.jaguar360_grupos_ciclo; prev public.jaguar360_movimientos_escolares; prevres public.jaguar360_movimiento_resoluciones; pe public.periodos_escolares; periods jsonb; firstday date; lastday date; today date:=(now() AT TIME ZONE 'America/Mexico_City')::date; sealed boolean; cat jsonb; occupied bigint; blockers text[]:=ARRAY[]::text[]; snapshot jsonb; base jsonb; pending boolean;
BEGIN
 IF coalesce(p_tipo,'') NOT IN ('baja','traslado','retorno') OR (p_tipo='retorno') IS DISTINCT FROM (p_grupo IS NOT NULL) THEN RAISE EXCEPTION 'Tipo o destino inválido.'; END IF;
 SELECT * INTO st FROM public.alumnos WHERE id=p_alumno;
 IF NOT FOUND THEN RAISE EXCEPTION 'Alumno inexistente.'; END IF;
 SELECT * INTO oldg FROM public.grupos WHERE id=st.grupo_id;
 SELECT * INTO pe FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE ORDER BY id LIMIT 1;
 SELECT min(fecha_inicio),max(fecha_fin),coalesce(jsonb_agg(jsonb_build_object('id',p.id::text,'inicio',p.fecha_inicio,'fin',p.fecha_fin,'activo',p.activo,'sellado',c.periodo_id IS NOT NULL) ORDER BY p.id),'[]'::jsonb),coalesce(bool_and(c.periodo_id IS NOT NULL AND p.activo IS FALSE),false) INTO firstday,lastday,periods,sealed FROM public.periodos_escolares p LEFT JOIN public.jaguar360_cierres_periodo c ON c.periodo_id=p.id AND c.ciclo=p_ciclo WHERE p.ciclo_escolar=p_ciclo;
 IF (SELECT count(*) FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE)<>1 OR pe.ciclo_escolar IS DISTINCT FROM p_ciclo OR firstday IS NULL OR lastday IS NULL THEN blockers:=array_append(blockers,'Ciclo vigente no conciliado.'); END IF;
 pending:=EXISTS(SELECT 1 FROM public.jaguar360_recuperaciones WHERE alumno_id=p_alumno AND estado IN ('reservada','evaluada')) OR EXISTS(SELECT 1 FROM public.jaguar360_reservas_recursamiento r JOIN public.jaguar360_convocatorias c ON c.id=r.convocatoria_id WHERE r.alumno_id=p_alumno AND r.estado='reservada' AND c.estado<>'cancelada' AND NOT EXISTS(SELECT 1 FROM public.jaguar360_intentos_recursamiento i WHERE i.reserva_id=r.id));
 IF pending THEN blockers:=array_append(blockers,'Regularización reservada o pendiente: resolverla antes.'); END IF;
 IF st.matricula IS NULL OR btrim(st.matricula)='' OR st.auth_user_id IS NULL THEN blockers:=array_append(blockers,'Identidad o matrícula no conciliada.'); END IF;
 IF p_tipo IN ('baja','traslado') THEN
  IF st.activo IS DISTINCT FROM true OR st.estado_escolar IS DISTINCT FROM 'activo' OR oldg.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.jaguar360_grupos_ciclo g WHERE g.grupo_id=st.grupo_id AND g.ciclo=p_ciclo) THEN blockers:=array_append(blockers,'Se requiere alumno activo en grupo vinculado al ciclo.'); END IF;
  IF NOT coalesce(today<firstday OR (today>lastday AND sealed),false) THEN blockers:=array_append(blockers,'Durante clases requiere conciliación de pertenencia por fecha; no ejecutar.'); END IF;
  IF today<firstday AND (EXISTS(SELECT 1 FROM public.calificaciones c JOIN public.grupo_materias gm ON gm.id=c.grupo_materia_id WHERE c.alumno_id=p_alumno AND gm.grupo_id=st.grupo_id) OR EXISTS(SELECT 1 FROM public.asistencias a JOIN public.grupo_materias gm ON gm.id=a.grupo_materia_id WHERE a.alumno_id=p_alumno AND gm.grupo_id=st.grupo_id)) THEN blockers:=array_append(blockers,'Hay notas o asistencias en el grupo antes del inicio; requiere conciliación.'); END IF;
 ELSE
  IF st.activo IS DISTINCT FROM false OR st.estado_escolar NOT IN ('baja','traslado') OR st.grupo_id IS NOT NULL THEN blockers:=array_append(blockers,'Solo retorno desde baja o traslado previamente registrado.'); END IF;
  SELECT m.* INTO prev FROM public.jaguar360_movimientos_escolares m JOIN public.jaguar360_movimiento_resoluciones r ON r.movimiento_id=m.id AND r.estado='applied' WHERE m.alumno_id=p_alumno ORDER BY r.creado_at DESC,m.id DESC LIMIT 1;
  SELECT * INTO prevres FROM public.jaguar360_movimiento_resoluciones WHERE movimiento_id=prev.id;
  IF prev.id IS NULL OR prev.ciclo IS DISTINCT FROM p_ciclo OR prev.tipo NOT IN ('baja','traslado') OR prevres.despues->>'state' IS DISTINCT FROM st.estado_escolar OR prevres.despues->>'matricula' IS DISTINCT FROM st.matricula THEN blockers:=array_append(blockers,'Falta antecedente de salida V25 del mismo ciclo; el retorno de otro ciclo requiere dictamen académico.'); END IF;
  IF NOT coalesce(today<firstday,false) THEN blockers:=array_append(blockers,'Retorno solo antes de iniciar clases.'); END IF;
  SELECT * INTO dest FROM public.grupos WHERE id=p_grupo;
  SELECT * INTO bind FROM public.jaguar360_grupos_ciclo WHERE grupo_id=p_grupo;
  IF dest.id IS NULL OR bind.ciclo IS DISTINCT FROM p_ciclo THEN blockers:=array_append(blockers,'Destino no vinculado al ciclo.'); ELSE
   cat:=public.jaguar360_catalogo_destino(p_grupo,p_ciclo);
   SELECT count(*) INTO occupied FROM public.alumnos WHERE grupo_id=p_grupo;
   IF dest.activo IS DISTINCT FROM true OR dest.grado::text IS DISTINCT FROM prevres.antes->>'grade' OR dest.turno IS DISTINCT FROM (prevres.antes->>'shift') OR bind.huella_catalogo IS DISTINCT FROM cat->>'fingerprint' OR cat->>'valid' IS DISTINCT FROM 'true' OR occupied>=bind.cupo THEN blockers:=array_append(blockers,'Destino sin cupo o incompatible con grado, turno o catálogo.'); END IF;
   IF EXISTS(SELECT 1 FROM public.calificaciones c JOIN public.grupo_materias g ON g.id=c.grupo_materia_id WHERE c.alumno_id=p_alumno AND g.grupo_id=p_grupo) OR EXISTS(SELECT 1 FROM public.asistencias a JOIN public.grupo_materias g ON g.id=a.grupo_materia_id WHERE a.alumno_id=p_alumno AND g.grupo_id=p_grupo) THEN blockers:=array_append(blockers,'Destino contiene antecedentes del alumno; requiere conciliación.'); END IF;
  END IF;
 END IF;
 base:=jsonb_build_object('group',st.grupo_id::text,'active',st.activo,'state',st.estado_escolar,'grade',coalesce(oldg.grado,st.grado_ingreso),'shift',st.turno,'matricula',st.matricula);
 snapshot:=jsonb_build_object('cycle',p_ciclo,'student',p_alumno::text,'type',p_tipo,'target',p_grupo::text,'before',base,'identity',st.auth_user_id,'periods',periods,'currentPeriod',pe.id::text,'destination',cat,'occupancy',occupied,'capacity',bind.cupo,'previous',prev.id::text,'blockers',to_jsonb(blockers));
 RETURN jsonb_build_object('before',base,'blockers',to_jsonb(blockers),'eligible',cardinality(blockers)=0,'fingerprint',md5(snapshot::text),'target',p_grupo::text,'destination',cat);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_contexto_movimiento(text,bigint,text,bigint) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_movimiento_escolar(p_actor uuid,p_ciclo text,p_alumno bigint,p_tipo text,p_grupo bigint DEFAULT NULL,p_op text DEFAULT NULL,p_id bigint DEFAULT NULL,p_huella text DEFAULT NULL,p_reference text DEFAULT NULL,p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor record; m public.jaguar360_movimientos_escolares; st public.alumnos; ctx jsonb; hist jsonb; afterrow jsonb; before_row jsonb; state text; newg public.grupos;
BEGIN
 IF p_op IS NOT NULL THEN
  LOCK TABLE public.perfiles,public.periodos_escolares,public.jaguar360_cierres_periodo,public.grupos,public.grupo_materias,public.jaguar360_grupos_ciclo,public.jaguar360_planes_ciclo,public.horarios,public.asignaciones_docentes,public.rubricas_evaluacion,public.bitacora_excel_diaria,public.calificaciones,public.asistencias,public.jaguar360_convocatorias,public.jaguar360_recuperaciones,public.jaguar360_reservas_recursamiento,public.jaguar360_intentos_recursamiento IN SHARE MODE NOWAIT;
  LOCK TABLE public.alumnos,public.jaguar360_movimientos_escolares,public.jaguar360_movimiento_resoluciones IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 END IF;
 SELECT rol,nombre_completo INTO actor FROM public.perfiles WHERE id=p_actor AND activo IS TRUE;
 IF NOT FOUND OR coalesce(actor.rol,'') NOT IN ('control_escolar','control','direccion_escolar') THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF p_op IS NOT NULL THEN
  IF p_op NOT IN ('propose','approve','reject') OR p_reference IS NULL OR char_length(btrim(p_reference)) NOT BETWEEN 5 AND 300 OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Operación o evidencia inválida.'; END IF;
  IF p_op='propose' THEN
   IF actor.rol NOT IN ('control_escolar','control') THEN RAISE EXCEPTION 'Solo Control Escolar propone.' USING ERRCODE='42501'; END IF;
   ctx:=public.jaguar360_contexto_movimiento(p_ciclo,p_alumno,p_tipo,p_grupo);
   IF ctx->>'eligible' IS DISTINCT FROM 'true' OR ctx->>'fingerprint' IS DISTINCT FROM p_huella OR p_huella IS NULL OR EXISTS(SELECT 1 FROM public.jaguar360_movimientos_escolares q WHERE q.alumno_id=p_alumno AND NOT EXISTS(SELECT 1 FROM public.jaguar360_movimiento_resoluciones r WHERE r.movimiento_id=q.id)) THEN RAISE EXCEPTION 'Movimiento no elegible, pendiente existente o evidencia modificada.'; END IF;
   INSERT INTO public.jaguar360_movimientos_escolares(alumno_id,ciclo,tipo,grupo_destino,huella,contexto,actor_id,actor_nombre,referencia,motivo) VALUES(p_alumno,p_ciclo,p_tipo,p_grupo,p_huella,ctx,p_actor,coalesce(actor.nombre_completo,'Sin nombre'),btrim(p_reference),btrim(p_reason));
  ELSE
   IF actor.rol<>'direccion_escolar' THEN RAISE EXCEPTION 'Solo Dirección resuelve.' USING ERRCODE='42501'; END IF;
   SELECT * INTO m FROM public.jaguar360_movimientos_escolares WHERE id=p_id AND alumno_id=p_alumno AND ciclo=p_ciclo AND tipo=p_tipo AND grupo_destino IS NOT DISTINCT FROM p_grupo;
   IF NOT FOUND OR m.actor_id=p_actor THEN RAISE EXCEPTION 'Conflicto de interés o movimiento inexistente.' USING ERRCODE='42501'; END IF;
   IF EXISTS(SELECT 1 FROM public.jaguar360_movimiento_resoluciones WHERE movimiento_id=m.id) OR p_huella IS DISTINCT FROM m.huella THEN RAISE EXCEPTION 'Movimiento resuelto o huella incorrecta.'; END IF;
   ctx:=public.jaguar360_contexto_movimiento(p_ciclo,p_alumno,p_tipo,p_grupo); before_row:=ctx->'before'; afterrow:=before_row; state:='rejected';
   IF p_op='approve' THEN
    IF ctx->>'eligible' IS DISTINCT FROM 'true' OR ctx->>'fingerprint' IS DISTINCT FROM m.huella THEN RAISE EXCEPTION 'Evidencia cambió; rechaza y vuelve a presentar.'; END IF;
    IF p_tipo='retorno' THEN
     SELECT * INTO newg FROM public.grupos WHERE id=p_grupo;
     UPDATE public.alumnos SET grupo_id=p_grupo,activo=true,estado_escolar='activo',grado_ingreso=newg.grado,turno=newg.turno WHERE id=p_alumno RETURNING * INTO st;
     IF st.grupo_id IS DISTINCT FROM p_grupo OR st.activo IS DISTINCT FROM true OR st.estado_escolar IS DISTINCT FROM 'activo' OR st.grado_ingreso IS DISTINCT FROM newg.grado OR st.turno IS DISTINCT FROM newg.turno THEN RAISE EXCEPTION 'Retorno no confirmado.'; END IF;
    ELSE
     UPDATE public.alumnos SET grupo_id=NULL,activo=false,estado_escolar=p_tipo WHERE id=p_alumno RETURNING * INTO st;
     IF st.grupo_id IS NOT NULL OR st.activo IS DISTINCT FROM false OR st.estado_escolar IS DISTINCT FROM p_tipo THEN RAISE EXCEPTION 'Salida no confirmada.'; END IF;
    END IF;
    IF st.matricula IS DISTINCT FROM before_row->>'matricula' THEN RAISE EXCEPTION 'La matrícula no puede cambiar.'; END IF;
    afterrow:=jsonb_build_object('group',st.grupo_id::text,'active',st.activo,'state',st.estado_escolar,'grade',CASE WHEN p_tipo='retorno' THEN st.grado_ingreso ELSE (before_row->>'grade')::int END,'shift',st.turno,'matricula',st.matricula); state:='applied';
   END IF;
   INSERT INTO public.jaguar360_movimiento_resoluciones(movimiento_id,estado,actor_id,actor_nombre,referencia,motivo,antes,despues) VALUES(m.id,state,p_actor,coalesce(actor.nombre_completo,'Sin nombre'),btrim(p_reference),btrim(p_reason),before_row,afterrow);
  END IF;
 END IF;
 ctx:=public.jaguar360_contexto_movimiento(p_ciclo,p_alumno,p_tipo,p_grupo);
 SELECT coalesce(jsonb_agg(h ORDER BY id DESC),'[]'::jsonb) INTO hist FROM (SELECT q.id, jsonb_build_object('id',q.id::text,'cycle',q.ciclo,'type',q.tipo,'target',q.grupo_destino::text,'fingerprint',q.huella,'reference',q.referencia,'reason',q.motivo,'actor',q.actor_nombre,'state',coalesce(r.estado,'pending'),'resolution',CASE WHEN r.movimiento_id IS NULL THEN NULL ELSE jsonb_build_object('actor',r.actor_nombre,'reference',r.referencia,'before',r.antes,'after',r.despues,'at',r.creado_at) END) h FROM public.jaguar360_movimientos_escolares q LEFT JOIN public.jaguar360_movimiento_resoluciones r ON r.movimiento_id=q.id WHERE q.alumno_id=p_alumno ORDER BY q.id DESC LIMIT 100) rows;
 RETURN ctx||jsonb_build_object('history',hist,'pending',EXISTS(SELECT 1 FROM public.jaguar360_movimientos_escolares q WHERE q.alumno_id=p_alumno AND NOT EXISTS(SELECT 1 FROM public.jaguar360_movimiento_resoluciones r WHERE r.movimiento_id=q.id)));
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_movimiento_escolar(uuid,text,bigint,text,bigint,text,bigint,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_movimiento_escolar(uuid,text,bigint,text,bigint,text,bigint,text,text,text) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
