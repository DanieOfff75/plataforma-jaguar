-- Jaguar V52: identificadores de ciclo opcionales /1 .. /9.
-- No renombra ciclos, no actualiza datos, no crea periodos ni activa ciclos.
-- Mantiene intactas las funciones anuales de apertura y reinscripcion.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';
DO $jaguar_v52$
DECLARE
 r record;
 old_def text;
 new_def text;
 pat constant text := '^[0-9]{4}-[0-9]{4}(/[1-9])?$';
 old_pat constant text := '^[0-9]{4}-[0-9]{4}$';
 old_d constant text := '^' || chr(92) || 'd{4}-' || chr(92) || 'd{4}$';
 old_dd constant text := '^' || repeat(chr(92),2) || 'd{4}-' || repeat(chr(92),2) || 'd{4}$';
 found_count integer;
BEGIN
 -- Exact constraints observed in the project's public schema. Keep their names.
 FOR r IN SELECT * FROM (VALUES
   ('jaguar360_apoyo_docente','jaguar360_apoyo_docente_ciclo_check','ciclo'),
   ('jaguar360_dictamen_continuidad','jaguar360_dictamen_continuidad_ciclo_check','ciclo'),
   ('jaguar360_modos_materia','jaguar360_modos_materia_ciclo_check','ciclo'),
   ('jaguar360_planes_ciclo','jaguar360_planes_ciclo_ciclo_check','ciclo'),
   ('jaguar_nexo_curriculo','jaguar_nexo_curriculo_ciclo_check','ciclo'),
   ('jaguar_nexo_memoria_docente','jaguar_nexo_memoria_docente_ciclo_check','ciclo'),
   ('jaguar_precision_calificaciones','jaguar_precision_calificaciones_ciclo_escolar_check','ciclo_escolar'),
   ('jaguar_tutoria_asesores','jaguar_tutoria_asesores_ciclo_check','ciclo')
 ) AS v(tabla, restriccion, campo)
 LOOP
   SELECT pg_get_constraintdef(c.oid) INTO old_def
     FROM pg_catalog.pg_constraint c
     JOIN pg_catalog.pg_class t ON t.oid=c.conrelid
     JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname=r.tabla AND c.conname=r.restriccion AND c.contype='c';
   IF old_def IS NULL THEN RAISE EXCEPTION 'Falta la restriccion %.%; revisa instalaciones previas.',r.tabla,r.restriccion; END IF;
   IF position(pat IN old_def)>0 THEN CONTINUE; END IF;
   -- Reject an unexpected customized check rather than replacing additional rules.
   IF old_def NOT IN (
      format('CHECK ((%I ~ %L::text))',r.campo,old_pat),
      'CHECK (('||quote_ident(r.campo)||' ~ '||chr(39)||old_d||chr(39)||'::text))',
      'CHECK (('||quote_ident(r.campo)||' ~ '||chr(39)||old_dd||chr(39)||'::text))'
   ) THEN RAISE EXCEPTION 'Restriccion no reconocida: %.%. No se aplicaron cambios.',r.tabla,r.restriccion; END IF;
   EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I, ADD CONSTRAINT %I CHECK (%I ~ %L)',r.tabla,r.restriccion,r.restriccion,r.campo,pat);
 END LOOP;
 -- Edit only the format literals in the installed definitions, not older copies of functions.
 -- CREATE OR REPLACE retains ownership and grants; preserve security/search_path and all business rules.
 FOR r IN SELECT unnest(ARRAY[
   'jaguar360_boleta_bloqueos',
   'jaguar360_consultar_apoyo_docente',
   'jaguar360_panel_departamento',
   'jaguar360_previsualizar_modo_materia',
   'jaguar360_registrar_apoyo_docente',
   'jaguar360_registrar_convocatoria',
   'jaguar360_registrar_plan',
   'jaguar_aplicar_criterios_calificaciones',
   'jaguar_cambiar_precision_calificaciones',
   'jaguar_institution_statistics',
   'jaguar_nexo_corte_v45'
 ]) AS nombre
 LOOP
   SELECT count(*) INTO found_count FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=r.nombre AND p.prokind='f';
   IF found_count<>1 THEN RAISE EXCEPTION 'Funcion ausente o ambigua: %. No se aplicaron cambios.',r.nombre; END IF;
   SELECT pg_get_functiondef(p.oid) INTO old_def FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=r.nombre AND p.prokind='f';
   new_def:=replace(replace(replace(old_def,old_pat,pat),old_d,pat),old_dd,pat);
   IF position(pat IN new_def)=0 THEN RAISE EXCEPTION 'Formato no reconocido en %. No se aplicaron cambios.',r.nombre; END IF;
   IF r.nombre='jaguar360_registrar_convocatoria' THEN
     new_def:=replace(new_def, $old$replace(label,'{CICLO}',p_ciclo)$old$, $new$replace(label,'{CICLO}',replace(p_ciclo,'/','-'))$new$);
   END IF;
   IF new_def<>old_def THEN EXECUTE new_def; END IF;
 END LOOP;
END;
$jaguar_v52$;
NOTIFY pgrst, 'reload schema';
COMMIT;
