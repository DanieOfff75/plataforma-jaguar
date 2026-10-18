-- PRECHECK INOFENSIVO: no requiere instalar previamente Jaguar 6.0.
SELECT objeto, to_regclass('public.'||objeto) IS NOT NULL AS existe
FROM (VALUES('institucion_config'),('perfiles'),('aspirantes'),('alumnos'),('ithla_config'),('ithla_sesiones')) v(objeto);
SELECT proname,pg_get_function_identity_arguments(p.oid) AS parametros
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('generar_matricula_excel','ithla_registrar_aspirante_if_open','ithla_resolver_cambio','ithla_confirmar_inscripcion');
