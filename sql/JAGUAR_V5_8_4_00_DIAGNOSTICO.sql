-- Solo lectura. No ejecuta cambios.
SELECT to_regclass('public.jaguar_cargas_grupo') AS cabecera,
       to_regclass('public.jaguar_cargas_materias') AS materias,
       to_regclass('public.grupo_materias') AS grupos_materias,
       to_regclass('public.calificaciones') AS calificaciones;
