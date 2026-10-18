-- V5.8.7 / Paso 00. SOLO LECTURA. Ejecutar en Supabase SQL Editor.
-- No agrega, modifica ni borra calificaciones ni relaciones Google-alumno.
-- Resultado 1: presencia de tablas y permisos del servidor.
WITH nombres(tabla) AS (VALUES
 ('jaguar_classroom_alumnos'),
 ('jaguar_classroom_trabajos_tipo'),
 ('jaguar_classroom_importaciones')
)
SELECT n.tabla,
       c.oid IS NOT NULL AS existe,
       CASE WHEN c.oid IS NOT NULL THEN c.relrowsecurity ELSE NULL END AS rls_activo,
       CASE WHEN c.oid IS NOT NULL THEN has_table_privilege('service_role', c.oid, 'SELECT') ELSE false END AS service_role_lee,
       CASE WHEN c.oid IS NOT NULL THEN has_table_privilege('service_role', c.oid, 'INSERT') ELSE false END AS service_role_inserta,
       CASE WHEN c.oid IS NOT NULL THEN has_table_privilege('service_role', c.oid, 'UPDATE') ELSE false END AS service_role_actualiza
FROM nombres n
LEFT JOIN pg_namespace ns ON ns.nspname = 'public'
LEFT JOIN pg_class c ON c.relnamespace = ns.oid AND c.relname=n.tabla AND c.relkind IN ('r','p')
ORDER BY n.tabla;

-- Resultado 2: columnas necesarias. Todas deberían mostrar existe=true.
WITH columnas(tabla,columna) AS (VALUES
 ('jaguar_classroom_alumnos','id'),
 ('jaguar_classroom_alumnos','google_course_id'),
 ('jaguar_classroom_alumnos','google_user_id'),
 ('jaguar_classroom_alumnos','alumno_id'),
 ('jaguar_classroom_alumnos','ciclo_escolar'),
 ('jaguar_classroom_alumnos','actualizado_por'),
 ('jaguar_classroom_alumnos','actualizado_at'),
 ('jaguar_classroom_trabajos_tipo','id'),
 ('jaguar_classroom_trabajos_tipo','google_course_id'),
 ('jaguar_classroom_trabajos_tipo','google_work_id'),
 ('jaguar_classroom_trabajos_tipo','grupo_materia_id'),
 ('jaguar_classroom_trabajos_tipo','periodo_id'),
 ('jaguar_classroom_trabajos_tipo','tipo'),
 ('jaguar_classroom_trabajos_tipo','fuente_examen'),
 ('jaguar_classroom_trabajos_tipo','google_form_id'),
 ('jaguar_classroom_trabajos_tipo','actualizado_por'),
 ('jaguar_classroom_trabajos_tipo','actualizado_at'),
 ('jaguar_classroom_importaciones','id'),
 ('jaguar_classroom_importaciones','rubrica_id'),
 ('jaguar_classroom_importaciones','componente_id'),
 ('jaguar_classroom_importaciones','google_course_id'),
 ('jaguar_classroom_importaciones','periodo_id'),
 ('jaguar_classroom_importaciones','actor'),
 ('jaguar_classroom_importaciones','calificaciones'),
 ('jaguar_classroom_importaciones','snapshot'),
 ('jaguar_classroom_importaciones','creado_at')
)
SELECT r.tabla,r.columna,(c.column_name IS NOT NULL) AS existe
FROM columnas r
LEFT JOIN information_schema.columns c
  ON c.table_schema='public' AND c.table_name=r.tabla AND c.column_name=r.columna
ORDER BY r.tabla,r.columna;

-- Resultado 3: la función se comprueba sin ejecutarla ni modificar notas.
WITH objetivo AS (
 SELECT to_regprocedure('public.jaguar_classroom_importar_rubrica(uuid,bigint,bigint,text,bigint,jsonb,jsonb)') AS firma
)
SELECT firma IS NOT NULL AS rpc_existe,
       CASE WHEN firma IS NOT NULL THEN pg_get_function_identity_arguments(firma::oid) END AS parametros_reales,
       CASE WHEN firma IS NOT NULL THEN has_function_privilege('service_role',firma::oid,'EXECUTE') ELSE false END AS service_role_puede_ejecutar
FROM objetivo;
