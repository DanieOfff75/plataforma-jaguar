# Jaguar 360 V41 — Organización de planificación de ciclos

Requiere V40 instalada. Reemplaza exclusivamente los dos archivos de la carpeta `assets/` en el repositorio Plataforma Jaguar. No ejecutar SQL, no reemplazar boletas ni otros archivos.

La primera pantalla es un resumen con accesos por botones. Configurar ciclo abre un selector, luego ocho secciones: estructura/calendario, asignaturas, evaluación, asistencia, regularización, continuidad, horarios y revisión/guardado. Se conservan los 41 criterios del formulario de V40 y el mismo contrato de API. Los botones de navegación mantienen el estado del formulario en memoria mientras se permanece en este módulo; salir por el menú general o recargar puede perder los cambios sin guardar. Al cambiar ciclo o abrir evaluación por materia desde aquí se advierte si hay cambios. Los errores de guardado permiten saltar a la sección correspondiente.

El cierre y evidencia tiene una pantalla propia. Gestión avanzada separa trayectoria, convocatorias, apertura, movimientos/reinscripción, carga docente y gobierno/horarios. Las reglas de permisos y los límites de las operaciones existentes no se modifican: las operaciones restringidas no se convierten en operativas por cambiar su nombre o ubicación. Las instrucciones técnicas siguen disponibles en sus respectivas pantallas.

Verificación: sintaxis Node de ambos archivos; comprobación de Chromium con los cuatro scripts de interfaz de V40/V38 y API simulada: navegación, los 41 criterios enviados al guardar, selección de catálogo, salto al campo inválido, preservación entre secciones, acceso por rol, vista móvil básica. No se comprobó el servidor Supabase real ni el despliegue Vercel. No se modificaron el diseño de boleta, las APIs ni las migraciones.

Después de desplegar, Ctrl+F5. Ruta: Gobierno institucional → Planificación de ciclos.
