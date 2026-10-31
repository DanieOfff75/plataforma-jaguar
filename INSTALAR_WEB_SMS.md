# Plataforma Jaguar · Integración SMS Gateway V5

## Alcance
Este paquete contiene **solamente archivos nuevos o modificados de Plataforma Jaguar**. Se basa en `plataforma-jaguar-main (16).zip`. **NO se reemplaza** la plataforma completa. No modifica `recuperar.html`, el correo OTP ni los diseños generales. No hay documentos Android aquí.

## Archivos modificados

- `sistema.html`: agrega menú `Pasarela SMS` únicamente a `tecnico` y reutiliza las tarjetas y botones existentes.
- `assets/jaguar-sms-admin.js`: panel técnico (QR, inventario, pausar/reactivar/revocar, límites, pruebas e historial).
- `lib/jaguar_sms_gateway.js`: autenticación de dispositivo, emparejamiento, reportes, telemetría y reclamo de trabajos.
- `api/sms-gateway.js`: entrada existente, NO agrega otra función Vercel.
- `package.json`: añade la dependencia `qrcode` para generar el PNG del QR **en el servidor**, sin CDN de QR.
- `sql/JAGUAR_SMS_GATEWAY_V5.sql`: esquema separado V5 y funciones de acceso restringido.

## 0. Antes de aplicar

1. Haz un respaldo de tu repo y de Supabase, y trabaja en una rama nueva.
2. Asegúrate de que **nunca** desplegaste V4/V5 con la misma tabla a mano; el SQL no elimina objetos de V2/V4.
3. Verifica en Supabase que existen las tablas `perfiles`, `ithla_sesiones`, `ithla_config` y que tu usuario tiene `rol = tecnico` y `activo = true`.
4. Conserva **correo OTP como único canal de recuperación** durante estas pruebas.

## 1. Instalar SQL

Supabase → SQL Editor → Nueva consulta → pega `sql/JAGUAR_SMS_GATEWAY_V5.sql` y ejecuta. Debe terminar sin errores. Recomendamos **primero una base de pruebas**; no podemos simular aquí tu proyecto real.

Se crean las tablas `jaguar_sms_v5_devices`, `jaguar_sms_v5_pairings`, `jaguar_sms_v5_jobs` y `jaguar_sms_v5_events`; funciones `jaguar_sms_v5_redeem`, `jaguar_sms_v5_claim`, `jaguar_sms_v5_report`, `jaguar_sms_v5_maintain`. No se habilita acceso anónimo a esas tablas ni a sus RPC.

## 2. Actualizar código

Copia **solo** los archivos del ZIP a esas mismas rutas en tu repositorio, sustituyendo los archivos que ya existan. Verifica los cambios del monolito `sistema.html` con un diff; no sustituye sus estilos ni menús de otros roles. `package.json` incorpora `qrcode`, por lo que el siguiente deploy debe instalar dependencias.

Commit y push a la rama de prueba. Vercel detectará la ruta existente `/api/sms-gateway` como la única función de SMS.

## 3. Variables en Vercel

Ya usadas por Jaguar:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (o `SUPABASE_SECRET_KEY`)

Nueva variable opcional para probar SMS:
- `JAGUAR_SMS_TEST_NUMBER` = número **tuyo** autorizado en formato E.164, por ejemplo `+5255XXXXXXXX` (cifra completa real, sin X ni espacios).

**NO crees** `JAGUAR_SMS_DEVICE_TOKEN`: los dispositivos obtienen automáticamente credenciales diferentes al escanear QR. **No publiques** las claves service role en el frontend, Android ni este chat.

## 4. Panel técnico

Despliega y entra normalmente a `https://plataforma-jaguar.vercel.app/sistema.html` con un usuario cuyo perfil es `tecnico`. Aparecerá `Pasarela SMS`. Pulsa **Generar QR temporal**, escanéalo con la nueva APK, comprueba que el equipo aparece `pending` y que reporta su última conexión una vez iniciado el servicio en el teléfono; verifica modelo y pulsa **Aprobar teléfono** para habilitarlo. La aprobación técnica posterior es obligatoria. El QR caduca en 180 segundos y solo se canjea una vez. **No compartas imágenes del QR mientras sea válido.**

No se piden tokens manuales ni páginas HTML adicionales. El panel usa el JWT de Supabase **más** `X-ITHLA-Session`, validados mediante `requireRoles(req,['tecnico'])`.

## 5. Prueba end-to-end

1. Comprueba que **Actualizar** muestre el Motorola registrado como pendiente; verifica su modelo y pulsa **Aprobar teléfono**.
2. Configura `JAGUAR_SMS_TEST_NUMBER` en Vercel y vuelve a desplegar.
3. En el dispositivo: SIM predeterminada para SMS, permisos y servicio activo, notificación visible.
4. Desde Jaguar, pulsa **Crear SMS de prueba**. No más de cinco pruebas por día.
5. Revisa en el panel los cambios `queued → claimed → submitted → sent → delivered` (el estado `delivered` depende del operador). Un fallo o reporte ausente puede dejar `failed` o `uncertain`, sin reintento automático.
6. Pulsa **Pausar** un dispositivo: debe dejar de reclamar trabajo. Revoca un equipo y comprueba que ya no puede consultar la cola.
7. Con dos/tres teléfonos, comprueba que los trabajos se reparten entre equipos disponibles en vez de quedarse en el que consulta primero. El algoritmo da una preferencia de 20s al que menos reclamó en la última hora; luego libera el trabajo para evitar esperas indefinidas. Si la batería cae bajo 10%, no se reclama trabajo nuevo.

## 6. Seguridad / limitaciones

- El OTP por correo no se modifica ni se activa el SMS de recuperación: **antes se requiere un teléfono de recuperación registrado y verificado por el propietario**, además de pruebas físicas.
- La cola contiene el texto de un SMS temporalmente. Se vacía cuando se informa un estado y en el mantenimiento por sondeo. El historial del panel muestra solo metadatos y destinatario oculto.
- No hay reintentos automáticos de SMS con resultado incierto; duplicar un código es peor que un mensaje fallido.
- Se usan TLS, token distinto por dispositivo (solo su SHA-256 en base de datos), revocación, RLS, mínimo privilegio y sesión técnica.
- El polling de tres teléfonos cada 40 s implica aprox. **194,400 consultas mensuales** (30 días, una por teléfono cada 40 s), más reportes y administración. Verifica los límites vigentes de Vercel antes de dejarlo encendido 24/7. Para alta escala, se recomienda pasar a una infraestructura always-on o un mecanismo de entrega por eventos.
- Android puede suspender el servicio; no es un SLA de envío garantizado.

## 7. Rollback

Si falla el despliegue, **revierte solamente estos cinco archivos web** mediante git (vuelve al commit anterior). Como V5 usa tablas aisladas, no es necesario borrar las tablas nuevas para restablecer V2/correo. **No hagas `DROP TABLE` en producción sin revisar referencias y respaldos.** Detén el servicio en cada APK de pruebas.

## Validaciones realizadas fuera de tu infraestructura

Comprobación de sintaxis JS y revisión estática de las transiciones de SQL y rutas. **No se ha podido ejecutar una migración contra tu Supabase, ni hacer build en Vercel, ni compilar Android en un SDK completo, ni enviar un SMS con SIM desde aquí.** Completa la prueba end-to-end antes de marcar el sistema como listo para producción.
