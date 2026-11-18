# Jaguar 360 V47 — Configuración general de asignaturas

Base: V46. Sustituir únicamente `assets/jaguar-academic-lifecycle.js` y `lib/jaguar_academic_lifecycle.js`. No hay migración SQL; `curriculumDefaults` es un campo opcional del JSON de la propuesta existente. El servidor valida esa plantilla con el mismo validador de fichas curriculares y las fichas materializadas siguen siendo el registro efectivo. No modificar el catálogo activo, las notas, boletas ni horarios.

## Uso
1. Dirección o Coordinación: Planificación de ciclos → Materias y plan de estudios. Seleccionar el ciclo.
2. Revisar «Editar configuración general». Indicar todos los valores, incluida la duración y los minutos de cada periodo; no se deducen las horas del catálogo antiguo.
3. Pulsar «Aplicar general e incorporar catálogo activo». Importa materias activas con grados explícitos, una ficha por grado, conservando identidad. Omite duplicados; muestra referencias sin grado/identidad válida o conflictos de nombre. Si se llega a 500 resultados o se exceden 300 fichas, detiene la operación para evitar importación parcial.
4. Por defecto conserva configuraciones anteriores: si aún no existía plantilla, mantiene las fichas ya configuradas como posibles excepciones; para comenzar con valores iguales en todas, desmarca «Conservar excepciones y criterios anteriores». Esto también uniforma las cargas horarias y por tanto exige revisión. No hay modificación hasta confirmar.
5. Los cambios posteriores conservan bloques de excepción (evaluación, carga horaria, asistencia). Los bloques diferentes a la plantilla anterior quedan como excepción; los demás heredan el cambio. Abrir una ficha para editar. Usar «Restablecer configuración general» para volver a toda la configuración común.
6. Usa filtro «Sólo excepciones», búsqueda o grado. Una nueva materia manual hereda la plantilla aplicada. «Importar materias faltantes» consulta de nuevo el catálogo activo; sólo añade fichas faltantes. Si habías retirado una materia del borrador y sigue activa en catálogo, una nueva importación puede volver a incorporarla: revisa antes de guardar.
7. Registrar nueva propuesta y validar con el flujo institucional. No activa criterios en el ciclo vigente, no sustituye el módulo independiente de evaluación por materia, no aplica fusiones definitivas. El historial de versiones anteriores permanece igual.
8. Si cambia el número de periodos, revisar y volver a aplicar la plantilla general; comprobar las sumas individuales. No se infiere una carga horaria para periodos nuevos.

## Pruebas
- 529 pruebas Node aprobadas sobre base local reconstruida V46 incluyendo 4 nuevas; con los directorios de Admisiones y Centro de Control de la misma base.
- Chromium con API simulada: importación multigrado, repetición sin duplicados, aviso de grado faltante, conservación de AP/RP, cambios de asistencia general, filtro y restauración, asignatura nueva que hereda y validación del payload con el servidor real (función pura), ancho móvil.
- No se ha ejecutado la persistencia real en Supabase ni se ha inspeccionado el despliegue actual. Antes de desplegar, comprobar que no existen cambios propios posteriores a V46 y hacer copia de los dos archivos. Probar en una copia de base: guardar, recargar y confirmar que la plantilla y excepciones se mantienen. Validación formal por otra persona según flujo existente.

La carpeta `tests` contiene prueba adicional opcional para desarrollo; no es necesaria en producción.
