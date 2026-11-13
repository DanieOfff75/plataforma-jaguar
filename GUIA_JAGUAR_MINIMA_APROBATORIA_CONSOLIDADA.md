# Plataforma Jaguar · Política oficial de mínima aprobatoria y reprobatorias

**Paquete único, acumulativo, sólo archivos necesarios.** Esta versión **sustituye** `JAGUAR_VALOR_TOTAL_CORRECCION_CRITICA_SOLO_CAMBIOS.zip` y los dos paquetes anteriores. Se aplica sobre el repositorio original `plataforma-jaguar-main (17)(2).zip`. No hay que instalar primero los paquetes anteriores.

## Qué resuelve

- **VALOR TOTAL del Excel del docente sigue siendo el dato original de cierre.** No se vuelve a ponderar, modificar ni redondear el desglose Libreta, Classroom y Proyecto. Los originales quedan en el respaldo académico.
- La **nota oficial** se genera usando la política vigente de ese ciclo escolar: enteros por defecto, un decimal si Control Escolar lo habilitó, **mínima aprobatoria 6 por defecto**, y tratamiento de notas reprobatorias bajas.
- **Bloqueo antiaprobación por redondeo**: si el valor original de VALOR TOTAL es inferior a la mínima aprobatoria, su calificación oficial **siempre** será inferior a ese umbral. Una nota 5.50, 5.90 o 5.99 no puede convertirse en 6. Con un decimal, 5.96 → 5.9.
- **Reprobatorias inferiores permitidas** (valor inicial): 1, 2, 3, 4, 5 pueden quedar como tales. Al elegir **piso reprobatorio**, cualquier nota por debajo del entero anterior a la mínima aprobatoria sube a ese entero. Ej.: mínima 6 → piso 5; 2.2 → 5, pero 5.7 → 5 (enteros) o 5.7 (decimales), sin aprobar.
- En `calificaciones.observaciones` los cierres reprobatorios llevan **`REPROBADO.`**, manteniendo la observación docente original. La vista previa muestra `Reprobado` o `Aprobado` antes de cerrar. La condición se determina sobre el valor original.
- **Autoridades**: Control Escolar, Coordinación Académica y Dirección Escolar pueden cambiar mínima y política de notas bajas. El ajuste de precisión decimal **sigue reservado a Control Escolar**. Son cambios auditados y versionados: requieren motivo de 15–300 caracteres, generan un oficio con folio y notificaciones para el personal. La notificación tiene acceso a la descarga del PDF mediante la bandeja existente.
- **No retroactivo**: jamás recalcula expedientes históricos ni modifica cierres anteriores por cambiar la configuración. Los registros bajos ya existentes siguen requiriendo cotejo y rectificación autorizada.

## Ejemplos (mínima 6)

| VALOR TOTAL original | Enteros, permitir notas bajas | Enteros, piso 5 | Un decimal, permitir bajas | Un decimal, piso 5 |
|--:|--:|--:|--:|--:|
| 2.2 | 2 (Reprobado) | 5 (Reprobado) | 2.2 (Reprobado) | 5.0 (Reprobado) |
| 4.8 | 5 (Reprobado) | 5 (Reprobado) | 4.8 (Reprobado) | 5.0 (Reprobado) |
| 5.5 | 5 (Reprobado) | 5 (Reprobado) | 5.5 (Reprobado) | 5.5 (Reprobado) |
| 5.99 | 5 (Reprobado) | 5 (Reprobado) | 5.9 (Reprobado) | 5.9 (Reprobado) |
| 6.0 | 6 (Aprobado) | 6 (Aprobado) | 6.0 (Aprobado) | 6.0 (Aprobado) |
| 7.625 | 8 (Aprobado) | 8 (Aprobado) | 7.6 (Aprobado) | 7.6 (Aprobado) |

La mínima se configura como **entero entre 1 y 10**; el piso es automáticamente `mínima - 1` y nunca un número fijo 5.

## Rutas incluidas

El ZIP incluye todos los archivos acumulados de las correcciones anteriores más la nueva regla. Las rutas relevantes para este añadido son:

- `lib/grade_precision.js`: cálculo central y etiqueta de resultado.
- `api/data.js`: aplica la regla en el cierre desde rúbrica o VALOR TOTAL y registra observaciones; permisos y oficios.
- `sistema.html`: configuración en la vista existente de ciclos y periodos, vista previa, menú de notificaciones del personal.
- `sql/ITHLA_CALIFICACIONES_PRECISION_Y_OFICIOS_2026.sql`: política por ciclo, modificación transaccional de criterio + oficio + avisos, y trigger de protección en `calificaciones`.
- `lib/grade_policy_office_pdf.js`: oficio institucional de cambio de criterios con motivo y firmante real (si está registrado).
- `api/reports.js`: descarga del oficio disponible para personal autorizado; los demás reportes conservan sus permisos previos.
- `tests/jaguar_minima_aprobatoria_anti_redondeo.test.mjs`: reglas, casos frontera, permisos, vista previa y acceso a oficio.

## Instalación segura, SIN alterar producción de inmediato

1. **Respalda** el repositorio y Supabase. Crea una rama de prueba en GitHub que despliegue en **Vercel Preview**.
2. Copia **únicamente** los archivos de este ZIP encima de las rutas equivalentes del repositorio, conservando carpetas. **No instales los ZIP anteriores primero.**
3. En la base de prueba, aplica una vez `sql/ITHLA_CALIFICACIONES_PRECISION_Y_OFICIOS_2026.sql` en Supabase SQL Editor. Este SQL **sustituye** al del ZIP anterior; si ese ya se había aplicado, la versión nueva incorpora compatibilidad con las columnas preliminares. No ejecutes una copia vieja posteriormente.
4. En **Control Escolar → Configuración**, establece mínima 6 y prueba ambas opciones de reprobatorias; alterna decimales sólo bajo rol Control Escolar. En **Coordinación Académica** o **Dirección Escolar**, verifica que pueden definir mínima/piso y **no** editar decimales ni periodos.
5. Con datos **ficticios** en un periodo de prueba, importa VALOR TOTAL 5.49, 5.50, 5.95, 5.99, 6.0 y 7.625. Revisa la vista previa, las observaciones, el registro oficial y las vistas administrativas. Verifica que los componentes de Excel son idénticos a los originales.
6. Cambia la mínima a 7 para probar que 6.9 es reprobatorio y no se redondea a 7. El cambio debe generar oficio `ITHLA-PC-*`, notificar al personal y permitir descargar el PDF desde **Notificaciones y oficios**. Comprueba que las notas de periodos cerrados **no** cambian.
7. Verifica la descarga del oficio real, exportación PDF de bitácora, pruebas de permisos y que las firmas institucionales son las registradas, no inventadas. **No pasar a producción** sin estas verificaciones.

## Verificaciones ejecutadas en el entorno de trabajo

- **36 pruebas específicas aprobadas**, cubriendo bitácora, VALOR TOTAL, precisión, mínima, redondeo, piso, UI, oficios y permisos.
- Batería del repositorio (tras estos cambios): **172 pruebas; 169 aprobadas, 2 fallos heredados, 1 omitida**. Los dos fallos heredados son una expectativa antigua de apertura/cierre de bitácora y una expectativa de 12 caracteres de contraseña, ya presentes en la versión recibida.
- Verificación sintáctica de JS de servidor y scripts HTML, sin errores.
- **NO verificado**: ejecución del SQL en Supabase real, firma/descarga del oficio en Vercel, PDF real o anotación de 40 notas ya guardadas. No se han ejecutado modificaciones ni notificaciones en producción desde este entorno.

### Advertencias

- La fuente del Excel (`VALOR TOTAL`) se conserva **sin cambios**. La normalización sólo afecta la nota oficial del cierre.
- El cambio de criterio no corrige ni sobrescribe las calificaciones anteriores que ya salían como 4 o 5 por doble ponderación. Deben cotejarse y rectificarse con el procedimiento institucional.
- La captura directa de totales previamente eliminada **no** vuelve a activarse: todo sigue por Bitácora → Rúbrica y adopción → Cierre.
- La política de notas aprobatorias/reprobatorias del ciclo debe ser compatible con el reglamento institucional; el código no valida por sí solo su fundamento normativo.
