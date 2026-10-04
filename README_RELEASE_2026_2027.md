# JAGUAR / ITHLA 2026-2027 — Release depurada

## Runtime

- `index.html` — aplicación principal.
- `verificar.html` — verificación de documentos.
- `api/` — 11 funciones serverless. No aumentar este número sin revisar el límite de Vercel Hobby.
- `lib/` — utilidades compartidas.
- `assets/` — recursos estáticos.
- `package.json` — dependencias.

## Organización

- `sql/` contiene únicamente SQL ejecutable de la release.
- `docs/` conserva notas y SQL históricos.
- `tools/` contiene utilidades de desarrollo.

## SQL

El archivo autoritativo es `sql/ITHLA_DB_COMPLETO_2026_2027.sql`.
No usar los archivos históricos como instalador acumulativo.

## Excel

La aplicación genera el flujo de tres hojas:

1. `ASISTENCIAS`
2. `ACTIVIDADES`
3. `VALORES PONDERACION`

Además utiliza la hoja técnica `ITHLA_META` para identificar versión, grupo, periodo y componentes. Se corrigió el desfase de columnas de importación para que la primera actividad/componente no se pierda.

## Vercel

La carpeta `api/` contiene 11 funciones `.js`, por debajo del límite de 12 funciones del plan Hobby mencionado durante el proyecto. No separar cada operación en un archivo independiente.
