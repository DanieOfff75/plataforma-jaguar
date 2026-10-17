-- Solo lectura. Esperado: ambas tablas y las dos funciones instaladas.
SELECT to_regclass('public.jaguar_cargas_grupo') IS NOT NULL AS cabecera_ok,
       to_regclass('public.jaguar_cargas_materias') IS NOT NULL AS materias_ok,
       to_regprocedure('public.jaguar_crear_carga_grupo(uuid,uuid,bigint,bigint,jsonb)') IS NOT NULL AS crear_ok,
       to_regprocedure('public.jaguar_aceptar_carga_materia(uuid,bigint,jsonb)') IS NOT NULL AS aceptar_ok;
