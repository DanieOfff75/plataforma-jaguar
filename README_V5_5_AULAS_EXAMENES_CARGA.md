# Jaguar V5.5 — Aulas, exámenes y carga masiva de calificaciones

Esta versión **parte de V5.4**, conserva las boletas, el sello, las credenciales, el horario de grupo/docente, documentos, panel Premium, modo oscuro, planeaciones, rúbricas y carga docente. Añade tres módulos independientes en el menú. No requiere licencias ni servicios de pago. **No se ha desplegado en Vercel ni se ha ejecutado contra una base Supabase real.**

## Orden de instalación obligatorio

1. Crea una **rama de pruebas** y un respaldo de Supabase (especialmente `calificaciones`, `horarios` y las tablas de rúbricas). **No sustituyas todavía la plataforma pública.**
2. Si V5.4 no está instalada en Supabase, aplica primero `sql/JAGUAR_V5_4_PLANEACIONES_DICTAMENES.sql` y comprueba el flujo de dictámenes.
3. En el editor SQL del proyecto de **pruebas** ejecuta `sql/JAGUAR_V5_5_AULAS_EXAMENES_CALIFICACIONES.sql` **una sola vez**. Verifica que las cuatro tablas y las dos funciones RPC se creen sin errores.
4. Instala las dependencias en tu CI/Vercel usando `npm install` (o `npm ci` si generas y confirmas un lockfile). La exportación Word requiere la dependencia gratuita `docx` agregada a `package.json`; PDF utiliza `pdf-lib`.
5. Publica esta rama como preview de Vercel. La API nueva se encuentra en `/api/academic-tools`. Debe devolver 401/403 sin usuario autorizado, nunca una tabla privada.
6. Ejecuta las pruebas con **cuentas ficticias** y verifica cada módulo antes de aplicar cambios a alumnos reales.

### Aulas y prevención de choques

- **Coordinación Académica y Dirección Escolar** pueden crear aulas, definir aforo y asignarlas a bloques de horarios de grupo existentes. **Control Escolar y Servicios Docentes** pueden consultarlas.
- La reserva usa el ciclo, día, hora inicio/fin y el valor `horarios.aula` que ya aprovechan el PDF y las vistas. La comprobación se realiza **en la función SQL y el trigger**, no sólo en el navegador.
- La función toma un bloqueo transaccional por aula para evitar dos reservas simultáneas. Comprueba **intersecciones parciales** y **aforo con alumnos activos del grupo**. La validación del trigger también opera si otro módulo modifica `horarios.aula` directamente.
- No se permite desactivar, renombrar o reducir la capacidad de una sala con horarios incompatibles sin reasignar previamente las clases.
- Prueba: reservar `SALÓN A-101` de 07:00 a 08:00 para 1A; intentar reservarlo de 07:30 a 08:30 a otro grupo el mismo día (debe rechazar); reservar de 08:00 a 09:00 (debe permitir). Prueba un grupo de 31 alumnos en sala de 30 (debe rechazar).
- Nota: la migración no cambia reservas históricas; consulta posibles colisiones antiguas antes de imponer nuevas reservas.

### Banco de reactivos y exámenes

- **Docentes** ven únicamente sus asignaciones activas del ciclo; guardan preguntas propias por asignatura (opción múltiple, verdadero/falso y respuesta abierta). No se exponen respuestas correctas a estudiantes.
- Seleccionan 1–60 preguntas y guardan una **instantánea** del examen para evitar que editar después el banco cambie versiones ya emitidas.
- El exportador permite descargar **PDF**, **DOCX de Word** y **Google Apps Script** (`.gs`). El PDF/Word deja espacio para contestar y no imprime la clave de respuestas.
- Para generar Google Forms **gratis**, entra a `script.google.com` con una cuenta Google autorizada, pega el archivo `.gs` y ejecuta `crearExamenJaguar`. Google pedirá autorización y mostrará los enlaces de edición y publicación. **No se crea automáticamente un formulario dentro de Jaguar, ni se conectan cuentas Google todavía.** Las preguntas abiertas necesitan corrección manual en Forms.
- Prueba un reactivo con acentos y una opción múltiple de 4 alternativas; verifica preguntas, impresión, respuestas abiertas y enlace de Forms con una cuenta de prueba.

### Carga masiva institucional de notas

- Sólo **Control Escolar / Dirección**. Es **independiente** de la carga de bitácora Excel y del cierre de rúbricas docentes.
- Selecciona grupo-materia y periodo del ciclo actual, descarga un Excel con las matrículas del grupo y llena columnas `MATRICULA`, `CALIFICACION`, `OBSERVACIONES`.
- Al subir un XLSX/CSV: revisa filas editables, detecta duplicados, notas fuera de 0–10, matriculas ajenas, periodos cerrados y calificaciones existentes. Admite **máximo 250 notas por lote**.
- Las notas provenientes de rúbricas/cierres **nunca pueden sobrescribirse desde esta herramienta**. Las notas previas manuales sólo pueden corregirse con autorización explícita y motivo de 20 caracteres.
- La vista previa se firma con un HMAC del servidor y se vuelve a validar antes de confirmar. La función SQL aplica **todo el lote en una transacción**, usando bloqueo y un identificador de operación. La auditoría almacena valores antes/después.
- Prueba 3 matrículas válidas y una de otro grupo (debe bloquear todo el lote); nota 10, 0, nota vacía; una nota manual previa; una nota de rúbrica cerrada; dos envíos simultáneos. Comprueba que ningún error cause guardado parcial.
- Los periodos concluidos o inactivos están bloqueados; las rectificaciones históricas deben seguir el procedimiento escolar autorizado.

## Pruebas locales disponibles

```bash
node tools/test_v55_academic_tools.mjs
node tools/test_v54_planeaciones_calificaciones.mjs
node tools/test_v54_execution.mjs
node tools/test_horarios_v52.mjs
node tools/test_redesign.cjs
node tools/test_v6_periodos.mjs
node --check api/academic-tools.js
node --check assets/jaguar-academico-v55.js
```

**Limitación comprobada del entorno de preparación:** npm no respondió (`EAI_AGAIN`), por eso las exportaciones DOCX/PDF y los RPC no se pudieron ejecutar aquí con dependencias y credenciales reales. Las pruebas estáticas/puras no equivalen a pruebas end-to-end. Es indispensable realizar ese recorrido en el preview de Vercel y la base de pruebas antes de producir calificaciones oficiales.

## Archivos principales añadidos

- `api/academic-tools.js`: API autenticada para aulas, reactivos, exámenes y notas.
- `assets/jaguar-academico-v55.js`: interfaz integrada con los roles existentes.
- `lib/academic_tools_rules.js`: reglas de negocio puras.
- `lib/jaguar_examen_export.js`: PDF, Word y script para Google Forms.
- `sql/JAGUAR_V5_5_AULAS_EXAMENES_CALIFICACIONES.sql`: tablas, trigger de aforo/horario y RPC transaccionales.
- `tools/test_v55_academic_tools.mjs`: pruebas locales del módulo.

**No se programó Google Classroom**: quedó pendiente de que compartas los ejemplos de códigos/plantillas, como habías pedido.
