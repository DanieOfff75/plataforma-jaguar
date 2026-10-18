-- Comprobación V6.0.2 de sólo lectura, sin revelar usuarios ni datos escolares.
SELECT
  to_regclass('public.ithla_config') IS NOT NULL AS configuracion_existe,
  to_regclass('public.ithla_auditoria') IS NOT NULL AS auditoria_existe,
  to_regclass('public.ithla_cambios') IS NOT NULL AS propuestas_existen,
  to_regprocedure('public.ithla_publicar_contenido_director(text,jsonb,integer,text,uuid)') IS NOT NULL AS publicar_contenido_instalado,
  to_regprocedure('public.ithla_direccion_cambiar_convocatoria(text,text,uuid)') IS NOT NULL AS controlar_convocatoria_instalado;
-- Sólo estados, sin nombres ni correos.
SELECT clave, revision, actualizado_en FROM public.ithla_config
WHERE clave IN ('institucion','portal','nexo','admisiones','sesiones')
ORDER BY clave;
SELECT rol, COUNT(*) AS perfiles_activos
FROM public.perfiles
WHERE rol='direccion_escolar' AND activo IS TRUE
GROUP BY rol;
