# Jaguar 360 · Catálogo funcional de navegación

**Fase 1 — inventario del código local y organización visual.** Este documento se generó a partir de las rutas efectivas de `roleNav` en el navegador con datos de demostración. Es un inventario de accesos de interfaz, no una certificación de los permisos efectivos de Supabase ni una aprobación de cambios de atribuciones. El alias `control` es heredado; no se convierte en un nuevo departamento. El catálogo incluye rutas visibles en el menú, no todos los botones, APIs ni operaciones internas de cada módulo.

## Conservación de accesos

| Perfil | Antes | Después | Rutas retiradas |
|---|---:|---:|---:|
| Administrador técnico (`tecnico`) | 4 | 4 | 0 |
| Docente (`docente`) | 15 | 15 | 0 |
| Alumno (`alumno`) | 9 | 9 | 0 |
| Servicios Docentes (`servicios_docentes`) | 15 | 15 | 0 |
| Servicios Estudiantiles (`servicios_estudiantiles`) | 13 | 13 | 0 |
| Prefectura (`prefectura`) | 9 | 9 | 0 |
| Coordinación Académica (`coordinacion_academica`) | 19 | 20 | 0 |
| Dirección Escolar (`direccion_escolar`) | 32 | 32 | 0 |
| Control Escolar (`control_escolar`) | 30 | 30 | 0 |
| Archivo Escolar (`archivo_escolar`) | 10 | 10 | 0 |
| Recursos Monetarios (`recursos_monetarios`) | 8 | 8 | 0 |
| Control Escolar (alias heredado) (`control`) | 29 | 29 | 0 |

Total: 193 accesos distribuidos por perfil antes y 194 después (la ruta `config` ya existente vuelve a mostrarse en Coordinación Académica).

## Secciones por perfil

### Administrador técnico

- **Inicio:** Inicio (`inicio`).
- **Comunicaciones:** Notificaciones y oficios (`notificaciones`).
- **Configuración y seguridad:** Pasarela SMS (`sms_gateway`).
- **Mi perfil:** Perfil (`perfil`).

### Docente

- **Inicio:** Inicio (`inicio`).
- **Mis grupos:** Mis grupos (`grupos`); Asistencia (`asistencia`); Consulta de notas (`calificaciones`); Bitácora Excel (`bitacora_calificaciones`).
- **Mi horario:** Mi horario (`horario`).
- **Centro didáctico:** Planeaciones (`planeaciones`); Centro de Creación Didáctica (`centro_didactico`); Google Classroom (`classroom`); Banco de exámenes (`examenes`).
- **Comunicaciones:** Notificaciones y oficios (`notificaciones`); Avisos (`avisos`); Aclaraciones (`clarificaciones`).
- **Mis trámites:** Mis relevos (`mis_relevos`).
- **Mi perfil:** Perfil (`perfil`).

### Alumno

- **Inicio:** Inicio (`inicio`).
- **Vida académica:** Mis calificaciones (`calificaciones`); Mi asistencia (`asistencia`).
- **Mi horario:** Mi horario (`horario`).
- **Mis trámites:** Mis trámites (`tramites_360`); Solicitudes (`solicitudes_taller`).
- **Mis pagos:** Mis pagos (`mis_pagos`).
- **Comunicaciones:** Avisos (`avisos`).
- **Mi perfil:** Perfil (`perfil`).

### Servicios Docentes

- **Inicio:** Inicio (`inicio`).
- **Alumnos y grupos:** Grupos (`grupos`).
- **Organización académica:** Aulas (`aulas`); Google Classroom (`classroom`).
- **Evaluación y seguimiento:** Bitácora Excel (`bitacora_calificaciones`).
- **Personal docente:** Docentes (`docentes`); Carga docente (`carga_docente`); Bajas y relevos docentes (`relevos_docentes`).
- **Trabajo didáctico:** Planeaciones (`planeaciones`).
- **Atención y trámites:** Cambio especial de grado (`cambios_especiales`).
- **Comunicaciones:** Notificaciones y oficios (`notificaciones`); Avisos (`avisos`); Oficios por firmar (`oficios_firma`); Contenido público (`portal_publico`).
- **Mi perfil:** Perfil (`perfil`).

### Servicios Estudiantiles

- **Inicio:** Inicio (`inicio`).
- **Alumnos y grupos:** Alumnos (`alumnos`); Talleres e inscripciones (`talleres`); Credenciales (`credenciales`).
- **Organización académica:** Horarios por grupo (`horarios`).
- **Atención y trámites:** Trámites presenciales (`tramites_360`); Solicitudes (`solicitudes_taller`); Cambio especial de grado (`cambios_especiales`).
- **Comunicaciones:** Notificaciones y oficios (`notificaciones`); Avisos (`avisos`); Oficios por firmar (`oficios_firma`); Contenido público (`portal_publico`).
- **Mi perfil:** Perfil (`perfil`).

### Prefectura

- **Inicio:** Inicio (`inicio`).
- **Atención y trámites:** Trámites presenciales (`tramites_360`); Cambio especial de grado (`cambios_especiales`); Incidencias (`incidencias`).
- **Comunicaciones:** Notificaciones y oficios (`notificaciones`); Avisos (`avisos`); Oficios por firmar (`oficios_firma`); Contenido público (`portal_publico`).
- **Mi perfil:** Perfil (`perfil`).

### Coordinación Académica

- **Inicio:** Inicio (`inicio`).
- **Alumnos y grupos:** Alumnos (`alumnos`); Grupos y listas (`grupos`).
- **Organización académica:** Materias (`materias`); Asignaciones (`cargas`); Horas por materia (`horas_materias`); Horarios (`horarios`); Aulas (`aulas`); Google Classroom (`classroom`).
- **Personal docente:** Docentes (`docentes`); Bajas y relevos docentes (`relevos_docentes`).
- **Trabajo didáctico:** Planeaciones docentes (`planeaciones`).
- **Atención y trámites:** Solicitudes (`solicitudes_taller`); Cambio especial de grado (`cambios_especiales`).
- **Comunicaciones:** Notificaciones y oficios (`notificaciones`); Avisos (`avisos`); Oficios por firmar (`oficios_firma`); Contenido público (`portal_publico`).
- **Configuración y seguridad:** Criterios académicos (`config`).
- **Mi perfil:** Perfil (`perfil`).

### Dirección Escolar

- **Inicio:** Inicio (`inicio`).
- **Alumnos y grupos:** Alumnos y grupos (`alumnos`); Grupos (`grupos`).
- **Organización académica:** Materias (`materias`); Horarios (`horarios`); Aulas (`aulas`); Google Classroom (`classroom`).
- **Evaluación y seguimiento:** Consulta de notas (`calificaciones`); Bitácora Excel (`bitacora_calificaciones`); Apertura de evaluaciones (`ventanas_evaluacion`); Carga masiva (`calificaciones_masivas`).
- **Personal docente:** Docentes (`docentes`); Bajas y relevos docentes (`relevos_docentes`).
- **Trabajo didáctico:** Planeaciones docentes (`planeaciones`).
- **Atención y trámites:** Trámites presenciales (`tramites_360`); Solicitudes (`solicitudes_taller`); Cambio especial de grado (`cambios_especiales`); Prefectura (`incidencias`).
- **Finanzas:** Recursos monetarios (`recursos_monetarios`).
- **Comunicaciones:** Notificaciones y oficios (`notificaciones`); Avisos (`avisos`); Oficios por firmar (`oficios_firma`); Contenido público (`portal_publico`).
- **Gobierno institucional:** Admisiones (`admision_control`); Departamentos (`departamentos`); Encargados departamentales (`encargados`); Datos de la institución (`institucion`); Estadísticas institucionales (`estadisticas`).
- **Configuración y seguridad:** Usuarios (`usuarios`); Auditoría (`auditoria`); Salud Jaguar (`salud_360`).
- **Mi perfil:** Perfil (`perfil`).

### Control Escolar

- **Inicio:** Inicio (`inicio`).
- **Alumnos y grupos:** Alumnos y grupos (`alumnos`); Grupos (`grupos`); Listas por grupo (`listas`); Talleres (`talleres`).
- **Organización académica:** Materias (`materias`); Horarios (`horarios`); Aulas (`aulas`); Google Classroom (`classroom`).
- **Evaluación y seguimiento:** Consulta de notas (`calificaciones`); Bitácora Excel (`bitacora_calificaciones`); Asistencia (`asistencia`); Carga masiva (`calificaciones_masivas`).
- **Personal docente:** Docentes (`docentes`).
- **Trabajo didáctico:** Planeaciones docentes (`planeaciones`).
- **Atención y trámites:** Trámites presenciales (`tramites_360`); Cambios de grupo (`solicitudes_taller`); Solicitudes académicas (`solicitudes_academicas`); Cambio especial de grado (`cambios_especiales`); Revisiones de acceso (`revision_acceso`).
- **Documentación:** Documentos verificables (`documentos`).
- **Comunicaciones:** Notificaciones y oficios (`notificaciones`); Gestionar avisos (`avisos`); Oficios por firmar (`oficios_firma`); Contenido público (`portal_publico`).
- **Configuración y seguridad:** Configuración (`config`); Usuarios (`usuarios`); Auditoría (`auditoria`); Salud Jaguar (`salud_360`).
- **Mi perfil:** Perfil (`perfil`).

### Archivo Escolar

- **Inicio:** Inicio (`inicio`).
- **Atención y trámites:** Trámites presenciales (`tramites_360`).
- **Documentación:** Archivo escolar (`archivo`); Documentos oficiales (`documentos_oficiales`); Retención documental (`retencion`).
- **Comunicaciones:** Notificaciones y oficios (`notificaciones`); Avisos (`avisos`); Oficios y firmas (`oficios_firma`); Contenido público (`portal_publico`).
- **Mi perfil:** Perfil (`perfil`).

### Recursos Monetarios

- **Inicio:** Inicio (`inicio`).
- **Atención y trámites:** Trámites presenciales (`tramites_360`).
- **Finanzas:** Recursos monetarios (`recursos_monetarios`).
- **Comunicaciones:** Notificaciones y oficios (`notificaciones`); Avisos (`avisos`); Oficios por firmar (`oficios_firma`); Contenido público (`portal_publico`).
- **Mi perfil:** Perfil (`perfil`).

### Control Escolar (alias heredado)

- **Inicio:** Inicio (`inicio`).
- **Alumnos y grupos:** Alumnos y grupos (`alumnos`); Grupos (`grupos`); Listas por grupo (`listas`); Talleres (`talleres`).
- **Organización académica:** Materias (`materias`); Horarios (`horarios`); Aulas (`aulas`).
- **Evaluación y seguimiento:** Consulta de notas (`calificaciones`); Bitácora Excel (`bitacora_calificaciones`); Asistencia (`asistencia`); Carga masiva (`calificaciones_masivas`).
- **Personal docente:** Docentes (`docentes`).
- **Trabajo didáctico:** Planeaciones docentes (`planeaciones`).
- **Atención y trámites:** Trámites presenciales (`tramites_360`); Cambios de grupo (`solicitudes_taller`); Solicitudes académicas (`solicitudes_academicas`); Cambio especial de grado (`cambios_especiales`); Revisiones de acceso (`revision_acceso`).
- **Documentación:** Documentos verificables (`documentos`).
- **Comunicaciones:** Notificaciones y oficios (`notificaciones`); Gestionar avisos (`avisos`); Oficios por firmar (`oficios_firma`); Contenido público (`portal_publico`).
- **Configuración y seguridad:** Configuración (`config`); Usuarios (`usuarios`); Auditoría (`auditoria`); Salud Jaguar (`salud_360`).
- **Mi perfil:** Perfil (`perfil`).

## Catálogo de capacidades compartidas (primera aproximación)

La columna «entrada canónica» indica el módulo existente al que debe dirigir una mejora; puede haber operaciones distintas dentro de un mismo módulo. No autoriza a quitar rutas homologadas. Solicitar/revisar/autorizar/ejecutar son capacidades distintas y deben verificarse contra cada operación del servidor antes de modificar permisos.

| Capacidad | Entrada canónica / funciones que se reutilizan | Distinguir de |
|---|---|---|
| Asignación docente y grupo | `teacherGroupsModule`, `normalizeTeacherAssignmentRows`, `teacherGroups` | Alta administrativa del grupo, asignación de docentes |
| Listas docentes | `teacherRosterModal`, `downloadRosterExcel`, `jaguarFormalListMenu` | Listas administrativas de grupo |
| Asistencia | `teacherAttendanceModule`, `jaguarAttendanceGroup`, `jaguarAttendancePeriod`, `saveTeacherAttendance` | Incidencias y justificantes de Prefectura |
| Evaluación | `openTeacherEvaluationHub`, `openEvaluationEditor`, `openEvaluationCapture` | Consulta de notas oficiales, no una segunda captura |
| Importación del total oficial | `openExcelGradeAdoption`, `previewDailyDraftToEvaluation`; API preservada del paquete anterior | Componentes ponderados; no recalcular ni aplicar otro redondeo |
| Bitácora diaria | `jaguarDailyGradebookModule`, `openDailyGradebook`, `showDailyUploadModal` | Respaldo académico, no publicación oficial |
| Política de evaluación | `jaguarSchoolCycleConfig`, `gradePrecisionPolicy` | Apertura de periodos a cargo de Dirección, ruta `ventanas_evaluacion` |
| Banco de exámenes | `jaguarExamenesModule` | Clasificación de actividades Google Classroom |
| Classroom | `jaguarClassroomModule` | Propiedad y vinculación gestionadas en el módulo existente de Servicios Docentes |
| Planeaciones | `jaguarArchiveModule('planeaciones')`, `jaguarDidacticPage` | Creación con NEXO y revisión de planeaciones (distintas etapas) |
| Oficios | `jaguarNotificationsModule`, `jaguarOfficialApprovalsModule`, `api/reports.js` | Recepción, firma y generación documental |
| Trámites presenciales | `tramites_360`, `assets/jaguar360.js` | Solicitudes académicas específicas y aclaraciones (conservar flujos distintos) |
| Relevos docentes | `jaguarTeacherTransitionPage`, `jaguarTeacherHandoverPage` | Asignación de materias y gestión laboral |
| Expedientes | `jaguarArchiveModule` | Permisos de consulta y solicitudes de transparencia |
| Seguridad | `assets/jaguar-session-guard.js`, `assets/jaguar-shield-ui.js`, pasarela `sms_gateway` | No habilitar funciones académicas al técnico |

## Acuerdos de arquitectura propuestos y pendientes de validar

- Mantener un solo catálogo de agrupación de interfaz (`assets/jaguar-workspaces.js`), alimentado por las rutas actualmente disponibles. Una nueva ruta no clasificada se muestra en «Otros módulos» en lugar de desaparecer.
- Mantener el servidor, los roles y Supabase como autoridad de acceso. Esta fase no crea un sistema de permisos nuevo, no concede permisos a Dirección y no convierte a todos los departamentos en superadministradores.
- Ante una mejora, ubicar primero la entrada canónica, sus APIs, tablas, permisos y pruebas. Aprobar explícitamente la migración de cualquier permiso antes de tocarlo.
- En la siguiente fase, inventariar cada operación de servidor (lectura, creación, modificación, solicitud, revisión, autorización, exportación y auditoría), identificar duplicidades reales y unificar sólo tras comprobar paridad funcional. La navegación compartida no demuestra todavía que los módulos internos sean únicos.
