# Jaguar V5.7.3 · Creación de Classroom con formato institucional

## Nuevo flujo
En **Servicios Docentes → Google Classroom**, después de conectar Google, aparece **Crear clase en Google Classroom**. Selecciona grupo/materia, docente asignado y tratamiento **PROF.** o **PROFA.**; Jaguar muestra una vista previa y requiere confirmación antes de enviar una solicitud de creación.

Nombre: `GRADO°GRUPO | MATERIA` (ejemplo `1°F | BIOLOGÍA`).
Sección y descripción: `PROF. NOMBRE COMPLETO` o `PROFA. NOMBRE COMPLETO`, para reproducir tanto el texto que aparece debajo del título como los datos descriptivos de las clases manuales.

La clase se crea en Google con `ownerId: "me"` (el Gmail conectado de Servicios Docentes) y `courseState: "PROVISIONED"`. **Con cuentas Gmail personales Google prohíbe crear cursos directamente en estado `ACTIVE` mediante API**. Servicios Docentes debe entrar a Classroom con la cuenta propietaria y aceptar/activar la clase antes de compartirla. Si aún no hay código, Jaguar la deja en **Pendiente**; luego usa *Consultar mis Classroom → Actualizar datos* para recuperar el código y enlace, y en su caso pasarla a Registrada.

## Primera instalación de V5.7.3
1. Subir V5.7.3 completa conservando los archivos de V5.7.2 (o aplicar el parche, reemplazando exclusivamente los cuatro archivos incluidos).
2. Esperar despliegue de Vercel, abrir Jaguar y recargar `Ctrl + F5`.
3. En **Google Auth Platform → Acceso a los datos**, revisar el permiso `https://www.googleapis.com/auth/classroom.courses` además del permiso de lectura existente. En modo de prueba mantener a Servicios Docentes como usuario de prueba. La pantalla de consentimiento volverá a pedir autorización.
4. Dentro de Jaguar, **Desconectar Google** y **Conectar Gmail de Servicios Docentes** de nuevo; el permiso antiguo era de solo lectura. Esto **no elimina** clases existentes ni las asociaciones guardadas en Jaguar.
5. Seleccionar una materia **sin Google Classroom ya vinculado**, el docente asignado y su tratamiento. Comprobar vista previa y confirmar **Crear clase en Google**.
6. Entrar a Google Classroom con Servicios Docentes y activar/aceptar el curso creado. Actualizar datos en Jaguar.

## Seguridad y preservación
- Solo el rol `servicios_docentes` puede crear; se valida origen HTTPS, pertenencia del docente a la asignación activa, ciclo y coincidencia con vista previa.
- Nunca se envían claves privadas ni tokens al navegador.
- Se comprueba si el grupo/materia ya tiene Google Classroom y si otra clase accesible, no archivada, tiene el mismo nombre. Si existe, primero se debe vincular desde *Consultar mis Classroom*.
- No se renombran, archivan, eliminan ni modifican las clases preexistentes; no se cambian calificaciones.
- Si la clase se crea en Google pero el registro local falla, la API devuelve el ID de la clase y pide vincularla manualmente en vez de duplicarla.
- El tratamiento del docente se elige explícitamente porque `docentes` no guarda una abreviatura confiable PROF./PROFA.
- **No necesitas ejecutar SQL nuevo**, agregar variables de Vercel ni cambiar la URI OAuth. La API mantiene **10 entradas**, compatible con el límite de 12 funciones de Hobby.

## Límites y siguientes fases
Esta versión crea una clase individual previa confirmación. **No** invita automáticamente al docente como coprofesor ni crea secciones «PRIMER PERIODO»: son etapas posteriores que necesitarán permisos OAuth adicionales y pruebas reales. En cuentas Gmail personales Google puede rechazar la creación si la cuenta está limitada, no cumple requisitos de Classroom o tiene restricciones de Google. Si ocurre, no reintentes varias veces sin consultar primero las clases existentes.

Referencia: https://developers.google.com/workspace/classroom/guides/manage-courses
