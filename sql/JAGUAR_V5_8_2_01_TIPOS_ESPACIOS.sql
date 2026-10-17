-- JAGUAR V5.8.2 | SOLO clasifica espacios ya registrados. NO asigna salones.
-- Ejecutar como una consulta SQL completa en Supabase. Requiere public.jaguar_aulas.
-- El estado "activo" continúa siendo independiente del tipo de espacio.

ALTER TABLE public.jaguar_aulas
    ADD COLUMN IF NOT EXISTS tipo_espacio text;

-- Clasificación inicial conservadora: nombres AULA son aulas ordinarias.
-- Todo espacio ambiguo queda como "otro" y NO puede asignarse hasta revisarlo.
-- No modifica clasificaciones previas elegidas manualmente.
UPDATE public.jaguar_aulas
SET tipo_espacio = CASE
    WHEN upper(btrim(nombre)) LIKE 'LAB%' OR upper(btrim(nombre)) LIKE '%LABORATORIO%'
      THEN 'laboratorio'
    WHEN upper(btrim(nombre)) LIKE '%AUDITORIO%'
      THEN 'auditorio'
    WHEN upper(btrim(nombre)) LIKE '%OFICINA%'
      OR upper(btrim(nombre)) LIKE '%ADMINISTRACION%'
      OR upper(btrim(nombre)) LIKE '%ADMINISTRACIÓN%'
      OR upper(btrim(nombre)) LIKE '%DIRECCION%'
      OR upper(btrim(nombre)) LIKE '%DIRECCIÓN%'
      OR upper(btrim(nombre)) LIKE '%SECRETARIA%'
      OR upper(btrim(nombre)) LIKE '%SECRETARÍA%'
      THEN 'oficina'
    WHEN upper(btrim(nombre)) ~ '^AULA([[:space:]]|[-_]|[0-9]|$)'
      THEN 'aula'
    ELSE 'otro'
END
WHERE tipo_espacio IS NULL;

ALTER TABLE public.jaguar_aulas
    ALTER COLUMN tipo_espacio SET DEFAULT 'otro';
ALTER TABLE public.jaguar_aulas
    ALTER COLUMN tipo_espacio SET NOT NULL;
ALTER TABLE public.jaguar_aulas
    DROP CONSTRAINT IF EXISTS jaguar_aulas_tipo_espacio_chk;
ALTER TABLE public.jaguar_aulas
    ADD CONSTRAINT jaguar_aulas_tipo_espacio_chk
    CHECK (tipo_espacio IN ('aula','laboratorio','auditorio','oficina','otro'));

-- Nunca permitir que un espacio identificable por nombre como especial sea etiquetado aula.
ALTER TABLE public.jaguar_aulas
    DROP CONSTRAINT IF EXISTS jaguar_aulas_no_especial_como_aula_chk;
ALTER TABLE public.jaguar_aulas
    ADD CONSTRAINT jaguar_aulas_no_especial_como_aula_chk
    CHECK (tipo_espacio <> 'aula' OR upper(btrim(nombre)) !~
           '(LABORATORIO|^LAB([[:space:]_-]|$)|AUDITORIO|OFICINA|ADMINISTRACI|DIRECCI|SECRETAR)');

-- Vista segura: verifica la clasificación (no cambia aulas ni horarios).
SELECT codigo, nombre, tipo_espacio, activo,
       (activo AND tipo_espacio='aula') AS asignable_grupo
FROM public.jaguar_aulas ORDER BY codigo;
