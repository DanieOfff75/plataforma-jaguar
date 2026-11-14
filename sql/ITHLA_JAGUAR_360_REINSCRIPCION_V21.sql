-- Limited experimental enrollment: existing, empty target groups, first day or earlier.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar360_grupos_ciclo (
 grupo_id bigint PRIMARY KEY REFERENCES public.grupos(id) ON DELETE RESTRICT,
 ciclo text NOT NULL, version_plan integer NOT NULL, huella_catalogo text NOT NULL,
 cupo integer NOT NULL CHECK(cupo BETWEEN 1 AND 500), referencia text NOT NULL,
 actor_id uuid NOT NULL, creado_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(ciclo,version_plan) REFERENCES public.jaguar360_planes_ciclo(ciclo,version) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS public.jaguar360_reinscripciones (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 alumno_id bigint NOT NULL REFERENCES public.alumnos(id) ON DELETE RESTRICT,
 ciclo_origen text NOT NULL, ciclo_destino text NOT NULL,
 grupo_destino bigint NOT NULL REFERENCES public.jaguar360_grupos_ciclo(grupo_id) ON DELETE RESTRICT,
 dictamen_id bigint NOT NULL UNIQUE REFERENCES public.jaguar360_dictamen_continuidad(id) ON DELETE RESTRICT,
 huella text NOT NULL, antes jsonb NOT NULL, despues jsonb NOT NULL,
 referencia text NOT NULL, motivo text NOT NULL, actor_id uuid NOT NULL,
 creado_at timestamptz NOT NULL DEFAULT now(), UNIQUE(alumno_id,ciclo_destino)
);
ALTER TABLE public.jaguar360_grupos_ciclo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar360_reinscripciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_grupos_ciclo,public.jaguar360_reinscripciones FROM PUBLIC,anon,authenticated,service_role;
-- Catalogue fingerprint: group + all subject assignments, not pupil count.
CREATE OR REPLACE FUNCTION public.jaguar360_catalogo_destino(p_grupo bigint,p_ciclo text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE g public.grupos; p public.jaguar360_planes_ciclo; rows jsonb; valid boolean;
BEGIN
 SELECT * INTO g FROM public.grupos WHERE id=p_grupo;
 SELECT * INTO p FROM public.jaguar360_planes_ciclo WHERE ciclo=p_ciclo AND estado='validada_para_planificacion' ORDER BY version DESC LIMIT 1;
 IF g.id IS NULL OR p.id IS NULL THEN RAISE EXCEPTION 'Grupo o plan validado inexistente.'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',gm.id::text,'materia',gm.materia_id::text,'activo',gm.activo,'horas',gm.horas_semana) ORDER BY gm.id),'[]'::jsonb) INTO rows FROM public.grupo_materias gm WHERE gm.grupo_id=p_grupo;
 valid:=coalesce(g.activo IS TRUE AND g.grado BETWEEN 1 AND 3 AND jsonb_array_length(rows)>0
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.plan->'curriculum') s WHERE (s->>'grade')::int=g.grado AND s->>'required'='true')
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.plan->'curriculum') s WHERE (s->>'grade')::int=g.grado AND (s->>'legacyId' IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rows) r WHERE r->>'materia'=s->>'legacyId' AND r->>'activo'='true')))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rows) r WHERE r->>'activo' IS DISTINCT FROM 'true' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.plan->'curriculum') s WHERE (s->>'grade')::int=g.grado AND s->>'legacyId'=r->>'materia'))
 AND NOT EXISTS(SELECT 1 FROM public.horarios h JOIN public.grupo_materias gm ON gm.id=h.grupo_materia_id WHERE gm.grupo_id=p_grupo AND h.ciclo_escolar IS DISTINCT FROM p_ciclo)
 AND NOT EXISTS(SELECT 1 FROM public.asignaciones_docentes a JOIN public.grupo_materias gm ON gm.id=a.grupo_materia_id WHERE gm.grupo_id=p_grupo AND a.ciclo_escolar IS DISTINCT FROM p_ciclo)
 AND NOT EXISTS(SELECT 1 FROM public.rubricas_evaluacion r JOIN public.grupo_materias gm ON gm.id=r.grupo_materia_id JOIN public.periodos_escolares pe ON pe.id=r.periodo_id WHERE gm.grupo_id=p_grupo AND pe.ciclo_escolar IS DISTINCT FROM p_ciclo)
 AND NOT EXISTS(SELECT 1 FROM public.bitacora_excel_diaria r JOIN public.grupo_materias gm ON gm.id=r.grupo_materia_id JOIN public.periodos_escolares pe ON pe.id=r.periodo_id WHERE gm.grupo_id=p_grupo AND pe.ciclo_escolar IS DISTINCT FROM p_ciclo)
 AND NOT EXISTS(SELECT 1 FROM public.calificaciones r JOIN public.grupo_materias gm ON gm.id=r.grupo_materia_id JOIN public.periodos_escolares pe ON pe.id=r.periodo_id WHERE gm.grupo_id=p_grupo AND pe.ciclo_escolar IS DISTINCT FROM p_ciclo)
 AND NOT EXISTS(SELECT 1 FROM public.jaguar360_cierres_periodo c CROSS JOIN LATERAL jsonb_array_elements(c.mapa_materias) m JOIN public.grupo_materias gm ON gm.id::text=m->>'gm' WHERE gm.grupo_id=p_grupo AND c.ciclo IS DISTINCT FROM p_ciclo),false);
 RETURN jsonb_build_object('valid',valid,'version',p.version,'grade',g.grado,'letter',g.letra,'shift',g.turno,'name',g.clave,'fingerprint',md5(jsonb_build_object('group',to_jsonb(g),'materials',rows,'version',p.version)::text));
END $$;
-- No learner records may exist before binding; this is not a migration of an existing group.
CREATE OR REPLACE FUNCTION public.jaguar360_destino_ciclo(p_actor uuid,p_ciclo text,p_grupo bigint,p_cupo integer DEFAULT NULL,p_huella text DEFAULT NULL,p_referencia text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r text; cat jsonb; bound public.jaguar360_grupos_ciclo; emptygroup boolean; n bigint;
BEGIN
 IF p_cupo IS NOT NULL THEN
  LOCK TABLE public.perfiles,public.grupos,public.grupo_materias,public.jaguar360_planes_ciclo,public.jaguar360_cierres_periodo,public.horarios,public.asignaciones_docentes,public.alumnos,public.calificaciones,public.asistencias,public.periodos_escolares,public.rubricas_evaluacion,public.bitacora_excel_diaria IN SHARE MODE NOWAIT;
  LOCK TABLE public.jaguar360_grupos_ciclo IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 END IF;
 SELECT rol INTO r FROM public.perfiles WHERE id=p_actor AND activo IS TRUE;
 IF coalesce(r,'') NOT IN ('control_escolar','control','direccion_escolar') OR (p_cupo IS NOT NULL AND r<>'direccion_escolar') THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 cat:=public.jaguar360_catalogo_destino(p_grupo,p_ciclo);
 SELECT * INTO bound FROM public.jaguar360_grupos_ciclo WHERE grupo_id=p_grupo;
 SELECT count(*) INTO n FROM public.alumnos WHERE grupo_id=p_grupo;
 emptygroup:=n=0 AND NOT EXISTS(SELECT 1 FROM public.calificaciones c JOIN public.grupo_materias gm ON gm.id=c.grupo_materia_id WHERE gm.grupo_id=p_grupo) AND NOT EXISTS(SELECT 1 FROM public.asistencias a JOIN public.grupo_materias gm ON gm.id=a.grupo_materia_id WHERE gm.grupo_id=p_grupo);
 IF p_cupo IS NOT NULL THEN
  IF bound.grupo_id IS NOT NULL OR NOT emptygroup OR cat->>'valid' IS DISTINCT FROM 'true' OR p_huella IS DISTINCT FROM cat->>'fingerprint' OR p_cupo NOT BETWEEN 1 AND 500 OR p_referencia IS NULL OR char_length(btrim(p_referencia)) NOT BETWEEN 5 AND 300 THEN RAISE EXCEPTION 'Destino no elegible, grupo no vacío o evidencia modificada.'; END IF;
  INSERT INTO public.jaguar360_grupos_ciclo(grupo_id,ciclo,version_plan,huella_catalogo,cupo,referencia,actor_id) VALUES(p_grupo,p_ciclo,(cat->>'version')::int,p_huella,p_cupo,btrim(p_referencia),p_actor) RETURNING * INTO bound;
 END IF;
 RETURN cat||jsonb_build_object('group',p_grupo::text,'cycle',p_ciclo,'empty',emptygroup,'occupancy',n,'binding',CASE WHEN bound.grupo_id IS NULL THEN NULL ELSE jsonb_build_object('cycle',bound.ciclo,'capacity',bound.cupo,'reference',bound.referencia,'current',bound.ciclo=p_ciclo AND bound.huella_catalogo=cat->>'fingerprint' AND cat->>'valid'='true') END);
END $$;
CREATE OR REPLACE FUNCTION public.jaguar360_reinscribir(p_actor uuid,p_ciclo text,p_alumno bigint,p_grupo bigint,p_huella text DEFAULT NULL,p_destino_huella text DEFAULT NULL,p_referencia text DEFAULT NULL,p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r text; st public.alumnos; oldg public.grupos; newg public.grupos; d public.jaguar360_dictamen_continuidad; b public.jaguar360_grupos_ciclo; rec public.jaguar360_reinscripciones; ctx jsonb; cat jsonb; lastperiod jsonb; target text; ready boolean; before_row jsonb; after_row jsonb; currentperiod public.periodos_escolares;
BEGIN
 IF p_huella IS NOT NULL THEN
  LOCK TABLE public.perfiles,public.periodos_escolares,public.grupos,public.grupo_materias,public.jaguar360_planes_ciclo,public.jaguar360_cierres_periodo,public.jaguar360_rectificaciones,public.jaguar360_rectificacion_resoluciones,public.jaguar360_actas_recursamiento,public.jaguar360_intentos_recursamiento,public.jaguar360_aplicaciones_recursamiento,public.jaguar360_aplicacion_autorizaciones,public.jaguar360_dictamen_continuidad,public.jaguar360_grupos_ciclo,public.horarios,public.asignaciones_docentes,public.rubricas_evaluacion,public.bitacora_excel_diaria,public.calificaciones IN SHARE MODE NOWAIT;
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
REVOKE ALL ON FUNCTION public.jaguar360_catalogo_destino(bigint,text),public.jaguar360_destino_ciclo(uuid,text,bigint,integer,text,text),public.jaguar360_reinscribir(uuid,text,bigint,bigint,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_destino_ciclo(uuid,text,bigint,integer,text,text),public.jaguar360_reinscribir(uuid,text,bigint,bigint,text,text,text,text) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
