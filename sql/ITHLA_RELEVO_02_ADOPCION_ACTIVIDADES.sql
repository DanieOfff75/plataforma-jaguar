-- Jaguar | continuidad de actividades de bitácora entre docentes.
-- Requiere ITHLA_GESTION_DOCENTE_V1.sql ya aplicado.
-- No altera bitácoras, notas ni rúbricas originales.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar_relevo_adopciones_actividades (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vacante_id bigint NOT NULL REFERENCES public.jaguar_vacantes_docentes(id) ON DELETE RESTRICT,
  bitacora_origen_id bigint NOT NULL REFERENCES public.bitacora_excel_diaria(id) ON DELETE RESTRICT,
  bitacora_destino_id bigint NOT NULL REFERENCES public.bitacora_excel_diaria(id) ON DELETE RESTRICT,
  docente_destino_id bigint NOT NULL REFERENCES public.docentes(id) ON DELETE RESTRICT,
  mapa_claves jsonb NOT NULL DEFAULT '{}'::jsonb,
  actividades_adoptadas integer NOT NULL CHECK(actividades_adoptadas BETWEEN 1 AND 40),
  notas_heredadas integer NOT NULL DEFAULT 0,
  registrado_por uuid NOT NULL,
  registrado_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(vacante_id,bitacora_origen_id)
);
ALTER TABLE public.jaguar_relevo_adopciones_actividades ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar_relevo_adopciones_actividades FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.jaguar_relevo_adopciones_actividades TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.jaguar_relevo_adopciones_actividades_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.jaguar_relevo_adoptar_actividades(
  p_vacante_id bigint,p_bitacora_id bigint,p_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $ithla$
DECLARE
 v_v public.jaguar_vacantes_docentes%ROWTYPE;
 v_origen public.bitacora_excel_diaria%ROWTYPE;
 v_destino public.bitacora_excel_diaria%ROWTYPE;
 v_rubrica public.rubricas_evaluacion%ROWTYPE;
 v_componentes jsonb := '[]'::jsonb;
 v_total_ponderacion numeric := 0;
 v_actividades jsonb := '[]'::jsonb;
 v_notas jsonb := '{}'::jsonb;
 v_notas_origen jsonb := '{}'::jsonb;
 v_ponderaciones jsonb := '{}'::jsonb;
 v_asistencias jsonb := '{}'::jsonb;
 v_mapa jsonb := '{}'::jsonb;
 v_historia jsonb := '[]'::jsonb;
 v_meta jsonb;
 v_rubrica_json jsonb;
 v_snapshot jsonb;
 v_actividad jsonb;
 v_nota record;
 v_clave text; v_nueva_clave text; v_nombre text;
 v_id_alumno bigint; v_clave_origen text; v_nueva_nota text;
 v_cantidad int := 0; v_notas_copiadas int := 0; v_version int; v_nuevo_id bigint;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Operación exclusiva de servidor'; END IF;
 IF p_vacante_id IS NULL OR p_bitacora_id IS NULL OR p_actor IS NULL THEN RAISE EXCEPTION 'Faltan identificadores'; END IF;
 SELECT * INTO v_v FROM public.jaguar_vacantes_docentes WHERE id=p_vacante_id FOR UPDATE;
 IF NOT FOUND OR v_v.estado<>'cubierta' THEN RAISE EXCEPTION 'El grupo no cuenta con relevo activo'; END IF;
 IF NOT EXISTS (
   SELECT 1 FROM public.docentes d JOIN public.asignaciones_docentes a ON a.docente_id=d.id
   WHERE d.id=v_v.docente_nuevo_id AND d.auth_user_id=p_actor AND d.activo=true
     AND a.grupo_materia_id=v_v.grupo_materia_id AND a.ciclo_escolar=v_v.ciclo_escolar AND a.activo=true
 ) THEN RAISE EXCEPTION 'No eres el docente sustituto activo de esta materia'; END IF;
 IF EXISTS (SELECT 1 FROM public.jaguar_relevo_adopciones_actividades
    WHERE vacante_id=p_vacante_id AND bitacora_origen_id=p_bitacora_id)
 THEN RAISE EXCEPTION 'Las actividades de esta bitácora ya fueron adoptadas'; END IF;
 SELECT * INTO v_origen FROM public.bitacora_excel_diaria WHERE id=p_bitacora_id FOR UPDATE;
 IF NOT FOUND OR v_origen.docente_id<>v_v.docente_anterior_id
   OR v_origen.grupo_materia_id<>v_v.grupo_materia_id
   OR v_origen.estado='reemplazado'
 THEN RAISE EXCEPTION 'Esta bitácora no es una fuente vigente del relevo'; END IF;
 IF jsonb_typeof(COALESCE(v_origen.snapshot->'activities','[]'::jsonb))<>'array' THEN
  RAISE EXCEPTION 'El formato de actividades no es válido'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.periodos_escolares p
   WHERE p.id=v_origen.periodo_id AND p.ciclo_escolar=v_v.ciclo_escolar) THEN
   RAISE EXCEPTION 'La bitácora original corresponde a otro ciclo escolar'; END IF;
 IF jsonb_array_length(COALESCE(v_origen.snapshot->'activities','[]'::jsonb))=0 THEN
  RAISE EXCEPTION 'La bitácora original no tiene actividades para adoptar'; END IF;

 SELECT * INTO v_destino FROM public.bitacora_excel_diaria
   WHERE docente_id=v_v.docente_nuevo_id AND grupo_materia_id=v_v.grupo_materia_id
     AND periodo_id=v_origen.periodo_id AND estado IS DISTINCT FROM 'reemplazado'
   ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE;
 v_actividades := COALESCE(v_destino.snapshot->'activities','[]'::jsonb);
 v_notas := CASE WHEN jsonb_typeof(v_destino.snapshot->'activityScores')='object'
   AND v_destino.snapshot->'activityScores'<>'{}'::jsonb THEN v_destino.snapshot->'activityScores'
   ELSE COALESCE(v_destino.snapshot->'scores',v_destino.snapshot->'activityScores','{}'::jsonb) END;
 v_ponderaciones := COALESCE(v_destino.snapshot->'weightedValues','{}'::jsonb);
 v_asistencias := COALESCE(v_destino.snapshot->'attendance','{}'::jsonb);
 IF jsonb_typeof(v_actividades)<>'array' OR jsonb_typeof(v_notas)<>'object' THEN
  RAISE EXCEPTION 'Bitácora del sustituto incompatible; revisa sus datos antes de continuar'; END IF;
 IF jsonb_array_length(v_actividades)+jsonb_array_length(v_origen.snapshot->'activities')>40 THEN
  RAISE EXCEPTION 'Excede 40 actividades; no se modificó ningún registro'; END IF;
 FOR v_actividad IN SELECT value FROM jsonb_array_elements(v_origen.snapshot->'activities') LOOP
  v_cantidad := v_cantidad+1;
  v_clave := left(btrim(COALESCE(v_actividad->>'key','')),80);
  v_nombre := left(btrim(COALESCE(v_actividad->>'nombre','')),160);
  IF v_clave='' OR v_nombre='' OR v_mapa ? v_clave THEN
   RAISE EXCEPTION 'La bitácora original tiene claves o nombres de actividad inválidos o duplicados'; END IF;
  v_nueva_clave := v_clave;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_actividades) x WHERE x->>'key'=v_nueva_clave) THEN
   v_nueva_clave := 'relevo-'||v_origen.id||'-'||v_cantidad;
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_actividades) x WHERE x->>'key'=v_nueva_clave) THEN
   RAISE EXCEPTION 'Conflicto entre claves de actividades; no se realizó ningún cambio';
  END IF;
  v_mapa := v_mapa || jsonb_build_object(v_clave,v_nueva_clave);
  v_actividades := v_actividades || jsonb_build_array(jsonb_build_object(
   'key',v_nueva_clave,'nombre',v_nombre,'fecha',v_actividad->>'fecha',
   'orden',jsonb_array_length(v_actividades)+1));
 END LOOP;
 v_notas_origen := CASE WHEN jsonb_typeof(v_origen.snapshot->'activityScores')='object'
   AND v_origen.snapshot->'activityScores'<>'{}'::jsonb THEN v_origen.snapshot->'activityScores'
   ELSE COALESCE(v_origen.snapshot->'scores',v_origen.snapshot->'activityScores','{}'::jsonb) END;
 IF jsonb_typeof(v_notas_origen)<>'object' THEN RAISE EXCEPTION 'Formato de notas heredadas inválido'; END IF;
 FOR v_nota IN SELECT key,value FROM jsonb_each(v_notas_origen) LOOP
  v_clave_origen := substr(v_nota.key,strpos(v_nota.key,'|')+1);
  IF strpos(v_nota.key,'|')=0 OR NOT (v_mapa ? v_clave_origen) THEN CONTINUE; END IF;
  IF split_part(v_nota.key,'|',1) !~ '^[0-9]+$' THEN CONTINUE; END IF;
  v_id_alumno := split_part(v_nota.key,'|',1)::bigint;
  IF NOT EXISTS(SELECT 1 FROM public.alumnos a JOIN public.grupo_materias gm ON gm.grupo_id=a.grupo_id
    WHERE gm.id=v_v.grupo_materia_id AND a.id=v_id_alumno) THEN CONTINUE; END IF;
  IF v_nota.value<>'null'::jsonb AND (jsonb_typeof(v_nota.value)<>'number' OR
     (v_nota.value::text)::numeric<0 OR (v_nota.value::text)::numeric>10) THEN CONTINUE; END IF;
  v_nueva_nota := v_id_alumno||'|'||(v_mapa->>v_clave_origen);
  IF NOT v_notas ? v_nueva_nota THEN
    v_notas := v_notas || jsonb_build_object(v_nueva_nota,v_nota.value);
    v_notas_copiadas := v_notas_copiadas+1;
  END IF;
 END LOOP;

 SELECT * INTO v_rubrica FROM public.rubricas_evaluacion
  WHERE docente_id=v_v.docente_nuevo_id AND grupo_materia_id=v_v.grupo_materia_id AND periodo_id=v_origen.periodo_id;
 IF FOUND THEN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'nombre',nombre,'ponderacion',ponderacion,'maximo',maximo,'orden',orden) ORDER BY orden),'[]'::jsonb),
   COALESCE(sum(ponderacion),0) INTO v_componentes,v_total_ponderacion
  FROM public.rubrica_componentes WHERE rubrica_id=v_rubrica.id;
  v_rubrica_json := jsonb_build_object('id',v_rubrica.id,'version',v_rubrica.version,
   'titulo',v_rubrica.titulo,'components',v_componentes,'total',v_total_ponderacion);
 ELSE
  v_rubrica_json := jsonb_build_object('id',0,'version',1,'titulo','Rúbrica pendiente de configurar',
   'components','[]'::jsonb,'total',0);
 END IF;
 v_historia := COALESCE(v_destino.snapshot->'meta'->'origenes_relevo','[]'::jsonb);
 v_historia := v_historia || jsonb_build_array(jsonb_build_object('bitacora_id',v_origen.id,
     'docente_id',v_v.docente_anterior_id,'actividades',v_cantidad,'notas',v_notas_copiadas));
 v_meta := jsonb_build_object('version',2,'periodo_id',v_origen.periodo_id,
  'grupo_materia_id',v_v.grupo_materia_id,'docente_id',v_v.docente_nuevo_id,
  'origenes_relevo',v_historia);
 v_snapshot := jsonb_build_object('activities',v_actividades,'activityScores',v_notas,
  'weightedValues',v_ponderaciones,'attendance',v_asistencias,'rubric',v_rubrica_json,'meta',v_meta);
 SELECT COALESCE(MAX(version),0)+1 INTO v_version FROM public.bitacora_excel_diaria
  WHERE docente_id=v_v.docente_nuevo_id AND grupo_materia_id=v_v.grupo_materia_id
    AND periodo_id=v_origen.periodo_id AND fecha_clase=CURRENT_DATE;
 INSERT INTO public.bitacora_excel_diaria(
  docente_id,grupo_materia_id,periodo_id,fecha_clase,version,anterior_id,
  archivo_path,archivo_sha256,filas,actividades,ponderacion_total,snapshot,uploaded_by)
 VALUES (v_v.docente_nuevo_id,v_v.grupo_materia_id,v_origen.periodo_id,CURRENT_DATE,
  v_version,v_destino.id,'',NULL,
  (SELECT count(*) FROM public.alumnos a JOIN public.grupo_materias gm ON gm.grupo_id=a.grupo_id
   WHERE gm.id=v_v.grupo_materia_id),jsonb_array_length(v_actividades),v_total_ponderacion,
  v_snapshot,p_actor)
 RETURNING id INTO v_nuevo_id;
 IF v_destino.id IS NOT NULL THEN
  UPDATE public.bitacora_excel_diaria SET estado='reemplazado' WHERE id=v_destino.id;
 END IF;
 INSERT INTO public.jaguar_relevo_adopciones_actividades
  (vacante_id,bitacora_origen_id,bitacora_destino_id,docente_destino_id,mapa_claves,
   actividades_adoptadas,notas_heredadas,registrado_por)
 VALUES (v_v.id,v_origen.id,v_nuevo_id,v_v.docente_nuevo_id,v_mapa,v_cantidad,v_notas_copiadas,p_actor);
 INSERT INTO public.jaguar_relevo_auditoria(vacante_id,accion,actor,detalle)
 VALUES(v_v.id,'adoptar_actividades',p_actor,
  jsonb_build_object('origen',v_origen.id,'destino',v_nuevo_id,
   'actividades',v_cantidad,'notas_heredadas',v_notas_copiadas));
 RETURN jsonb_build_object('bitacora_id',v_nuevo_id,'origen_id',v_origen.id,
   'actividades',v_cantidad,'notas_heredadas',v_notas_copiadas,'estado','adoptada');
END $ithla$;
REVOKE ALL ON FUNCTION public.jaguar_relevo_adoptar_actividades(bigint,bigint,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jaguar_relevo_adoptar_actividades(bigint,bigint,uuid) TO service_role;
COMMIT;
