# Plataforma Jaguar · ITHLA · Release 2026-2027

## Estructura
- `index.html`, `verificar.html`: runtime web.
- `api/`: endpoints Vercel. Hay 11 archivos `.js` en `api/`, por debajo del límite de 12 funciones del plan Vercel Hobby.
- `lib/`: utilidades compartidas del backend.
- `assets/`: recursos institucionales.
- `sql/ITHLA_DB_COMPLETO_2026_2027.sql`: instalador/consolidador principal.
- `sql/VERIFICAR_SALUD_DB_ITHLA_2026_2027.sql`: diagnóstico de esquema; no modifica datos.
- `docs/`: notas y documentación.
- `docs/sql_historico/`: SQL históricos; NO se deben ejecutar como lote adicional después del maestro.
- `docs/patches/`: parches generados durante esta depuración.

## Orden de instalación
1. Hacer respaldo de Supabase.
2. Ejecutar `sql/VERIFICAR_SALUD_DB_ITHLA_2026_2027.sql` para inspección.
3. Ejecutar `sql/ITHLA_DB_COMPLETO_2026_2027.sql` como instalador principal.
4. No ejecutar los SQL de `docs/sql_historico/` encima del maestro.
5. Desplegar los archivos del runtime.

## Compatibilidad de expedientes
El instalador garantiza `expedientes_documentales.creado_at` antes de crear índices. Si una instalación anterior tiene `created_at`, conserva esa columna y copia sus valores a `creado_at`; no renombra ni elimina datos históricos.

## Vercel Hobby
El directorio `api/` contiene 11 funciones serverless. No crear un archivo nuevo por cada operación: agregar endpoints puede superar el límite de 12. Mantener la agrupación por dominio actual.

## Importante
El SQL es idempotente en los objetos que administra, pero la compatibilidad de una base antigua depende de su esquema real. Si el diagnóstico muestra columnas/funciones incompatibles, corregir el maestro, no volver a ejecutar los SQL históricos uno por uno.
