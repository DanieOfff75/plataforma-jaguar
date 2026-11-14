-- V14. Justificantes temporales y acta experimental de resultados; no modifica notas ordinarias.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar360_justificantes_temporales (
 sesion_id bigint NOT NULL REFERENCES public.jaguar360_listas_temporales(sesion_id) ON DELETE RESTRICT,
 alumno_id bigint NOT NULL REFERENCES public.alumnos(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL, actor_nombre text NOT NULL,
 referencia text NOT NULL CHECK(char_length(referencia) BETWEEN 5 AND 300),
 motivo text NOT NULL CHECK(char_length(motivo) BETWEEN 15 AND 1500), registrado_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(sesion_id,alumno_id)
);
CREATE TABLE IF NOT EXISTS public.jaguar360_actas_recursamiento (
 convocatoria_id bigint PRIMARY KEY REFERENCES public.jaguar360_grupos_temporales(convocatoria_id) ON DELETE RESTRICT,
 huella text NOT NULL CHECK(huella ~ '^[a-f0-9]{32}$'), evidencia jsonb NOT NULL,
 resultados jsonb NOT NULL CHECK(jsonb_typeof(resultados)='array'), actor_id uuid NOT NULL, actor_nombre text NOT NULL,
 referencia text NOT NULL CHECK(char_length(referencia) BETWEEN 5 AND 300), motivo text NOT NULL CHECK(char_length(motivo) BETWEEN 15 AND 1500), registrado_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.jaguar360_intentos_recursamiento (
 ciclo text NOT NULL, materia_clave text NOT NULL, alumno_id bigint NOT NULL REFERENCES public.alumnos(id) ON DELETE RESTRICT,
 reserva_id bigint NOT NULL UNIQUE REFERENCES public.jaguar360_reservas_recursamiento(id) ON DELETE RESTRICT,
 convocatoria_id bigint NOT NULL REFERENCES public.jaguar360_actas_recursamiento(convocatoria_id) ON DELETE RESTRICT,
 resultado text NOT NULL CHECK(resultado IN ('blocks_passed','blocks_failed')), registrado_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(ciclo,materia_clave,alumno_id)
);
ALTER TABLE public.jaguar360_justificantes_temporales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar360_actas_recursamiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar360_intentos_recursamiento ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_justificantes_temporales,public.jaguar360_actas_recursamiento,public.jaguar360_intentos_recursamiento FROM PUBLIC,anon,authenticated,service_role;
-- Only prefectura can inspect or justify a recorded temporary list. Original marks remain unchanged.
CREATE OR REPLACE FUNCTION public.jaguar360_justificar_temporal(p_actor uuid,p_session bigint,p_student bigint DEFAULT NULL,p_reference text DEFAULT NULL,p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; s public.jaguar360_sesiones_temporales; l public.jaguar360_listas_temporales; rows jsonb; writable boolean;
BEGIN
 IF p_student IS NOT NULL THEN
  LOCK TABLE public.perfiles,public.jaguar360_grupos_temporales,public.jaguar360_listas_temporales,public.jaguar360_actas_recursamiento IN SHARE MODE NOWAIT;
  LOCK TABLE public.jaguar360_justificantes_temporales IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 END IF;
 SELECT nombre_completo INTO a FROM public.perfiles WHERE id=p_actor AND activo AND rol='prefectura';
 IF NOT FOUND THEN RAISE EXCEPTION 'Solo Prefectura valida justificantes.' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.jaguar360_sesiones_temporales WHERE id=p_session;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sesión temporal no encontrada.'; END IF;
 SELECT * INTO l FROM public.jaguar360_listas_temporales WHERE sesion_id=p_session;
 IF NOT FOUND THEN RAISE EXCEPTION 'La lista aún no está confirmada.'; END IF;
 writable:=EXISTS(SELECT 1 FROM public.jaguar360_grupos_temporales WHERE convocatoria_id=s.convocatoria_id AND estado='activo') AND NOT EXISTS(SELECT 1 FROM public.jaguar360_actas_recursamiento WHERE convocatoria_id=s.convocatoria_id);
 IF p_student IS NOT NULL THEN
  IF NOT writable OR p_reference IS NULL OR char_length(btrim(p_reference)) NOT BETWEEN 5 AND 300 OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Acta cerrada, grupo no activo o referencia/motivo inválidos.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.jaguar360_grupo_temporal_padron p WHERE p.convocatoria_id=s.convocatoria_id AND p.alumno_id=p_student AND s.bloque=ANY(p.bloques)) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(l.marcas) m WHERE m->>'student'=p_student::text AND m->>'state'='falta') THEN RAISE EXCEPTION 'Solo se justifica una falta original del padrón.'; END IF;
  IF EXISTS(SELECT 1 FROM public.jaguar360_justificantes_temporales WHERE sesion_id=p_session AND alumno_id=p_student) THEN RAISE EXCEPTION 'La falta ya fue justificada.'; END IF;
  INSERT INTO public.jaguar360_justificantes_temporales(sesion_id,alumno_id,actor_id,actor_nombre,referencia,motivo) VALUES(p_session,p_student,p_actor,coalesce(a.nombre_completo,'Sin nombre'),btrim(p_reference),btrim(p_reason));
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('student',p.alumno_id::text,'name',al.nombre_completo,'original',m->>'state','state',CASE WHEN j.alumno_id IS NOT NULL THEN 'justificada' ELSE m->>'state' END,'reference',j.referencia,'actor',j.actor_nombre,'at',j.registrado_at) ORDER BY p.alumno_id),'[]'::jsonb) INTO rows
 FROM public.jaguar360_grupo_temporal_padron p JOIN public.alumnos al ON al.id=p.alumno_id
 JOIN LATERAL (SELECT z AS m FROM jsonb_array_elements(l.marcas) z WHERE z->>'student'=p.alumno_id::text) marks ON true
 LEFT JOIN public.jaguar360_justificantes_temporales j ON j.sesion_id=p_session AND j.alumno_id=p.alumno_id
 WHERE p.convocatoria_id=s.convocatoria_id AND s.bloque=ANY(p.bloques);
 RETURN jsonb_build_object('rows',rows,'canWrite',writable,'period',s.bloque,'date',s.fecha);
END $$;
CREATE OR REPLACE FUNCTION public.jaguar360_listas_para_justificar(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo AND rol='prefectura') THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.fecha DESC,t.id DESC) FROM (SELECT s.id::text AS id,s.fecha,s.bloque,c.nombre FROM public.jaguar360_sesiones_temporales s JOIN public.jaguar360_listas_temporales l ON l.sesion_id=s.id JOIN public.jaguar360_convocatorias c ON c.id=s.convocatoria_id JOIN public.jaguar360_grupos_temporales g ON g.convocatoria_id=c.id WHERE g.estado='activo' AND NOT EXISTS(SELECT 1 FROM public.jaguar360_actas_recursamiento a WHERE a.convocatoria_id=c.id) ORDER BY s.fecha DESC,s.id DESC LIMIT 200) t),'[]'::jsonb);
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
   SELECT jsonb_build_object('present',count(*) FILTER(WHERE z.mark='presente'),'absent',count(*) FILTER(WHERE z.mark='falta'),'late',count(*) FILTER(WHERE z.mark='retardo'),'justified',count(*) FILTER(WHERE z.mark='justificada'),'unknown',count(*) FILTER(WHERE z.mark IS NULL OR z.mark NOT IN ('presente','falta','retardo','justificada'))),count(*)>0 AND count(*) FILTER(WHERE z.mark IS NULL OR z.mark NOT IN ('presente','falta','retardo','justificada'))=0 INTO counts,complete FROM public.jaguar360_sesiones_temporales s LEFT JOIN public.jaguar360_listas_temporales l ON l.sesion_id=s.id LEFT JOIN LATERAL (SELECT CASE WHEN m->>'state'='falta' AND EXISTS(SELECT 1 FROM public.jaguar360_justificantes_temporales j WHERE j.sesion_id=s.id AND j.alumno_id=p.alumno_id) THEN 'justificada' ELSE m->>'state' END AS mark FROM jsonb_array_elements(l.marcas) m WHERE m->>'student'=p.alumno_id::text) z ON true WHERE s.convocatoria_id=p_call AND s.bloque=b;
   SELECT z->'value' INTO val FROM public.jaguar360_resultados_temporales r CROSS JOIN LATERAL jsonb_array_elements(r.resultados) z WHERE r.convocatoria_id=p_call AND r.bloque=b AND z->>'student'=p.alumno_id::text;
   blocks:=blocks||jsonb_build_array(jsonb_build_object('period',b,'attendance',counts,'complete',complete,'value',val));
  END LOOP;
  rows:=rows||jsonb_build_array(jsonb_build_object('student',p.alumno_id::text,'name',p.nombre_completo,'cause',p.causa,'stale',cur->>'fingerprint' IS DISTINCT FROM p.huella,'source',p.respaldo,'blocks',blocks,'reservation',p.reserva_id::text));
 END LOOP;
 RETURN jsonb_build_object('call',to_jsonb(c),'students',rows);
END $$;
-- Snapshot hash is computed by PostgreSQL. Never accepts grades or attendance from the browser.
CREATE OR REPLACE FUNCTION public.jaguar360_contexto_acta_recursamiento(p_actor uuid,p_call bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE stored public.jaguar360_actas_recursamiento; src jsonb; ended boolean;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo AND rol IN ('direccion_escolar','coordinacion_academica','control_escolar','control')) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 SELECT * INTO stored FROM public.jaguar360_actas_recursamiento WHERE convocatoria_id=p_call;
 IF FOUND THEN RETURN jsonb_build_object('recorded',true,'fingerprint',stored.huella,'rows',stored.resultados,'reference',stored.referencia,'actor',stored.actor_nombre,'at',stored.registrado_at,'canAuthorize',false); END IF;
 src:=public.jaguar360_revision_resultados_temporales(p_actor,p_call);
 ended:=(src->'call'->'reglas'->>'end')::date < (now() AT TIME ZONE 'America/Mexico_City')::date;
 RETURN jsonb_build_object('recorded',false,'source',src,'fingerprint',md5(src::text),'canAuthorize',ended);
END $$;
CREATE OR REPLACE FUNCTION public.jaguar360_autorizar_acta_recursamiento(p_actor uuid,p_call bigint,p_fingerprint text,p_results jsonb,p_reference text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; ctx jsonb; src jsonb; n integer;
BEGIN
 -- Serialize final decisions and prevent changes to source evidence between hash and insert.
 LOCK TABLE public.perfiles,public.alumnos,public.jaguar360_convocatorias,public.jaguar360_reservas_recursamiento,public.jaguar360_grupos_temporales,public.jaguar360_grupo_temporal_padron,public.jaguar360_sesiones_temporales,public.jaguar360_listas_temporales,public.jaguar360_resultados_temporales,public.jaguar360_justificantes_temporales,public.jaguar360_cierres_periodo,public.jaguar360_rectificaciones,public.jaguar360_rectificacion_resoluciones,public.jaguar360_planes_ciclo,public.periodos_escolares IN SHARE MODE NOWAIT;
 LOCK TABLE public.jaguar360_actas_recursamiento,public.jaguar360_intentos_recursamiento IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 SELECT nombre_completo INTO a FROM public.perfiles WHERE id=p_actor AND activo AND rol='direccion_escolar';
 IF NOT FOUND THEN RAISE EXCEPTION 'Solo Dirección autoriza el acta.' USING ERRCODE='42501'; END IF;
 IF p_reference IS NULL OR char_length(btrim(p_reference)) NOT BETWEEN 5 AND 300 OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 15 AND 1500 THEN RAISE EXCEPTION 'Referencia y motivo requeridos.'; END IF;
 ctx:=public.jaguar360_contexto_acta_recursamiento(p_actor,p_call); src:=ctx->'source';
 IF ctx->>'recorded'='true' OR ctx->>'canAuthorize' IS DISTINCT FROM 'true' OR p_fingerprint IS NULL OR ctx->>'fingerprint' IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'Convocatoria sin concluir, acta existente o fuentes modificadas.'; END IF;
 n:=jsonb_array_length(src->'students');
 IF n=0 OR jsonb_typeof(p_results) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Acta sin alumnos.'; END IF;
 IF jsonb_array_length(p_results)<>n OR (SELECT count(DISTINCT r->>'student') FROM jsonb_array_elements(p_results) r)<>n OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_results) r WHERE coalesce(r->>'state','') NOT IN ('blocks_passed','blocks_failed') OR r->'evaluation'->>'consumesAttempt' IS DISTINCT FROM 'true' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(src->'students') s WHERE s->>'student'=r->>'student' AND s->>'stale'='false' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s->'blocks') b WHERE b->>'complete' IS DISTINCT FROM 'true' OR b->>'value' IS NULL))) THEN RAISE EXCEPTION 'Resultados incompletos, incompatibles o pendientes.'; END IF;
 -- Results calculated by the trusted backend from exactly this snapshot; service_role only.
 INSERT INTO public.jaguar360_actas_recursamiento(convocatoria_id,huella,evidencia,resultados,actor_id,actor_nombre,referencia,motivo) VALUES(p_call,p_fingerprint,src,p_results,p_actor,coalesce(a.nombre_completo,'Sin nombre'),btrim(p_reference),btrim(p_reason));
 INSERT INTO public.jaguar360_intentos_recursamiento(ciclo,materia_clave,alumno_id,reserva_id,convocatoria_id,resultado)
 SELECT r.ciclo,r.materia_clave,r.alumno_id,r.id,p_call,result->>'state' FROM public.jaguar360_grupo_temporal_padron p JOIN public.jaguar360_reservas_recursamiento r ON r.id=p.reserva_id JOIN LATERAL (SELECT z AS result FROM jsonb_array_elements(p_results) z WHERE z->>'student'=p.alumno_id::text) x ON true WHERE p.convocatoria_id=p_call;
 RETURN public.jaguar360_contexto_acta_recursamiento(p_actor,p_call);
END $$;
-- An exhausted attempt cannot be bypassed by a reservation in another call.
CREATE OR REPLACE FUNCTION public.jaguar360_bloquear_intento_agotado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.estado='reservada' AND EXISTS(SELECT 1 FROM public.jaguar360_intentos_recursamiento WHERE ciclo=NEW.ciclo AND materia_clave=NEW.materia_clave AND alumno_id=NEW.alumno_id) THEN RAISE EXCEPTION 'Derecho de recursamiento agotado para esta materia y ciclo.'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS j360_intento_agotado ON public.jaguar360_reservas_recursamiento;
CREATE TRIGGER j360_intento_agotado BEFORE INSERT OR UPDATE ON public.jaguar360_reservas_recursamiento FOR EACH ROW EXECUTE FUNCTION public.jaguar360_bloquear_intento_agotado();
REVOKE ALL ON FUNCTION public.jaguar360_justificar_temporal(uuid,bigint,bigint,text,text),public.jaguar360_listas_para_justificar(uuid),public.jaguar360_revision_resultados_temporales(uuid,bigint),public.jaguar360_contexto_acta_recursamiento(uuid,bigint),public.jaguar360_autorizar_acta_recursamiento(uuid,bigint,text,jsonb,text,text),public.jaguar360_bloquear_intento_agotado() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_justificar_temporal(uuid,bigint,bigint,text,text),public.jaguar360_listas_para_justificar(uuid),public.jaguar360_revision_resultados_temporales(uuid,bigint),public.jaguar360_contexto_acta_recursamiento(uuid,bigint),public.jaguar360_autorizar_acta_recursamiento(uuid,bigint,text,jsonb,text,text) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
