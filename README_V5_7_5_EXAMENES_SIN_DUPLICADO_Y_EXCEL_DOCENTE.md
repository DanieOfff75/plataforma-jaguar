# Jaguar V5.7.5 — Clasificación de exámenes y Excel del primer periodo

Parche incremental de la V5.7.4. **No elimina ni recrea clases, alumnos, rúbricas ni notas.** Mantiene diez funciones `/api` para Vercel Hobby.

## Qué cambia

1. **Trabajos por periodo:** el docente asignado clasifica explícitamente cada trabajo puntuable que Google Classroom devuelve dentro del tema correspondiente: `Actividad Classroom`, `Examen` o `Excluir`. No se guarda una clasificación inferida a partir del título.
2. **Fuente del examen:** al marcar `Examen`, elige `Calificación de Classroom`, `Google Forms` o `Captura manual`. Si elige Forms, debe registrar el enlace o ID; se comprueba que no haya dos trabajos declarados como el mismo formulario en el periodo. Esto documenta la fuente y evita que el examen entre en el promedio de actividades.
3. **No doble conteo:** el servidor calcula el componente Classroom **únicamente** con trabajos clasificados `Actividad`. Los trabajos `Examen` y `Excluir` nunca cuentan en ese componente, aun si el navegador intenta incluirlos. Los trabajos `Sin clasificar` impiden importar. Un cambio de clasificación invalida la revisión previa; el docente tiene que recalcular y confirmar.
4. **Excel del primer periodo sin Classroom:** se añade acceso directo en el panel docente a **Rúbricas y Evaluaciones**, donde ya existían la plantilla Excel institucional, la captura por actividades, la vista previa y la confirmación/cierre. No hace falta crear Google Classroom ni vincular matrículas Google para registrar ese periodo.
5. Se muestran todos los periodos del ciclo en el panel de evaluaciones del docente, incluidos los inactivos. Las rúbricas **ya cerradas** siguen siendo inmodificables. Para cualquier rectificación de una calificación cerrada, contactar Control Escolar.

### Precisión sobre Forms y el componente Examen

El selector de fuente NO equivale a sincronización automática de Forms. En esta versión no se descargan respuestas de Forms ni se copian notas de exámenes de Classroom al componente `Examen`. El docente debe registrar las notas de examen mediante el apartado **Rúbricas y Evaluaciones**; el módulo Classroom sólo calcula/importa el promedio de **actividades**. La integración automática de respuestas Forms requerirá nuevos permisos y lógica de correspondencia con matrícula, y no se declara terminada.

## Instalar (orden recomendado)

1. **Respaldo:** crea un respaldo de código y base Supabase antes de modificar producción. Prueba primero en un entorno de desarrollo si dispones de él.
2. Ejecuta en Supabase → **SQL Editor** el archivo `sql/JAGUAR_V5_7_5_CLASIFICACION_EXAMENES.sql` (después de V5.7.4).
3. Sube el contenido del parche respetando su estructura a tu repositorio GitHub. Al usar un ZIP de parche, **sobrescribe sólo estos archivos existentes**, conservando todos los demás. El parche incluye archivos nuevos `lib/classroom_classification.js` y el SQL.
4. Espera el despliegue en Vercel Hobby y recarga Jaguar con `Ctrl + F5`. No hay variables nuevas ni cambios OAuth.
5. Entra con un **docente asignado** → Google Classroom → Calificaciones por periodo → Consulta. Clasifica todos los trabajos, elige la fuente para cada examen y guarda. Los exámenes Forms deben tener un ID/enlace para impedir duplicados. Verifica que los trabajos Examen/Excluir no aparezcan en la tabla de actividades y que el promedio use sólo Actividad.
6. Prueba con calificaciones ficticias antes de importar notas reales. Las matrículas deben estar vinculadas por Servicios Docentes, y el docente debe confirmar las notas; el periodo debe ser el actual, abierto y con rúbrica Classroom correctamente configurada.

## Primer periodo, cuando todavía no se usaba Classroom

Con la **cuenta Docente**, entra a Google Classroom y pulsa **Abrir Evaluaciones → Excel del primer periodo**, o desde Configuración de carga/Calificaciones → **Abrir evaluación**. Elige materia y primer periodo.

- Si todavía no existe una rúbrica para ese periodo, configúrala con las actividades de evaluación efectivamente utilizadas y ponderaciones totales de 100%; **no inventes un porcentaje de Classroom que no existió**.
- En **Actividades**, descarga la plantilla Excel. Rellena las notas reales en la hoja `VALORES PONDERACION`; no modifiques la hoja oculta `ITHLA_META` ni cambies matrículas.
- Sube el Excel, revisa la vista previa, errores y ajustes; al **Guardar y cerrar periodo** el sistema calcula el promedio ponderado, conserva evidencia y bloquea la rúbrica.
- Si ya está cerrada, no intentes volver a importarla: tramita una rectificación en Control Escolar. Las notas anteriores a Classroom no requieren crear un curso Google ni ninguna sincronización.

**Advertencia:** la importación de una rúbrica y su cierre generan calificaciones oficiales. Evita probar con alumnos reales sin confirmar que la rúbrica y la plantilla son correctas. El proceso de cierre existente de Jaguar V5.4 no se ha reescrito en esta versión.

## Código cambiado

- `routes/google-classroom.js` — clasificación persistente y verificación estricta de los trabajos en servidor, además de corregir el envío de la selección a la vista previa.
- `lib/classroom_classification.js` — validación pura de trabajos, fuente de examen y duplicados Forms.
- `lib/classroom_grades.js` — uso de la clasificación verificada durante el cálculo del componente Classroom.
- `assets/jaguar-classroom-v56.js` — selector Actividad/Examen/Excluir y fuente Forms/Classroom/Manual; acceso a evaluación tradicional.
- `index.html` — mostrar todos los periodos del ciclo en el panel de evaluación docente e instrucciones sin Classroom.
- `sql/JAGUAR_V5_7_5_CLASIFICACION_EXAMENES.sql` — tabla privada de correspondencias y unicidad por formulario, sin cambios a calificaciones oficiales.

## Pruebas locales (no sustituyen probar con Google/Supabase reales)

```sh
node tools/test_v575_clasificacion.mjs
node tools/test_v574_classroom_periods_grades.mjs
node tools/test_v56_classroom.mjs
node tools/test_v57_google_oauth.mjs
node tools/test_hobby_routing.mjs
```

Comprobar también ejecución SQL en un Supabase de pruebas. El CI local verifica cálculos, control de duplicados, rutas y sintaxis; no se ha hecho una autorización real con tu cuenta Gmail ni importado calificaciones reales.
