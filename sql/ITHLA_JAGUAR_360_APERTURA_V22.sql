-- Jaguar 360 V22: transition from a fully sealed cycle to a prebound, empty destination.
-- Experimental: install/test only in isolated DB. No student promotion or grade mutation.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar360_aperturas_ciclo (
 ciclo text PRIMARY KEY, ciclo_origen text NOT NULL UNIQUE,
 version_plan integer NOT NULL, huella text NOT NULL CHECK (huella ~ '^[a-f0-9]{32}$'),
 evidencia jsonb NOT NULL, resultado jsonb NOT NULL, actor_id uuid NOT NULL,
 actor_nombre text NOT NULL, motivo text NOT NULL, referencia text NOT NULL,
 creado_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(ciclo,version_plan) REFERENCES public.jaguar360_planes_ciclo(ciclo,version) ON DELETE RESTRICT
);
ALTER TABLE public.jaguar360_aperturas_ciclo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_aperturas_ciclo FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.jaguar_precision_calificaciones ADD COLUMN IF NOT EXISTS redondeo_ordinario text NOT NULL DEFAULT 'nearest' CHECK(redondeo_ordinario IN ('nearest','truncate'));
-- Keep the accepted initial policy aligned with the legacy policy row. Later policy changes need an authorized version transition.
CREATE OR REPLACE FUNCTION public.jaguar360_proteger_politica_activada()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j jsonb; cy text;
BEGIN
 IF TG_OP<>'INSERT' THEN
  j:=to_jsonb(OLD); cy:=coalesce(j->>'ciclo',j->>'ciclo_escolar');
  IF EXISTS(SELECT 1 FROM public.jaguar360_aperturas_ciclo WHERE ciclo=cy) THEN RAISE EXCEPTION 'Política de ciclo activada: requiere transición de versión autorizada.' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP<>'DELETE' THEN
  j:=to_jsonb(NEW); cy:=coalesce(j->>'ciclo',j->>'ciclo_escolar');
  IF EXISTS(SELECT 1 FROM public.jaguar360_aperturas_ciclo WHERE ciclo=cy) THEN RAISE EXCEPTION 'Política de ciclo activada: requiere transición de versión autorizada.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_proteger_politica_activada() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS jaguar360_proteger_politica ON public.jaguar_precision_calificaciones;
CREATE TRIGGER jaguar360_proteger_politica BEFORE INSERT OR UPDATE OR DELETE ON public.jaguar_precision_calificaciones FOR EACH ROW EXECUTE FUNCTION public.jaguar360_proteger_politica_activada();
DROP TRIGGER IF EXISTS jaguar360_proteger_plan ON public.jaguar360_planes_ciclo;
CREATE TRIGGER jaguar360_proteger_plan BEFORE INSERT OR UPDATE OR DELETE ON public.jaguar360_planes_ciclo FOR EACH ROW EXECUTE FUNCTION public.jaguar360_proteger_politica_activada();

-- A calendar already activated cannot be replaced through legacy CRUD. Flag changes remain available for period transitions.
CREATE OR REPLACE FUNCTION public.jaguar360_proteger_calendario_activado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'activo'-'es_periodo_actual')=(to_jsonb(OLD)-'activo'-'es_periodo_actual') THEN RETURN NEW; END IF;
 END IF;
 IF TG_OP<>'INSERT' THEN
  IF EXISTS(SELECT 1 FROM public.jaguar360_aperturas_ciclo WHERE ciclo=OLD.ciclo_escolar) THEN RAISE EXCEPTION 'Calendario activado: requiere transición autorizada.' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP<>'DELETE' THEN
  IF EXISTS(SELECT 1 FROM public.jaguar360_aperturas_ciclo WHERE ciclo=NEW.ciclo_escolar) THEN RAISE EXCEPTION 'Calendario activado: requiere transición autorizada.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_proteger_calendario_activado() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS jaguar360_proteger_calendario ON public.periodos_escolares;
CREATE TRIGGER jaguar360_proteger_calendario BEFORE INSERT OR UPDATE OR DELETE ON public.periodos_escolares FOR EACH ROW EXECUTE FUNCTION public.jaguar360_proteger_calendario_activado();

CREATE OR REPLACE FUNCTION public.jaguar360_abrir_ciclo(p_actor uuid,p_ciclo text,p_huella text DEFAULT NULL,p_motivo text DEFAULT NULL,p_referencia text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; cur public.periodos_escolares; src public.jaguar360_planes_ciclo; dst public.jaguar360_planes_ciclo;
 prev public.jaguar360_aperturas_ciclo; srcperiods jsonb; targetgroups jsonb; oldgroups jsonb; payload jsonb; h text; g record; rowp jsonb; pol jsonb; cal jsonb; cat jsonb;
 reasons text[]:=ARRAY[]::text[]; writing boolean:=p_huella IS NOT NULL; result jsonb; n int; startdate date; d date:=(now() AT TIME ZONE 'America/Mexico_City')::date;
BEGIN
 IF writing THEN
  LOCK TABLE public.perfiles,public.jaguar360_planes_ciclo,public.jaguar360_cierres_periodo,public.jaguar360_grupos_ciclo,public.grupo_materias,public.materias,public.alumnos,public.calificaciones,public.asistencias,public.horarios,public.asignaciones_docentes,public.rubricas_evaluacion,public.bitacora_excel_diaria,public.jaguar_evaluacion_ventanas IN SHARE MODE NOWAIT;
  LOCK TABLE public.periodos_escolares,public.grupos,public.jaguar_precision_calificaciones,public.jaguar360_aperturas_ciclo IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 END IF;
 SELECT id,rol,nombre_completo INTO a FROM public.perfiles WHERE id=p_actor AND activo IS TRUE;
 IF NOT FOUND OR a.rol NOT IN ('direccion_escolar','control_escolar','control','coordinacion_academica') OR (writing AND a.rol<>'direccion_escolar') THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF p_ciclo IS NULL OR p_ciclo !~ '^[0-9]{4}-[0-9]{4}$' OR substring(p_ciclo,6,4)::int<>substring(p_ciclo,1,4)::int+1 THEN RAISE EXCEPTION 'Ciclo inválido.'; END IF;
 SELECT * INTO prev FROM public.jaguar360_aperturas_ciclo WHERE ciclo=p_ciclo;
 IF FOUND THEN
  IF writing AND p_huella IS DISTINCT FROM prev.huella THEN RAISE EXCEPTION 'El ciclo ya fue abierto con otra evidencia.'; END IF;
  RETURN jsonb_build_object('cycle',p_ciclo,'ready',false,'activated',true,'fingerprint',prev.huella,'result',prev.resultado,'blockers','[]'::jsonb);
 END IF;
 IF (SELECT count(*) FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE)<>1 THEN RAISE EXCEPTION 'Debe existir exactamente un periodo actual.'; END IF;
 SELECT * INTO cur FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE;
 IF cur.ciclo_escolar IS NULL OR cur.ciclo_escolar !~ '^[0-9]{4}-[0-9]{4}$' OR substring(cur.ciclo_escolar,6,4)<>substring(p_ciclo,1,4) THEN RAISE EXCEPTION 'Solo se puede abrir el ciclo consecutivo.'; END IF;
 SELECT * INTO src FROM public.jaguar360_planes_ciclo WHERE ciclo=cur.ciclo_escolar AND estado='validada_para_planificacion' ORDER BY version DESC LIMIT 1;
 SELECT * INTO dst FROM public.jaguar360_planes_ciclo WHERE ciclo=p_ciclo AND estado='validada_para_planificacion' ORDER BY version DESC LIMIT 1;
 IF src.id IS NULL OR dst.id IS NULL THEN RAISE EXCEPTION 'Se requieren planes validados de origen y destino.'; END IF;
 pol:=dst.plan->'policy'; cal:=dst.plan->'calendar';
 IF jsonb_typeof(cal) IS DISTINCT FROM 'array' OR jsonb_array_length(cal) NOT BETWEEN 1 AND 6 OR jsonb_array_length(cal) IS DISTINCT FROM (pol->>'periods')::int THEN RAISE EXCEPTION 'Calendario de destino inválido.'; END IF;
 startdate:=(cal->0->>'start')::date;
 IF startdate IS NULL OR startdate<d OR cur.fecha_fin IS NULL OR cur.fecha_fin>=d OR startdate<=cur.fecha_fin THEN reasons:=array_append(reasons,'El ciclo anterior debe haber terminado y el nuevo no debe haber comenzado.'); END IF;
 IF EXISTS(SELECT 1 FROM public.periodos_escolares WHERE ciclo_escolar=p_ciclo) THEN reasons:=array_append(reasons,'Ya existen periodos de destino; no se sobrescriben.'); END IF;
 IF EXISTS(SELECT 1 FROM public.jaguar_precision_calificaciones WHERE ciclo_escolar=p_ciclo) THEN reasons:=array_append(reasons,'Ya existe política antigua para el destino; requiere conciliación.'); END IF;
 IF jsonb_typeof(src.plan->'calendar') IS DISTINCT FROM 'array' OR jsonb_array_length(src.plan->'calendar')<>(SELECT count(*) FROM public.periodos_escolares WHERE ciclo_escolar=cur.ciclo_escolar) OR cur.numero_periodo IS DISTINCT FROM jsonb_array_length(src.plan->'calendar') OR EXISTS(SELECT 1 FROM jsonb_array_elements(src.plan->'calendar') c WHERE (SELECT count(*) FROM public.periodos_escolares p JOIN public.jaguar360_cierres_periodo s ON s.periodo_id=p.id AND s.ciclo=cur.ciclo_escolar AND s.plan_version=src.version WHERE p.ciclo_escolar=cur.ciclo_escolar AND p.numero_periodo=(c->>'number')::int AND p.fecha_inicio=(c->>'start')::date AND p.fecha_fin=(c->>'end')::date)<>1) THEN reasons:=array_append(reasons,'Origen: faltan sellos ordinarios o su calendario y versión no coinciden.'); END IF;
 IF EXISTS(SELECT 1 FROM public.jaguar_evaluacion_ventanas v JOIN public.periodos_escolares p ON p.id=v.periodo_id WHERE p.ciclo_escolar=cur.ciclo_escolar AND v.habilitada IS TRUE) THEN reasons:=array_append(reasons,'Hay ventanas ordinarias abiertas en origen.'); END IF;
 -- Check destination calendar order and all fields independently of the client.
 n:=0;
 FOR rowp IN SELECT value FROM jsonb_array_elements(cal) LOOP
  n:=n+1;
  IF (rowp->>'number')::int IS DISTINCT FROM n OR (rowp->>'start')::date IS NULL OR (rowp->>'end')::date IS NULL OR (rowp->>'end')::date<(rowp->>'start')::date OR (n>1 AND (rowp->>'start')::date<=(cal->(n-2)->>'end')::date) OR (rowp->>'start')::date<make_date(substring(p_ciclo,1,4)::int,1,1) OR (rowp->>'end')::date>make_date(substring(p_ciclo,6,4)::int,12,31) THEN RAISE EXCEPTION 'Fechas de destino inválidas.'; END IF;
 END LOOP;
 IF coalesce(pol->>'precision','0') NOT IN ('0','1') OR coalesce(pol->>'ordinaryRounding','nearest') NOT IN ('nearest','truncate') OR coalesce((pol->>'minimum')::int,0) NOT BETWEEN 1 AND 10 OR jsonb_typeof(pol->'floor') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Política ordinaria inválida.'; END IF;
 targetgroups:='[]'::jsonb; oldgroups:='[]'::jsonb;
 FOR g IN SELECT gg.*,b.ciclo AS bound_cycle,b.huella_catalogo,b.version_plan,b.cupo FROM public.grupos gg LEFT JOIN public.jaguar360_grupos_ciclo b ON b.grupo_id=gg.id WHERE gg.activo IS TRUE ORDER BY gg.id LOOP
  IF g.bound_cycle=p_ciclo THEN
   cat:=public.jaguar360_catalogo_destino(g.id,p_ciclo);
   IF g.version_plan IS DISTINCT FROM dst.version OR cat->>'valid' IS DISTINCT FROM 'true' OR cat->>'fingerprint' IS DISTINCT FROM g.huella_catalogo OR EXISTS(SELECT 1 FROM public.alumnos WHERE grupo_id=g.id) OR EXISTS(SELECT 1 FROM public.calificaciones r JOIN public.grupo_materias gm ON gm.id=r.grupo_materia_id WHERE gm.grupo_id=g.id) OR EXISTS(SELECT 1 FROM public.asistencias r JOIN public.grupo_materias gm ON gm.id=r.grupo_materia_id WHERE gm.grupo_id=g.id) THEN reasons:=array_append(reasons,'Grupo destino incompatible, ocupado o modificado: '||g.id); END IF;
   targetgroups:=targetgroups||jsonb_build_array(jsonb_build_object('id',g.id::text,'name',g.clave,'grade',g.grado,'letter',g.letra,'shift',g.turno,'fingerprint',cat->>'fingerprint','capacity',g.cupo));
  ELSIF (g.bound_cycle IS NULL OR g.bound_cycle=cur.ciclo_escolar) AND EXISTS(SELECT 1 FROM public.jaguar360_cierres_periodo s CROSS JOIN LATERAL jsonb_array_elements(s.mapa_materias) m WHERE s.ciclo=cur.ciclo_escolar AND m->>'grupo'=g.id::text) THEN
   oldgroups:=oldgroups||jsonb_build_array(jsonb_build_object('id',g.id::text,'name',g.clave,'grade',g.grado,'fingerprint',md5(to_jsonb(g)::text)));
  ELSE reasons:=array_append(reasons,'Grupo activo sin vínculo inequívoco al origen o destino: '||g.id);
  END IF;
 END LOOP;
 IF jsonb_array_length(oldgroups)=0 OR jsonb_array_length(targetgroups)=0 OR EXISTS(SELECT 1 FROM generate_series(1,3) i WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(targetgroups) x WHERE (x->>'grade')::int=i)) THEN reasons:=array_append(reasons,'Se requieren grupos de origen identificados y destinos para los tres grados.'); END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(targetgroups) x GROUP BY x->>'name' HAVING count(*)>1) THEN reasons:=array_append(reasons,'Hay nombres de grupos destino duplicados.'); END IF;
 -- Only the verified origin groups are archived; do not move any student here.
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id::text,'period',p.numero_periodo,'end',p.fecha_fin,'seal',s.huella) ORDER BY p.numero_periodo,p.id),'[]'::jsonb) INTO srcperiods FROM public.periodos_escolares p LEFT JOIN public.jaguar360_cierres_periodo s ON s.periodo_id=p.id WHERE p.ciclo_escolar=cur.ciclo_escolar;
 payload:=jsonb_build_object('source',cur.ciclo_escolar,'sourceCurrent',cur.id::text,'sourcePeriods',srcperiods,'sourceGroups',oldgroups,'targetGroups',targetgroups,'targetVersion',dst.version,'plan',dst.plan);
 h:=md5(payload::text);
 IF writing THEN
  IF cardinality(reasons)>0 THEN RAISE EXCEPTION 'Apertura bloqueada: %',array_to_string(reasons,' '); END IF;
  IF h IS DISTINCT FROM p_huella OR p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500 OR p_referencia IS NULL OR char_length(btrim(p_referencia)) NOT BETWEEN 5 AND 300 THEN RAISE EXCEPTION 'Confirmación incompleta o evidencia modificada.'; END IF;
  UPDATE public.periodos_escolares SET es_periodo_actual=false,activo=false WHERE ciclo_escolar=cur.ciclo_escolar;
  UPDATE public.grupos SET activo=false WHERE id IN (SELECT (x->>'id')::bigint FROM jsonb_array_elements(oldgroups) x);
  INSERT INTO public.periodos_escolares(nombre,ciclo_escolar,fecha_inicio,fecha_fin,activo,numero_periodo,es_periodo_actual)
   SELECT 'Periodo '||(x->>'number'),p_ciclo,(x->>'start')::date,(x->>'end')::date,true,(x->>'number')::int,(x->>'number')::int=1 FROM jsonb_array_elements(cal) x ORDER BY (x->>'number')::int;
  INSERT INTO public.jaguar_precision_calificaciones(ciclo_escolar,permite_decimales,minima_aprobatoria,permitir_reprobatorias_inferiores,redondeo_ordinario,version,actualizado_por)
   VALUES(p_ciclo,coalesce((pol->>'precision')::int,0)=1,(pol->>'minimum')::int,NOT (pol->>'floor')::boolean,coalesce(pol->>'ordinaryRounding','nearest'),1,p_actor);
  result:=jsonb_build_object('source',cur.ciclo_escolar,'periods',jsonb_array_length(cal),'archivedGroups',jsonb_array_length(oldgroups),'targetGroups',jsonb_array_length(targetgroups),'studentMoves',0,'version',dst.version);
  INSERT INTO public.jaguar360_aperturas_ciclo(ciclo,ciclo_origen,version_plan,huella,evidencia,resultado,actor_id,actor_nombre,motivo,referencia) VALUES(p_ciclo,cur.ciclo_escolar,dst.version,h,payload,result,p_actor,coalesce(a.nombre_completo,'Sin nombre'),btrim(p_motivo),btrim(p_referencia));
  RETURN jsonb_build_object('cycle',p_ciclo,'ready',false,'activated',true,'fingerprint',h,'result',result,'blockers','[]'::jsonb);
 END IF;
 RETURN jsonb_build_object('cycle',p_ciclo,'source',cur.ciclo_escolar,'ready',cardinality(reasons)=0,'activated',false,'fingerprint',h,'blockers',to_jsonb(reasons),'plan',dst.plan,'version',dst.version,'sourceGroups',oldgroups,'targetGroups',targetgroups);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_abrir_ciclo(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_abrir_ciclo(uuid,text,text,text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.jaguar_normalizar_calificacion_oficial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_ciclo text;v_decimal boolean;v_minima integer;v_permitir boolean;v_original numeric; v_modo text;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF public.jaguar_reaplicacion_autorizada(to_jsonb(old),to_jsonb(new)) THEN RETURN new; END IF;
  IF new.calificacion_original_politica IS NOT DISTINCT FROM old.calificacion_original_politica AND new.calificacion IS NOT DISTINCT FROM old.calificacion THEN RETURN new; END IF;
 END IF;
 IF new.calificacion IS NULL THEN new.calificacion_original_politica:=NULL; RETURN new; END IF;
 IF TG_OP='INSERT' THEN v_original:=coalesce(new.calificacion_original_politica,new.calificacion::numeric);
 ELSIF new.calificacion_original_politica IS DISTINCT FROM old.calificacion_original_politica THEN v_original:=coalesce(new.calificacion_original_politica,new.calificacion::numeric);
 ELSE v_original:=new.calificacion::numeric; END IF;
 SELECT ciclo_escolar INTO v_ciclo FROM public.periodos_escolares WHERE id=new.periodo_id;
 IF v_ciclo IS NULL THEN RAISE EXCEPTION 'Periodo escolar inexistente para esta calificación.'; END IF;
 SELECT permite_decimales,minima_aprobatoria,permitir_reprobatorias_inferiores,redondeo_ordinario INTO v_decimal,v_minima,v_permitir,v_modo FROM public.jaguar_precision_calificaciones WHERE ciclo_escolar=v_ciclo;
 v_minima:=coalesce(v_minima,6);
 new.calificacion_original_politica:=v_original;
 new.calificacion:=public.jaguar360_nota_ordinaria(v_original,coalesce(v_decimal,false),v_minima,coalesce(v_permitir,true),coalesce(v_modo,'nearest'));
 new.observaciones:=public.jaguar_observacion_segun_criterio(v_original,v_minima,new.observaciones);
 RETURN new;
END $$;
COMMIT;
NOTIFY pgrst,'reload schema';
