# Jaguar · Unificación de calificaciones, precisión y oficios

**Entrega de cambios sobre** `plataforma-jaguar-main (17)(2).zip` (12 de noviembre de 2026). **Incluye lo entregado previamente y todas las modificaciones de esta ampliación.** No hace falta instalar el ZIP anterior.

## Decisiones implementadas

1. **Bitácora docente como fuente única de Excel.** La plantilla de evaluación duplicada dejó de ofrecerse. Se conserva la importación con selección de hoja, rango, matrícula y columnas; se muestra un comparativo antes de sustituir notas. No se borran calificaciones históricas.
2. **Estructura del Excel original.** Se mantienen `ASISTENCIAS`, `ACTIVIDADES`, `VALORES PONDERACION` y `JAGUAR_META`. El PDF de respaldo contiene las tres secciones visibles, en el mismo orden, con nombres y matrículas, fechas de asistencia, nombre/clave/fecha de actividades, porcentajes/ID de cada aspecto y valor total; pagina los bloques si no caben. No se imprime la hoja técnica oculta `JAGUAR_META`.
3. **Corrección de la doble ponderación.** Una aportación que ya vale 5.60 puntos no se multiplica de nuevo por 70 %. En el Excel proporcionado, 5.60 + 0.90 + 1.125 = **7.625** de valor bruto; el Excel visualiza **8** porque la celda está formateada sin decimales. El PDF de la bitácora seguirá el mismo criterio: **8** predeterminado o **7.6** si el periodo de captura se configuró con una cifra decimal. Los componentes se muestran con 2 decimales, pero su precisión subyacente se conserva.
4. **Un criterio por ciclo académico**, en la pantalla que ya administra ciclos y periodos. `Sin decimales` por defecto; `Con un decimal` opcional. El número, orden, inicio y fin de los periodos se siguen gestionando desde los controles existentes. Sin crear otro calendario.
5. **Redondeo tipo Excel:** `9.4 → 9`, `9.5 → 10`. Al activar decimal: `9.44 → 9.4`, `9.45 → 9.5`. Se redondea el **total oficial final**, no cada elemento de rúbrica. Se preservan aportes e importaciones originales y no se recalculan las notas históricas ya cerradas.
6. **Oficio circular automático al cambiar el criterio**, también si se vuelve al modo anterior. Control Escolar debe indicar motivo (15 a 300 caracteres) y confirmar. Una transacción de Supabase actualiza la regla, genera registro histórico inmutable de oficio y entrega una **notificación interna con enlace al PDF a cada perfil activo de personal** (no a alumnos, aspirantes, padres ni tutores). El PDF se crea al descargarlo y usa las utilidades de membrete, tipografía, firma y pie existentes, sobre el diseño del oficio de ejemplo; no inventa firma, no sustituye boleta oficial ni envía correo electrónico o SMS.
7. **Señalización en el respaldo.** Las nuevas bitácoras guardan el criterio de precisión del momento de su respaldo, para que una descarga histórica no altere la presentación anterior. Las notas oficiales nuevas también se normalizan desde un trigger de base de datos, incluso cuando proceden de una ruta administrativa previa.

## Instalación obligatoria (en este orden)

1. **Crear una rama de respaldo** del repositorio y realizar un respaldo de Supabase antes de cualquier cambio. No instalar directamente sobre producción sin verificar la vista previa.
2. En Supabase, ejecutar íntegro el archivo `sql/ITHLA_CALIFICACIONES_PRECISION_Y_OFICIOS_2026.sql` **una sola vez** desde SQL Editor. Crea las tablas de política y registro de oficios, la función transaccional y el trigger de normalización. No cambia las calificaciones que ya existen.
3. Copiar al repositorio los archivos incluidos en este ZIP, respetando las rutas de carpetas. **No borrar todo el directorio ni reemplazar otros módulos.** Subir a una rama de prueba y desplegar una Preview de Vercel.
4. Entrar con un perfil de **Control Escolar** y abrir Configuración → Ciclo y periodos → Precisión de calificaciones. Debe aparecer `Sin decimales` con versión 0 y el listado de periodos con sus fechas habituales.
5. Crear (o seleccionar) una bitácora de prueba de un grupo ficticio, descargar el Excel, revisar la hoja `VALORES PONDERACION` y descargar el PDF administrativo. Comparar el **valor total** de cada alumno con la cifra visual del Excel, no únicamente con su valor numérico interno. Confirmar que no reaparece el valor 4.2 para el ejemplo de 7.625.
6. En Preview, seleccionar `Con un decimal`, escribir un motivo y confirmar **solo con datos y personal de prueba**: verificar el folio, oficio PDF, fecha, motivo, actor y notificación por cada miembro activo. Comprobar que cuentas de alumnos no reciben ese aviso.
7. Abrir/cerrar un periodo **de prueba** y confirmar la nota oficial `9.45 → 9.5` en modo decimal. Después cambiar con nuevo oficio a enteros y comprobar `9.5 → 10`, `9.4 → 9`. No usar expedientes reales sin autorización.
8. Comprobar que las bitácoras históricas mantienen sus respaldos, que la importación XLSX valida hoja/filas/columnas y que siguen disponibles los oficios institucionales existentes de revisión docente.

## Precauciones

- **No se ejecutó el SQL ni se enviaron avisos reales.** La función enviará los avisos únicamente cuando una persona autorizada cambie el criterio en el sistema desplegado.
- **La notificación es interna de Plataforma Jaguar, no un mensaje de correo ni SMS.** El PDF circular se genera al descargarlo y se basa en datos históricos del folio.
- **Sin conectividad a Supabase no pueden darse por comprobados** la ejecución de la migración, los permisos, el envío a perfiles reales ni las escrituras oficiales; deben validarse en Preview.
- **El entorno de pruebas no tiene `pdf-lib` instalado** y no pudo renderizar visualmente el PDF generado por Node. La fórmula y la estructura están verificadas por pruebas estáticas/unitarias, no por una comparación pixel a pixel del PDF emitido por Vercel.
- Las notas de periodos ya cerrados **no se actualizan retroactivamente**. Cambiar el criterio exige nuevo oficio; no se modifica el valor bruto de la Bitácora diaria.
- Para mantener el formato en PDF se distribuyen los bloques que no caben por ancho o por alto, sin eliminar actividades ni alumnos. La maquetación del PDF no es una captura idéntica de Excel, pero conserva sus columnas, encabezados y metadatos académicos relevantes.

## Pruebas ejecutadas

- `node --test tests/jaguar_calificaciones_unificadas.test.mjs tests/jaguar_excel_pdf_reparacion.test.mjs tests/jaguar_precision_comunicado.test.mjs` → **20 aprobadas / 20**.
- `node --check` sobre los archivos JavaScript cambiados y scripts inline → sin errores de sintaxis.
- Batería general `node --test tests/*.test.mjs` → **152 aprobadas, 2 fallos heredados y 1 omitida**. Se repitieron esos dos archivos sobre el ZIP original y **los mismos 2 fallos ya existían**: (1) prueba antigua exige bloquear respaldo diario sin periodo de evaluación, decisión incompatible con respaldo diario; (2) prueba antigua exige contraseña mínima de 12 caracteres, mientras Jaguar ya acepta 8. No se alteraron los módulos de recuperación ni se cambió la política de contraseñas.

## Archivos incluidos

Paquete **SOLO CAMBIOS** contra el ZIP `(17)(2)`: `sistema.html`, `api/data.js`, `api/reports.js`, `lib/gradebook_weighting.js`, `lib/grade_precision.js`, `lib/jaguar_gradebook_pdf.js`, `lib/grade_policy_office_pdf.js`, `sql/ITHLA_CALIFICACIONES_PRECISION_Y_OFICIOS_2026.sql`, los tres archivos de pruebas y dos guías.
