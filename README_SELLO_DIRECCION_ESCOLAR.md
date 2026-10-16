# Ajuste de boleta · Propuesta Visual 15

Se conserva el generador de boleta y sus consultas de datos. En la primera página:
- La cabecera usa el archivo institucional `assets/ithla-logo.png` en vez de una letra genérica.
- El bloque de autorización se presenta como Dirección Escolar, con línea independiente para firma y sello circular institucional.
- El sello es un elemento gráfico de identificación; no sustituye la firma de la autoridad ni el registro de validación/QR.

Validación realizada en este paquete: comprobación sintáctica de `api/reports.js` con `node --check`. La generación end-to-end requiere ejecutar el proyecto con sus variables de entorno y una base de datos Supabase configurada.
