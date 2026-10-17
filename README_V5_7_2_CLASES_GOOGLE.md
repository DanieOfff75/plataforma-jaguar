# Jaguar V5.7.2 · Descubrimiento de Classroom

## Corrección

La consulta previa incluía `teacherId=me`, que restringía los resultados a los cursos en los que Google registra al Gmail conectado como docente. La consulta actual usa `GET https://classroom.googleapis.com/v1/courses?pageSize=100`, sin dicho filtro, y sigue todas las páginas. Muestra las clases a las que el Gmail autorizado tiene acceso. No altera clases ni calificaciones.

Al pulsar **Consultar mis Classroom**, la pantalla también distingue una respuesta correcta con cero clases de un error HTTP.

## Actualización sin pagar Vercel Pro

- **Proyecto completo:** sustituye los archivos del proyecto por esta versión de 10 funciones `/api` (borrando archivos antiguos que no estén en el ZIP). Asegúrate de desplegar la raíz del proyecto.
- **Parche:** sobrescribe solamente `lib/google_classroom_oauth.js` y `assets/jaguar-classroom-v56.js` con los del parche.
- Conserva las seis variables de Vercel y la URL OAuth. No es necesario renovar secretos, cambiar permisos, reconectar Google, ni ejecutar SQL adicional para esta corrección.
- Confirma el despliegue a Producción y recarga el navegador con Ctrl + F5.
- Entra como Servicios Docentes → Google Classroom → **Consultar mis Classroom**.

Si el mensaje indica cero cursos, confirma que el correo **Conectada: ...** sea exactamente el correo propietario visible en classroom.google.com (avatar superior derecho) y prueba desde la cuenta correspondiente. Si hay error, copia el mensaje de la pantalla; nunca compartas tokens ni variables privadas.

## Pruebas locales

```bash
node tools/test_google_course_discovery_v572.mjs
node tools/test_v57_google_oauth.mjs
node tools/test_hobby_routing.mjs
```

**Nota:** esta corrección se ha probado con respuestas simuladas; la API real sólo puede verificarse tras el despliegue y autorización del usuario.
