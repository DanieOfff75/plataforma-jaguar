# Boleta Jaguar — integración de Propuesta Visual 15

La generación PDF de la boleta está implementada en `api/reports.js` con una composición editorial basada en la Propuesta Visual 15: escudo J dorado, encabezado institucional, patrón geométrico suave extraído del HTML aprobado, campos del alumno en líneas, tabla de evaluación de baja opacidad, resumen general, observaciones y bloques amplios de firma.

## Datos dinámicos
- Institución, lema, ciclo, alumno, matrícula, grupo, grado y turno.
- Periodos y calificaciones reales; materias Artes y Lengua Indígena se excluyen según las reglas acordadas.
- Taller informativo sin nota numérica.
- Folio y QR de validación generados por Jaguar.
- Docentes y responsables departamentales consultados desde los datos reales; si no hay firma digital legible, se conserva espacio de firma manuscrita.
- Las páginas complementarias crecen según el número de docentes y departamentos.

El HTML aprobado se conserva en `assets/Boleta-Jaguar-Propuesta-Visual-15.html` como referencia visual, y su patrón exacto está en `assets/boleta-propuesta15-pattern.png`.

## Validación
`node --check api/reports.js` debe pasar. La generación integral requiere probar el endpoint en el entorno con variables de entorno y Supabase configurados; no se afirma una validación contra la base de datos de producción desde este paquete.
