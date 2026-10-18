-- SOLO LECTURA. Ejecutar DESPUÉS de aplicar las migraciones; antes usa PRECHECK.
SELECT x.objeto, to_regclass('public.'||x.objeto) IS NOT NULL AS existe
FROM (VALUES ('ithla_config'),('ithla_centro_operadores'),('ithla_cambios'),('ithla_auditoria'),('ithla_sesiones'),('ithla_inscripciones_pendientes'),('aspirantes'),('perfiles')) AS x(objeto);
SELECT 'ithla_registrar_aspirante_if_open' AS funcion, to_regprocedure('public.ithla_registrar_aspirante_if_open(jsonb)') IS NOT NULL AS existe;
SELECT clave,revision,actualizado_en FROM public.ithla_config ORDER BY clave;
-- Agregar administrador técnico MANUALMENTE, sólo después de crear una cuenta Auth:
-- INSERT INTO public.ithla_centro_operadores(usuario_id,rol) VALUES ('UUID_DE_LA_CUENTA'::uuid,'tecnico') ON CONFLICT(usuario_id) DO UPDATE SET activo=true;
