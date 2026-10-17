# Plataforma Jaguar V5.7 — conexión OAuth Google, etapa 2

**Base:** V5.6 + todas las funciones existentes. Esta actualización implementa autorización OAuth segura para **Servicios Docentes**, lectura de sus clases Google Classroom y vinculación supervisada con los grupo-materias de Jaguar. **Todavía no crea cursos en Google, no envía invitaciones, no crea Forms ni importa notas.**

## 1. Seguridad y requisitos

- Gmail de Servicios Docentes debe ser **usuario de prueba** si la aplicación OAuth está en estado de prueba.
- En Google Cloud → APIs: habilitar **Google Classroom API**; las otras APIs (Forms y Drive) se utilizarán en fases posteriores.
- OAuth de tipo **Aplicación web**, con **origen autorizado** `https://plataforma-jaguar.vercel.app` y **URI de redirección exacta** `https://plataforma-jaguar.vercel.app/api/google-oauth-callback`.
- Permisos de esta fase: `openid`, `email` y `https://www.googleapis.com/auth/classroom.courses.readonly`.
- Esta etapa no usa bibliotecas Google de pago, ni Google Workspace, ni añade servicios con facturación. Las cuotas y políticas de Google siguen vigentes.
- **Nunca publiques credenciales privadas en GitHub, código HTML, archivos de ejemplo ni capturas.**

## 2. Instalación (primero PRUEBAS)

1. Conserva copia del proyecto y de la base Supabase. Instala previamente las migraciones V5.4–V5.6 **si todavía no están aplicadas**.
2. En una base Supabase de PRUEBAS, ejecuta `sql/JAGUAR_V5_7_GOOGLE_OAUTH.sql`. No crea usuarios ni cambia notas.
3. Despliega Jaguar V5.7 en un entorno de pruebas. Si usas una URL Preview diferente a la de producción, registra **esa URL Preview** como origen y su callback en el cliente OAuth de Google; cambia `GOOGLE_OAUTH_REDIRECT_URI` para coincidir con ella. Debe ser una URL estable.
4. En Vercel → Settings → Environment Variables crea estas **variables de servidor**:

| Variable | Ejemplo / uso |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | Identificador del cliente Web OAuth de Google |
| `GOOGLE_OAUTH_CLIENT_SECRET` | **Secreto privado** del cliente Google |
| `GOOGLE_OAUTH_REDIRECT_URI` | `https://plataforma-jaguar.vercel.app/api/google-oauth-callback` (o callback Preview registrado) |
| `GOOGLE_SERVICIOS_EMAIL` | Dirección exacta del Gmail dueño de las clases; sólo admite ese correo |
| `GOOGLE_OAUTH_STATE_SECRET` | Texto aleatorio secreto de mínimo 32 caracteres (genera por tu cuenta, `openssl rand -hex 32`) |
| `GOOGLE_TOKEN_KEY` | Clave aleatoria de **32 bytes codificada en Base64** (genera por tu cuenta, `openssl rand -base64 32`) |

**No cambies `GOOGLE_TOKEN_KEY` después de conectar Google**: si la pierdes, los tokens cifrados serán irrecuperables y deberás borrar la conexión y reconectar.

**Importante:** todas las variables anteriores son sensibles o están relacionadas con una conexión privada; guárdalas en Vercel, no aquí. Selecciona sólo los entornos que realmente utilizarás, guarda y haz un **nuevo despliegue** para que las funciones de servidor las reciban. No agregues prefijo `VITE_` ni `NEXT_PUBLIC_`.

5. Inicia sesión en Jaguar con el perfil **Servicios Docentes**; abre **Google Classroom → Conectar Gmail de Servicios Docentes**. Verifica que el correo mostrado en Google sea el configurado.
6. Tras aceptar, Google regresará a Jaguar con `?google_connect=ok`. Abre otra vez el módulo Google Classroom, confirma que muestre **Conectada** y usa **Consultar mis Classroom**.
7. Comprueba nombre/código/enlace de una clase existente, selecciona el grupo-materia correcto y pulsa **Vincular**. Descarga el directorio PDF por grupo; comprueba que se refleje el código esperado.
8. Verifica el acceso denegado a un usuario sin rol Servicios Docentes y la continuidad de los módulos de boletas, periodos, horario y planeaciones.

## 3. Almacenamiento y permisos

- El servidor maneja el OAuth `code` y los tokens: el navegador **nunca recibe tokens de Google**.
- Los tokens se cifran con **AES-256-GCM** antes de almacenarlos en `jaguar_google_conexiones`; RLS y revocación de permisos públicos protegen la tabla. Sólo la API autenticada con rol `servicios_docentes` consulta o modifica la conexión.
- El callback exige `state` firmado HMAC, cookie `HttpOnly` + `Secure` + `SameSite=Lax`, caducidad de 10 minutos y que la cuenta autorizada de Google coincida con `GOOGLE_SERVICIOS_EMAIL`.
- La sincronización **no crea clases** ni modifica Classroom. Para vincular una clase con Jaguar el usuario debe seleccionar explícitamente su grupo-materia; la API valida que la clase exista en la cuenta conectada, el ciclo esté activo y no se duplique.
- Para desconectar, el botón elimina la autorización **del almacenamiento de Jaguar**. Si deseas revocar también el permiso concedido en Google, ve a seguridad de tu cuenta Google → Conexiones con aplicaciones de terceros.

## 4. Límites y cuestiones pendientes

- **Pruebas locales realizadas:** comprobación de sintaxis JS, 13 casos OAuth, 15 pruebas V5.6. **No se ha probado un flujo OAuth real en tu proyecto Google o Supabase**, y no se han usado tus credenciales.
- Google OAuth externo en estado **Testing** puede hacer caducar el refresh token al cabo de 7 días para scopes de Classroom. Una reconexión no es una falla de Jaguar. La transición de Google a producción y cualquier verificación requerida se tratarán por separado.
- Google puede mostrar advertencia sobre aplicaciones no verificadas o límites de usuarios de prueba según el alcance OAuth. No prometemos sincronización indefinida en producción sin completar los requisitos de Google.
- No guardar contraseñas de estudiantes. La sincronización de Forms, correspondencia matrícula–cuenta Google y ponderación Classroom se implementarán después de validar esta primera conexión.

## 5. Archivos añadidos y modificados

- `api/google-oauth.js`: iniciar, comprobar conexión, desconectar.
- `api/google-oauth-callback.js`: recepción del código Google y almacenamiento cifrado.
- `api/google-classroom.js`: consulta Google y vinculación supervisada.
- `lib/google_classroom_oauth.js`: validación, HMAC, AES-GCM, renovación de token, Google API.
- `sql/JAGUAR_V5_7_GOOGLE_OAUTH.sql`: tabla privada.
- `assets/jaguar-classroom-v56.js`: controles Google en el módulo existente.
- `tools/test_v57_google_oauth.mjs`: pruebas automáticas.

## 6. Diagnóstico rápido

- `redirect_uri_mismatch`: tu redirect en Google Cloud no coincide **exactamente** con `GOOGLE_OAUTH_REDIRECT_URI`.
- `access_denied`: usuario de prueba no autorizado o no aceptó el permiso.
- `wrong_account`: conectaste un Gmail distinto a `GOOGLE_SERVICIOS_EMAIL`.
- `no_refresh`: Google no entregó token de renovación; desconecta acceso en la cuenta Google y autoriza de nuevo.
- `?google_connect=error`: consulta los logs de Vercel (no publiques tokens ni secretos).
- Si el módulo funciona manualmente pero OAuth no: revisa migración, Vercel env y rol de Servicios Docentes.

Documentación Google: https://developers.google.com/identity/protocols/oauth2/web-server y https://developers.google.com/workspace/classroom/reference/rest/v1/courses/list
