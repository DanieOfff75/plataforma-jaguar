# Ajuste de Propuesta Visual 15

- Se conserva el HTML de referencia `assets/Boleta-Jaguar-Propuesta-Visual-15.html` sin cambios visuales.
- En el generador PDF (`api/reports.js`), la marca cuadrada con la letra “J” se sustituyó por el logotipo institucional disponible en `assets/ithla-logo.png`, ajustado proporcionalmente al espacio de cabecera.
- No se añadió sello.
- Se conserva la lógica existente de consulta de calificaciones, folio, QR de verificación, firmas y hojas complementarias.

## Verificación realizada

- `node --check api/reports.js` pasó sin errores.
- La generación completa de una boleta con datos reales requiere el entorno configurado y acceso a Supabase; no se marca como prueba de extremo a extremo.
