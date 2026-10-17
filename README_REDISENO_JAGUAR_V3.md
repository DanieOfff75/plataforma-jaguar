# Plataforma Jaguar · Rediseño Premium Académico (versión 3)

## Base y alcance

Esta entrega parte de **Plataforma-Jaguar-SETECFI-Garet-SinPagina4.zip**. Mantiene los módulos, permisos, formularios, APIs, boletas PDF (Garet, sello institucional y compactación de firmas), archivo, finanzas y controles que ya estaban en esa versión. **No se reemplazó la aplicación por una maqueta ni se reescribieron todos los procesos de negocio.** Se hizo un rediseño transversal de interfaz y se añadió un panel analítico.

## Qué se implementó

1. **Interfaz Jaguar Premium** en `assets/jaguar-premium.css`: menú lateral, cabecera, iconos, tarjetas, tablas, inputs, modales y disposición adaptable a móvil, con escudo ITHLA y tipografía Garet para textos; títulos serif institucionales.
2. **Modo claro/oscuro** desde el botón ☾/☀ de la cabecera. Persiste en el navegador mediante `localStorage` (`jaguar_display_mode_v3`). No cambia la paleta institucional guardada en Supabase.
3. **Navegación por rol sin eliminar entradas**: utiliza exactamente los arreglos `controlNav`, `roleNav`, `jaguarStudentSuspendedNav` del sistema original. No da acceso a módulos fuera de los permisos originales. En móvil, el menú se abre/cierra por botón.
4. **Buscador de módulos propios** en la cabecera; Enter localiza en el menú un módulo al que el usuario ya tiene acceso, Ctrl/Cmd+K enfoca la búsqueda. No busca registros de estudiantes ni bypass de permisos.
5. **Panel ejecutivo de Control Escolar y Dirección** con recuentos, barras de rangos de calificaciones, gráfico de anillo, tendencia de asistencia mensual, alumnos por grado, avisos y accesos rápidos. Siempre utiliza datos agregados de la API; sin datos muestra mensajes vacíos.
6. **Gráficas complementarias** para alumnos (sus propias calificaciones, únicamente con acceso vigente), docentes (asignaciones de sus grupos) y departamentos (contadores institucionales de la API ya existente), conservando sus paneles previos.
7. **Corrección puntual**: el directorio de encargados listaba dos veces Recursos Monetarios; se corrigió el duplicado.

## Nueva API

`GET /api/data?resource=dashboardAnalytics`: recurso de solo lectura que exige autenticación normal y **roles** de Dirección Escolar, Control Escolar o Coordinación Académica. Devuelve exclusivamente datos agregados. Usa hasta 5,000 calificaciones y 5,000 asistencias recientes por tipo para proteger el plan gratuito; muestra el aviso de muestra limitada cuando corresponde. No devuelve nombres, matrículas, IDs ni firmas.

Los porcentajes se calculan sobre registros válidos. Las calificaciones abarcan registros históricos consultados (no son automáticamente del periodo actual), y la gráfica de asistencia agrupa fechas de los registros recientes por mes. Los rangos son `0–5.9`, `6–6.9`, `7–7.9`, `8–8.9`, `9–10`.

## Instalación en GitHub / Vercel

Subir **todo el contenido** de `plataforma-jaguar-main/` a la raíz correspondiente del repositorio. Mantener los secretos de Supabase configurados en Vercel tal como estaban. Los nuevos recursos en `assets/` son estáticos y no requieren Chromium, Puppeteer ni Chart.js. Las dependencias de producción no se modificaron en esta entrega.

En la raíz del proyecto se puede ejecutar:

```bash
node tools/test_redesign.cjs
```

Luego desplegar en un entorno de **pruebas** y verificar con usuarios de cada rol: inicio de sesión, menús, ediciones/altas, descarga de boletas, registro de firmas, permisos, finanzas, archivo, modo oscuro y navegación móvil. No hacer una sustitución definitiva del sitio productivo sin estas comprobaciones.

## Pruebas realizadas y pendientes

**Realizadas:** comprobación sintáctica de archivos JS, revisión de HTML y estructura de IDs, pruebas automatizadas del recurso agregado (cálculo y roles), gráficos con datos de prueba, menús y alternancia de modo oscuro (`tools/test_redesign.cjs`).

**Pendientes:** revisión visual en un navegador de la implementación completa (el navegador de prueba de este entorno bloqueó la navegación), pruebas de integración contra **Supabase** y **Vercel**, y pruebas end-to-end de todos los procesos existentes. Por ello no se afirma que todos los posibles errores heredados hayan sido resueltos.

## Próxima iteración sugerida

Antes de sumar funcionalidades nuevas, conviene auditar cada módulo por rol con una cuenta de pruebas y un checklist de crear / editar / buscar / descargar / confirmar. Después de estabilizar, se podrían añadir filtros de estadísticas por **periodo, grado y grupo**, con reglas de permisos consistentes y exportación de reportes agregados, sin crear nuevas consultas pesadas.
