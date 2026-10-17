# Jaguar V5.6 — Classroom, etapa 1: registro y directorio de códigos

**Base:** Plataforma Jaguar V5.5. No reemplaza ninguna pantalla, boleta, credencial, horario, planeación, rúbrica ni módulo académico. **No se ha probado con Supabase/Vercel reales** y NO se conecta todavía a la cuenta Gmail.

## Qué incluye

- Menú **Google Classroom** en Servicios Docentes, y consulta en perfiles docentes/roles académicos autorizados.
- Una clase prevista por **grupo + materia + ciclo escolar**; clave de unicidad que impide registrar duplicados del mismo ciclo.
- Selección del docente validada contra `asignaciones_docentes` del ciclo actual; no acepta un docente ajeno a esa clase.
- Datos manuales: nombre, descripción, código de unión, URL de `classroom.google.com`, ID de curso (opcional) y estado pendiente/registrada/archivada.
- Enlaces aceptados sólo si usan HTTPS y dominio oficial `classroom.google.com`.
- Los docentes sólo ven clases vinculadas a las materias que tienen asignadas; no pueden modificarlas.
- **Directorio PDF por grupo** para personal escolar autorizado, con materias y docentes actuales; muestra clases pendientes y los códigos registrados. No se publica una lista de códigos en la web pública.
- Los cambios se registran con `creado_por`, `actualizado_por` y marcas temporales.

## Orden para probar sin arriesgar producción

1. **No reemplaces el sitio público todavía.** Crea una rama de GitHub y un despliegue Preview de Vercel. Respalda la base y emplea Supabase de pruebas.
2. Instala previamente las migraciones de V5.4 y V5.5 si esa base aún no las tiene. Luego aplica `sql/JAGUAR_V5_6_CLASSROOM_FASE1.sql` mediante Supabase SQL Editor.
3. Despliega este ZIP (es proyecto completo basado en V5.5) y verifica que `/api/classroom?action=bootstrap` **requiere sesión**.
4. En Servicios Docentes → **Google Classroom**, selecciona una materia-grupo del ciclo activo y registra una clase que ya exista en Google; puedes dejarla **pendiente** sin código.
5. Comprueba que un docente sin asignación no se puede guardar y que el mismo grupo-materia se actualiza, no duplica.
6. Descarga el PDF por grupo y comprueba que nombres, materias y códigos son correctos. Prueba un grupo con clases pendientes.
7. Verifica que un alumno no pueda acceder a la API y que un docente vea únicamente sus clases asignadas.
8. Prueba la navegación en claro y oscuro y que los módulos V5.5 continúan funcionando.

## Limitaciones actuales — importantes

- **No se crean clases ni se mandan invitaciones en Google desde Jaguar.** El registro y el PDF funcionan tras aplicar SQL, pero la automatización requiere la **etapa 2 OAuth**, pruebas con el Gmail de Servicios Docentes y las APIs autorizadas.
- El formulario del generador de exámenes V5.5 sigue exportando Apps Script manual; **para respetar la propiedad centralizada, sólo debe ejecutarlo la cuenta Google de Servicios Docentes**, no la del docente. En la etapa 2 se sustituirá por creación integrada y reparto de permisos.
- No se han probado endpoints con credenciales reales de Supabase ni la generación PDF con `pdf-lib` instalado en este entorno. Hasta completar esas pruebas, NO publicar en producción.
- No se incluyen datos de cuentas, contraseñas, tokens OAuth o client secrets en el ZIP.

## Etapa 2 — conexión gratuita con Gmail personal (aún no implementada)

1. Crear un proyecto de Google Cloud con el titular **Servicios Docentes**.
2. Configurar pantalla de consentimiento OAuth para usuarios externos y habilitar la API de Google Classroom; para Forms, habilitar también Forms API y Drive API con los permisos estrictamente necesarios.
3. Registrar como URI de redirección el endpoint HTTPS real de la instalación Preview/producción en Vercel.
4. Vincular mediante el flujo OAuth, con consentimiento explícito del titular, y guardar los tokens **sólo en un almacén privado del servidor**. Nunca enviarlos al navegador ni guardarlos en tablas accesibles por alumnos o docentes.
5. Probar primero crear **una** clase en Classroom, recuperar `id`, `enrollmentCode` y `alternateLink`, y mandar una invitación al docente que éste debe aceptar.
6. Sincronizar clases existentes en lugar de crearlas por duplicado. Añadir control de cupos/cuotas y reintentos con identificadores idempotentes.
7. Sólo después automatizar Google Forms y su cesión de permisos de edición; implementar revisión humana por matrícula antes de notas de rúbricas.

**Ojo con OAuth en modo «Testing»:** Google indica que los tokens de actualización para apps externas en pruebas (con permisos diferentes de perfil/email básicos) expiran aproximadamente a los **7 días**. Debemos diseñar la transición a producción/validación de Google o la reconexión conforme a sus políticas; no prometer conexión perpetua sin verificarlo.

Documentación oficial:
- Google Classroom: https://developers.google.com/workspace/classroom/reference/rest/v1/courses/create
- Invitaciones docentes: https://developers.google.com/workspace/classroom/reference/rest/v1/invitations/create
- OAuth y caducidad: https://developers.google.com/identity/protocols/oauth2
- Google Forms: https://developers.google.com/workspace/forms/api/reference/rest/v1/forms/create

## Archivos nuevos/actualizados

- `api/classroom.js`: API autenticada con verificación de rol y asignaciones.
- `lib/classroom_rules.js`: normalización, enlaces y permisos.
- `lib/classroom_pdf.js`: PDF institucional.
- `assets/jaguar-classroom-v56.js`: nueva pantalla.
- `sql/JAGUAR_V5_6_CLASSROOM_FASE1.sql`: tabla privada, unicidad y permisos.
- `tools/test_v56_classroom.mjs`: pruebas puras de reglas.
- `index.html`: registra la ruta y carga el módulo.
- `assets/jaguar-academico-v55.js`: aclara qué Gmail debe ejecutar la exportación manual de Forms.
