# NEXO AI 1.0 · Plataforma Jaguar

**Objetivo:** transformar el orientador NEXO en un chat conversacional con GroqCloud (GPT-OSS), sin añadir una función de Vercel ni comprar GPU. Se mantiene el modo anterior como respaldo.

## Qué está incluido

- Chat con historial efímero: hasta 8 mensajes recientes enviados desde la página, no guardados en la base de datos.
- Endpoint `POST /api/public` (`action: "nexo-chat"`) sobre la ruta existente; el `GET /api/public?action=nexo&q=...` anterior sigue operativo.
- Prompt institucional, conocimiento oficial publicado desde `ithla_config.nexo.preguntas` (Centro de Control), selección de fuentes relacionadas y modo de orientación anterior.
- API Groq desde el servidor, sin revelar la clave al navegador; modelo inicial **`openai/gpt-oss-20b`**. También se permite `openai/gpt-oss-120b`, si está accesible en el plan gratuito de la cuenta.
- Cuotas persistentes y atómicas en Supabase: **80 llamadas IA/día globales, 12/minuto globales, 10/día por dirección seudonimizada, 3/minuto por dirección**. La primera barrera son las cuotas del proveedor y el plan Free.
- El motor rechaza preguntas que parecen contener ciertos datos personales. La detección es conservadora y no es una solución integral de DLP.
- Sin consultas autenticadas, sin acceso a expedientes, sin escritura en Jaguar y sin entrenamiento automático con mensajes.

## Activación (requiere tus cuentas; NO compartir claves por chat)

1. **Respalda el código actual** de Jaguar. Sube los archivos de esta versión a una rama de prueba de tu repositorio. Esta carpeta es una copia del ZIP recibido, no un despliegue.
2. **En Supabase, proyecto de Jaguar:** ejecuta el archivo `sql/ITHLA_NEXO_AI_01_CUOTAS_GRATUITAS.sql` desde SQL Editor. Crea una tabla de contadores y la función RPC `ithla_nexo_ai_take_quota`. No modifica boletas, alumnos ni políticas escolares.
3. **En GroqCloud:** entra en https://console.groq.com/ y conserva la cuenta en el **plan Free**. En https://console.groq.com/keys crea una clave API. Confirma en https://console.groq.com/docs/rate-limits los límites reales de tu cuenta. No cambies al plan Developer si tu presupuesto es $0.
4. **En Vercel > Proyecto Jaguar > Settings > Environment Variables:** conserva `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` existentes. Añade estas variables secretas para los entornos que vayas a utilizar:

   ```env
   GROQ_API_KEY=(tu clave, SOLO en Vercel)
   GROQ_MODEL=openai/gpt-oss-20b
   NEXO_AI_ENABLED=true
   NEXO_RATE_LIMIT_SECRET=(cadena aleatoria privada de 32 bytes o más)
   ```

   Para generar el secreto de cuota puedes utilizar `openssl rand -hex 32` en tu propia computadora. Nunca subas el archivo `.env` real a GitHub. El archivo `.env.example` es solo una plantilla sin valores reales.
5. **Redeploy en Vercel** para aplicar las variables. No se añadió ningún paquete npm ni ninguna función Vercel adicional. Jaguar continúa usando su `vercel.json` existente.
6. Entra a la portada, abre **NEXO AI** y pregunta `Hola, ¿quién eres?`. A continuación escribe `¿Y qué puedes hacer?` para comprobar que comprende referencias. Pregunta también `¿Cómo solicito una constancia?` para verificar el uso de las fuentes.
7. Si aparece **"NEXO · orientación"**, comprueba que `NEXO_AI_ENABLED=true`, la clave está configurada, la cuota SQL está instalada y la cuenta Groq Free tiene disponibilidad. No se ha enviado ninguna solicitud de IA si la comprobación de cuotas falla.

## Apagado inmediato / regreso al modo anterior

En Vercel cambia `NEXO_AI_ENABLED=false` y redepliega. El widget conservará el modo orientador y no llamará a Groq. El Centro de Control conserva su opción `nexo.activo` de encender/apagar NEXO para toda la institución.

## Validación en local

```bash
node --test tests/nexo_ai_100.test.mjs tests/nexo_v601.test.mjs tests/ithla_v6_nexo_session.test.mjs
node --check lib/nexo_ai.js
node --check routes/ithla-public.js
node --check assets/nexo-widget.js
```

Las pruebas no necesitan conexión a Groq. El endpoint fue comprobado también con simulaciones de Supabase/Groq. **No se realizó una petición real a Groq ni un despliegue** porque no disponemos de las claves ni acceso a tus cuentas.

## Privacidad y costos

- El chat es **público**, aun si aparece dentro de `sistema.html`: NO recibe automáticamente la sesión, calificaciones, CURP ni datos del alumnado.
- Groq recibe las preguntas de orientación, un historial breve y las fuentes institucionales seleccionadas. Es un servicio externo, por lo que NO debes usarlo para datos privados hasta aprobar una revisión institucional de privacidad.
- No se registra el contenido de los chats en Jaguar por esta función; la red y los proveedores pueden aplicar sus propias políticas. Revisa https://console.groq.com/docs/data-handling .
- La tabla SQL registra contadores de uso con IP seudonimizada mediante HMAC. No contiene mensajes. Los contadores antiguos se pueden depurar periódicamente.
- Las restricciones por IP se pueden eludir mediante proxies; hay un límite global compartido para contener abuso. Para uso masivo se requeriría seguridad adicional y auditoría de privacidad.
- **$0 es una meta condicionada:** Groq Free no cobra por superar las cuotas (rechaza llamadas), pero verifica el plan y los límites de cada servicio (Vercel, Supabase, etc.). Revisa también la elegibilidad de uso de Vercel Hobby para tu institución; sus términos pueden no permitir ciertos usos comerciales.
- Este prototipo aún NO es apto para decisiones académicas automatizadas ni para consultas autenticadas a expedientes personales.

## Archivos modificados/creados

| Archivo | Cambio |
| --- | --- |
| `lib/nexo_ai.js` | Motor de conversación, privacidad, API Groq y protección por cuota |
| `lib/nexo_advisor.js` | Exportación de referencias relevantes y mejora del desempate de contenido aprobado |
| `routes/ithla-public.js` | Acción POST pública segura, sin cambiar la ruta de Dirección ni GET anterior |
| `assets/nexo-widget.js` | Chat con contexto, respuesta de IA y respaldo visible |
| `index.html` | Encabezado del módulo actualizado a NEXO AI |
| `sql/ITHLA_NEXO_AI_01_CUOTAS_GRATUITAS.sql` | Cuotas SQL atómicas y roles limitados |
| `tests/nexo_ai_100.test.mjs` | Pruebas nuevas del motor |
| `.env.example` | Nombres de variables, sin secretos |

El control institucional de preguntas oficiales del **Centro de Control** funciona como antes; no requiere actualizar ese repositorio para iniciar el prototipo de Jaguar.
