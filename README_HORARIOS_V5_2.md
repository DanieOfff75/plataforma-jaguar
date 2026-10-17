# Jaguar V5.2 — Horarios institucionales

**Base:** Plataforma Jaguar V5.1 (periodos escolares + verificación PDF).

## Qué se modificó

- `api/reports.js`: nuevo diseño PDF A4 horizontal para horario de **grupo**, **alumno** y **docente**; portada con escudo ITHLA, encabezado institucional, títulos tipo Times New Roman, datos y tablas Garet, folio, firmas, QR.
- **Alumnos / grupos**: colores oficiales **configurados por los docentes** en `docente_materia_colores` y vinculados a materias activas. Franjas cromáticas sobre fondo tenue para impresión legible; sin colores improvisados.
- **Docentes**: diseño dorado institucional uniforme, con independencia de la paleta que hayan configurado para sus asignaturas. Esto no altera la configuración de colores individual.
- Consultas de horarios de alumnos/grupos incluyen ahora `grupo_materias.materia_id` (antes faltaba y no se resolvía el color).
- Intervalos extraordinarios: se muestran los horarios reales aunque no coincidan con los bloques predeterminados del turno.
- Materias adicionales, intervalos extensos, coincidencias y más firmas: páginas de continuación cuando son necesarias. No se omiten materias ni se recortan clases a propósito.
- `api/data.js`: el alumno recibe `subject_color` en el `studentOverview` usando su propio grupo. Fallos del catálogo de colores no bloquean la consulta académica.
- `index.html`: horario docente con dorado uniforme; horario alumno con franja de color oficial por materia.

## Qué NO se modificó

- Las rutas y nombres de acciones de descarga PDF, las verificaciones de permisos y las consultas de calificaciones.
- Boletas, credenciales, sellos, plataforma premium, modo oscuro, firmas almacenadas, folios y QR de validez.
- Esquema de Supabase: **sin migraciones**.

## Instalación

El ZIP es un proyecto completo. Primero despliega a una rama o entorno de prueba. Para dependencias:

```bash
npm install
```

La plataforma ya incluye Garet-Book.ttf y Garet-Heavy.ttf en `assets/fonts`. La generación PDF utiliza `pdf-lib` y `@pdf-lib/fontkit` del `package.json` existente.

## Pruebas incluidas

```bash
node tools/test_horarios_v52.mjs
node --check api/reports.js
node --check api/data.js
```

Las vistas PDF de ejemplo se prepararon con datos ficticios y son **ilustrativas**, no descargas reales del servidor. Validar en Vercel con un grupo real y un docente real: PDF de 2 páginas, colores, QR de verificación y todas las firmas existentes.

## Limitaciones

No se pudo instalar dependencias desde `registry.npmjs.org` en el entorno de desarrollo por bloqueo DNS. Por ello no se completó una generación real con `pdf-lib` ni las consultas a Supabase. Las pruebas estáticas no sustituyen a un despliegue de ensayo.
