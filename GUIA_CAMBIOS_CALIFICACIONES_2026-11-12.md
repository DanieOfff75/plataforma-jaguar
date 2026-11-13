# Plataforma Jaguar · Calificaciones unificadas

**Entrega:** 12 de noviembre de 2026  
**Base de trabajo:** `plataforma-jaguar-main (17)(2).zip` proporcionado en la conversación.  
**Alcance:** Sólo archivos modificados; no se adjunta un repositorio completo ni se modificó ninguna base de datos real.

## Objetivo y cambios

La **Bitácora diaria** queda como el único Excel de captura y respaldo docente. El antiguo Excel específico de evaluación se retiró de la interfaz y ya no se genera ni importa por rutas duplicadas. La **rúbrica de evaluación** sigue siendo el registro oficial de notas de actividades sobre 10, con el cierre por periodo existente. La vista general **Mis calificaciones** queda de consulta; no se permite modificar en paralelo el total oficial desde allí.

En la captura de rúbrica se añadió **Adoptar desde Excel** para importar un archivo `.xlsx` o `.xls` de hasta 10 MB. El docente selecciona el libro, hoja, fila de encabezados, rango de filas de alumnos, columna de matrícula, columnas de aspectos y unidad de cada número (notas originales 0–10 o aportaciones ponderadas). La vinculación es por matrícula, nunca por posición. Se validan matriculas duplicadas, columnas repetidas, alumnos ajenos al grupo, valores fuera de escala, inconsistencias y celdas vacías. Antes de guardar se comparan los resultados con las notas ya existentes; las sustituciones de notas distintas aparecen desmarcadas y requieren confirmación. El servidor comprueba permiso, periodo abierto, pertenencia del alumnado, rúbrica y concurrencia; la evidencia del archivo se sube al almacenamiento de evaluación existente y se registra su procedencia para auditoría.

Se corrigió **`situacion is not defined`** al adoptar valores ya guardados en bitácora y se centralizó la vista de revisión de diferencias para ambas fuentes. Las notas 0–10 y los **aportes ponderados** quedan diferenciados. Para calcular el resultado final se suman aportes ya ponderados, sin aplicar de nuevo los porcentajes. Por ejemplo, para 70 % / 15 % / 15 %, las contribuciones **5.6 + 0.9 + 1.1 = 7.6**, y NO 4.2. Cuando falta un aspecto, el total se presenta como «—» y no se publica una nota ficticia; el cero registrado sí conserva su valor.

El libro descargado incorpora `unidad_ponderaciones` en la hoja `JAGUAR_META`. Los documentos antiguos sin esta información se interpretan con una regla de compatibilidad que puede resultar ambigua: cuando los números caben en las dos escalas, se presupone que son aportes y se solicita una selección explícita cuando se sube el Excel al módulo de bitácora. El PDF histórico muestra que la unidad fue inferida cuando corresponde. **Es imprescindible que el docente confirme la unidad real antes de adoptar datos históricos.**

Los nuevos respaldos diarios capturan el padrón de alumnos en el servidor para conservar nombres y matrículas al regenerar PDFs históricos. Para respaldos antiguos sin padrón guardado, el reporte intenta sumar estudiantes anteriores que tengan registros, incluso si cambiaron de grupo. Ningún registro histórico fue reescrito por este parche.

## Archivos incluidos

| Archivo | Función |
|---|---|
| `sistema.html` | Flujo docente, generación e importación de bitácora, adopción de Excel externo y consolidación de menús |
| `api/data.js` | Contexto y respaldo diario, comprobaciones de guardado, evidencia y auditoría |
| `api/reports.js` | Recuperación de padrón histórico para PDF |
| `lib/gradebook_weighting.js` **(nuevo)** | Cálculo coherente de notas y aportes |
| `lib/jaguar_gradebook_pdf.js` | Total corregido y rótulo de unidad |
| `tests/jaguar_calificaciones_unificadas.test.mjs` **(nuevo)** | Pruebas del cálculo, importación y consolidación |
| `tests/jaguar_excel_pdf_reparacion.test.mjs` | Ajuste del banco de pruebas existente |

## Instalación cuidadosa

1. **Respaldar** previamente el código vigente y, por separado, los datos de Supabase. Usar una rama o despliegue de prueba, no reemplazar directamente producción.
2. Abrir el ZIP en la raíz de tu proyecto, respetando las rutas de los archivos. **Sólo sobrescribir los archivos incluidos** y añadir los dos nuevos. No borrar otros archivos ni carpetas.
3. No hay migración SQL. Se reutilizan las tablas, funciones y los buckets de Supabase ya empleados por evaluaciones y bitácora. Comprobar que el bucket `evaluaciones-docentes` y sus permisos actuales permitan subir la evidencia antes de probar la nueva adopción.
4. Ejecutar los tests de la sección siguiente, desplegar a una **vista previa** de Vercel y probar con un grupo y periodo de ensayo, conservando un respaldo previo.
5. Publicar únicamente después de validar exportación PDF, importación y cierre de periodo con un usuario docente y uno administrativo. **Esta entrega no realiza automáticamente ningún despliegue.**

## Pruebas ejecutadas localmente

```sh
node --test tests/jaguar_calificaciones_unificadas.test.mjs tests/jaguar_excel_pdf_reparacion.test.mjs tests/jaguar_evaluation_menu_v15.test.mjs
node tools/test_bitacora_compacta.mjs
node --check api/data.js
node --check api/reports.js
node --check lib/jaguar_gradebook_pdf.js
```

**Resultado local:** 14/14 pruebas automatizadas correctas; pruebas de paginación y asistencia correctas; sintaxis de los servidores comprobada. También se comprobó la compilación de los scripts embebidos de `sistema.html` con el analizador de JavaScript.

## Pruebas manuales obligatorias en la vista previa

- [ ] Descargar una Bitácora diaria con rúbrica 70/15/15 y verificar Excel. Para aportes **5.6, 0.9 y 1.1**, el total tiene que ser **7.6**.
- [ ] Subir el Excel, conservar un respaldo, descargar el PDF administrativo **nuevo** del mismo respaldo y comprobar que el total sea **7.6**, no **4.2**. El PDF del 6 de noviembre ya generado es un archivo histórico y **no cambia retroactivamente**.
- [ ] Adoptar valores desde Bitácora y confirmar que ya no aparece `situacion is not defined`; verificar que se convierten 5.6 puntos / 70 % en nota **8.0/10**.
- [ ] Probar un Excel externo con dos hojas, encabezados desplazados y columnas no contiguas; configurar manualmente sus filas y columnas, y comprobar que la matrícula corresponde a cada nota.
- [ ] Probar rechazo de matrícula duplicada, alumno ajeno al grupo, celda no numérica, nota fuera de rango y columna repetida. Las celdas vacías **no** deben convertirse en cero.
- [ ] Tener una nota previa diferente: debe aparecer **desmarcada** en la vista previa y requerir confirmación antes de reemplazarla. Abrir dos sesiones para verificar el rechazo de edición concurrente.
- [ ] Con un periodo de evaluación no abierto por Dirección, verificar que la bitácora se respalda sin publicar notas oficiales; la adopción oficial debe permanecer cerrada.
- [ ] Ampliar un Excel de Bitácora con actividades adicionales y comprobar que las calificaciones, claves y asistencias anteriores no cambian.
- [ ] Confirmar que «Mis grupos» sólo ofrece el Excel de Bitácora, y «Mis calificaciones» no tiene otra captura editable de total final. Verificar que Control Escolar y Dirección conservan sus reportes y flujos propios.
- [ ] Probar bitácoras antiguas sin unidad declarada; escoger manualmente la interpretación de su escala, especialmente cuando todos los valores caben en el porcentaje máximo.
- [ ] Probar la regeneración de un PDF histórico después de mover de grupo a un estudiante **en el entorno de prueba**.
- [ ] Probar cierre de periodo, consulta de calificación, reportes administrativos y boleta antes de la publicación en producción.

## Límites de esta entrega

No se tuvo acceso a las credenciales de Supabase ni al estado real de las tablas de producción. La instalación de las dependencias del motor PDF no terminó en el entorno de análisis, por lo que **la generación y revisión visual del PDF real no se pudo completar aquí**. El cálculo y el enlace al generador están cubiertos por pruebas automatizadas, no por una prueba real de exportación. También es necesario probar permisos del almacenamiento en tu entorno; el servidor valida la ruta y el formato de la huella del archivo, pero no recalcula su SHA-256 descargando la evidencia. No se debe afirmar que esos extremos ya están verificados.

El guardado de varias filas utiliza la API de base de datos existente, no una nueva transacción SQL atómica. Las validaciones previas reducen errores y choques simultáneos, pero ante un fallo de red a mitad de escritura es prudente recargar la rúbrica y comprobar el resultado. Esto puede perfeccionarse después con una función transaccional, sin añadir módulos de captura.

## Reversión

Si la vista previa presenta una regresión, **restaurar sólo los archivos anteriores** desde el respaldo o revertir el commit que añade esta entrega. El módulo nuevo `lib/gradebook_weighting.js` puede retirarse tras restaurar `lib/jaguar_gradebook_pdf.js`; no borres datos ni documentos de Supabase. Los respaldos históricos permanecen intactos. Verifica los registros importados durante las pruebas antes de restaurar una base de datos.
