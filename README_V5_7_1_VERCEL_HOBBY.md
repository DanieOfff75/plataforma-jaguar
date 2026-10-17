# Plataforma Jaguar V5.7.1 — corrección de funciones Vercel Hobby

## Motivo

El proyecto V5.7 contenía **16 archivos JavaScript en `api/`**. En el despliegue del plan Hobby, Vercel devolvía `No more than 12 Serverless Functions can be added to a Deployment`.

Esta edición conserva las funciones anteriores y reduce el número de puntos de entrada **de 16 a 10**, mediante un enrutador de APIs y reubicación de utilidades. **No cambia** los datos de Supabase, las migraciones, OAuth, boletas, horarios, credenciales, exámenes ni el diseño del sitio.

## Rutas públicas que continúan funcionando

| URL pública | Controlador reubicado |
| --- | --- |
| `/api/academic-tools` | `routes/academic-tools.js` |
| `/api/classroom` | `routes/classroom.js` |
| `/api/google-classroom` | `routes/google-classroom.js` |
| `/api/google-oauth` | `routes/google-oauth.js` |
| `/api/teacher` | `routes/teacher.js` |

Las URLs anteriores se reescriben con `vercel.json` hacia **`api/router.js`**, que llama al mismo código de permisos y validación de cada controlador. El callback OAuth **permanece sin cambios en `/api/google-oauth-callback`**, así que la dirección ya registrada en Google Cloud se conserva:

`https://plataforma-jaguar.vercel.app/api/google-oauth-callback`

Las utilidades `documentos.js` y `responsables.js` ahora están en `lib/`, fuera de `api/`. Siguen siendo utilizadas por las mismas funciones, pero ya no consumen espacios de Serverless Functions.

## Instalación: proyecto completo

1. Trabaja sobre una rama o copia de seguridad de GitHub.
2. **Sustituye el contenido del repositorio**, incluida la nueva carpeta `routes/` y `vercel.json`. No te limites a arrastrar nuevos archivos encima de los antiguos.
3. **ELIMINA estos siete archivos antiguos de `api/`, porque en GitHub NO desaparecen al subir un ZIP:**

   - `api/academic-tools.js`
   - `api/classroom.js`
   - `api/google-classroom.js`
   - `api/google-oauth.js`
   - `api/teacher.js`
   - `api/documentos.js`
   - `api/responsables.js`

4. Confirma que `api/` contiene **exactamente 10 archivos `.js`**, incluidos `api/router.js` y `api/google-oauth-callback.js`.
5. Confirma que `routes/` contiene los cinco controladores mencionados y que `lib/` incluye `documentos.js` y `responsables.js`.
6. Realiza un nuevo despliegue en Vercel con el proyecto raíz correctamente establecido.
7. Prueba la página principal y las funciones de tu cuenta; después inicia sesión como Servicios Docentes y comprueba Google Classroom y el inicio de OAuth.

**No ejecutes ninguna migración SQL adicional por este cambio**: esta corrección sólo reorganiza código. Continúan siendo necesarias las migraciones de las versiones anteriores si todavía no las instalaste.

**No modifiques** las seis variables de entorno de OAuth que ya guardaste ni publiques sus valores. La clave `GOOGLE_TOKEN_KEY` se conserva sin cambios.

### Si ya tienes la V5.7 clonada en Windows

Puedes aplicar los archivos del parche sobre el proyecto, **eliminar los siete archivos de la lista anterior** y subir un commit nuevo. Eliminar los archivos es indispensable. No necesitas un plan de pago.

## Comprobaciones incluidas

Ejecutar con Node.js:

```bash
node tools/test_hobby_routing.mjs
node tools/test_v57_google_oauth.mjs
node tools/test_v56_classroom.mjs
node tools/test_v55_academic_tools.mjs
```

Se comprobaron las 10 entradas del API, la conservación de URLs, las importaciones relativas y un despacho simulado sin credenciales. Además, pasaron los scripts de regresión incluidos en versiones anteriores. **No se pudo ejecutar aquí un deploy real de Vercel ni una autorización Google/Supabase real**: deben probarse en tu cuenta antes de considerarlo listo para producción.

## Nota para futuras versiones

No agregues archivos de rutas sueltas en `api/` sin comprobar el límite. Agrupa los módulos nuevos con `api/router.js` y mantiene la lógica en `routes/` o `lib/`. Las reescrituras conservan las direcciones usadas por la interfaz.
