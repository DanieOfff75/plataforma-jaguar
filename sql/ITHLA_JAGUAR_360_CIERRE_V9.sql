-- V9: cierre protegido de evidencia académica. SOLO BASE AISLADA hasta validar
-- rectificaciones, activación del plan y todos los consumidores históricos.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar360_cierres_periodo (
 periodo_id bigint PRIMARY KEY REFERENCES public.periodos_escolares(id) ON DELETE RESTRICT,
 verificacion_id bigint NOT NULL REFERENCES public.jaguar360_verificaciones_cierre(id) ON DELETE RESTRICT,
 ciclo text NOT NULL, plan_version integer NOT NULL,
 huella text NOT NULL CHECK(huella ~ '^[a-f0-9]{32}$'),
 evidencia jsonb NOT NULL CHECK(jsonb_typeof(evidencia)='object'),
 mapa_materias jsonb NOT NULL CHECK(jsonb_typeof(mapa_materias)='array'),
 actor_id uuid NOT NULL, actor_nombre text NOT NULL,
 motivo text NOT NULL CHECK(char_length(btrim(motivo)) BETWEEN 15 AND 1500),
 creado_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(ciclo,plan_version) REFERENCES public.jaguar360_planes_ciclo(ciclo,version) ON DELETE RESTRICT
);
ALTER TABLE public.jaguar360_cierres_periodo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_cierres_periodo FROM PUBLIC,anon,authenticated,service_role;

-- Serializa contra escritores de las fuentes del comprobador (NOWAIT, sin espera indefinida).
-- Una consulta nunca expone las notas o las asistencias individuales del sello.
CREATE OR REPLACE FUNCTION public.jaguar360_cierre_periodo(p_actor uuid,p_periodo bigint,p_plan_version integer DEFAULT NULL,p_huella text DEFAULT NULL,p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; pe record; plan jsonb; pv integer; v jsonb; seal public.jaguar360_cierres_periodo; verification public.jaguar360_verificaciones_cierre; snap jsonb; mapping jsonb; blockers text[]:=ARRAY[]::text[]; seal_hash text; t text; writing boolean:=p_huella IS NOT NULL;
BEGIN
 SELECT id,rol,nombre_completo INTO a FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('direccion_escolar','coordinacion_academica','control_escolar','control');
 IF NOT FOUND OR (writing AND a.rol<>'direccion_escolar') THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF writing THEN
  IF p_huella !~ '^[a-f0-9]{32}$' OR p_plan_version IS NULL OR p_plan_version<1 OR p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Confirmación inválida.'; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext('j360-cierre-global')) THEN RAISE EXCEPTION 'Otro cierre está en curso.' USING ERRCODE='55P03'; END IF;
  LOCK TABLE public.periodos_escolares,public.jaguar360_evidencias_periodo,public.calificaciones,public.asistencias,public.alumnos,public.grupo_materias,public.grupos,public.materias,public.jaguar360_listas_sesion,public.jaguar_evaluacion_ventanas,public.jaguar360_planes_ciclo,public.jaguar360_verificaciones_cierre IN SHARE MODE NOWAIT;
  FOREACH t IN ARRAY ARRAY['rubricas_evaluacion','rubrica_componentes','evaluacion_notas','cierres_evaluacion','bitacora_excel_diaria','jaguar_cargas_grupo','jaguar_cargas_materias','jaguar_classroom_importaciones','jaguar_classroom_trabajos_tipo'] LOOP
   IF to_regclass('public.'||t) IS NOT NULL THEN EXECUTE format('LOCK TABLE public.%I IN SHARE MODE NOWAIT',t); END IF;
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtext('j360-cierre:'||p_periodo));
 END IF;
 SELECT * INTO pe FROM public.periodos_escolares WHERE id=p_periodo;
 IF NOT FOUND THEN RAISE EXCEPTION 'Periodo inexistente.'; END IF;
 SELECT * INTO seal FROM public.jaguar360_cierres_periodo WHERE periodo_id=p_periodo;
 IF FOUND THEN
  IF writing AND (seal.huella IS DISTINCT FROM p_huella OR seal.plan_version IS DISTINCT FROM p_plan_version) THEN RAISE EXCEPTION 'El periodo ya fue sellado con otra evidencia.'; END IF;
  RETURN jsonb_build_object('sealed',true,'period',p_periodo::text,'cycle',seal.ciclo,'planVersion',seal.plan_version,'fingerprint',seal.huella,'actor',seal.actor_nombre,'createdAt',seal.creado_at,'reason',seal.motivo,'blockers','[]'::jsonb,'ready',false);
 END IF;
 v:=public.jaguar360_verificar_cierre(p_actor,p_periodo);
 IF NOT coalesce((v->>'verificacion_posible')::boolean AND (v->>'verificacion_vigente')::boolean,false) THEN blockers:=array_append(blockers,'Se requiere una verificación documental completa y vigente.'); END IF;
 IF EXISTS(SELECT 1 FROM public.jaguar_evaluacion_ventanas WHERE periodo_id=p_periodo AND habilitada IS TRUE) THEN blockers:=array_append(blockers,'Cerrar primero la ventana ordinaria de captura.'); END IF;
 SELECT t.plan,t.version INTO plan,pv FROM public.jaguar360_planes_ciclo t WHERE ciclo=pe.ciclo_escolar AND estado='validada_para_planificacion' ORDER BY version DESC LIMIT 1;
 IF NOT FOUND THEN blockers:=array_append(blockers,'No existe un plan escolar validado.');
 ELSE
  IF jsonb_typeof(plan->'calendar') IS DISTINCT FROM 'array' OR pe.numero_periodo IS NULL OR pe.numero_periodo<1 OR (plan->'calendar'->(pe.numero_periodo-1)->>'start') IS DISTINCT FROM pe.fecha_inicio::text OR (plan->'calendar'->(pe.numero_periodo-1)->>'end') IS DISTINCT FROM pe.fecha_fin::text THEN blockers:=array_append(blockers,'El calendario del plan y del periodo no coinciden.'); END IF;
  IF EXISTS(SELECT 1 FROM public.jaguar360_cierres_periodo c WHERE c.ciclo=pe.ciclo_escolar AND c.plan_version<>pv) THEN blockers:=array_append(blockers,'Existe un sello del ciclo con otra versión del plan; requiere resolver la vigencia histórica.'); END IF;
 END IF;
 snap:=public.jaguar360_snapshot_verificacion(p_periodo);
 WITH obligations AS (SELECT DISTINCT n.grupo_materia_id,n.evaluacion FROM jsonb_to_recordset(snap->'notas') n(grupo_materia_id bigint,evaluacion text)),
 mapped AS (SELECT o.grupo_materia_id::text AS gm,gm.materia_id::text AS materia,g.id::text AS grupo,g.grado,m.nombre AS nombre,o.evaluacion,
 (SELECT count(*) FROM jsonb_array_elements(coalesce(plan->'curriculum','[]'::jsonb)) p WHERE p->>'legacyId'=gm.materia_id::text AND p->>'grade'=g.grado::text AND p->>'evaluation'=o.evaluacion) AS matches
 FROM obligations o LEFT JOIN public.grupo_materias gm ON gm.id=o.grupo_materia_id LEFT JOIN public.grupos g ON g.id=gm.grupo_id LEFT JOIN public.materias m ON m.id=gm.materia_id)
 SELECT coalesce(jsonb_agg(to_jsonb(mapped) ORDER BY gm),'[]'::jsonb) INTO mapping FROM mapped;
 IF jsonb_array_length(mapping)=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(mapping) z WHERE z->>'nombre' IS NULL OR z->>'matches'<>'1') THEN blockers:=array_append(blockers,'La correspondencia de materias con el plan no es inequívoca.'); END IF;
 seal_hash:=md5(jsonb_build_object('academic',v->>'huella','mapping',mapping,'plan',pv)::text);
 IF writing THEN
  IF cardinality(blockers)>0 THEN RAISE EXCEPTION 'Cierre bloqueado: %',array_to_string(blockers,' '); END IF;
  IF p_plan_version IS DISTINCT FROM pv OR p_huella IS DISTINCT FROM seal_hash OR md5(snap::text) IS DISTINCT FROM v->>'huella' THEN RAISE EXCEPTION 'Cambió el plan o la evidencia; consulta nuevamente.'; END IF;
  SELECT * INTO verification FROM public.jaguar360_verificaciones_cierre WHERE periodo_id=p_periodo ORDER BY id DESC LIMIT 1;
  IF NOT FOUND OR verification.huella IS DISTINCT FROM v->>'huella' THEN RAISE EXCEPTION 'Falta verificación vigente.'; END IF;
  INSERT INTO public.jaguar360_cierres_periodo(periodo_id,verificacion_id,ciclo,plan_version,huella,evidencia,mapa_materias,actor_id,actor_nombre,motivo)
  VALUES(p_periodo,verification.id,pe.ciclo_escolar,pv,p_huella,snap,mapping,p_actor,coalesce(a.nombre_completo,'Sin nombre'),btrim(p_motivo));
  RETURN jsonb_build_object('sealed',true,'period',p_periodo::text,'cycle',pe.ciclo_escolar,'planVersion',pv,'fingerprint',p_huella,'actor',a.nombre_completo,'createdAt',now(),'reason',btrim(p_motivo),'blockers','[]'::jsonb,'ready',false);
 END IF;
 RETURN jsonb_build_object('sealed',false,'period',p_periodo::text,'cycle',pe.ciclo_escolar,'planVersion',pv,'fingerprint',seal_hash,'blockers',to_jsonb(blockers),'ready',cardinality(blockers)=0);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_cierre_periodo(uuid,bigint,integer,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_cierre_periodo(uuid,bigint,integer,text,text) TO service_role;

-- Conservador: no se habilita una vía genérica de excepción mediante GUC o bandera JWT.
-- Las rectificaciones deben tener RPC específicos y mantener la instantánea original.
CREATE OR REPLACE FUNCTION public.jaguar360_bloqueo_periodo_sellado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j jsonb; pid bigint; rid bigint; aid bigint; dates date; gm bigint; sides jsonb[]:=ARRAY[]::jsonb[];
BEGIN
 IF TG_OP<>'INSERT' THEN sides:=array_append(sides,to_jsonb(OLD)); END IF;
 IF TG_OP<>'DELETE' THEN sides:=array_append(sides,to_jsonb(NEW)); END IF;
 IF TG_TABLE_NAME='periodos_escolares' AND TG_OP='UPDATE' THEN
  -- Se permite cambiar las banderas de periodo actual/activo al avanzar, no calendario ni identidad.
  IF (to_jsonb(NEW)-'activo'-'es_periodo_actual')=(to_jsonb(OLD)-'activo'-'es_periodo_actual') THEN RETURN NEW; END IF;
 END IF;
 FOREACH j IN ARRAY sides LOOP
  pid:=NULL;
  IF TG_TABLE_NAME='periodos_escolares' THEN pid:=(j->>'id')::bigint;
  ELSIF TG_TABLE_NAME='asistencias' THEN
   gm:=(j->>'grupo_materia_id')::bigint; dates:=(j->>'fecha')::date;
   IF EXISTS(SELECT 1 FROM public.jaguar360_cierres_periodo c WHERE dates BETWEEN (c.evidencia->'periodo'->>'fecha_inicio')::date AND (c.evidencia->'periodo'->>'fecha_fin')::date AND EXISTS(SELECT 1 FROM jsonb_array_elements(c.mapa_materias) m WHERE m->>'gm'=gm::text)) THEN RAISE EXCEPTION 'Asistencia de periodo sellado; no se permite escritura ordinaria.' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME IN ('evaluacion_notas','rubrica_componentes') THEN
   rid:=(j->>'rubrica_id')::bigint;
   SELECT periodo_id INTO pid FROM public.rubricas_evaluacion WHERE id=rid;
  ELSIF TG_TABLE_NAME='jaguar_cargas_materias' THEN
   aid:=(j->>'carga_id')::bigint;
   SELECT periodo_id INTO pid FROM public.jaguar_cargas_grupo WHERE id=aid;
  ELSE pid:=(j->>'periodo_id')::bigint;
  END IF;
  IF pid IS NOT NULL AND EXISTS(SELECT 1 FROM public.jaguar360_cierres_periodo WHERE periodo_id=pid) THEN RAISE EXCEPTION 'Periodo sellado: escritura ordinaria bloqueada.' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_bloqueo_periodo_sellado() FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['periodos_escolares','calificaciones','asistencias','jaguar360_evidencias_periodo','jaguar360_listas_sesion','jaguar_evaluacion_ventanas','rubricas_evaluacion','rubrica_componentes','evaluacion_notas','cierres_evaluacion','bitacora_excel_diaria','jaguar_cargas_grupo','jaguar_cargas_materias','jaguar_classroom_importaciones','jaguar_classroom_trabajos_tipo'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   EXECUTE format('DROP TRIGGER IF EXISTS jaguar360_bloqueo_sellado ON public.%I',t);
   EXECUTE format('CREATE TRIGGER jaguar360_bloqueo_sellado BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.jaguar360_bloqueo_periodo_sellado()',t);
  END IF;
 END LOOP;
END $$;
-- Rectificación numérica posterior al sello en un libro separado e inmutable.
-- No cambia calificaciones legadas: los informes oficiales aún requieren integración.
CREATE TABLE IF NOT EXISTS public.jaguar360_rectificaciones (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 periodo_id bigint NOT NULL REFERENCES public.jaguar360_cierres_periodo(periodo_id) ON DELETE RESTRICT,
 alumno_id bigint NOT NULL REFERENCES public.alumnos(id) ON DELETE RESTRICT,
 grupo_materia_id bigint NOT NULL REFERENCES public.grupo_materias(id) ON DELETE RESTRICT,
 anterior_id bigint REFERENCES public.jaguar360_rectificaciones(id) ON DELETE RESTRICT,
 anterior_original numeric, anterior_oficial numeric NOT NULL CHECK(anterior_oficial BETWEEN 0 AND 10),
 nuevo_original numeric NOT NULL CHECK(nuevo_original BETWEEN 0 AND 10), nuevo_oficial numeric NOT NULL CHECK(nuevo_oficial BETWEEN 0 AND 10),
 actor_id uuid NOT NULL, actor_nombre text NOT NULL, motivo text NOT NULL CHECK(char_length(btrim(motivo)) BETWEEN 15 AND 1500),
 referencia text NOT NULL CHECK(char_length(btrim(referencia)) BETWEEN 5 AND 200),
 creado_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.jaguar360_rectificacion_resoluciones (
 rectificacion_id bigint PRIMARY KEY REFERENCES public.jaguar360_rectificaciones(id) ON DELETE RESTRICT,
 estado text NOT NULL CHECK(estado IN ('autorizada','rechazada')),
 actor_id uuid NOT NULL, actor_nombre text NOT NULL, motivo text NOT NULL CHECK(char_length(btrim(motivo)) BETWEEN 15 AND 1500),
 creado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jaguar360_rectificacion_objetivo_idx ON public.jaguar360_rectificaciones(periodo_id,alumno_id,grupo_materia_id,id DESC);
ALTER TABLE public.jaguar360_rectificaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar360_rectificacion_resoluciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_rectificaciones,public.jaguar360_rectificacion_resoluciones FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_nota_ordinaria(p_original numeric,p_decimal boolean,p_minima integer,p_permitir boolean,p_modo text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE STRICT SET search_path='' AS $$
DECLARE v numeric; places integer:=CASE WHEN p_decimal THEN 1 ELSE 0 END;
BEGIN
 IF p_modo NOT IN ('nearest','truncate') OR p_minima NOT BETWEEN 1 AND 10 OR p_original NOT BETWEEN 0 AND 10 THEN RAISE EXCEPTION 'Criterio ordinario inválido.'; END IF;
 v:=CASE WHEN p_modo='truncate' THEN trunc(p_original,places) ELSE round(p_original,places) END;
 IF p_original<p_minima THEN
  v:=least(v,p_minima-CASE WHEN p_decimal THEN 0.1 ELSE 1 END);
  IF NOT p_permitir THEN v:=greatest(v,p_minima-1); END IF;
 END IF;
 RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_nota_ordinaria(numeric,boolean,integer,boolean,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_rectificar_sello(p_actor uuid,p_periodo bigint,p_alumno bigint,p_gm bigint,p_accion text DEFAULT 'consultar',p_nota numeric DEFAULT NULL,p_anterior bigint DEFAULT NULL,p_id bigint DEFAULT NULL,p_motivo text DEFAULT NULL,p_referencia text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; seal public.jaguar360_cierres_periodo; note record; prior public.jaguar360_rectificaciones; proposal public.jaguar360_rectificaciones; pol jsonb; official numeric; previous_raw numeric; previous_official numeric; output jsonb;
BEGIN
 SELECT rol,nombre_completo INTO a FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('direccion_escolar','coordinacion_academica','control_escolar','control');
 IF NOT FOUND OR p_accion IS NULL OR p_accion NOT IN ('consultar','proponer','autorizar','rechazar') OR p_accion='proponer' AND a.rol NOT IN ('control_escolar','control') OR p_accion IN ('autorizar','rechazar') AND a.rol<>'direccion_escolar' THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF p_accion<>'consultar' THEN
  IF p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Motivo requerido.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('j360-rectifica:'||p_periodo||':'||p_alumno||':'||p_gm));
 END IF;
 SELECT * INTO seal FROM public.jaguar360_cierres_periodo WHERE periodo_id=p_periodo;
 IF NOT FOUND THEN RAISE EXCEPTION 'El periodo no está sellado.'; END IF;
 SELECT n.* INTO note FROM jsonb_to_recordset(seal.evidencia->'notas') n(alumno_id bigint,grupo_materia_id bigint,evaluacion text,calificacion numeric,fuente_original numeric) WHERE n.alumno_id=p_alumno AND n.grupo_materia_id=p_gm AND n.evaluacion='numerica';
 IF NOT FOUND OR note.calificacion IS NULL THEN RAISE EXCEPTION 'No existe calificación numérica sellada para ese alumno y asignatura.'; END IF;
 SELECT r.* INTO prior FROM public.jaguar360_rectificaciones r JOIN public.jaguar360_rectificacion_resoluciones d ON d.rectificacion_id=r.id AND d.estado='autorizada' WHERE r.periodo_id=p_periodo AND r.alumno_id=p_alumno AND r.grupo_materia_id=p_gm ORDER BY r.id DESC LIMIT 1;
 previous_raw:=CASE WHEN prior.id IS NULL THEN note.fuente_original ELSE prior.nuevo_original END;
 previous_official:=coalesce(prior.nuevo_oficial,note.calificacion);
 IF p_accion='proponer' THEN
  IF p_anterior IS DISTINCT FROM prior.id THEN RAISE EXCEPTION 'Cambió la versión efectiva; vuelve a consultar.'; END IF;
  IF p_nota IS NULL OR NOT p_nota BETWEEN 0 AND 10 OR p_referencia IS NULL OR char_length(btrim(p_referencia)) NOT BETWEEN 5 AND 200 THEN RAISE EXCEPTION 'Nota o referencia inválida.'; END IF;
  IF EXISTS(SELECT 1 FROM public.jaguar360_rectificaciones r LEFT JOIN public.jaguar360_rectificacion_resoluciones d ON d.rectificacion_id=r.id WHERE r.periodo_id=p_periodo AND r.alumno_id=p_alumno AND r.grupo_materia_id=p_gm AND d.rectificacion_id IS NULL) THEN RAISE EXCEPTION 'Ya existe una rectificación pendiente.'; END IF;
  SELECT plan->'policy' INTO pol FROM public.jaguar360_planes_ciclo WHERE ciclo=seal.ciclo AND version=seal.plan_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'Falta política histórica.'; END IF;
  official:=public.jaguar360_nota_ordinaria(p_nota,coalesce((pol->>'precision')::integer,0)=1,(pol->>'minimum')::integer,NOT (pol->>'floor')::boolean,coalesce(pol->>'ordinaryRounding','nearest'));
  IF p_nota IS NOT DISTINCT FROM previous_raw AND official=previous_official THEN RAISE EXCEPTION 'No hay cambio.'; END IF;
  INSERT INTO public.jaguar360_rectificaciones(periodo_id,alumno_id,grupo_materia_id,anterior_id,anterior_original,anterior_oficial,nuevo_original,nuevo_oficial,actor_id,actor_nombre,motivo,referencia) VALUES(p_periodo,p_alumno,p_gm,prior.id,previous_raw,previous_official,p_nota,official,p_actor,coalesce(a.nombre_completo,'Sin nombre'),btrim(p_motivo),btrim(p_referencia));
 ELSIF p_accion IN ('autorizar','rechazar') THEN
  SELECT * INTO proposal FROM public.jaguar360_rectificaciones WHERE id=p_id AND periodo_id=p_periodo AND alumno_id=p_alumno AND grupo_materia_id=p_gm;
  IF NOT FOUND OR proposal.actor_id=p_actor OR proposal.anterior_id IS DISTINCT FROM prior.id OR EXISTS(SELECT 1 FROM public.jaguar360_rectificacion_resoluciones WHERE rectificacion_id=p_id) THEN RAISE EXCEPTION 'Propuesta inexistente, autorrevisión, resolución previa o versión obsoleta.'; END IF;
  INSERT INTO public.jaguar360_rectificacion_resoluciones(rectificacion_id,estado,actor_id,actor_nombre,motivo) VALUES(p_id,CASE WHEN p_accion='autorizar' THEN 'autorizada' ELSE 'rechazada' END,p_actor,coalesce(a.nombre_completo,'Sin nombre'),btrim(p_motivo));
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id::text,'previousId',r.anterior_id::text,'originalBefore',r.anterior_original,'officialBefore',r.anterior_oficial,'originalAfter',r.nuevo_original,'officialAfter',r.nuevo_oficial,'actor',r.actor_nombre,'reason',r.motivo,'reference',r.referencia,'createdAt',r.creado_at,'state',coalesce(d.estado,'pendiente'),'resolution',CASE WHEN d.rectificacion_id IS NULL THEN NULL ELSE jsonb_build_object('actor',d.actor_nombre,'reason',d.motivo,'createdAt',d.creado_at) END) ORDER BY r.id DESC),'[]'::jsonb) INTO output FROM public.jaguar360_rectificaciones r LEFT JOIN public.jaguar360_rectificacion_resoluciones d ON d.rectificacion_id=r.id WHERE r.periodo_id=p_periodo AND r.alumno_id=p_alumno AND r.grupo_materia_id=p_gm;
 RETURN jsonb_build_object('sealedOriginal',note.fuente_original,'sealedOfficial',note.calificacion,'history',output,'effectiveId',(SELECT r.id::text FROM public.jaguar360_rectificaciones r JOIN public.jaguar360_rectificacion_resoluciones d ON d.rectificacion_id=r.id AND d.estado='autorizada' WHERE r.periodo_id=p_periodo AND r.alumno_id=p_alumno AND r.grupo_materia_id=p_gm ORDER BY r.id DESC LIMIT 1));
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_rectificar_sello(uuid,bigint,bigint,bigint,text,numeric,bigint,bigint,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_rectificar_sello(uuid,bigint,bigint,bigint,text,numeric,bigint,bigint,text,text) TO service_role;

-- Proyección a partir del sello: no usa el grado o materia actuales ni la última propuesta.
CREATE OR REPLACE FUNCTION public.jaguar360_fuentes_selladas(p_actor uuid,p_ciclo text,p_alumno bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE pv integer; plan jsonb; pe record; seal public.jaguar360_cierres_periodo; rows jsonb; output jsonb:='[]'::jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('direccion_escolar','coordinacion_academica','control_escolar','control')) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.alumnos WHERE id=p_alumno) THEN RAISE EXCEPTION 'Alumno inexistente.'; END IF;
 SELECT min(plan_version) INTO pv FROM public.jaguar360_cierres_periodo WHERE ciclo=p_ciclo;
 IF pv IS NULL OR EXISTS(SELECT 1 FROM public.jaguar360_cierres_periodo WHERE ciclo=p_ciclo AND plan_version<>pv) THEN RAISE EXCEPTION 'No existe un plan común en los sellos del ciclo.'; END IF;
 SELECT t.plan INTO plan FROM public.jaguar360_planes_ciclo t WHERE ciclo=p_ciclo AND version=pv;
 IF NOT FOUND THEN RAISE EXCEPTION 'Versión histórica del plan inexistente.'; END IF;
 IF (SELECT count(*) FROM public.periodos_escolares WHERE ciclo_escolar=p_ciclo)>6 THEN RAISE EXCEPTION 'Periodos no conciliados.'; END IF;
 FOR pe IN SELECT id,numero_periodo,fecha_inicio,fecha_fin FROM public.periodos_escolares WHERE ciclo_escolar=p_ciclo ORDER BY numero_periodo,id LOOP
  SELECT * INTO seal FROM public.jaguar360_cierres_periodo WHERE periodo_id=pe.id AND ciclo=p_ciclo AND plan_version=pv;
  rows:='[]'::jsonb;
  IF seal.periodo_id IS NOT NULL THEN
   WITH notes AS (SELECT * FROM jsonb_to_recordset(seal.evidencia->'notas') AS n(alumno_id bigint,grupo_materia_id bigint,evaluacion text,calificacion numeric,fuente_original numeric,resultado text) WHERE alumno_id=p_alumno),
   marks AS (SELECT grupo_materia_id,count(*) FILTER(WHERE estado='presente') AS present,count(*) FILTER(WHERE estado='falta') AS absent,count(*) FILTER(WHERE estado='retardo') AS late,count(*) FILTER(WHERE estado='justificada') AS justified,count(*) FILTER(WHERE estado IS NULL) AS unknown FROM jsonb_to_recordset(seal.evidencia->'asistencias') AS s(alumno_id bigint,grupo_materia_id bigint,estado text) WHERE alumno_id=p_alumno GROUP BY grupo_materia_id),
   mapping AS (SELECT * FROM jsonb_to_recordset(seal.mapa_materias) AS m(gm text,materia text,grado integer,evaluacion text))
   SELECT coalesce(jsonb_agg(jsonb_build_object('subjectId',g.materia,'groupMaterialId',n.grupo_materia_id::text,'grade',g.grado,'evaluation',n.evaluacion,'official',coalesce(rect.nuevo_oficial,n.calificacion),'original',coalesce(rect.nuevo_original,n.fuente_original),'result',n.resultado,'attendance',jsonb_build_object('present',coalesce(m.present,0),'absent',coalesce(m.absent,0),'late',coalesce(m.late,0),'justified',coalesce(m.justified,0),'unknown',coalesce(m.unknown,0))) ORDER BY n.grupo_materia_id),'[]'::jsonb) INTO rows FROM notes n LEFT JOIN mapping g ON g.gm=n.grupo_materia_id::text AND g.evaluacion=n.evaluacion LEFT JOIN marks m ON m.grupo_materia_id=n.grupo_materia_id LEFT JOIN LATERAL (SELECT r.nuevo_oficial,r.nuevo_original FROM public.jaguar360_rectificaciones r JOIN public.jaguar360_rectificacion_resoluciones d ON d.rectificacion_id=r.id AND d.estado='autorizada' WHERE r.periodo_id=pe.id AND r.alumno_id=n.alumno_id AND r.grupo_materia_id=n.grupo_materia_id ORDER BY r.id DESC LIMIT 1) rect ON true;
  END IF;
  output:=output||jsonb_build_array(jsonb_build_object('number',pe.numero_periodo,'start',pe.fecha_inicio,'end',pe.fecha_fin,'verified',seal.periodo_id IS NOT NULL,'rows',rows));
 END LOOP;
 RETURN jsonb_build_object('plan',plan,'version',pv,'periods',output);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_fuentes_selladas(uuid,text,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_fuentes_selladas(uuid,text,bigint) TO service_role;
-- Avance ordinario atómico: no promueve ni exige cierre del periodo precedente.
CREATE TABLE IF NOT EXISTS public.jaguar360_avances_periodo (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 ciclo text NOT NULL, anterior_id bigint NOT NULL REFERENCES public.periodos_escolares(id) ON DELETE RESTRICT,
 nuevo_id bigint NOT NULL REFERENCES public.periodos_escolares(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL, actor_nombre text NOT NULL, creado_at timestamptz NOT NULL DEFAULT now(),
 CHECK(anterior_id<>nuevo_id)
);
ALTER TABLE public.jaguar360_avances_periodo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_avances_periodo FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_avanzar_periodo(p_actor uuid,p_destino bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; oldp public.periodos_escolares; newp public.periodos_escolares;
BEGIN
 SELECT nombre_completo INTO a FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('control_escolar','control');
 IF NOT FOUND THEN RAISE EXCEPTION 'Solo Control Escolar puede avanzar el periodo.' USING ERRCODE='42501'; END IF;
 LOCK TABLE public.periodos_escolares IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 IF (SELECT count(*) FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE)<>1 THEN RAISE EXCEPTION 'Debe existir exactamente un periodo actual; concilia la configuración.'; END IF;
 SELECT * INTO oldp FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE;
 SELECT * INTO newp FROM public.periodos_escolares WHERE id=p_destino;
 IF NOT FOUND OR newp.activo IS DISTINCT FROM true OR newp.ciclo_escolar IS DISTINCT FROM oldp.ciclo_escolar THEN RAISE EXCEPTION 'Destino inválido o de otro ciclo.'; END IF;
 IF oldp.id=newp.id THEN RETURN jsonb_build_object('period',to_jsonb(oldp),'changed',false); END IF;
 IF oldp.numero_periodo IS NULL OR newp.numero_periodo IS NULL OR newp.numero_periodo<>oldp.numero_periodo+1 OR newp.numero_periodo NOT BETWEEN 1 AND 6 OR oldp.fecha_fin IS NULL OR newp.fecha_inicio IS NULL OR newp.fecha_fin IS NULL OR newp.fecha_inicio<=oldp.fecha_fin OR newp.fecha_fin<newp.fecha_inicio OR (SELECT count(*) FROM public.periodos_escolares WHERE ciclo_escolar=oldp.ciclo_escolar AND numero_periodo=newp.numero_periodo)<>1 THEN RAISE EXCEPTION 'Solo se permite el siguiente periodo ordinario con calendario válido.'; END IF;
 IF EXISTS(SELECT 1 FROM public.jaguar360_cierres_periodo WHERE periodo_id=newp.id) THEN RAISE EXCEPTION 'No se puede avanzar hacia un periodo ya sellado.'; END IF;
 UPDATE public.periodos_escolares SET es_periodo_actual=false WHERE id=oldp.id;
 UPDATE public.periodos_escolares SET es_periodo_actual=true WHERE id=newp.id RETURNING * INTO newp;
 INSERT INTO public.jaguar360_avances_periodo(ciclo,anterior_id,nuevo_id,actor_id,actor_nombre) VALUES(oldp.ciclo_escolar,oldp.id,newp.id,p_actor,coalesce(a.nombre_completo,'Sin nombre'));
 RETURN jsonb_build_object('period',to_jsonb(newp),'changed',true);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_avanzar_periodo(uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_avanzar_periodo(uuid,bigint) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
