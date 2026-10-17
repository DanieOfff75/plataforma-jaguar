# Jaguar V5.1 — Periodos escolares y verificación pública

**Base:** `Plataforma-Jaguar-V5-Credencial-Minimalista-Foto.zip`. No altera las boletas,
las credenciales, los pagos ni los permisos de otros módulos.

## 1. Corrección de periodos

**Causa confirmada:** `formFor('periods')` no incluye `ciclo_escolar` en los campos
y `writeResource()` hacía el INSERT sin agregarlo. El esquema `periodos_escolares`
exige la columna NOT NULL, por lo que Supabase rechazaba el nuevo periodo.

**Solución:** el servidor obtiene directamente el ciclo actual de `periodos_escolares`,
lo coloca en el INSERT y valida nombre, número entero, fechas, duplicados y ciclo.
Los periodos nuevos quedan `activo:true` y `es_periodo_actual:false` hasta seleccionar
«Hacer actual». La edición también comprueba números duplicados y preserva la marca actual.
El formulario muestra el ciclo activo y sugiere el siguiente número.

No requiere SQL ni migraciones. No se modificaron filas existentes.

## 2. Verificación PDF

- `verificar.html`: diseño responsivo con estado, folio, visor PDF y datos públicos.
- `api/verificar.js`: devuelve los datos existentes y también `GET ?token=...&pdf=1`.
- `lib/verificacion_pdf.js`: dibuja una marca diagonal dentro del PDF, por **cada página**:
  verde «DOCUMENTO VÁLIDO», roja «DOCUMENTO CANCELADO», ámbar «DOCUMENTO EXPIRADO».
- `api/documentos.js`: los estados no reconocidos y fechas de caducidad inválidas **no**
  se convierten por defecto en estado válido.

### Protección de datos

La vista pública **no debe difundir por QR un PDF confidencial**. Los PDF originales
se sirven únicamente si simultáneamente:

1. Existe un documento oficial emitido vinculado al folio verificable.
2. Existe un expediente con `confidencialidad = 'publico'`, `alcance = 'publico'`
   y `estado = 'vigente'`.
3. El archivo se descarga del bucket existente `archivo-escolar`, mide como máximo
   8 MB y su SHA-256 coincide con los hashes del expediente y la emisión.
4. El registro verificable sigue válido.

De lo contrario, la página muestra un **PDF de representación pública** construido sólo
con `datos_publicos`, marcado claramente como tal. **No es una copia del PDF original.**
Los documentos actuales con `alcance='oficial'` o `confidencialidad='interno'` /
`'restringido'` seguirán ocultando el original; no cambies masivamente esas clasificaciones
para hacer visible todo. Un futuro flujo de aprobación de copias públicas/redactadas puede
ampliar los casos con vista del documento real de forma segura.

El archivo original sigue guardado sin modificación. La marca de agua se aplica en
la copia derivada de verificación.

## 3. Pruebas realizadas

- Sintaxis Node: `api/data.js`, `api/verificar.js`, `api/documentos.js`,
  `lib/periodos_escolares.js`, `lib/verificacion_pdf.js`.
- Scripts incrustados en `index.html` y `verificar.html`: comprobación de sintaxis.
- `node tools/test_v6_periodos.mjs`: validación de 8 escenarios.
- `documentStatus()`: seis escenarios de vigencia y cancelación.
- Maqueta de verificación en escritorio y móvil con datos ficticios: sin desbordes.

**Pendientes reales:** `npm install` / funciones PDF Node (el registro npm no estuvo
accesible en este entorno), consultas Supabase, lectura de archivos del storage
privado, y la emisión/visualización a partir de un QR real en Vercel.
La imagen y PDF de muestra de esta entrega son demostraciones visuales,
no documentos verificados en producción.

## 4. Lista de pruebas antes de publicar

1. Registrar un nuevo periodo dentro de Control Escolar y confirmar que toma
   el ciclo vigente, no lo establece como actual ni modifica horarios.
2. Intentar crear dos periodos con el mismo número (debe rechazarse el segundo).
3. Editar fechas y números de un periodo existente sin alterar su estado.
4. Abrir el QR de una boleta y comprobar estado válido más vista pública PDF.
5. Cancelar un documento de prueba y revisar que cambie a rojo/cancelado.
6. Probar un token inventado y verificar que no muestra un PDF válido.
7. Comprobar en móvil y escritorio, en HTTPS.

Para que los QR usen tu dominio estable es recomendable configurar en Vercel
`PUBLIC_APP_URL=https://<tu-dominio>`.
