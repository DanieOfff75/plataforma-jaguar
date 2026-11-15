-- V42: solamente relevo docente. No modifica filas, calificaciones ni bitácoras.
-- Conserva la definición instalada, permisos y el resto de comprobaciones.
DO $j42$
DECLARE
  v_oid regprocedure := to_regprocedure('public.jaguar_relevo_adoptar_actividades(bigint,bigint,uuid)');
  v_def text;
  v_old text := $old$IF v_nota.value<>'null'::jsonb AND (jsonb_typeof(v_nota.value)<>'number' OR
     (v_nota.value::text)::numeric<0 OR (v_nota.value::text)::numeric>10) THEN CONTINUE; END IF;$old$;
  v_new text := $new$IF v_nota.value<>'null'::jsonb THEN
    IF jsonb_typeof(v_nota.value)<>'number' THEN CONTINUE; END IF;
    IF (v_nota.value::text)::numeric<0 THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_origen.snapshot->'activities') a
      WHERE a->>'key'=v_clave_origen AND lower(btrim(a->>'nombre')) IN ('firma','firmas')) THEN
      IF (v_nota.value::text)::numeric<>trunc((v_nota.value::text)::numeric)
         OR (v_nota.value::text)::numeric>9007199254740991 THEN
        RAISE EXCEPTION 'Conteo de firmas inválido en bitácora original; no se adoptó ningún registro';
      END IF;
    ELSIF (v_nota.value::text)::numeric>10 THEN CONTINUE;
    END IF;
  END IF;$new$;
BEGIN
  IF v_oid IS NULL THEN RAISE EXCEPTION 'No existe la función de relevo docente esperada; no se modificó nada'; END IF;
  v_def := pg_get_functiondef(v_oid);
  IF strpos(v_def,v_new)>0 THEN RETURN; END IF;
  IF (length(v_def)-length(replace(v_def,v_old,'')))<>length(v_old) THEN
    RAISE EXCEPTION 'La definición de relevo difiere de la versión conocida; no se modificó nada';
  END IF;
  EXECUTE replace(v_def,v_old,v_new);
END;
$j42$;
NOTIFY pgrst, 'reload schema';
