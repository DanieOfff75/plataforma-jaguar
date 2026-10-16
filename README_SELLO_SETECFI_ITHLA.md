# Sello institucional SETECFI en boleta Jaguar

El sello se aplica sólo en la **hoja 1**, exactamente en el recuadro antes reservado a la firma de Dirección.

- Origen: imagen remitida por el responsable del proyecto.
- Formato integrado: `assets/sello-setecfi-ithla-transparente.png` (PNG RGBA con los blancos convertidos a transparencia y textura de tinta conservada).
- Responsable de colocación: `lib/boleta_visual15.js`, sobre `1.signbox.1`; no hay cambios de posición para alumnos, tabla de notas, QR, promedio ni demás firmas.
- Para reconstruir las plantillas precompiladas, ejecutar en un entorno de desarrollo con Chromium/Playwright: `python tools/build_boleta_templates.py`.
- No se instala conversor PDF adicional en Vercel: en producción sólo se utiliza `pdf-lib`.

**La firma de Dirección en la hoja 2 se mantiene.** El nuevo sello no sustituye una firma auténtica ni constituye por sí mismo acreditación de autoridad pública.
