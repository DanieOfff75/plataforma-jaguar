# Integración de boleta oficial · Plataforma Jaguar

La generación de boletas se actualizó en `api/reports.js` para usar el diseño institucional aprobado y datos dinámicos del expediente.

## Cambios

- Fondo geométrico original, recoloreado en dorado suave con transparencia progresiva y proporción conservada: `assets/boleta-patron-geometrico.png`.
- Lema/eslogan institucional leído de la configuración (`eslogan`, `slogan`, `lema` o `lema_traduccion`).
- Taller del alumno leído desde `inscripciones_talleres`; aparece como dato informativo y no como asignatura evaluada.
- Asignaturas y periodos se construyen desde las calificaciones registradas para el ciclo escolar activo.
- Departamentos activos y responsables se obtienen de `departamentos` y `responsables_departamento`, con compatibilidad para roles institucionales existentes.
- Se conserva espacio de firma física para madre/padre/tutor y para responsables o docentes sin firma digital registrada.
- Las firmas docentes se distribuyen en páginas adicionales si hacen falta; los departamentos adicionales también reciben páginas propias.
- Se conservan folio verificable y QR.
- Los fondos de las celdas de tabla usan opacidad para permitir que el patrón se transparente sutilmente por debajo.

## Archivos modificados

- `api/reports.js`
- `assets/boleta-patron-geometrico.png` (nuevo recurso local derivado del patrón proporcionado para la boleta)

No se agregaron tablas ni migraciones de base de datos. La boleta utiliza las tablas existentes de institución, alumnos, grupos, calificaciones, periodos, talleres, departamentos, responsables y perfiles.

## Verificación

Se comprobó la sintaxis de `api/reports.js` con `node --check`. La generación final del PDF debe validarse en el entorno conectado a Supabase con un alumno de prueba que tenga materias, taller, responsables y docentes con/sin firma registrada.
