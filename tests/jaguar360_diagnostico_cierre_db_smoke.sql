-- Solo para base de prueba con datos ficticios. No crea ni cambia filas.
BEGIN TRANSACTION READ ONLY;
DO $$
DECLARE actor uuid; r jsonb; p jsonb; g jsonb;
BEGIN
 IF has_function_privilege('anon','public.jaguar360_diagnostico_cierre(uuid)','EXECUTE') OR has_function_privilege('authenticated','public.jaguar360_diagnostico_cierre(uuid)','EXECUTE') THEN RAISE EXCEPTION 'RPC visible a cliente directo'; END IF;
 IF NOT has_function_privilege('service_role','public.jaguar360_diagnostico_cierre(uuid)','EXECUTE') THEN RAISE EXCEPTION 'RPC sin permiso de servidor'; END IF;
 BEGIN
   PERFORM public.jaguar360_diagnostico_cierre(NULL);
   RAISE EXCEPTION 'Actor ausente aceptado';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 SELECT id INTO actor FROM public.perfiles WHERE activo IS TRUE AND rol='control_escolar' LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION 'Prepara un perfil ficticio de Control Escolar'; END IF;
 r:=public.jaguar360_diagnostico_cierre(actor);
 IF r->'cierre_disponible' IS DISTINCT FROM 'false'::jsonb OR r->'padron_historico_verificado' IS DISTINCT FROM 'false'::jsonb OR r->'sesiones_verificadas' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'No se permite declarar cierre listo'; END IF;
 FOR p IN SELECT value FROM jsonb_array_elements(r->'periodos') LOOP
   IF (p->>'notas_pendientes_estimadas')::bigint NOT BETWEEN 0 AND (p->>'notas_esperadas_estimadas')::bigint OR (p->>'celdas_asistencia_pendientes')::bigint NOT BETWEEN 0 AND (p->>'celdas_asistencia_observadas')::bigint THEN RAISE EXCEPTION 'Totales inconsistentes'; END IF;
   FOR g IN SELECT value FROM jsonb_array_elements(p->'grupos') LOOP
     IF (g->>'notas_pendientes')::bigint + (g->>'presentes')::bigint <> (g->>'esperadas')::bigint OR (g->>'asistencias_sin_registro')::bigint + (g->>'asistencias_registradas')::bigint <> (g->>'celdas_observadas')::bigint THEN RAISE EXCEPTION 'Subtotales inconsistentes'; END IF;
   END LOOP;
 END LOOP;
END $$;
ROLLBACK;
