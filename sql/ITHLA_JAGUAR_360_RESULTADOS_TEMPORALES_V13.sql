-- Captura experimental de resultados por bloque. No aplica calificaciones ni consume intentos.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar360_resultados_temporales (
 convocatoria_id bigint NOT NULL REFERENCES public.jaguar360_grupos_temporales(convocatoria_id) ON DELETE RESTRICT,
 bloque integer NOT NULL CHECK(bloque BETWEEN 1 AND 6),
 resultados jsonb NOT NULL CHECK(jsonb_typeof(resultados)='array'),
 referencia text NOT NULL CHECK(char_length(referencia) BETWEEN 5 AND 300),
 actor_id uuid NOT NULL, registrado_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(convocatoria_id,bloque)
);
ALTER TABLE public.jaguar360_resultados_temporales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_resultados_temporales FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.jaguar360_resultado_bloque_temporal(p_actor uuid,p_session bigint,p_results jsonb DEFAULT NULL,p_reference text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.jaguar360_sesiones_temporales; c public.jaguar360_convocatorias; r public.jaguar360_resultados_temporales; expected integer; complete boolean; qual boolean; allowed boolean; rows jsonb; localnow timestamp:=now() AT TIME ZONE 'America/Mexico_City';
BEGIN
 IF p_results IS NOT NULL THEN
  LOCK TABLE public.jaguar360_grupos_temporales,public.jaguar360_apoyo_docente,public.docentes,public.perfiles,public.alumnos,public.jaguar360_listas_temporales IN SHARE MODE NOWAIT;
  LOCK TABLE public.jaguar360_resultados_temporales IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.jaguar360_mis_sesiones_temporales(p_actor)) z WHERE z->>'id'=p_session::text) THEN RAISE EXCEPTION 'Bloque no asignado o fuera de vigencia.' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.jaguar360_sesiones_temporales WHERE id=p_session;
 SELECT * INTO c FROM public.jaguar360_convocatorias WHERE id=s.convocatoria_id;
 qual:=c.reglas->>'method'='qualitative';
 IF EXISTS(SELECT 1 FROM public.jaguar360_sesiones_temporales t WHERE t.convocatoria_id=s.convocatoria_id AND t.bloque=s.bloque AND t.docente_id<>s.docente_id) THEN RAISE EXCEPTION 'Bloque con titulares distintos: requiere revisión.'; END IF;
 SELECT count(*) INTO expected FROM public.jaguar360_grupo_temporal_padron p WHERE p.convocatoria_id=s.convocatoria_id AND s.bloque=ANY(p.bloques);
 SELECT expected>0 AND NOT EXISTS(SELECT 1 FROM public.jaguar360_sesiones_temporales t LEFT JOIN public.jaguar360_listas_temporales l ON l.sesion_id=t.id WHERE t.convocatoria_id=s.convocatoria_id AND t.bloque=s.bloque AND (l.sesion_id IS NULL OR t.fecha>localnow::date OR (t.fecha=localnow::date AND t.fin>extract(hour FROM localnow)*60+extract(minute FROM localnow)))) INTO complete;
 SELECT * INTO r FROM public.jaguar360_resultados_temporales WHERE convocatoria_id=s.convocatoria_id AND bloque=s.bloque;
 allowed:=complete AND r.convocatoria_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.jaguar360_grupo_temporal_padron p JOIN public.alumnos a ON a.id=p.alumno_id WHERE p.convocatoria_id=s.convocatoria_id AND s.bloque=ANY(p.bloques) AND (NOT a.activo OR a.estado_escolar<>'activo'));
 IF p_results IS NOT NULL THEN
  IF NOT allowed OR p_reference IS NULL OR char_length(btrim(p_reference)) NOT BETWEEN 5 AND 300 THEN RAISE EXCEPTION 'Bloque incompleto, ya evaluado, padrón modificado o referencia inválida.'; END IF;
  IF jsonb_typeof(p_results) IS DISTINCT FROM 'array' OR jsonb_array_length(p_results)<>expected OR (SELECT count(DISTINCT z->>'student') FROM jsonb_array_elements(p_results) z)<>expected OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_results) z WHERE NOT EXISTS(SELECT 1 FROM public.jaguar360_grupo_temporal_padron p WHERE p.convocatoria_id=s.convocatoria_id AND s.bloque=ANY(p.bloques) AND p.alumno_id::text=z->>'student') OR CASE WHEN qual THEN coalesce(z->>'value','') NOT IN ('AP','RP') OR jsonb_typeof(z->'value') IS DISTINCT FROM 'string' ELSE CASE WHEN jsonb_typeof(z->'value') IS DISTINCT FROM 'number' THEN true ELSE (z->>'value')::numeric NOT BETWEEN 0 AND 10 END END) THEN RAISE EXCEPTION 'Resultados incompletos, incompatibles o ajenos al bloque.'; END IF;
  INSERT INTO public.jaguar360_resultados_temporales(convocatoria_id,bloque,resultados,referencia,actor_id) VALUES(s.convocatoria_id,s.bloque,(SELECT jsonb_agg(jsonb_build_object('student',z->>'student','value',z->'value') ORDER BY z->>'student') FROM jsonb_array_elements(p_results) z),btrim(p_reference),p_actor) RETURNING * INTO r;
  allowed:=false;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('student',p.alumno_id::text,'name',a.nombre_completo,'value',(SELECT z->'value' FROM jsonb_array_elements(r.resultados) z WHERE z->>'student'=p.alumno_id::text)) ORDER BY a.nombre_completo,p.alumno_id),'[]') INTO rows FROM public.jaguar360_grupo_temporal_padron p JOIN public.alumnos a ON a.id=p.alumno_id WHERE p.convocatoria_id=s.convocatoria_id AND s.bloque=ANY(p.bloques);
 RETURN jsonb_build_object('period',s.bloque,'rows',rows,'qualitative',qual,'complete',complete,'recorded',r.convocatoria_id IS NOT NULL,'canWrite',allowed,'reference',r.referencia);
END $$;
CREATE OR REPLACE FUNCTION public.jaguar360_revision_resultados_temporales(p_actor uuid,p_call bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.jaguar360_convocatorias; p record; b integer; rows jsonb:='[]'; blocks jsonb; cur jsonb; val jsonb; counts jsonb; complete boolean;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo AND rol IN ('direccion_escolar','coordinacion_academica','control_escolar','control')) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.jaguar360_convocatorias WHERE id=p_call AND reglas->>'kind'='recourse';
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.jaguar360_grupos_temporales WHERE convocatoria_id=p_call AND estado='activo') THEN RAISE EXCEPTION 'Grupo temporal no activo.'; END IF;
 FOR p IN SELECT t.*,r.causa,r.huella,r.respaldo,a.nombre_completo FROM public.jaguar360_grupo_temporal_padron t JOIN public.jaguar360_reservas_recursamiento r ON r.id=t.reserva_id JOIN public.alumnos a ON a.id=t.alumno_id WHERE t.convocatoria_id=p_call ORDER BY t.alumno_id LOOP
  cur:=public.jaguar360_candidatura_recursamiento(p_actor,p_call,p.alumno_id);
  blocks:='[]';
  FOREACH b IN ARRAY p.bloques LOOP
   SELECT jsonb_build_object('present',count(*) FILTER(WHERE z.mark='presente'),'absent',count(*) FILTER(WHERE z.mark='falta'),'late',count(*) FILTER(WHERE z.mark='retardo'),'justified',0,'unknown',count(*) FILTER(WHERE z.mark IS NULL OR z.mark NOT IN ('presente','falta','retardo'))),count(*)>0 AND count(*) FILTER(WHERE z.mark IS NULL OR z.mark NOT IN ('presente','falta','retardo'))=0 INTO counts,complete FROM public.jaguar360_sesiones_temporales s LEFT JOIN public.jaguar360_listas_temporales l ON l.sesion_id=s.id LEFT JOIN LATERAL (SELECT m->>'state' AS mark FROM jsonb_array_elements(l.marcas) m WHERE m->>'student'=p.alumno_id::text) z ON true WHERE s.convocatoria_id=p_call AND s.bloque=b;
   SELECT z->'value' INTO val FROM public.jaguar360_resultados_temporales r CROSS JOIN LATERAL jsonb_array_elements(r.resultados) z WHERE r.convocatoria_id=p_call AND r.bloque=b AND z->>'student'=p.alumno_id::text;
   blocks:=blocks||jsonb_build_array(jsonb_build_object('period',b,'attendance',counts,'complete',complete,'value',val));
  END LOOP;
  rows:=rows||jsonb_build_array(jsonb_build_object('student',p.alumno_id::text,'name',p.nombre_completo,'cause',p.causa,'stale',cur->>'fingerprint' IS DISTINCT FROM p.huella,'source',p.respaldo,'blocks',blocks));
 END LOOP;
 RETURN jsonb_build_object('call',to_jsonb(c),'students',rows);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_resultado_bloque_temporal(uuid,bigint,jsonb,text),public.jaguar360_revision_resultados_temporales(uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_resultado_bloque_temporal(uuid,bigint,jsonb,text),public.jaguar360_revision_resultados_temporales(uuid,bigint) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
