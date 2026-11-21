-- Solo lectura: los cuatro primeros ejemplos se aceptan, los cuatro ultimos se rechazan; formato_ampliado debe ser true.
SELECT v AS ejemplo, v ~ '^[0-9]{4}-[0-9]{4}(/[1-9])?$' AS aceptado
FROM (VALUES ('2026-2027'),('2026-2027/1'),('2026-2027/2'),('2027-2028/3'),('2026-2027/0'),('2026-2027/01'),('2026-2027/10'),('2026-2027/1/2')) AS x(v);
SELECT t.relname AS tabla,c.conname AS restriccion,
       position('^[0-9]{4}-[0-9]{4}(/[1-9])?$' IN pg_get_constraintdef(c.oid))>0 AS formato_ampliado
FROM pg_constraint c JOIN pg_class t ON c.conrelid=t.oid JOIN pg_namespace n ON t.relnamespace=n.oid
WHERE n.nspname='public' AND c.contype='c' AND c.conname IN (
'jaguar360_apoyo_docente_ciclo_check','jaguar360_dictamen_continuidad_ciclo_check','jaguar360_modos_materia_ciclo_check','jaguar360_planes_ciclo_ciclo_check','jaguar_nexo_curriculo_ciclo_check','jaguar_nexo_memoria_docente_ciclo_check','jaguar_precision_calificaciones_ciclo_escolar_check','jaguar_tutoria_asesores_ciclo_check') ORDER BY tabla;
SELECT p.proname AS funcion,position('^[0-9]{4}-[0-9]{4}(/[1-9])?$' IN p.prosrc)>0 AS formato_ampliado
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (
'jaguar360_boleta_bloqueos','jaguar360_consultar_apoyo_docente','jaguar360_panel_departamento','jaguar360_previsualizar_modo_materia','jaguar360_registrar_apoyo_docente','jaguar360_registrar_convocatoria','jaguar360_registrar_plan','jaguar_aplicar_criterios_calificaciones','jaguar_cambiar_precision_calificaciones','jaguar_institution_statistics','jaguar_nexo_corte_v45') ORDER BY funcion;
SELECT ciclo_escolar, count(*) AS periodos,bool_or(es_periodo_actual) AS actual FROM public.periodos_escolares GROUP BY ciclo_escolar ORDER BY ciclo_escolar;
