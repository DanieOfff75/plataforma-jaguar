# Jaguar V5 · Credencial Minimalista Escolar con fotografía

## Alcance

Se integra el diseño horizontal de credencial aprobado (85.6 × 54 mm): columna azul marino con escudo ITHLA, panel blanco con fotografía real, datos del alumno, ciclo escolar, reverso con datos institucionales y QR verificable.

No se modifican los generadores de boletas, constancias, listas, horarios ni planeaciones. Se mantienen los módulos y funciones existentes.

## Flujo de trabajo

1. Servicios Estudiantiles abre **Credenciales**, selecciona grupo y alumno.
2. Carga una fotografía frontal JPG, PNG o WebP de hasta 8 MB. Jaguar la recorta en el navegador a 360 × 450, la convierte a JPG y la guarda como **foto privada**.
3. El servidor valida la fotografía y permite **solicitar el cargo de credencial** únicamente cuando existe una foto guardada.
4. Recursos Monetarios registra el pago y entrega el ticket, igual que antes.
5. Servicios Estudiantiles indica el folio real del ticket. Jaguar verifica que esté registrado, vinculado al alumno, que sea el concepto `CREDENCIAL`, y, si corresponde a un cargo, que esté totalmente cubierto.
6. El servidor obtiene la fotografía privada, genera las dos caras de la credencial, registra folio y QR, y guarda una copia PDF privada para reimprimir sin expedir un nuevo folio.
7. Si se anula el pago, la credencial emitida con ese comprobante pasa al estado `cancelado` en verificación.

## Seguridad y almacenamiento

- **Bucket:** `credenciales-alumnos`, privado (`public:false`). El servidor intenta crearlo automáticamente la primera vez, usando la clave de servicio ya necesaria en Jaguar.
- **Ruta:** `alumnos/<id>/credencial.jpg` (el ID lo verifica el servidor, no lo elige el navegador).
- **Foto:** se valida tipo JPEG, tamaño máximo 650 KB y dimensiones reales. No hay URL pública.
- **Acciones del servidor:** `student_credential_photo_upload` y `student_credential_photo_status` en `/api/reports`. Requieren sesión activa y rol **servicios_estudiantiles**.
- **Copia de credencial emitida:** bucket privado `archivo-escolar`, ruta `credenciales/<ciclo>/<alumno_id>/<pago_id>.pdf`. La reimpresión recupera **el mismo PDF**.
- **Datos del QR:** la fotografía no se incluye en el payload público de verificación.
- **Base de datos:** no hay migración SQL nueva para fotografías; se utilizan Storage y tablas ya existentes.

## Archivos modificados

- `api/reports.js` — acciones de fotografía, emisión, validación de pago y reimpresión.
- `api/data.js` — requiere foto antes de crear el cargo e invalida la credencial si se anula el pago.
- `index.html` — captura, vista previa y actualización de fotografías por alumno.
- `lib/credential_photo.js` — carga privada y validación de la foto.
- `lib/credencial_escolar_pdf.js` — nuevo formato frente/reverso.
- `assets/fonts/Garet-Book.ttf`, `assets/fonts/Garet-Heavy.ttf` — incluidas en este ZIP (faltaban en V4).

## Pruebas antes de publicar

### Automáticas sin conexión

```bash
node tools/test_credential_v5.mjs
node --check api/reports.js
node --check api/data.js
node --check lib/credential_photo.js
node --check lib/credencial_escolar_pdf.js
```

### Manuales en una rama de pruebas de Vercel (obligatorias)

1. Ingresar como Servicios Estudiantiles. Elegir 2 alumnos distintos y subir fotos distintas; verificar que al seleccionar cada uno se muestra sólo la suya.
2. Intentar solicitar un pago sin foto; debe rechazarlo.
3. Solicitar cargo a un alumno con foto; registrar **un pago de prueba** desde Recursos Monetarios.
4. Comprobar que un pago de otro alumno, de otro concepto, anulado o parcial no emite credencial.
5. Descargar el PDF y verificar la foto, el escudo, la matrícula, el ciclo, el tamaño y el QR.
6. Repetir el mismo folio de pago; debe descargarse la **misma credencial**, no una emisión nueva.
7. Anular un pago de prueba y comprobar el estado `cancelado` de la credencial asociada.
8. Probar los roles de alumnos, docentes y otros departamentos: **no** deben tener permiso para subir o consultar fotos de credencial.
9. Verificar que las boletas, Garet y el sello S.E.T.E.C.F.I. conservan su comportamiento.

## Limitaciones conocidas

- El ZIP pasó pruebas de sintaxis y pruebas unitarias **sin Supabase real**. La emisión y reimpresión de extremo a extremo requieren un despliegue de prueba con las variables correctas y acceso a Storage.
- La copia de la credencial emitida se guarda en Storage privado; `archivo-escolar` debe existir y permitir escritura del rol de servicio de Supabase.
- La prevención de dobles emisiones usa consulta por folio y ruta de archivo sin sobrescritura. Para transacciones concurrentes fuertes sería conveniente agregar una restricción única de emisión por pago en una migración futura.
- La gestión institucional de permisos, consentimiento para fotografía y plazo de retención debe definirse según las políticas aplicables a la escuela. No hay un flujo de borrado de fotos incluido en este cambio.
- La vista previa PDF entregada con el proyecto usa datos **ficticios** y un QR de demostración; no es una credencial emitida ni sustituye la prueba real del generador JavaScript.

## Despliegue

1. Haz una copia o crea rama antes de actualizar.
2. Sube el ZIP completo o aplica el parche sobre la V4, sin borrar ningún archivo ajeno al parche.
3. Ejecuta `npm install` durante el despliegue; `pdf-lib` y `@pdf-lib/fontkit` siguen en `package.json`.
4. Valida `/api/reports`, Storage y el módulo Credenciales en tu entorno de prueba.
