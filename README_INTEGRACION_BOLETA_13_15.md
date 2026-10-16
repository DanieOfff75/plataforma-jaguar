# Integración de la boleta Jaguar — Propuesta visual 13 / HTML 15

## Qué se cambió

- `api/reports.js` sigue consultando Supabase, respetando los roles, permisos, ciclo escolar activo, calificaciones, asistencia, taller, docentes y responsables; conserva el registro del folio de verificación y el QR.
- La **única** ruta de salida de `student_boleta` y `student_boleta_admin` ahora compone el PDF con `renderBoletaVisual15()` en `lib/boleta_visual15.js`. La generación se realiza con `pdf-lib` y no requiere Chromium, Puppeteer ni servicios externos en Vercel.
- El PDF tiene como base **variantes preimpresas directamente del HTML de la propuesta**, por lo que se conservan los mismos encabezados, patrones, líneas, tablas, títulos, tamaños y espacios para firmas. Se superponen exclusivamente los datos variables, los QR de validación y las firmas digitales disponibles.
- Se mantiene el archivo original `assets/Boleta-Jaguar-Propuesta-Visual-15.html` como referencia **sin tocarlo**.

## Archivos nuevos

| Archivo | Propósito |
| --- | --- |
| `assets/boleta-visual15-base.pdf` | 27 variantes (0-10 materias, 1-10 docentes, 1-6 departamentos) impresas desde el HTML aprobado; sin datos ficticios y con un espacio dedicado al sello SETECFI de la página 1. |
| `assets/boleta-visual15-campos.json` | Coordenadas y estilos por variante (sin espacios vacíos) obtenidos del DOM real. |
| `assets/boleta-visual15-plantilla.html` | Fuente intermedia sin datos ficticios, con el CSS exacto y campos reemplazables. |
| `lib/boleta_visual15.js` | Compone automáticamente la boleta con datos, validación y firmas. |
| `tools/build_boleta_templates.py` | Regenera las plantillas después de cambios deliberados al HTML aprobado (solo desarrollo, requiere Python, BeautifulSoup, Playwright y Chromium). |

## Qué es dinámico

- Institución, lema, ciclo, alumno, matrícula, grado, grupo, turno, plantel, taller y su condición formativa.
- Hasta diez asignaturas por boleta, con hasta tres periodos, notas y promedios, resultado académico, faltas y observaciones.
- Folio de control real y QR de validación creado por el mismo servicio usado anteriormente.
- Docentes vinculados con asignaturas reales del grupo: de una a diez filas por hoja, sin docentes de recuperación ajenos al horario. Cuando no existe horario de una asignatura se consulta el docente que calificó en el mismo grupo. No se agrega la fila «Asignatura asignada». Se crean páginas adicionales si hay más de diez docentes. Si no existe firma digital legible, se deja espacio para firma manuscrita.
- Departamentos reales activos y responsables: sólo los bloques existentes, hasta seis por hoja; nunca se imprimen recuadros de departamentos ficticios. Se crean páginas adicionales si hay más de seis. Firma de la dirección y responsables departamentales cuando haya datos.
- Numeración de todas las páginas, incluyendo las adicionales, y nombre del PDF institucional. El escudo ITHLA del proyecto sustituye la «J» en todas las hojas; no se utiliza un logo nuevo. Se quitó Subdirección de la segunda hoja y la firma de Dirección está centrada. Firmas digitales moderadamente ampliadas y folio completo con ajuste automático de tamaño.

## Reglas de exactitud y límites

- La referencia HTML original se conserva sin cambios. La maqueta tenía datos ficticios, referencia a una "Propuesta de diseño" y textos relacionados con sellos. Esos textos no se trasladan al documento generado. **Excepción solicitada posteriormente:** la primera página incorpora el sello institucional S.E.T.E.C.F.I. en lugar de la firma de Dirección; la segunda hoja sigue mostrando la firma de Dirección.
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

## Ajustes solicitados sobre el PDF ITHLA de 4 páginas

- Tabla principal de 9 materias: no hay décima fila fantasma. Tabla de docentes de 8 o 9 responsables: sólo hay filas reales. Última hoja con dos departamentos: no se conservan cuatro bloques vacíos.
- Se toma el docente titular del horario para cada asignatura. Una calificación de recursamiento se conserva en el alumno, pero la firma de quien sólo evaluó la recuperación no reemplaza a la del docente asignado al grupo. Si faltan horarios, revisar la asignación real en Supabase.
- El folio se escribe sin puntos suspensivos usando más ancho, y cuando hace falta reduce su tamaño de manera proporcional.
- Subdirección ya no forma parte de Validación Académica. Dirección queda centrada en la segunda fila.
- La firma del alumno/tutor requiere firma autógrafa; las imágenes de firma guardadas en Supabase se muestran más grandes sin invadir los renglones.

**Pruebas realizadas:** sintaxis de `api/reports.js` y `lib/boleta_visual15.js`; 27 variantes y conteos correctos; render visual de páginas de muestra. **Pendiente:** confirmar conexión a Supabase de producción y descarga real en Vercel (no se dispuso de credenciales aquí).

## Actualización: sello S.E.T.E.C.F.I. (octubre de 2026)

- Se incorporó la imagen aportada por el usuario, no se redibujó el Escudo Nacional.
- Se extrajo el papel blanco de la imagen para generar `assets/sello-setecfi-ithla-transparente.png` con alfa real y apariencia de tinta entintada/desgastada.
- **Sólo** cambia el área de firma de Dirección de la primera hoja: se oculta su línea/rótulo y `lib/boleta_visual15.js` dibuja el sello centrado en dicho bloque, sin mover los campos de datos ni las tablas.
- La firma de Dirección de la página 2 y las firmas de responsables/departamentos siguen funcionando tal cual.
- El sello no se añade como firma digital ni altera la verificación QR o folio.
- `tools/build_boleta_templates.py` conserva el espacio de sello si es necesario recompilar plantillas. Las 27 variantes conservan las mismas coordenadas JSON de campos.
- Esta versión incluye revisión por comparación pixel a pixel de plantillas; sin acceso a producción no se verificó la descarga desde Supabase/Vercel.
