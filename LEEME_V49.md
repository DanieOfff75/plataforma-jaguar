# Jaguar 360 V49 — Tutoría y registros imprimibles

Base de trabajo: archivos originales + V38, V40, V42, V43, V44, V45 (NEXO-V45.zip), V46, V47, V48 suministrados en la conversación. Es un parche incremental. No instala ni cambia boletas, formatos de la bitácora existente, NEXO EDU, reglas de evaluación, matrículas o históricos. No se ha desplegado ni conectado a tu Supabase de producción.

## Instalación segura

1. Crea respaldo/export de tu base y una rama o copia de prueba de GitHub. Revisa diferencias si editaste estos archivos después de V48.
2. En Supabase SQL Editor, con la traducción automática de Chrome DESACTIVADA, ejecuta completo `sql/ITHLA_JAGUAR_TUTORIA_V49.sql` (de `BEGIN;` a `COMMIT;`). El código ya incluye RLS. No aceptes cambios automáticos al script. Requiere las migraciones anteriores V1/V8/V40 (plan, listas de sesión y proyección de evaluación mixta). Si falla no continúes: conserva el mensaje completo y no borres tablas.
3. Ejecuta `sql/VERIFICAR_TUTORIA_V49.sql`: deben aparecer **dos tablas**, todas sus comprobaciones `true`, y una función con tres comprobaciones `true`. No es sustituto de pruebas con usuarios reales.
4. En GitHub reemplaza/agrega sólo los 11 archivos de aplicación listados abajo. No subas carpetas de ejemplo ni alteres `package.json`. El endpoint reutiliza `/api/router`, no crea otra función serverless independiente.
5. Despliega primero en prueba. Ctrl+F5. Comprueba migración, roles y descarga. No es necesario reinstalar V1–V48.

## Archivos de aplicación

- `sistema.html`
- `vercel.json`
- `api/router.js`
- `routes/tutoria.js`
- `lib/jaguar_tutoria.js`
- `lib/jaguar_tutoria_pdf.js`
- `lib/jaguar_tutoria_fontmetrics.js`
- `assets/jaguar-tutoria.js`
- `assets/jaguar-tutoria.css`
- `assets/jaguar-workspaces.js`
- `assets/tutoria-logo.jpg`

## Rutas de uso

Dirección Escolar / Coordinación Académica / Servicios Docentes → **Alumnos y grupos → Asignación de asesores**. Elige un docente activo por grupo o confirma una propuesta automática de grupos que aún no tienen un registro de asesor. Se priorizan menos tutorías, dar clase al grupo como desempate, menor carga registrada e ID estable. No asigna docentes desactivados. Una asignación previa (incluido un retiro o una baja) requiere revisión manual para no sobrescribirla. Si se cambia de asesor, en la siguiente consulta se bloquea el acceso del anterior al panel. No se cambia su carga horaria. El asesor puede tener varios grupos. El vínculo se separa por ciclo y se audita mediante el mecanismo existente de Jaguar.

Docente → **Mis grupos → Tutoría y grupos asesorados**. Selecciona grupo y periodo del ciclo vigente. El asesor obtiene la matriz de notas, indicadores numéricos, AP/RP, clasificación de 10 mejores medias comparables, marcas de asistencia, incidencias y solicitudes agregadas, saldo agregado actual y observaciones compartidas. Los profesores que dan clase a un grupo sin asesorarlo sólo aportan o retiran sus propias observaciones, no consultan el expediente integral del grupo.

Docente → **Calificaciones → seleccionar su asignatura y grupo → periodo**. Descargar registro imprimible con notas visibles y cuatro columnas libres de actividad, o el mismo registro con las notas en blanco. Tutoría permite la matriz de todas las materias evaluables por periodo y un informe PDF completo. Las páginas se subdividen por materias y alumnos; el registro no es boleta, no firma ni altera notas. La estética se inspira en la bitácora (carta horizontal, escudo, azul marino/dorado, encabezados). El PDF usa fuentes estándar, no el mismo archivo Garet, y no cambia el formato anterior. No se emiten QR/folios oficiales.

## Criterios y límites

- Solo ciclo inequívoco vigente, padrón actual de alumnos activos, grupo y catálogo activos. No se pretende reconstruir matrículas, traslados y materias de ciclos pasados. Dentro del ciclo, un periodo anterior se consulta con el padrón actual y se advierte. Se excluye una ficha sin evaluación si así consta en el último plan validado; los modos numérico/cualitativo se obtienen de la política V40. No es una boleta oficial. La media de grupo es la media de los registros numéricos disponibles; AP/RP no promedian, cero es nota válida, pendiente no es cero. Para clasificar se requiere cubrir todas las materias numéricas consideradas; los empates comparten puesto. Actualmente no calcula acreditaciones, puntos de promoción, nota anual, equivalencias históricas ni sanciones por asistencia.
- Asistencia: se combinan las últimas listas operativas versionadas de sesión con las marcas diarias de fechas sin listas; no se cuentan ambas para la misma materia/fecha. Ante duplicados conflictivos, se clasifican como otro estado y se indica el número. No se incorporan otras evidencias manuales/históricas ni se valida padrón de sesiones/sellos históricos, no es porcentaje oficial. Si el RPC falla se muestran sólo marcas diarias con advertencia. Cubre materias evaluables activas. Incidencias y trámites: conteos y tipos del periodo, no descripciones privadas de los expedientes. Finanzas: saldo abierto del ciclo calculado con cargos pendientes/parciales menos pagos registrados, a fecha de consulta, agregado sin nombres, cuentas, datos de pago ni comprobantes. Si alguna fuente no está disponible, se muestra como no disponible y no como cero.
- Las observaciones son una aportación nueva expresamente compartida por docentes del grupo o asesor; no se copia automáticamente texto privado de calificaciones, expedientes, planeaciones ni NEXO. Retirar excluye de futuros informes, no borra copias descargadas. Se solicita no incluir nombres ni datos sensibles. No hay acceso de la IA a estos datos ni se envían a proveedores externos.
- Los asesores tienen acceso de lectura a los datos oficiales de su grupo; sólo escriben en la tabla propia de observaciones. Las funciones de asignación/editado pertenecen a los roles señalados. El RPC de sesiones es de lectura, actor/rol/ciclo/grupo restringidos y EXECUTE sólo para service_role. Las dos tablas nuevas están protegidas por RLS y sin acceso directo de anon/authenticated. No se otorgan privilegios sobre tablas anteriores. Las respuestas no se almacenan en caché. El permiso se comprueba al consultar; una copia PDF ya descargada no puede revocarse, trátala como confidencial.
- Los documentos se generan localmente en el servidor en cada consulta, sin paquetes nuevos. Límite de seguridad: consultas de máximo 20,000 filas por colección, 500 alumnos/80 materias, PDF de máximo 3 MB antes de base64; se indica error en lugar de truncar silenciosamente. No se ha probado Vercel/Supabase reales.

## Pruebas de aceptación

- Asigna un docente activo a un grupo; confirma que aparece. Intenta reassignar a uno inactivo y comprobar rechazo. Confirmar autoasignación sólo después de revisar propuestas. Probar cambio y retiro de asesor.
- Con un usuario docente asesor, consultar grupo y periodo. Contrastar la matriz con Calificaciones, AP/RP, faltas, incidencias y saldos agregados con las áreas responsables. Probar un alumno con nota cero y otro con pendientes. Probar listas diarias y por sesión para una fecha sin duplicación.
- Desde un profesor que da clase pero no asesora, aportar una observación general y luego comprobar su aparición en informe del asesor; retirar y comprobar que no aparece. Desde otro usuario, no permitir consultar el panel ni descargar un PDF ajeno. Comprobar sesiones vencidas y rol alumno.
- Descargar informe, matriz y formato individual en blanco. Probar grupo con >10 materias: el nuevo registro matricial pagina sin omitir materias. Comprobar que las boletas existentes y la bitácora original conservan su comportamiento.
- Validar el permiso de datos financieros agregados con Dirección Escolar antes de uso institucional. No distribuir la gráfica de nombres ni informes a alumnos; son para uso interno.

## Pruebas realizadas localmente

40/40 pruebas Node aprobadas (23 nuevas de Tutoría, 17 pruebas seleccionadas de V47, V48, navegación y espacios de trabajo). Para repetir dentro del repositorio actualizado:

```sh
node --test tests/jaguar_tutoria_v49.test.mjs tests/jaguar_workspaces.test.mjs tests/jaguar_cycle_workload_v48.test.mjs tests/jaguar360_general_subjects_v47.test.mjs
```

Se comprobó la sintaxis de los scripts modificados e inline de sistema.html, flujos de API con base simulada, interfaz en Chromium con respuestas simuladas (panel, AP/RP, escape de texto, notas, propuesta auto, solicitud de descarga, viewport móvil). Se generaron PDF reales y se renderizaron con Poppler; 39 alumnos / 14 materias producen 9 páginas sin descartar datos. **No se ejecutó SQL en PostgreSQL real ni se hicieron pruebas reales de red con credenciales.** La verificación de migración, sesión y RLS reales es necesaria antes de utilizar registros reales.

## Reversión

Si aparece una falla de interfaz, restaura los archivos anteriores desde GitHub (o revierte el commit V49). No borres tablas ni observaciones si ya registraste información; pueden permanecer protegidas mientras se resuelve. No se requieren cambios en la configuración de boletas.
