# Jaguar 360 · Organización sin pérdida de funciones — fase 1

## Alcance
Base: ZIP `plataforma-jaguar-main (17)(2).zip` + paquete consolidado `JAGUAR_MINIMA_APROBATORIA_Y_ANTIRREDONDEO_SOLO_CAMBIOS.zip`. La instalación nueva reúne los cambios anteriores y esta reorganización. No se asume que el paquete anterior ya esté instalado en producción. Si GitHub tiene cambios posteriores no incluidos en la base, comparar antes de reemplazar archivos.

Esta fase no sustituye el motor de evaluación, PDF, Excel, oficios, NEXO, Google Classroom, autenticación o Supabase. No se cambian APIs ni tablas respecto del paquete consolidado anterior. Se conserva la identidad visual y los componentes existentes. No se considera terminado el rediseño de todos los procesos ni la definición de todos los permisos por operación.

## Qué cambió en esta fase
- Agrupación del menú existente por secciones con expansión y búsqueda; sin rutas nuevas de negocio. Las entradas no clasificadas se preservan en Otros módulos.
- 11 perfiles y alias `control`: 193 accesos previos conservados, 194 actuales. El único acceso agregado es `config` en Coordinación Académica (pantalla existente, que habilita sólo el criterio aprobatorio de acuerdo con sus permisos anteriores). No crea un permiso de servidor.
- Docente: Mis grupos agrupa por grupo real, con selección separada de materia si hay varias. Dentro de la asignación: lista, asistencia, evaluación, consulta de notas, bitácora, Classroom, exámenes y planeaciones. Lista, asistencia, evaluación, notas, bitácora y Classroom reciben la asignación seleccionada. El banco de exámenes preselecciona la asignación, conserva la opción de cambiarla y mantiene su historial general. Planeaciones abre el centro general existente (el filtro por grupo aún no se implementa). Se conservan las vistas generales accesibles en el menú.
- La consulta, edición y cierre de notas mantienen las funciones ya existentes; no se agrega una segunda captura. El contexto se reinicia al entrar desde un acceso general. La revisión de solicitudes y oficios por lote conserva su acceso general dentro de calificaciones.
- Guardado de asistencia captura los campos de la lista seleccionada antes de la consulta al servidor; si el padrón o la fecha cambian antes de enviar, pide volver a revisar. No se interpreta un campo desaparecido como falta.
- Se protege la renderización principal ante respuestas atrasadas al navegar.
- `JAGUAR_CATALOGO_FUNCIONAL_FASE1.md` registra rutas reales y entradas canónicas para orientar futuras mejoras. El catálogo es de interfaz, no un dictamen de permisos reales de todas las APIs.

## Instalación
1. Respaldar la rama y la BD antes de actualizar. Crear rama Preview en GitHub/Vercel. El ZIP contiene sólo archivos nuevos o modificados respecto del ZIP base (no el repositorio entero).
2. Extraer y copiar el contenido de la carpeta `plataforma-jaguar-main/` sobre la raíz del repositorio, sin crear una carpeta anidada. Conservar los demás archivos. No subir archivos de datos escolares ni credenciales.
3. Si NO instalaste el paquete consolidado de mínima aprobatoria, revisar y ejecutar su migración `sql/ITHLA_CALIFICACIONES_PRECISION_Y_OFICIOS_2026.sql` en una BD de prueba; seguir `GUIA_JAGUAR_MINIMA_APROBATORIA_CONSOLIDADA.md`. Si ya está aplicada, esta fase de navegación no requiere migración nueva: no volver a ejecutarla por esta entrega. Verificar si se aplicó una versión anterior de la migración: cotejar estructura y no ejecutar a ciegas.
4. Desplegar Preview, entrar con perfiles de prueba y refrescar página. No aplicar directamente a producción. No se enviaron oficios ni se cambiaron datos.

## Pruebas automáticas
- `node --test tests/*.test.mjs` (Node 22+ en la prueba; `package.json` del proyecto indica Node 24 para despliegue).
- Resultado base: 169 aprobadas / 2 fallos / 1 omitida, 172 totales.
- Resultado reorganizado: 174 aprobadas / 2 fallos / 1 omitida, 177 totales. Los dos fallos idénticos a la base: el test `jaguar_evaluacion360` todavía exige bloquear la bitácora diaria fuera de la apertura; `jaguar_recuperacion_otp` exige longitud 12. No se alteraron esas políticas ni se ocultaron las pruebas fallidas.
- Se actualizó únicamente la aserción de navegación de la prueba de oficios para detectar la nueva renderización protegida de notificaciones; conserva las comprobaciones de autorización y PDF.
- `tools/test_workspaces_browser.py` es opcional: necesita Python Playwright y Chromium local, ejecuta scripts reales en una página local con datos ficticios y sin red. Ejemplo desde la raíz: `python tools/test_workspaces_browser.py --base /ruta/raiz-anterior --actual . --chromium /usr/bin/chromium`. La base debe contener la versión anterior consolidada, no sólo el ZIP antiguo. Se inlinearon los scripts locales porque el navegador de este entorno bloqueaba navegación a direcciones HTTP; no se cargaron Tailwind por CDN ni la autenticación externa. Se verificaron las rutas de los 12 identificadores de rol, el menú suspendido, selección de materia, lista, asistencia, evaluación, notas, bitácora, Classroom, exámenes, búsqueda y acceso a asignación inexistente. No hubo excepciones JavaScript en esas pruebas.

## Checklist de aceptación en Vercel Preview
- [ ] Docente: iniciar, mostrar horas/grupos/avisos reales; abrir mismo grupo con dos materias diferentes; comprobar que listas y rúbricas son de la materia seleccionada.
- [ ] Asistencia: probar fechas antiguas y nuevas, cambiar de grupo antes de completar una consulta; guardar sólo en un registro de prueba y cotejar.
- [ ] Evaluación: periodo abierto y cerrado, adoptar `VALOR TOTAL`, verificar redondeo protegido y observaciones REPROBADO; verificar que aportes no se redondean. No rectificar los 40 registros anteriores sin autorización y cotejo.
- [ ] Bitácora: descarga, ampliación y subida en datos de prueba, PDF institucional y confirmación de que no se pierden valores históricos.
- [ ] Classroom: clase seleccionada, clasificación de actividades, notas y selección de periodo; probar con cuenta autorizada. Exámenes: exportaciones e historial.
- [ ] Dirección, Control Escolar, Coordinación, Servicios Docentes, Servicios Estudiantiles, Prefectura, Archivo, Recursos Monetarios, Técnico y Alumno: abrir cada sección y verificar acciones de lectura y escritura con cuentas reales de prueba; probar denegaciones desde servidor para operaciones no permitidas.
- [ ] Notificaciones y oficios, búsqueda y navegación, tema claro/oscuro, móvil Android real, sesión y recuperación; verificar PDF visualmente. La prueba automática offline no cubre estas integraciones reales.
- [ ] Verificar Centro de Control, Admisiones y portal público sin modificar sus repositorios; esta intervención sólo afecta la plataforma con sesión.

## Reversión
Si la migración previa ya estaba instalada y sólo se quiere revertir la reorganización, restaurar desde la rama anterior `sistema.html`, `assets/jaguar-premium.js`, `assets/jaguar-premium.css`, `assets/jaguar-academico-v55.js`, `assets/jaguar-classroom-v56.js` y la aserción de prueba modificada. Eliminar el nuevo archivo `assets/jaguar-workspaces.js` sólo después de restaurar `sistema.html`. El resto de archivos corresponde al paquete previo de calificaciones y no se debe retirar si estaba instalado. No revertir SQL automáticamente ni borrar registros; gestionar migraciones por separado.

## Límites pendientes
Agrupación visual de los administrativos, no unificación todavía de cada formulario o servicio interno. La matriz de atribuciones por acción, cuentas multiperfil, autorizaciones excepcionales y migración de menús heredados a un único registro de rutas son decisiones de una segunda fase. La seguridad efectiva debe validarse con API/Supabase; no se deduce de botones visibles. No se ha publicado ningún cambio ni conectado a producción.
