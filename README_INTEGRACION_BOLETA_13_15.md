# Integración de la boleta Jaguar — Propuesta visual 13 / HTML 15

## Qué se cambió

- `api/reports.js` sigue consultando Supabase, respetando los roles, permisos, ciclo escolar activo, calificaciones, asistencia, taller, docentes y responsables; conserva el registro del folio de verificación y el QR.
- La **única** ruta de salida de `student_boleta` y `student_boleta_admin` ahora compone el PDF con `renderBoletaVisual15()` en `lib/boleta_visual15.js`. La generación se realiza con `pdf-lib` y no requiere Chromium, Puppeteer ni servicios externos en Vercel.
- El PDF tiene como base **páginas impresas directamente del HTML de la propuesta**, por lo que se conservan los mismos encabezados, patrones, líneas, tablas, títulos, tamaños y espacios para firmas. Se superponen exclusivamente los datos variables, los QR de validación y las firmas digitales disponibles.
- Se mantiene el archivo original `assets/Boleta-Jaguar-Propuesta-Visual-15.html` como referencia **sin tocarlo**.

## Archivos nuevos

| Archivo | Propósito |
| --- | --- |
| `assets/boleta-visual15-base.pdf` | Fondo de tres páginas impreso desde el HTML aprobado; la maqueta no contiene datos ficticios ni sellos. |
| `assets/boleta-visual15-campos.json` | Coordenadas y estilos de todos los campos dinámicos, obtenidos del DOM real de la maqueta. |
| `assets/boleta-visual15-plantilla.html` | Fuente intermedia sin datos ficticios, con el CSS exacto y campos reemplazables. |
| `lib/boleta_visual15.js` | Compone automáticamente la boleta con datos, validación y firmas. |
| `tools/build_boleta_templates.py` | Regenera las plantillas después de cambios deliberados al HTML aprobado (solo desarrollo, requiere Python, BeautifulSoup, Playwright y Chromium). |

## Qué es dinámico

- Institución, lema, ciclo, alumno, matrícula, grado, grupo, turno, plantel, taller y su condición formativa.
- Hasta diez asignaturas por boleta, con hasta tres periodos, notas y promedios, resultado académico, faltas y observaciones.
- Folio de control real y QR de validación creado por el mismo servicio usado anteriormente.
- Docentes asignados y firmas: diez filas por hoja, con páginas adicionales cuando haya más de diez docentes. Si no existe firma digital legible, se deja espacio para firma manuscrita.
- Departamentos reales y responsables: seis por hoja, con páginas adicionales cuando se requiera. Firma de la dirección y responsables departamentales cuando haya datos.
- Numeración de todas las páginas, incluyendo las adicionales, y nombre del PDF institucional.

## Reglas de exactitud y límites

- La maqueta original tenía datos ficticios, referencia a una "Propuesta de diseño" y textos relacionados con sellos. Esos textos no se trasladan al documento generado. **No se añade sello alguno**.
- Las materias `Artes` y `Lengua indígena` no se imprimen según las reglas previas. El taller no lleva calificación.
- Para no ocultar calificaciones accidentalmente, la generación da un error explícito si existen más de diez materias o más de tres periodos: el formato original de tres columnas no tiene espacio suficiente para más. No se truncan materias ni periodos silenciosamente.
- Las firmas o datos demasiado largos se adaptan al espacio disponible con ajuste visual. Los nombres que excedan el ancho de una casilla se acortan visualmente; su nombre completo no se elimina de Supabase.
- No se ha accedido a Supabase de producción. La prueba real debe hacerse desde la plataforma con un alumno que tenga calificaciones, docentes y firmas digitales.

## Cómo validar

1. Ejecutar `npm install` y `node --check api/reports.js && node --check lib/boleta_visual15.js`.
2. Desplegar a Vercel o ejecutar la plataforma con las variables de Supabase configuradas.
3. Descargar una boleta como alumno, y otra desde Control Escolar/Dirección.
4. Comprobar el folio/QR en el verificador existente y revisar visualmente 1, 5 y 10 materias, firmas presentes/ausentes y más de seis departamentos.
5. Si se modifica deliberadamente el CSS de la propuesta, ejecutar `python tools/build_boleta_templates.py` y guardar los nuevos `pdf/json`. Para uso normal **no** debe instalarse Python/Chromium en Vercel.

**Importante:** Esta entrega incluye la integración de código y validación sintáctica y visual de las tres plantillas, pero **no** una prueba de punta a punta con la base de datos real, ni un despliegue a GitHub/Vercel.
