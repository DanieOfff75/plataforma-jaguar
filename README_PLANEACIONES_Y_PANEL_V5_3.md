# Plataforma Jaguar V5.3 — Planeaciones y panel de Control Escolar

Esta actualización parte **directamente de Jaguar V5.2**, conservando sus generadores de documentos, estilos, credenciales, boletas, horarios, fotografías, permisos de los demás módulos y firmas.

## Correcciones

1. **Enrutamiento de Planeaciones Docentes.** El botón aparecía en el menú de Control Escolar y Dirección, pero `pageHtml('planeaciones')` sólo resolvía el módulo para Docente y Servicios Docentes. Al hacer clic se terminaba mostrando el `dashboard()` anterior. Ahora resuelve correctamente `jaguarArchiveModule('planeaciones')` para los perfiles autorizados.
2. **Permisos específicos en API.** `getTeacherPlans`, `reviewTeacherPlanning` y los adjuntos de `getArchivePathUrl` ahora aceptan perfiles de revisión académica permitidos. Un alumno, personal de Prefectura o Servicios Estudiantiles no puede consultar planeaciones por esas rutas. Un docente conserva lectura exclusivamente de sus propias planeaciones, y **no** recibe permisos de revisión de las ajenas. Este cambio **no** concede acceso general a expedientes escolares.
3. **Navegación coherente.** La pantalla de Planeaciones permanece marcada y muestra un título adecuado, en lugar de abrir el menú de Archivo Escolar y desaparecer de la navegación. El menú de Control Escolar utiliza ahora `roleNav.control_escolar` y vuelve a incluir también la Bitácora Excel ya definida para ese rol.
4. **Inicio Premium persistente.** Ante un fallo en `dashboard` el sistema ya no regresa a `v22Dashboard`. El diseño Premium se mantiene, presenta indicadores `—` donde faltan datos y muestra un aviso informativo. Las demás acciones continúan visibles.
5. **Acciones y vista previa.** Los botones de documento usan identificadores de una lista controlada en lugar de insertar objetos JSON completos en atributos HTML. El visor previo toma el periodo del campo correcto (`pl_periodo`). Las acciones de revisión sólo corresponden a transiciones admitidas (`enviada → revisada/devuelta`, `revisada → cerrada`). Cancelar un cuadro de revisión no cambia el estado.

## Archivos modificados

- `index.html`
- `api/data.js`
- `assets/jaguar-premium.js`

Se añadieron esta guía y dos pruebas automatizadas. **No se tocaron** `api/reports.js`, el generador de boletas, el de credenciales, los horarios PDF, la verificación documental ni las hojas de estilo.

## Pruebas sin dependencias adicionales

Desde la raíz del proyecto, con Node:

```sh
node tools/test_planeaciones_v53.cjs
node tools/test_planeaciones_api_v53.cjs
node --check api/data.js
node --check assets/jaguar-premium.js
```

Las pruebas de ejecución simulan perfiles, rutas, estados y errores de consulta, **no usan expedientes reales**.

## Verificación imprescindible antes de publicar

1. En una rama de pruebas conectada a Supabase, iniciar sesión con **Control Escolar**, abrir **Planeaciones docentes** y comprobar consulta, documentos adjuntos, versión, observaciones y acciones de revisión.
2. Con una cuenta **Docente**, crear un borrador, consultar la vista previa, enviarlo y comprobar que no aparezcan botones de aprobación.
3. Volver a **Control Escolar**, marcar la planeación como revisada o devolverla con observaciones. Probar también el cierre de una planeación revisada.
4. Comprobar el mismo flujo con los perfiles Dirección y Servicios Docentes, y asegurar que un alumno no tenga acceso.
5. Volver al Inicio y confirmar que muestra el dashboard Premium tanto si hay estadísticas como si alguna consulta falla.
6. Verificar que las tablas de Supabase `planeaciones_docentes`, `docentes`, `grupo_materias` y sus relaciones estén configuradas. Esta versión no requiere cambios de esquema si ya funcionaban anteriormente.

Las pruebas locales no sustituyen una comprobación extremo a extremo con tus credenciales y datos reales de Supabase ni una revisión en Vercel. Nada se ha publicado automáticamente.
