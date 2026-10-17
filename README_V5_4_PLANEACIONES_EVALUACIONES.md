# Plataforma Jaguar V5.4 — Dictámenes académicos y corrección de rúbricas

Esta versión es un **parche incremental sobre Jaguar V5.3**. Conserva menús, dashboards, boletas, credenciales, horarios, fotografías, verificación pública, modo oscuro y documentos. **No reemplaza el sistema ni requiere servicios nuevos de pago.**

## 1. Dictámenes de planeaciones docentes

Una misma versión tiene exactamente cuatro departamentos habilitados para emitir un dictamen:

| Departamento | Rol de Supabase |
|---|---|
| Servicios Docentes | `servicios_docentes` |
| Coordinación Escolar / Académica | `coordinacion_academica` |
| Dirección Escolar | `direccion_escolar` |
| Control Escolar | `control_escolar` (también alias `control`) |

La base actual denomina a Coordinación como `coordinacion_academica`: no se cambia ni se inventa un rol adicional.

- Cada departamento tiene **un dictamen inmutable por versión**: aprobar y firmar o rechazar de forma argumentada. No se admiten firmas dobles de usuarios del mismo departamento.
- Antes de firmar, el servidor verifica que la firma institucional esté registrada en el perfil, descarga el original del bucket privado y comprueba el SHA-256. El registro del dictamen conserva departamento, usuario firmante, fecha, ruta de firma y hash; no almacena una imagen pública.
- Con **3/4 aprobaciones** la versión queda válida (`estado='revisada'` en el esquema preexistente). El cuarto departamento todavía puede registrar su dictamen, pero no anula las tres firmas válidas.
- Con **2 rechazos** ya no es matemáticamente posible alcanzar 3 aprobaciones: el estado pasa a `devuelta` y se habilita una apelación.
- Con menos de 3 aprobaciones y falta de revisión permanece pendiente; una planeación sin tres aprobaciones no debe anunciarse como válida.
- El rechazo requiere argumentos específicos de **30 a 2000 caracteres**.
- El docente puede apelar una versión devuelta; escribe sus argumentos, explica las correcciones y prepara una **nueva versión** con contenido o adjunto corregido. La versión anterior conserva sus dictámenes.
- Para imprimir el PDF de planeación con firmas, el sistema recupera imágenes mediante URL privadas temporales únicamente para personas autorizadas. Las firmas no se imprimen si están pendientes ni se atribuyen a revisores que no firmaron.
- Archivo Escolar puede consultar como custodio de documentos, pero **no emitir dictamen de planeación**. Los docentes no revisan planeaciones ajenas.

**Migración obligatoria:** `sql/JAGUAR_V5_4_PLANEACIONES_DICTAMENES.sql` crea tablas de dictámenes/apelaciones y la función transaccional que serializa cada voto. No se ejecuta automáticamente desde Vercel. Hacer copia de seguridad y ejecutar manualmente en Supabase **antes** de subir el código.

## 2. Rúbricas, ponderaciones y Excel

Problemas localizados en V5.3 y medidas tomadas:

1. El exportador generaba Excel de evaluación con `formato_version = 4`, mientras el importador exigía `3`. **Corregido:** ambos usan 4 y se comprueban rúbrica, versión, grupo, periodo y componentes.
2. Se exigían simultáneamente 100% de ponderaciones y un segundo total de 10 puntos introducido desde el navegador. **Corregido:** los puntos máximos se derivan en servidor del porcentaje; la nota final usa el porcentaje como fuente de verdad.
3. Al modificar una rúbrica, el servidor eliminaba **todos** sus componentes y notas. **Corregido:** conserva IDs y notas, actualiza componentes existentes y rechaza borrar un componente ya calificado.
4. La captura enviaba valores vacíos como `null` a `evaluacion_notas`, que puede tener restricción `NOT NULL`. **Corregido:** un campo vacío borra sólo la nota que ya existía; los valores completos se actualizan o insertan sin depender de un `ON CONFLICT` no confirmado.
5. Antes era obligatorio importar Excel para cerrar y registrar notas. **Mejora:** aparece el botón **Registrar calificaciones con rúbrica** para cerrar sin Excel (requiere todas las actividades capturadas). El Excel sigue disponible como evidencia de cierre.
6. En la exportación se conserva intacta la hoja oculta `ITHLA_META`; no se alteran IDs, versiones ni datos de importación.

**Equivalencia real (escala 0–10):** `nota_final = suma(nota_actividad * ponderación / 100)`. Ejemplo: Tareas 8 con 30%, Proyecto 9 con 40%, Examen 10 con 30% ⇒ **9.0/10**. Las rúbricas y sus notas se conservan por periodo; no se añade una escala artificial nueva.

**Límites pendientes de validar en tu base de datos:** esquemas, índices, políticas y columnas de `rubricas_evaluacion`, `rubrica_componentes`, `evaluacion_notas`, `cierres_evaluacion` y `calificaciones`. Las pruebas locales no pueden confirmar si esos objetos están instalados correctamente ni simular una importación autenticada real. El cierre hace varias operaciones sobre tablas distintas; se recomienda encapsularlo en una transacción SQL en una siguiente iteración para evitar cierres parcialmente aplicados si Supabase falla a mitad.

## 3. Instalación segura (SIN reemplazar archivos de fuentes)

1. Guarda respaldo de la rama estable V5.3 y de la base de datos Supabase.
2. En la base de datos de **pruebas**, ejecuta `sql/JAGUAR_V5_4_PLANEACIONES_DICTAMENES.sql`.
3. Aplica este parche **encima del código V5.3**, copiando únicamente los archivos incluidos en el ZIP. No borres los demás directorios ni los recursos de fuente existentes.
4. Despliega en una rama/preview de Vercel y realiza pruebas autenticadas de cuatro cuentas revisoras distintas más un docente.
5. Con firma cargada en cada perfil, envía una planeación, aprueba 3/4 y verifica el PDF y el historial; prueba también 2 rechazos, apelación y nueva versión.
6. Prueba una rúbrica 30/40/30: guarda calificaciones, descarga el Excel oficial, rellena las notas y vuelve a importarlo. También prueba cierre directo sin Excel. **Hazlo con alumnos de prueba**, pues el cierre escribe calificaciones reales.
7. Si cualquiera de estos pasos falla, no publiques a producción: conserva el error de Supabase y la pantalla, y revisa primero las tablas/índices y políticas.

## 4. Pruebas locales

```sh
node tools/test_v54_planeaciones_calificaciones.mjs
node tools/test_v54_execution.mjs
node tools/test_planeaciones_v53.cjs
node tools/test_planeaciones_api_v53.cjs
node tools/test_horarios_v52.mjs
node tools/test_redesign.cjs
node tools/test_v6_periodos.mjs
node --check api/data.js
```

Estas pruebas validan lógica, roles y sintaxis **sin conexión real a Supabase**. No son una certificación de funcionamiento de extremo a extremo en Vercel.

## 5. Ideas futuras — NO implementadas

- **Asignación de aulas:** inventario, capacidad, disponibilidad semanal y detección de colisiones (grupo, docente, aula).
- **Generador de exámenes:** banco de reactivos por asignatura, versiones para impresión PDF/Word; para Google Forms haría falta autorización con la cuenta de Google y revisión de los límites de su API.
- **Carga masiva institucional de calificaciones:** validación previa, vista de diferencias, aprobación/control de cambios y confirmación por lotes, sin mezclarla con la bitácora Excel diaria ya existente.
- **Transacción única al cerrar calificaciones** y diagnóstico de esquema antes de permitir el cierre, por seguridad académica.
