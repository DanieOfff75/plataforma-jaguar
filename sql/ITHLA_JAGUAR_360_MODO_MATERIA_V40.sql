-- V40: política independiente, versionada y reversible. No altera notas ni sellos al instalar.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar360_modos_materia (
 ciclo text NOT NULL CHECK(ciclo ~ '^[0-9]{4}-[0-9]{4}$'), materia_id bigint NOT NULL REFERENCES public.materias(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version>0), modo text NOT NULL CHECK(modo IN ('numerica','cualitativa')),
 min_ap numeric, actor_id uuid NOT NULL, motivo text NOT NULL CHECK(char_length(btrim(motivo)) BETWEEN 15 AND 1500),
 creado_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(ciclo,materia_id),
 CHECK((modo='numerica' AND min_ap IS NULL) OR (modo='cualitativa' AND min_ap IS NOT NULL AND min_ap>0 AND min_ap<=10 AND scale(min_ap)<=6))
);
CREATE TABLE IF NOT EXISTS public.jaguar360_modos_materia_historial (
 ciclo text NOT NULL,materia_id bigint NOT NULL,version integer NOT NULL,antes jsonb,despues jsonb NOT NULL, impacto jsonb NOT NULL,
 creado_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(ciclo,materia_id,version),
 FOREIGN KEY(ciclo,materia_id) REFERENCES public.jaguar360_modos_materia(ciclo,materia_id) ON DELETE RESTRICT
);
ALTER TABLE public.jaguar360_modos_materia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar360_modos_materia_historial ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_modos_materia,public.jaguar360_modos_materia_historial FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.jaguar360_modos_materia TO service_role;

-- Una proyección común: calificación ordinaria oficial y fuente original nunca se modifican.
-- La representación numérica se devuelve como texto para preservar decimales.
CREATE OR REPLACE FUNCTION public.jaguar360_presentacion_notas(p_ids text[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE salida jsonb;
BEGIN
 IF p_ids IS NULL OR cardinality(p_ids)>200 OR EXISTS(SELECT 1 FROM unnest(p_ids) i WHERE i IS NULL OR i !~ '^[1-9][0-9]{0,18}$') THEN RAISE EXCEPTION 'Identificadores inválidos.'; END IF;
 WITH n AS (SELECT c.id,c.calificacion::numeric AS nota,coalesce(m.modo,'numerica') AS modo,m.min_ap,
 CASE WHEN c.calificacion IS NOT NULL THEN coalesce(c.calificacion_original_politica,public.jaguar_fuente_cierre_verificada(to_jsonb(c)->'detalle_evaluacion',c.calificacion::numeric,c.observaciones),c.calificacion::numeric) END AS fuente
 FROM public.calificaciones c JOIN public.periodos_escolares p ON p.id=c.periodo_id JOIN public.grupo_materias gm ON gm.id=c.grupo_materia_id
 LEFT JOIN public.jaguar360_modos_materia m ON m.ciclo=p.ciclo_escolar AND m.materia_id=gm.materia_id WHERE c.id::text=ANY(p_ids))
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id::text,'modo',modo,'valor',CASE WHEN nota IS NULL THEN NULL WHEN nota NOT BETWEEN 0 AND 10 OR fuente NOT BETWEEN 0 AND 10 THEN 'INVALIDA' WHEN modo='cualitativa' THEN CASE WHEN fuente>=min_ap THEN 'AP' ELSE 'RP' END ELSE trim_scale(nota)::text END) ORDER BY id),'[]'::jsonb) INTO salida FROM n;
 RETURN salida;
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_presentacion_notas(text[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_presentacion_notas(text[]) TO service_role;

-- Impide una conversión incompatible con evidencia ya materializada. No elimina ninguna protección V9/V22/V26.
CREATE OR REPLACE FUNCTION public.jaguar360_modo_materia_bloqueos(p_ciclo text,p_materia bigint) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE b text[]:=ARRAY[]::text[];
BEGIN
 IF (SELECT count(*) FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE)<>1 OR NOT EXISTS(SELECT 1 FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE AND ciclo_escolar=p_ciclo) THEN b:=array_append(b,'Solo ciclo vigente inequívoco.'); END IF;
 IF EXISTS(SELECT 1 FROM public.jaguar360_cierres_periodo WHERE ciclo=p_ciclo) THEN b:=array_append(b,'Hay periodos sellados; se requiere rectificación autorizada.'); END IF;
 IF EXISTS(SELECT 1 FROM public.jaguar360_evidencias_periodo e JOIN public.periodos_escolares p ON p.id=e.periodo_id CROSS JOIN LATERAL jsonb_array_elements(e.contenido->'rows') r JOIN public.grupo_materias gm ON gm.id::text=r->>'grupo_materia_id' WHERE p.ciclo_escolar=p_ciclo AND gm.materia_id=p_materia AND (e.tipo='cualitativas' OR (e.tipo='padron' AND r->>'evaluacion'<>'numerica')) AND e.estado='revisada') THEN b:=array_append(b,'La materia tiene padrón o resultados cualitativos revisados.'); END IF;
 IF EXISTS(SELECT 1 FROM public.jaguar360_planes_ciclo t CROSS JOIN LATERAL jsonb_array_elements(coalesce(t.plan->'curriculum','[]'::jsonb)) r WHERE t.ciclo=p_ciclo AND t.estado='validada_para_planificacion' AND r->>'legacyId'=p_materia::text AND r->>'evaluation'<>'numerica') THEN b:=array_append(b,'Materia cualitativa nativa o no evaluable en un plan validado; requiere conciliación.'); END IF;
 IF EXISTS(SELECT 1 FROM public.jaguar360_convocatorias c JOIN public.jaguar360_planes_ciclo t ON t.ciclo=c.ciclo AND t.version=c.plan_version CROSS JOIN LATERAL jsonb_array_elements(coalesce(t.plan->'curriculum','[]'::jsonb)) r WHERE c.ciclo=p_ciclo AND c.estado<>'cancelada' AND r->>'key'=c.reglas->>'subjectKey' AND r->>'legacyId'=p_materia::text) THEN b:=array_append(b,'Hay convocatorias de la materia sin cancelar; requiere conciliación.'); END IF;
 RETURN b;
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_modo_materia_bloqueos(text,bigint) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.jaguar360_previsualizar_modo_materia(p_actor uuid,p_ciclo text,p_materia bigint,p_modo text,p_min_ap numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; materia_nombre text; actual jsonb; huella text; bloqueos text[];
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('direccion_escolar','coordinacion_academica','control_escolar','control')) THEN
  RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501';
 END IF;
 IF p_modo IS NULL OR p_modo NOT IN ('numerica','cualitativa') OR p_ciclo IS NULL OR p_ciclo !~ '^[0-9]{4}-[0-9]{4}$' OR p_materia IS NULL OR p_materia<=0 OR (p_modo='cualitativa' AND (p_min_ap IS NULL OR NOT (p_min_ap>0 AND p_min_ap<=10 AND scale(p_min_ap)<=6))) OR (p_modo='numerica' AND p_min_ap IS NOT NULL) THEN
  RAISE EXCEPTION 'Ciclo, materia, modo o mínimo AP inválido.';
 END IF;
 SELECT nombre INTO materia_nombre FROM public.materias WHERE id=p_materia;
 IF NOT FOUND THEN RAISE EXCEPTION 'Materia no encontrada.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.periodos_escolares WHERE ciclo_escolar=p_ciclo) THEN RAISE EXCEPTION 'Ciclo sin periodos registrados.'; END IF;
 WITH periodos AS (
  SELECT p.id,p.nombre,p.numero_periodo,
   EXISTS(SELECT 1 FROM public.jaguar360_cierres_periodo der WHERE der.periodo_id=p.id) AS sellado,
   EXISTS(SELECT 1 FROM public.jaguar_evaluacion_ventanas v WHERE v.periodo_id=p.id AND v.habilitada IS TRUE) AS ventana_abierta
  FROM public.periodos_escolares p WHERE p.ciclo_escolar=p_ciclo
 ), notas AS (
  SELECT c.periodo_id,c.calificacion::numeric AS nota,
    CASE WHEN c.calificacion IS NOT NULL THEN coalesce(c.calificacion_original_politica,public.jaguar_fuente_cierre_verificada(to_jsonb(c)->'detalle_evaluacion',c.calificacion::numeric,c.observaciones),c.calificacion::numeric) END AS fuente,
    CASE WHEN c.calificacion IS NULL THEN 'sin_nota' WHEN c.calificacion_original_politica IS NOT NULL THEN 'original' WHEN public.jaguar_fuente_cierre_verificada(to_jsonb(c)->'detalle_evaluacion',c.calificacion::numeric,c.observaciones) IS NOT NULL THEN 'evidencia' ELSE 'nota_registrada' END AS origen
  FROM public.calificaciones c JOIN public.grupo_materias gm ON gm.id=c.grupo_materia_id JOIN periodos p ON p.id=c.periodo_id WHERE gm.materia_id=p_materia
 ), resumen AS (
  SELECT p.id::text AS periodo_id,p.nombre,p.numero_periodo,p.sellado,p.ventana_abierta,
   count(n.periodo_id) AS registros,count(*) FILTER(WHERE n.periodo_id IS NOT NULL AND n.nota IS NULL) AS sin_nota,
   count(*) FILTER(WHERE n.nota IS NOT NULL AND (n.nota NOT BETWEEN 0 AND 10 OR n.fuente IS NULL OR n.fuente NOT BETWEEN 0 AND 10)) AS invalidas,
   count(*) FILTER(WHERE n.nota BETWEEN 0 AND 10 AND n.fuente BETWEEN 0 AND 10 AND p_modo='cualitativa' AND n.fuente>=p_min_ap) AS ap,
   count(*) FILTER(WHERE n.nota BETWEEN 0 AND 10 AND n.fuente BETWEEN 0 AND 10 AND p_modo='cualitativa' AND n.fuente<p_min_ap) AS rp,
   count(*) FILTER(WHERE n.nota BETWEEN 0 AND 10 AND n.fuente BETWEEN 0 AND 10 AND p_modo='numerica') AS numericas,
   count(*) FILTER(WHERE n.origen='nota_registrada') AS sin_original_verificado
  FROM periodos p LEFT JOIN notas n ON n.periodo_id=p.id GROUP BY p.id,p.nombre,p.numero_periodo,p.sellado,p.ventana_abierta
 ) SELECT jsonb_build_object('ciclo',p_ciclo,'materia_id',p_materia::text,'materia',materia_nombre,'modo',p_modo,'min_ap',p_min_ap,
  'periodos',coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.numero_periodo,r.periodo_id),'[]'::jsonb),'solo_lectura',true) INTO result FROM resumen r;
 SELECT to_jsonb(m) INTO actual FROM public.jaguar360_modos_materia m WHERE m.ciclo=p_ciclo AND m.materia_id=p_materia;
 bloqueos:=public.jaguar360_modo_materia_bloqueos(p_ciclo,p_materia);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(result->'periodos') z WHERE (z->>'invalidas')::bigint>0) THEN bloqueos:=array_append(bloqueos,'Hay calificaciones inválidas que requieren conciliación.'); END IF;
 SELECT md5(jsonb_build_object('impacto',result,'actual',actual,'bloqueos',to_jsonb(bloqueos),'notas',coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]'::jsonb))::text) INTO huella
 FROM public.calificaciones c JOIN public.periodos_escolares p ON p.id=c.periodo_id JOIN public.grupo_materias gm ON gm.id=c.grupo_materia_id WHERE p.ciclo_escolar=p_ciclo AND gm.materia_id=p_materia;
 RETURN result||jsonb_build_object('actual',actual,'huella',huella,'bloqueos',to_jsonb(bloqueos),'aplicable',cardinality(bloqueos)=0);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_previsualizar_modo_materia(uuid,text,bigint,text,numeric) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_previsualizar_modo_materia(uuid,text,bigint,text,numeric) TO service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_aplicar_modo_materia(p_actor uuid,p_ciclo text,p_materia bigint,p_modo text,p_min_ap numeric,p_huella text,p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE impacto jsonb; previo jsonb; nuevo jsonb; ver integer;
BEGIN
 -- Bloquea escritores y cierres concurrentes; no espera bloqueos indefinidamente.
 LOCK TABLE public.perfiles,public.materias,public.grupo_materias,public.periodos_escolares,public.calificaciones,public.jaguar360_cierres_periodo,public.jaguar360_aperturas_ciclo,public.jaguar360_evidencias_periodo,public.jaguar360_planes_ciclo,public.jaguar360_convocatorias IN SHARE MODE NOWAIT;
 IF NOT pg_try_advisory_xact_lock(hashtext('jaguar360-plan:'||p_ciclo)) THEN RAISE EXCEPTION 'Hay otra operación académica en curso.' USING ERRCODE='55P03'; END IF;
 LOCK TABLE public.jaguar360_modos_materia IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol='direccion_escolar') THEN RAISE EXCEPTION 'Solo Dirección Escolar autoriza el cambio de modo.' USING ERRCODE='42501'; END IF;
 IF p_huella IS NULL OR p_huella !~ '^[a-f0-9]{32}$' OR p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Confirma la huella y escribe el motivo.'; END IF;
 impacto:=public.jaguar360_previsualizar_modo_materia(p_actor,p_ciclo,p_materia,p_modo,p_min_ap);
 IF impacto->>'huella' IS DISTINCT FROM p_huella THEN RAISE EXCEPTION 'Cambió la evidencia; vuelve a consultar.'; END IF;
 IF impacto->>'aplicable' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Cambio bloqueado: %',impacto->'bloqueos'; END IF;
 SELECT to_jsonb(m),m.version INTO previo,ver FROM public.jaguar360_modos_materia m WHERE m.ciclo=p_ciclo AND m.materia_id=p_materia;
 IF previo->>'modo'=p_modo AND (previo->>'min_ap')::numeric IS NOT DISTINCT FROM p_min_ap THEN RETURN jsonb_build_object('aplicado',true,'sin_cambio',true,'actual',previo); END IF;
 INSERT INTO public.jaguar360_modos_materia(ciclo,materia_id,version,modo,min_ap,actor_id,motivo)
 VALUES(p_ciclo,p_materia,coalesce(ver,0)+1,p_modo,p_min_ap,p_actor,btrim(p_motivo))
 ON CONFLICT(ciclo,materia_id) DO UPDATE SET version=excluded.version,modo=excluded.modo,min_ap=excluded.min_ap,actor_id=excluded.actor_id,motivo=excluded.motivo,creado_at=now()
 RETURNING to_jsonb(jaguar360_modos_materia) INTO nuevo;
 INSERT INTO public.jaguar360_modos_materia_historial(ciclo,materia_id,version,antes,despues,impacto) VALUES(p_ciclo,p_materia,coalesce(ver,0)+1,previo,nuevo,impacto);
 RETURN jsonb_build_object('aplicado',true,'actual',nuevo,'sin_cambio',false);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_aplicar_modo_materia(uuid,text,bigint,text,numeric,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_aplicar_modo_materia(uuid,text,bigint,text,numeric,text,text) TO service_role;

-- Boleta: huella del modo vigente y filas de calificación; evita que código V38 emita números fuente en vez de AP/RP.
CREATE OR REPLACE FUNCTION public.jaguar360_boleta_modos(p_alumno bigint,p_ciclo text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE modos jsonb; ids text[]; notas jsonb:='[]'::jsonb; h text; idx integer;
BEGIN
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.materia_id::text,'modo',m.modo,'version',m.version,'min_ap',m.min_ap) ORDER BY m.materia_id),'[]'::jsonb) INTO modos
 FROM public.jaguar360_modos_materia m WHERE m.ciclo=p_ciclo AND (EXISTS(SELECT 1 FROM public.alumnos a JOIN public.grupo_materias gm ON gm.grupo_id=a.grupo_id WHERE a.id=p_alumno AND gm.activo AND gm.materia_id=m.materia_id) OR EXISTS(SELECT 1 FROM public.calificaciones c JOIN public.periodos_escolares p ON p.id=c.periodo_id JOIN public.grupo_materias gm ON gm.id=c.grupo_materia_id WHERE c.alumno_id=p_alumno AND p.ciclo_escolar=p_ciclo AND gm.materia_id=m.materia_id));
 SELECT coalesce(array_agg(c.id::text ORDER BY c.id),ARRAY[]::text[]),md5(jsonb_build_object('modos',modos,'notas',coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]'::jsonb))::text) INTO ids,h FROM public.calificaciones c JOIN public.periodos_escolares p ON p.id=c.periodo_id WHERE c.alumno_id=p_alumno AND p.ciclo_escolar=p_ciclo;
 IF cardinality(ids)>0 THEN FOR idx IN 1..cardinality(ids) BY 200 LOOP notas:=notas||public.jaguar360_presentacion_notas(ids[idx:idx+199]); END LOOP; END IF;
 RETURN jsonb_build_object('modos',modos,'notas',notas,'huella',h);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_boleta_modos(bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_boleta_modos(bigint,text) TO service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_guardar_boleta_modos() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cyc text; estado jsonb;
BEGIN
 IF lower(NEW.tipo) IS DISTINCT FROM 'boleta' THEN RETURN NEW; END IF;
 LOCK TABLE public.jaguar360_modos_materia,public.calificaciones,public.grupo_materias,public.periodos_escolares,public.alumnos IN SHARE MODE NOWAIT;
 SELECT ciclo_escolar INTO cyc FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE;
 estado:=public.jaguar360_boleta_modos(NEW.alumno_id,cyc);
 IF (jsonb_array_length(estado->'modos')>0 OR NEW.datos_publicos ? 'evaluacion_huella') AND NEW.datos_publicos->>'evaluacion_huella' IS DISTINCT FROM estado->>'huella' THEN RAISE EXCEPTION 'Cambió el modo o la nota de esta boleta. Genera la boleta de nuevo.'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_guardar_boleta_modos() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS j360_boleta_modos ON public.documentos_verificables;
CREATE TRIGGER j360_boleta_modos BEFORE INSERT ON public.documentos_verificables FOR EACH ROW EXECUTE FUNCTION public.jaguar360_guardar_boleta_modos();

CREATE OR REPLACE FUNCTION public.jaguar360_plan_con_modos(p_plan jsonb,p_ciclo text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE materias jsonb;
BEGIN
 IF jsonb_typeof(p_plan->'curriculum') IS DISTINCT FROM 'array' THEN RETURN p_plan; END IF;
 SELECT coalesce(jsonb_agg(CASE WHEN m.modo IS NULL OR r->>'evaluation'='no_aplica' THEN r ELSE r||jsonb_build_object('evaluation',m.modo,'qualitativeMode',CASE WHEN m.modo='cualitativa' THEN 'all' ELSE NULL END) END ORDER BY ord),'[]'::jsonb) INTO materias
 FROM jsonb_array_elements(p_plan->'curriculum') WITH ORDINALITY a(r,ord) LEFT JOIN public.jaguar360_modos_materia m ON m.ciclo=p_ciclo AND m.materia_id::text=r->>'legacyId';
 RETURN jsonb_set(p_plan,'{curriculum}',materias,false);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_plan_con_modos(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_plan_con_modos(jsonb,text) TO service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_snapshot_verificacion(p_periodo bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE pe record; p public.jaguar360_evidencias_periodo; s public.jaguar360_evidencias_periodo; m public.jaguar360_evidencias_periodo; q public.jaguar360_evidencias_periodo; result jsonb; mv boolean; qv boolean;
BEGIN
 SELECT id,ciclo_escolar,numero_periodo,fecha_inicio,fecha_fin INTO pe FROM public.periodos_escolares WHERE id=p_periodo;
 IF NOT FOUND THEN RAISE EXCEPTION 'Periodo inexistente.'; END IF;
 SELECT * INTO p FROM public.jaguar360_evidencias_periodo WHERE periodo_id=p_periodo AND tipo='padron' ORDER BY version DESC LIMIT 1;
 SELECT * INTO s FROM public.jaguar360_evidencias_periodo WHERE periodo_id=p_periodo AND tipo='sesiones' ORDER BY version DESC LIMIT 1;
 SELECT * INTO m FROM public.jaguar360_evidencias_periodo WHERE periodo_id=p_periodo AND tipo='marcas' ORDER BY version DESC LIMIT 1;
 SELECT * INTO q FROM public.jaguar360_evidencias_periodo WHERE periodo_id=p_periodo AND tipo='cualitativas' ORDER BY version DESC LIMIT 1;
 mv:=coalesce(m.estado='revisada' AND m.contenido->>'padron_version'=p.version::text AND m.contenido->>'sesiones_version'=s.version::text,false);
 qv:=coalesce(q.estado='revisada' AND q.contenido->>'padron_version'=p.version::text,false);
 WITH roster AS (SELECT * FROM jsonb_to_recordset(coalesce(p.contenido->'rows','[]'::jsonb)) AS r(alumno_id bigint,grupo_materia_id bigint,desde date,hasta date,evaluacion text)),
 held AS (SELECT *,count(*) OVER(PARTITION BY grupo_materia_id,fecha) AS n FROM jsonb_to_recordset(coalesce(s.contenido->'rows','[]'::jsonb)) AS h(grupo_materia_id bigint,fecha date,inicio time,fin time,estado text) WHERE estado='impartida'),
 marks AS (SELECT * FROM jsonb_to_recordset(CASE WHEN mv THEN m.contenido->'rows' ELSE '[]'::jsonb END) AS z(alumno_id bigint,grupo_materia_id bigint,fecha date,inicio time,estado text)),
 qualitative AS (SELECT * FROM jsonb_to_recordset(CASE WHEN qv THEN q.contenido->'rows' ELSE '[]'::jsonb END) AS z(alumno_id bigint,grupo_materia_id bigint,resultado text)),
 expected AS (SELECT r.alumno_id,r.grupo_materia_id,h.fecha,h.inicio,h.fin,h.n FROM roster r JOIN held h ON h.grupo_materia_id=r.grupo_materia_id AND h.fecha BETWEEN r.desde AND r.hasta),
 attendance AS (SELECT e.*,z.estado AS marca,CASE WHEN e.n=1 THEN a.estado ELSE NULL END AS legado,
 CASE WHEN z.estado IS NOT NULL THEN z.estado WHEN e.n=1 THEN a.estado ELSE NULL END AS estado
 FROM expected e LEFT JOIN marks z USING(alumno_id,grupo_materia_id,fecha,inicio) LEFT JOIN public.asistencias a USING(alumno_id,grupo_materia_id,fecha)),
 grades AS (SELECT r.alumno_id,r.grupo_materia_id,coalesce(mm.modo,r.evaluacion) AS evaluacion,
 CASE WHEN mm.modo='cualitativa' THEN NULL ELSE c.calificacion END AS calificacion,c.calificacion_calculada,
 CASE WHEN mm.modo='cualitativa' THEN to_jsonb(src.fuente) ELSE to_jsonb(c)->'calificacion_original_politica' END AS fuente_original,c.observaciones,
 CASE WHEN mm.modo='cualitativa' THEN CASE WHEN src.fuente BETWEEN 0 AND 10 AND c.calificacion BETWEEN 0 AND 10 THEN CASE WHEN src.fuente>=mm.min_ap THEN 'AP' ELSE 'RP' END END ELSE qq.resultado END AS resultado,
 mm.version AS modo_version,mm.min_ap AS modo_min_ap,CASE WHEN mm.modo='cualitativa' THEN c.calificacion END AS nota_numerica_conservada,CASE WHEN mm.version IS NOT NULL AND qq.resultado IS NOT NULL THEN true ELSE false END AS modo_conflicto
 FROM roster r LEFT JOIN public.calificaciones c ON c.alumno_id=r.alumno_id AND c.grupo_materia_id=r.grupo_materia_id AND c.periodo_id=p_periodo
 LEFT JOIN public.grupo_materias gm ON gm.id=r.grupo_materia_id
 LEFT JOIN public.jaguar360_modos_materia mm ON mm.ciclo=pe.ciclo_escolar AND mm.materia_id=gm.materia_id AND r.evaluacion<>'no_aplica'
 LEFT JOIN LATERAL (SELECT CASE WHEN c.calificacion IS NOT NULL THEN coalesce(c.calificacion_original_politica,public.jaguar_fuente_cierre_verificada(to_jsonb(c)->'detalle_evaluacion',c.calificacion::numeric,c.observaciones),c.calificacion::numeric) END AS fuente) src ON true
 LEFT JOIN qualitative qq ON qq.alumno_id=r.alumno_id AND qq.grupo_materia_id=r.grupo_materia_id),
 counts AS (SELECT jsonb_build_object(
 'obligaciones',(SELECT count(*) FROM roster),
 'sesiones_sin_confirmar',(SELECT count(*) FROM jsonb_to_recordset(coalesce(s.contenido->'rows','[]'::jsonb)) AS h(estado text) WHERE h.estado='programada'),
 'evidencias_sin_revision',(CASE WHEN m.id IS NOT NULL AND NOT mv THEN 1 ELSE 0 END)+(CASE WHEN q.id IS NOT NULL AND NOT qv THEN 1 ELSE 0 END),
 'vigencias_invalidas',(SELECT count(*) FROM roster r WHERE r.desde<pe.fecha_inicio OR r.hasta>pe.fecha_fin OR NOT EXISTS(SELECT 1 FROM public.alumnos al WHERE al.id=r.alumno_id) OR NOT EXISTS(SELECT 1 FROM public.grupo_materias gm WHERE gm.id=r.grupo_materia_id))+(SELECT count(*) FROM jsonb_to_recordset(coalesce(s.contenido->'rows','[]'::jsonb)) AS h(grupo_materia_id bigint,fecha date) WHERE h.fecha NOT BETWEEN pe.fecha_inicio AND pe.fecha_fin OR NOT EXISTS(SELECT 1 FROM public.grupo_materias gm WHERE gm.id=h.grupo_materia_id)),
 'sin_nota_numerica',(SELECT count(*) FROM grades WHERE evaluacion='numerica' AND calificacion IS NULL),
 'sin_resultado_ap_rp',(SELECT count(*) FROM grades WHERE evaluacion='cualitativa' AND resultado IS NULL),
 'notas_incompatibles',(SELECT count(*) FROM grades WHERE (evaluacion<>'numerica' AND calificacion IS NOT NULL) OR modo_conflicto),
 'notas_fuera_padron',(SELECT count(*) FROM public.calificaciones c WHERE c.periodo_id=p_periodo AND NOT EXISTS(SELECT 1 FROM roster r WHERE r.alumno_id=c.alumno_id AND r.grupo_materia_id=c.grupo_materia_id)),
 'sesiones_exigibles',(SELECT count(*) FROM expected),
 'asistencia_pendiente',(SELECT count(*) FROM attendance WHERE estado IS NULL),
 'asistencia_en_conflicto',(SELECT count(*) FROM attendance WHERE marca IS NOT NULL AND legado IS NOT NULL AND marca<>legado),
 'obligaciones_sin_sesiones',(SELECT count(*) FROM roster r WHERE NOT EXISTS(SELECT 1 FROM held h WHERE h.grupo_materia_id=r.grupo_materia_id AND h.fecha BETWEEN r.desde AND r.hasta))) AS data)
 SELECT jsonb_build_object('periodo',to_jsonb(pe),'versiones',jsonb_build_object('padron',p.version,'sesiones',s.version,'marcas',m.version,'cualitativas',q.version),
 'padrón_y_sesiones_revisados',coalesce(p.estado='revisada' AND s.estado='revisada',false),
 'periodo_transcurrido',coalesce(pe.fecha_fin<(now() AT TIME ZONE 'America/Mexico_City')::date AND pe.fecha_inicio<=pe.fecha_fin,false),
 'resumen',counts.data,
 'notas',coalesce((SELECT jsonb_agg(CASE WHEN g.modo_version IS NULL THEN to_jsonb(g)-ARRAY['modo_version','modo_min_ap','nota_numerica_conservada','modo_conflicto'] ELSE to_jsonb(g) END ORDER BY g.alumno_id,g.grupo_materia_id) FROM grades g),'[]'::jsonb),
 'asistencias',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.alumno_id,a.grupo_materia_id,a.fecha,a.inicio) FROM attendance a),'[]'::jsonb)) INTO result FROM counts;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.jaguar360_verificar_cierre(p_actor uuid,p_periodo bigint,p_huella text DEFAULT NULL,p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; snap jsonb; h text; r jsonb; ready boolean; prev record; saved bigint;
BEGIN
 SELECT id,nombre_completo,rol,activo INTO a FROM public.perfiles WHERE id=p_actor;
 IF NOT FOUND OR a.activo IS DISTINCT FROM true OR coalesce(a.rol,'') NOT IN ('direccion_escolar','coordinacion_academica','control_escolar','control') THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF p_huella IS NOT NULL THEN
  IF a.rol<>'direccion_escolar' THEN RAISE EXCEPTION 'Solo Dirección registra una verificación.' USING ERRCODE='42501'; END IF;
  IF p_huella !~ '^[a-f0-9]{32}$' OR p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Huella o motivo inválido.'; END IF;
  -- Solo en copia de pruebas: no esperar bloqueos de escritores ordinarios.
  LOCK TABLE public.periodos_escolares,public.jaguar360_evidencias_periodo,public.calificaciones,public.asistencias,public.alumnos,public.grupo_materias,public.jaguar360_modos_materia IN SHARE MODE NOWAIT;
  PERFORM pg_advisory_xact_lock(hashtext('j360-verificacion:'||p_periodo));
 END IF;
 snap:=public.jaguar360_snapshot_verificacion(p_periodo); h:=md5(snap::text); r:=snap->'resumen';
 ready:=coalesce((snap->>'padrón_y_sesiones_revisados')::boolean AND (snap->>'periodo_transcurrido')::boolean
 AND (r->>'obligaciones')::bigint>0 AND (r->>'sesiones_exigibles')::bigint>0
 AND (r->>'evidencias_sin_revision')::bigint=0 AND (r->>'vigencias_invalidas')::bigint=0
 AND (r->>'sin_nota_numerica')::bigint=0 AND (r->>'sin_resultado_ap_rp')::bigint=0 AND (r->>'notas_incompatibles')::bigint=0
 AND (r->>'notas_fuera_padron')::bigint=0 AND (r->>'asistencia_pendiente')::bigint=0 AND (r->>'asistencia_en_conflicto')::bigint=0
 AND (r->>'obligaciones_sin_sesiones')::bigint=0 AND (r->>'sesiones_sin_confirmar')::bigint=0,false);
 IF p_huella IS NOT NULL THEN
  IF h<>p_huella THEN RAISE EXCEPTION 'La evidencia o las calificaciones cambiaron; actualiza la verificación.'; END IF;
  IF NOT ready THEN RAISE EXCEPTION 'La verificación contiene pendientes.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM (SELECT huella FROM public.jaguar360_verificaciones_cierre WHERE periodo_id=p_periodo ORDER BY id DESC LIMIT 1) previous WHERE previous.huella=h) THEN
  INSERT INTO public.jaguar360_verificaciones_cierre(periodo_id,huella,evidencia,actor_id,actor_nombre,motivo)
  VALUES(p_periodo,h,snap,p_actor,coalesce(a.nombre_completo,'Sin nombre'),btrim(p_motivo)) RETURNING id INTO saved;
  END IF;
 END IF;
 SELECT id::text AS id,huella,actor_nombre,creado_at INTO prev FROM public.jaguar360_verificaciones_cierre WHERE periodo_id=p_periodo ORDER BY id DESC LIMIT 1;
 RETURN jsonb_build_object('resumen',r,'versiones',snap->'versiones','evidencias_revisadas',snap->'padrón_y_sesiones_revisados','periodo_transcurrido',snap->'periodo_transcurrido','verificacion_posible',ready,'huella',h,'ultima_verificacion',CASE WHEN prev.id IS NULL THEN NULL ELSE to_jsonb(prev)-'huella' END,'verificacion_vigente',coalesce(prev.huella=h,false),'cierre_definitivo',false);
END $$;
CREATE OR REPLACE FUNCTION public.jaguar360_cierre_periodo(p_actor uuid,p_periodo bigint,p_plan_version integer DEFAULT NULL,p_huella text DEFAULT NULL,p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; pe record; plan jsonb; pv integer; v jsonb; seal public.jaguar360_cierres_periodo; verification public.jaguar360_verificaciones_cierre; snap jsonb; mapping jsonb; blockers text[]:=ARRAY[]::text[]; seal_hash text; t text; writing boolean:=p_huella IS NOT NULL;
BEGIN
 SELECT id,rol,nombre_completo INTO a FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('direccion_escolar','coordinacion_academica','control_escolar','control');
 IF NOT FOUND OR (writing AND a.rol<>'direccion_escolar') THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF writing THEN
  IF p_huella !~ '^[a-f0-9]{32}$' OR p_plan_version IS NULL OR p_plan_version<1 OR p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Confirmación inválida.'; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext('j360-cierre-global')) THEN RAISE EXCEPTION 'Otro cierre está en curso.' USING ERRCODE='55P03'; END IF;
  LOCK TABLE public.periodos_escolares,public.jaguar360_evidencias_periodo,public.calificaciones,public.asistencias,public.alumnos,public.grupo_materias,public.grupos,public.materias,public.jaguar360_listas_sesion,public.jaguar_evaluacion_ventanas,public.jaguar360_planes_ciclo,public.jaguar360_verificaciones_cierre,public.jaguar360_modos_materia IN SHARE MODE NOWAIT;
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
 SELECT public.jaguar360_plan_con_modos(t.plan,t.ciclo),t.version INTO plan,pv FROM public.jaguar360_planes_ciclo t WHERE ciclo=pe.ciclo_escolar AND estado='validada_para_planificacion' ORDER BY version DESC LIMIT 1;
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
CREATE OR REPLACE FUNCTION public.jaguar360_fuentes_ordinarias(p_actor uuid,p_ciclo text,p_alumno bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE pv integer; plan jsonb; pe record; seal public.jaguar360_cierres_periodo; rows jsonb; output jsonb:='[]'::jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles p WHERE p.id=p_actor AND p.activo IS TRUE AND (p.rol IN ('direccion_escolar','coordinacion_academica','control_escolar','control') OR (p.rol='alumno' AND EXISTS(SELECT 1 FROM public.alumnos a WHERE a.id=p_alumno AND a.auth_user_id=p_actor AND a.activo AND a.estado_escolar NOT IN ('baja','traslado','archivado','egresado'))))) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.alumnos WHERE id=p_alumno) THEN RAISE EXCEPTION 'Alumno inexistente.'; END IF;
 SELECT min(plan_version) INTO pv FROM public.jaguar360_cierres_periodo WHERE ciclo=p_ciclo;
 IF pv IS NULL OR EXISTS(SELECT 1 FROM public.jaguar360_cierres_periodo WHERE ciclo=p_ciclo AND plan_version<>pv) THEN RAISE EXCEPTION 'No existe un plan común en los sellos del ciclo.'; END IF;
 SELECT public.jaguar360_plan_con_modos(t.plan,t.ciclo) INTO plan FROM public.jaguar360_planes_ciclo t WHERE ciclo=p_ciclo AND version=pv;
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
CREATE OR REPLACE FUNCTION public.jaguar360_registrar_convocatoria(p_actor uuid,p_ciclo text,p_plan_version integer,p_accion text,p_id bigint,p_version integer,p_reglas jsonb,p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; plan jsonb; pol jsonb; mat jsonb; r jsonb; b jsonb; c public.jaguar360_convocatorias; kind text; template text; label text; periods integer; min_grade numeric; seen integer[]:=ARRAY[]::integer[]; n integer; seq bigint; token text;
BEGIN
 SELECT id,rol,nombre_completo INTO a FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol='coordinacion_academica';
 IF NOT FOUND THEN RAISE EXCEPTION 'Solo Coordinación gestiona convocatorias.' USING ERRCODE='42501'; END IF;
 IF p_ciclo IS NULL OR p_ciclo !~ '^[0-9]{4}-[0-9]{4}$' OR p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Ciclo o motivo inválido.'; END IF;
 -- Serialize naming and transitions against the same cycle's planning operations.
 PERFORM pg_advisory_xact_lock(hashtext('jaguar360-plan:'||p_ciclo));
 IF p_accion='proponer' THEN
  IF p_id IS NOT NULL OR p_version IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Propuesta inválida.'; END IF;
  SELECT public.jaguar360_plan_con_modos(t.plan,t.ciclo) INTO plan FROM public.jaguar360_planes_ciclo t WHERE t.ciclo=p_ciclo AND t.version=p_plan_version AND t.estado='validada_para_planificacion' AND t.version=(SELECT max(v.version) FROM public.jaguar360_planes_ciclo v WHERE v.ciclo=p_ciclo AND v.estado='validada_para_planificacion');
  IF NOT FOUND THEN RAISE EXCEPTION 'Selecciona la última versión validada del ciclo.'; END IF;
  pol:=plan->'policy'; periods:=(pol->>'periods')::integer; min_grade:=(pol->>'minimum')::numeric;
  r:=p_reglas; kind:=r->>'kind';
  SELECT value INTO mat FROM jsonb_array_elements(plan->'curriculum') WHERE value->>'key'=r->>'subjectKey';
  IF NOT FOUND OR mat->>'evaluation' NOT IN ('numerica','cualitativa') OR coalesce(kind,'') NOT IN ('recovery','recourse') OR jsonb_typeof(r) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Asignatura o tipo inválido.'; END IF;
  IF r->>'start' IS NULL OR r->>'end' IS NULL OR (r->>'start')::date>(r->>'end')::date OR (r->>'start')::date<=(now() AT TIME ZONE 'America/Mexico_City')::date OR (r->>'start')::date<(substring(p_ciclo,1,4)||'-01-01')::date THEN RAISE EXCEPTION 'Fechas inválidas o anteriores a hoy.'; END IF;
  IF jsonb_typeof(r->'blocks') IS DISTINCT FROM 'array' OR jsonb_array_length(r->'blocks') NOT BETWEEN 1 AND periods OR (kind='recovery' AND jsonb_array_length(r->'blocks')<>1) THEN RAISE EXCEPTION 'Bloques inválidos.'; END IF;
  FOR b IN SELECT value FROM jsonb_array_elements(r->'blocks') LOOP
   IF jsonb_typeof(b->'period') IS DISTINCT FROM 'number' OR jsonb_typeof(b->'minutes') IS DISTINCT FROM 'number' OR (b->>'period')::numeric<>trunc((b->>'period')::numeric) OR (b->>'minutes')::numeric<>trunc((b->>'minutes')::numeric) OR (b->>'minutes')::numeric NOT BETWEEN 1 AND 525600 THEN RAISE EXCEPTION 'Bloque inválido.'; END IF;
   n:=(b->>'period')::integer; IF n NOT BETWEEN 1 AND periods OR n=ANY(seen) THEN RAISE EXCEPTION 'Periodo objetivo inválido o repetido.'; END IF; seen:=array_append(seen,n);
  END LOOP;
  IF jsonb_typeof(r->'attendancePct') IS DISTINCT FROM 'number' OR (r->>'attendancePct')::numeric NOT BETWEEN 0 AND 100 OR jsonb_typeof(r->'capacity') IS DISTINCT FROM 'number' OR (r->>'capacity')::numeric<>trunc((r->>'capacity')::numeric) OR (r->>'capacity')::numeric NOT BETWEEN 1 AND 1000 OR jsonb_typeof(r->'attempts') IS DISTINCT FROM 'number' OR (r->>'attempts')::numeric<>trunc((r->>'attempts')::numeric) OR (r->>'attempts')::numeric NOT BETWEEN 1 AND 10 OR coalesce(r->>'eligibility','') NOT IN ('failed','improve') OR coalesce(r->>'teacherMode','') NOT IN ('holder','support','either') OR coalesce(r->>'turn','') NOT IN ('MATUTINO','VESPERTINO') OR r->>'modality' IS NULL OR char_length(btrim(r->>'modality')) NOT BETWEEN 3 AND 120 THEN RAISE EXCEPTION 'Reglas de convocatoria inválidas.'; END IF;
  IF mat->>'evaluation'='cualitativa' THEN
   IF r->>'method' IS DISTINCT FROM 'qualitative' OR r->>'cap' IS NOT NULL THEN RAISE EXCEPTION 'AP/RP no admite tope numérico.'; END IF;
  ELSE
   IF coalesce(r->>'method','') NOT IN ('direct','proportional') OR jsonb_typeof(r->'cap') IS DISTINCT FROM 'number' OR (r->>'cap')::numeric NOT BETWEEN min_grade AND 10 THEN RAISE EXCEPTION 'Escala inválida.'; END IF;
  END IF;
  IF kind='recourse' AND ((r->>'attempts')::numeric<>1 OR r->>'eligibility'<>'failed' OR r->>'teacherMode'<>'support' OR (mat->>'evaluation'='numerica' AND (r->>'method' IS DISTINCT FROM pol->>'recourseMethod' OR (r->>'cap')::numeric IS DISTINCT FROM (pol->>'recourseCap')::numeric))) THEN RAISE EXCEPTION 'El recursamiento debe respetar la política del ciclo, un intento y docente de apoyo.'; END IF;
  -- Keep only fields of the validated contract. No private free-form payload.
  r:=jsonb_build_object('kind',kind,'subjectKey',mat->>'key','start',r->>'start','end',r->>'end','blocks', (SELECT jsonb_agg(jsonb_build_object('period',(z->>'period')::int,'minutes',(z->>'minutes')::int) ORDER BY (z->>'period')::int) FROM jsonb_array_elements(r->'blocks') z),'method',r->>'method','cap',r->'cap','attendancePct',r->'attendancePct','capacity',r->'capacity','attempts',r->'attempts','eligibility',r->>'eligibility','teacherMode',r->>'teacherMode','letter',r->>'letter','turn',r->>'turn','modality',btrim(r->>'modality'));
  template:=pol->>(CASE WHEN kind='recovery' THEN 'recoveryTemplate' ELSE 'recourseTemplate' END);
  IF r->>'letter' IS NOT NULL AND r->>'letter' !~ '^[A-Z]$' OR position('{LETRA}' IN template)>0 AND r->>'letter' IS NULL THEN RAISE EXCEPTION 'Letra inválida para la nomenclatura.'; END IF;
  SELECT count(*)+1 INTO seq FROM public.jaguar360_convocatorias WHERE ciclo=p_ciclo;
  label:=template;
  label:=replace(label,'{TIPO}',CASE WHEN kind='recovery' THEN 'RE' ELSE 'RC' END);
  label:=replace(label,'{MATERIA}',mat->>'key'); label:=replace(label,'{GRADO}',mat->>'grade');
  label:=replace(label,'{PERIODO}',array_to_string(ARRAY(SELECT unnest(seen) ORDER BY 1),'-'));
  label:=replace(label,'{LETRA}',coalesce(r->>'letter',''));label:=replace(label,'{TURNO}',r->>'turn');label:=replace(label,'{CICLO}',p_ciclo);
  label:=replace(label,'{CONSECUTIVO}',lpad(seq::text,greatest(3,length(seq::text)),'0'));
  IF label IS NULL OR label !~ '^[A-Z0-9_ -]{1,100}$' THEN RAISE EXCEPTION 'Plantilla no resoluble. Revisa las variables de nombre.'; END IF;
  IF EXISTS(SELECT 1 FROM public.jaguar360_convocatorias WHERE ciclo=p_ciclo AND nombre=label) THEN RAISE EXCEPTION 'Nombre repetido; utiliza una plantilla con consecutivo.'; END IF;
  INSERT INTO public.jaguar360_convocatorias(ciclo,plan_version,nombre,estado,reglas,actor_id,actor_nombre) VALUES(p_ciclo,p_plan_version,label,'propuesta',r,p_actor,coalesce(a.nombre_completo,'Sin nombre')) RETURNING * INTO c;
 ELSIF p_accion IN ('autorizar','cancelar') THEN
  SELECT * INTO c FROM public.jaguar360_convocatorias WHERE id=p_id AND ciclo=p_ciclo FOR UPDATE;
  IF NOT FOUND OR c.version IS DISTINCT FROM p_version OR c.estado='cancelada' THEN RAISE EXCEPTION 'Convocatoria inexistente o versión desactualizada.'; END IF;
  IF (c.reglas->>'start')::date<=(now() AT TIME ZONE 'America/Mexico_City')::date THEN RAISE EXCEPTION 'No se modifica una convocatoria iniciada; requiere otro procedimiento con Dirección.'; END IF;
  IF p_accion='autorizar' AND (c.estado<>'propuesta' OR c.plan_version IS DISTINCT FROM (SELECT max(v.version) FROM public.jaguar360_planes_ciclo v WHERE v.ciclo=p_ciclo AND v.estado='validada_para_planificacion')) THEN RAISE EXCEPTION 'Convocatoria o política obsoleta.'; END IF;
  UPDATE public.jaguar360_convocatorias SET estado=CASE WHEN p_accion='autorizar' THEN 'autorizada_para_planeacion' ELSE 'cancelada' END,version=version+1 WHERE id=c.id RETURNING * INTO c;
 ELSE RAISE EXCEPTION 'Acción inválida.';
 END IF;
 INSERT INTO public.jaguar360_convocatoria_eventos(convocatoria_id,version,estado,actor_id,actor_nombre,actor_cargo,motivo) VALUES(c.id,c.version,c.estado,p_actor,coalesce(a.nombre_completo,'Sin nombre'),a.rol,btrim(p_motivo));
 RETURN (to_jsonb(c)-'id')||jsonb_build_object('id',c.id::text);
END $$;
CREATE OR REPLACE FUNCTION public.jaguar360_fuentes_acreditacion(p_actor uuid,p_ciclo text,p_alumno bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE plan record; pe record; snap jsonb; rows jsonb; outrows jsonb:='[]'::jsonb; verified boolean;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('direccion_escolar','coordinacion_academica','control_escolar','control')) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.alumnos WHERE id=p_alumno) THEN RAISE EXCEPTION 'Alumno inexistente.'; END IF;
 SELECT t.version,public.jaguar360_plan_con_modos(t.plan,t.ciclo) AS plan INTO plan FROM public.jaguar360_planes_ciclo t WHERE ciclo=p_ciclo AND estado='validada_para_planificacion' ORDER BY version DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'No existe plan validado; faltan criterios de referencia.'; END IF;
 IF (SELECT count(*) FROM public.periodos_escolares WHERE ciclo_escolar=p_ciclo)>6 THEN RAISE EXCEPTION 'Periodos no conciliados (más de seis).'; END IF;
 FOR pe IN SELECT id,numero_periodo,fecha_inicio,fecha_fin FROM public.periodos_escolares WHERE ciclo_escolar=p_ciclo ORDER BY numero_periodo,id LOOP
  snap:=public.jaguar360_snapshot_verificacion(pe.id);
  verified:=coalesce((SELECT huella=md5(snap::text) FROM public.jaguar360_verificaciones_cierre WHERE periodo_id=pe.id ORDER BY id DESC LIMIT 1),false);
  -- Do not return unverified grades. Map legacy group-material IDs explicitly; this mapping is a provisional reference.
  rows:='[]'::jsonb;
  IF verified THEN
   WITH notes AS (SELECT * FROM jsonb_to_recordset(snap->'notas') AS n(alumno_id bigint,grupo_materia_id bigint,evaluacion text,calificacion numeric,fuente_original numeric,resultado text) WHERE alumno_id=p_alumno),
   marks AS (SELECT grupo_materia_id,count(*) FILTER(WHERE estado='presente') AS present,count(*) FILTER(WHERE estado='falta') AS absent,count(*) FILTER(WHERE estado='retardo') AS late,count(*) FILTER(WHERE estado='justificada') AS justified,count(*) FILTER(WHERE estado IS NULL) AS unknown FROM jsonb_to_recordset(snap->'asistencias') AS s(alumno_id bigint,grupo_materia_id bigint,estado text) WHERE alumno_id=p_alumno GROUP BY grupo_materia_id)
   SELECT coalesce(jsonb_agg(jsonb_build_object('subjectId',gm.materia_id::text,'groupMaterialId',n.grupo_materia_id::text,'grade',g.grado,'evaluation',n.evaluacion,'official',n.calificacion,'original',n.fuente_original,'result',n.resultado,'attendance',jsonb_build_object('present',coalesce(m.present,0),'absent',coalesce(m.absent,0),'late',coalesce(m.late,0),'justified',coalesce(m.justified,0),'unknown',coalesce(m.unknown,0))) ORDER BY n.grupo_materia_id),'[]'::jsonb) INTO rows FROM notes n LEFT JOIN public.grupo_materias gm ON gm.id=n.grupo_materia_id LEFT JOIN public.grupos g ON g.id=gm.grupo_id LEFT JOIN marks m ON m.grupo_materia_id=n.grupo_materia_id;
  END IF;
  outrows:=outrows||jsonb_build_array(jsonb_build_object('number',pe.numero_periodo,'start',pe.fecha_inicio,'end',pe.fecha_fin,'verified',verified,'rows',rows));
 END LOOP;
 RETURN jsonb_build_object('plan',plan.plan,'version',plan.version,'periods',outrows);
END $$;
CREATE OR REPLACE FUNCTION public.jaguar360_panel_departamento(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r text; p public.periodos_escolares; cycles integer; curr integer;
 res jsonb; academic jsonb; pending bigint; incidents bigint; top_group jsonb; lo date; hi date;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Acceso exclusivo del servidor.' USING ERRCODE='42501'; END IF;
 SELECT rol INTO r FROM public.perfiles WHERE id=p_actor AND activo IS TRUE;
 IF r IS NULL OR r NOT IN ('servicios_estudiantiles','servicios_docentes','prefectura','coordinacion_academica','direccion_escolar','control_escolar','control') THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO curr FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE;
 IF curr>1 THEN RAISE EXCEPTION 'Hay varios periodos actuales. Revisa el calendario.'; END IF;
 IF curr=1 THEN
  SELECT * INTO p FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE;
  IF p.activo IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'El periodo actual no está activo.'; END IF;
 ELSE
  SELECT count(DISTINCT ciclo_escolar) INTO cycles FROM public.periodos_escolares WHERE activo IS TRUE;
  IF cycles<>1 THEN RAISE EXCEPTION 'No hay un ciclo activo inequívoco.'; END IF;
  SELECT * INTO p FROM public.periodos_escolares WHERE activo IS TRUE ORDER BY numero_periodo DESC NULLS LAST,id DESC LIMIT 1;
 END IF;
 IF p.ciclo_escolar IS NULL OR p.ciclo_escolar !~ '^\d{4}-\d{4}$' THEN RAISE EXCEPTION 'Ciclo activo inválido.'; END IF;
 res:=jsonb_build_object('cycle',p.ciclo_escolar,'period',jsonb_build_object('id',p.id::text,'nombre',p.nombre,'ciclo_escolar',p.ciclo_escolar,'activo',p.activo),'totalStudents',(SELECT count(*) FROM public.alumnos a JOIN public.grupos g ON g.id=a.grupo_id AND g.activo IS TRUE WHERE a.activo IS TRUE AND coalesce(a.estado_escolar,'activo') NOT IN ('archivado','baja','traslado','egresado','inactivo')),'totalTeachers',(SELECT count(*) FROM public.docentes WHERE activo IS TRUE AND coalesce(estado_profesional,'activo') NOT IN ('archivado','baja','inactivo')),'totalGroups',(SELECT count(*) FROM public.grupos WHERE activo IS TRUE),'totalSubjects',(SELECT count(*) FROM public.materias WHERE activa IS TRUE),'average',NULL,'averageByGrade','{}'::jsonb,'groupAverages','[]'::jsonb,'pendingRequests',NULL,'incidentCount',NULL,'topIncidentGroup',NULL,'academicSource','ordinarias_registradas');
 IF r IN ('servicios_estudiantiles','coordinacion_academica','direccion_escolar','control_escolar','control') THEN
  -- Group memberships are current; exclude grades belonging to a previous group, even within the same cycle.
  WITH roster AS (
   SELECT a.id AS student_id,g.id AS group_id,g.clave,g.grado,g.turno FROM public.alumnos a JOIN public.grupos g ON g.id=a.grupo_id AND g.activo IS TRUE WHERE a.activo IS TRUE AND coalesce(a.estado_escolar,'activo') NOT IN ('archivado','baja','traslado','egresado','inactivo')
  ), marks AS (
   SELECT ro.group_id,ro.grado,c.calificacion FROM public.calificaciones c JOIN roster ro ON ro.student_id=c.alumno_id JOIN public.grupo_materias gm ON gm.id=c.grupo_materia_id AND gm.grupo_id=ro.group_id JOIN public.periodos_escolares pe ON pe.id=c.periodo_id AND pe.ciclo_escolar=p.ciclo_escolar WHERE c.calificacion BETWEEN 0 AND 10 AND NOT EXISTS(SELECT 1 FROM public.jaguar360_modos_materia m WHERE m.ciclo=pe.ciclo_escolar AND m.materia_id=gm.materia_id AND m.modo='cualitativa')
  ), groups_count AS (
   SELECT group_id,clave,turno,grado,count(*) AS pupils FROM roster GROUP BY group_id,clave,turno,grado
  ), grade_count AS (SELECT grado,count(*) AS pupils FROM roster GROUP BY grado),
  group_marks AS (SELECT group_id,avg(calificacion) AS mean FROM marks GROUP BY group_id),
  grade_marks AS (SELECT grado,avg(calificacion) AS mean FROM marks GROUP BY grado)
  SELECT jsonb_build_object('average',(SELECT avg(calificacion) FROM marks),'averageByGrade',coalesce((SELECT jsonb_object_agg(gc.grado::text,jsonb_build_object('count',gc.pupils,'average',gm.mean) ORDER BY gc.grado) FROM grade_count gc LEFT JOIN grade_marks gm USING(grado)),'{}'::jsonb),'groupAverages',coalesce((SELECT jsonb_agg(jsonb_build_object('group',gc.clave||' · '||coalesce(gc.turno,'Sin turno'),'count',gc.pupils,'average',gm.mean) ORDER BY gc.grado,gc.clave,gc.turno,gc.group_id) FROM groups_count gc LEFT JOIN group_marks gm USING(group_id)),'[]'::jsonb)) INTO academic;
  res:=res||academic;
 END IF;
 IF r IN ('servicios_estudiantiles','direccion_escolar','control_escolar','control','servicios_docentes','prefectura','coordinacion_academica') THEN
  SELECT count(*) INTO pending FROM public.solicitudes_estudiantiles s WHERE s.estado='pendiente' AND s.tipo IN ('grupo','grado','turno','taller','otro') AND (r='direccion_escolar' OR (r IN ('control_escolar','control') AND s.tipo='grupo') OR (r='servicios_estudiantiles' AND s.tipo IN ('grado','turno','taller')) OR (s.tipo='otro' AND s.departamento_destino=CASE WHEN r='control' THEN 'control_escolar' ELSE r END));
  res:=res||jsonb_build_object('pendingRequests',pending);
 END IF;
 IF r IN ('prefectura','direccion_escolar','control_escolar','control') THEN
  SELECT min(fecha_inicio),max(fecha_fin) INTO lo,hi FROM public.periodos_escolares WHERE ciclo_escolar=p.ciclo_escolar;
  IF lo IS NULL OR hi IS NULL OR hi<lo THEN RAISE EXCEPTION 'Calendario del ciclo incompleto.'; END IF;
  SELECT count(*) INTO incidents FROM public.incidencias_prefectura WHERE fecha BETWEEN lo AND hi;
  SELECT jsonb_build_array(g.clave||' · '||coalesce(g.turno,'Sin turno'),count(*)) INTO top_group FROM public.incidencias_prefectura i JOIN public.alumnos a ON a.id=i.alumno_id AND a.activo IS TRUE JOIN public.grupos g ON g.id=a.grupo_id AND g.activo IS TRUE WHERE i.fecha BETWEEN lo AND hi GROUP BY g.id,g.clave,g.turno ORDER BY count(*) DESC,g.id LIMIT 1;
  res:=res||jsonb_build_object('incidentCount',incidents,'topIncidentGroup',top_group,'incidentGrouping','grupo_actual');
 END IF;
 RETURN res;
END $$;

CREATE OR REPLACE FUNCTION public.jaguar360_contexto_trayectoria(p_actor uuid,p_ciclo text,p_alumno bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE src jsonb; attempts jsonb; ctx jsonb; pending jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles p WHERE p.id=p_actor AND p.activo IS TRUE AND (p.rol IN ('direccion_escolar','coordinacion_academica','control_escolar','control') OR (p.rol='alumno' AND EXISTS(SELECT 1 FROM public.alumnos a WHERE a.id=p_alumno AND a.auth_user_id=p_actor AND a.activo AND a.estado_escolar NOT IN ('baja','traslado','archivado','egresado'))))) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
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

-- Boleta con evidencia histórica: permisos por actor, fuentes exactas y huella de emisión.
CREATE OR REPLACE FUNCTION public.jaguar360_boleta_historica(p_actor uuid,p_ciclo text,p_alumno bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE informe jsonb; ctx jsonb; vals jsonb; ausencias bigint; grupo bigint; esperado integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles p WHERE p.id=p_actor AND p.activo IS TRUE AND (p.rol IN ('direccion_escolar','control_escolar','control') OR (p.rol='alumno' AND EXISTS(SELECT 1 FROM public.alumnos a WHERE a.id=p_alumno AND a.auth_user_id=p_actor AND a.activo)))) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE)<>1 OR NOT EXISTS(SELECT 1 FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE AND ciclo_escolar=p_ciclo) THEN RAISE EXCEPTION 'Ciclo vigente no conciliado.'; END IF;
 SELECT a.grupo_id INTO grupo FROM public.alumnos a JOIN public.grupos g ON g.id=a.grupo_id WHERE a.id=p_alumno AND a.activo AND a.estado_escolar NOT IN ('baja','traslado','archivado','egresado') AND g.activo;
 IF grupo IS NULL THEN RAISE EXCEPTION 'No hay grupo vigente.'; END IF;
 informe:=public.jaguar360_informe_trayectoria(p_actor,p_ciclo,p_alumno);ctx:=informe->'context';
 esperado:=(ctx->'source'->'plan'->'policy'->>'periods')::int;
 IF esperado NOT BETWEEN 1 AND 3 OR jsonb_array_length(ctx->'source'->'periods')<>esperado OR EXISTS(SELECT 1 FROM jsonb_array_elements(ctx->'source'->'periods') p WHERE p->>'verified' IS DISTINCT FROM 'true') THEN RAISE EXCEPTION 'La boleta histórica requiere todos los periodos sellados y compatibles con el formato aprobado.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(ctx->'source'->'periods') p CROSS JOIN LATERAL jsonb_array_elements(p->'rows') r LEFT JOIN public.grupo_materias gm ON gm.id::text=r->>'groupMaterialId' WHERE gm.grupo_id IS DISTINCT FROM grupo OR gm.activo IS DISTINCT FROM true) THEN RAISE EXCEPTION 'Hay cambios históricos de grupo o materia; se requiere conciliación documental.'; END IF;
 SELECT count(DISTINCT m->>'fecha') INTO ausencias FROM public.jaguar360_cierres_periodo s CROSS JOIN LATERAL jsonb_array_elements(s.evidencia->'asistencias') m WHERE s.ciclo=p_ciclo AND m->>'alumno_id'=p_alumno::text AND m->>'estado'='falta';
 -- Read the authoritative lexical numeric values from persisted JSON, not a JS float.
 WITH ordinary AS (SELECT (p->>'number')::int AS periodo,r FROM jsonb_array_elements(ctx->'source'->'periods') p CROSS JOIN LATERAL jsonb_array_elements(p->'rows') r),
 effective AS (SELECT o.periodo,o.r,coalesce(a.r,o.r) AS resultado FROM ordinary o LEFT JOIN LATERAL (SELECT x.r FROM jsonb_array_elements(ctx->'attempts') a CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN a->'application'->>'state'='authorized' THEN a->'application'->'payload'->'after' ELSE '[]'::jsonb END) WITH ORDINALITY x(r,ord) WHERE x.ord=o.periodo AND x.r->>'groupMaterialId'=o.r->>'groupMaterialId') a ON true)
 SELECT coalesce(jsonb_agg(jsonb_build_object('period',periodo,'groupMaterialId',r->>'groupMaterialId','value',CASE WHEN r->>'evaluation'='cualitativa' THEN resultado->>'result' ELSE resultado->>'official' END) ORDER BY periodo,r->>'groupMaterialId'),'[]'::jsonb) INTO vals FROM effective;
 informe:=informe||jsonb_build_object('exact',vals,'absenceDays',ausencias,'groupId',grupo::text);
 RETURN informe||jsonb_build_object('hash',md5(informe::text));
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_boleta_historica(uuid,text,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_boleta_historica(uuid,text,bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.jaguar360_guardar_boleta_legacy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cyc text; historica jsonb; bloqueos jsonb;
BEGIN
 IF lower(NEW.tipo) IS DISTINCT FROM 'boleta' THEN RETURN NEW; END IF;
 -- Prevent a concurrent change to evidence between this guard and the document insert.
 LOCK TABLE public.alumnos,public.grupos,public.periodos_escolares,public.jaguar360_cierres_periodo,public.jaguar360_rectificaciones,public.jaguar360_rectificacion_resoluciones,public.jaguar360_recuperaciones,public.jaguar360_intentos_recursamiento,public.jaguar360_aplicacion_autorizaciones,public.jaguar360_listas_sesion,public.jaguar360_evidencias_periodo IN SHARE MODE NOWAIT;
 IF (SELECT count(*) FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE)<>1 THEN RAISE EXCEPTION 'No se ha identificado un ciclo vigente único.'; END IF;
 SELECT ciclo_escolar INTO cyc FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE;
 bloqueos:=public.jaguar360_boleta_bloqueos(NEW.alumno_id,cyc);
 IF NEW.datos_publicos ? 'huella_historica' THEN
  LOCK TABLE public.perfiles,public.grupo_materias,public.jaguar360_modos_materia,public.jaguar360_planes_ciclo,public.jaguar360_actas_recursamiento,public.jaguar360_convocatorias,public.jaguar360_reservas_recursamiento,public.jaguar360_aplicaciones_recursamiento IN SHARE MODE NOWAIT;
  IF NEW.created_by IS NULL THEN RAISE EXCEPTION 'Falta actor de emisión histórica.'; END IF;
  historica:=public.jaguar360_boleta_historica(NEW.created_by,cyc,NEW.alumno_id);
  IF historica->>'hash' IS DISTINCT FROM NEW.datos_publicos->>'huella_historica' THEN RAISE EXCEPTION 'La evidencia histórica cambió durante la emisión.'; END IF;
 ELSIF bloqueos->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Boleta incompatible: requiere evidencia histórica conciliada.'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_guardar_boleta_legacy() FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
NOTIFY pgrst,'reload schema';
