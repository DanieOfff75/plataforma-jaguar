# Plataforma Jaguar · Suite Documental V4

Esta versión parte del proyecto **Jaguar Premium V3 Claro/Oscuro**. No sustituye rutas ni permisos escolares. Se actualiza el lenguaje gráfico de las salidas impresas y descargables para armonizar con la interfaz: azul marino #1B365D, turquesa #008080, dorado #B18A32, tipografía secundaria Garet en PDF/impresión y títulos serif.

## Cambios específicos

| Salida | Archivo | Cambio |
| --- | --- | --- |
| Listas completas por grupo (Control Escolar/Dirección) | `index.html` → `downloadGroupExcel`, `groupListsModule`, `downloadGroupFormalPdf` | Tarjetas de grupo con botón Excel/PDF, opción de lista formal, encabezados y tablas institucionales |
| Lista del docente, horarios Excel, evaluación por materia, carga masiva, alumnos sin cupo y bitácora diaria | `index.html` → `jaguarPolishWorkbook` | Estilo común sobre las celdas existentes, columnas legibles, encabezados, impresión y colores; no se reordenan rangos ni hojas |
| Listas PDF de impresión | `index.html` → `jaguarFormalListPdf`, `printPdf` | Encabezado institucional, identificación de grupo, paginación del navegador, filas alternadas, firmas preservadas |
| Planeaciones docentes | `index.html` → `jaguarPlanningPrint`, `jaguarPlanningPreview` | Nueva vista imprimible desde versiones guardadas y borradores, sin modificar ni convertir adjuntos cargados por el docente |
| Constancias, oficios, circulares y certificaciones | `lib/documentos_oficiales_pdf.js` | Portada formal más limpia, Garet, títulos serif, datos académicos, firmas sin distorsionar, QR y folio preservados; cuerpo largo multipágina |
| Horarios PDF del alumno, docente y grupo | `api/reports.js` → `drawJaguarScheduleChrome` | Cenefas institucionales limpias y menos adornos, sin cambiar celdas/horarios |
| Bitácora PDF | `lib/jaguar_gradebook_pdf.js` + `api/reports.js` | Corrige incrustación del logo, encabezado y paginación de fechas, actividades, alumnos y rúbricas sin recortarlos |
| Ticket de egreso imprimible | `index.html` | Maquetación de recibo más consistente con el sistema |

## Cambios deliberadamente NO realizados

- **Boletas de calificaciones:** se conserva íntegro `lib/boleta_visual15.js`, sello, estructura de 3 páginas y sus 27 variantes de diseño. No se reprocesa el folio ni el QR.
- **Adjuntos históricos DOCX/XLSX/PDF:** se guardan y descargan tal como fueron cargados; la opción “Formato PDF” genera otra **vista** desde `snapshot`, no reescribe archivos originales.
- **Formato de importación Excel:** se conservan los nombres de las hojas `ASISTENCIAS`, `ACTIVIDADES`, `VALORES PONDERACION`, y el campo/hoja `JAGUAR_META`, IDs, rúbricas y validaciones. El estilizador sólo modifica la presentación.
- **Credenciales, contraseñas, firmas digitales y permisos:** no se cambia su lógica ni se fabrican firmas.

## Integración con la V3

Aplicar los archivos nuevos **sobre la rama V3 ya existente**. No borres carpetas ni reemplacen todos los archivos desde cero. Mantén de tu versión anterior las fuentes institucionales de `assets/fonts/` (`Garet-Book.ttf`, `Garet-Heavy.ttf`), ya usadas por el sistema y por las boletas. Los ZIP de entrega no redistribuyen binarios de fuentes. La dependencia `@pdf-lib/fontkit` ya figura en `package.json`; no es necesario añadir otras dependencias.

### Verificación

- Los nombres de las 382 funciones JavaScript originales se mantienen; se añadieron cuatro nuevas funciones de interfaz.
- Todos los `.js` y los bloques JavaScript en `index.html` pasan la validación sintáctica de Node.
- Ensayo de estructura Excel sin cambios de datos, formatos numéricos, posiciones o `JAGUAR_META`.
- Vista preliminar de lista PDF con 24 registros de ejemplo: 24 aparecen en 2 páginas; planeación de ejemplo: 1 página.
- **Pendiente:** probar con cuentas y datos reales de Supabase, la impresión desde Chrome/Edge y la escritura/lectura Excel por cada rol, además del pipeline Vercel. No se publica automáticamente.

## Siguiente paso recomendado

Probar en una rama de ensayo, descargar una lista Excel de Control Escolar, volver a cargar un Excel de bitácora docente, imprimir un formato PDF de planeación y generar una constancia/oficio con folio y QR. Verificar longitudes de datos reales y firmas.
