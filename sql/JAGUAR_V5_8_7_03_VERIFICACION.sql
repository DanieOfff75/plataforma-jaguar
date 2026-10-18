-- V5.8.7 / Paso 03. Verificación final SOLO LECTURA + recarga de caché.
NOTIFY pgrst, 'reload schema';
SELECT to_regclass('public.jaguar_classroom_alumnos') IS NOT NULL AS alumnos,
       to_regclass('public.jaguar_classroom_trabajos_tipo') IS NOT NULL AS clasificacion,
       to_regclass('public.jaguar_classroom_importaciones') IS NOT NULL AS importaciones,
       to_regprocedure('public.jaguar_classroom_importar_rubrica(uuid,bigint,bigint,text,bigint,jsonb,jsonb)') IS NOT NULL AS rpc_importacion;
-- Consulta 00 nuevamente: todas las columnas, RLS y permisos deben estar correctos.
