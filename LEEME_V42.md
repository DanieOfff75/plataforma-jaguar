# V42 · Firmas en bitácora + planificación V41
Base: V38 instalada y V40. Incluye ambos archivos de planificación V41 sin cambios. No instalar V41 aparte.

## Código
Reemplazar `sistema.html`, `api/data.js`, `lib/jaguar_gradebook_pdf.js`, `assets/jaguar-academic-lifecycle.js`, `assets/jaguar360-operations.js` en Plataforma Jaguar. No modificar Admisiones ni Centro. Si existen cambios locales adicionales, comparar antes de sobrescribir. Este parche no modifica el diseño de la boleta oficial.

En el Excel docente, en ACTIVIDADES, la columna titulada FIRMAS (también FIRMA, sin distinguir mayúsculas ni espacios exteriores) acepta cualquier entero no negativo representable exactamente por JavaScript (máximo técnico 9 007 199 254 740 991; Excel tiene menor precisión para números muy grandes). No se restringe a 10 ni a 900. Se conserva la cantidad en el snapshot y al volver a exportar. No confundir conteo con nota equivalente: en VALORES PONDERACION se conserva la escala existente (0–10 en notas, peso/10 en aportes ponderados) y VALOR TOTAL 0–10. No se inventa una meta de firmas ni se altera la fórmula seleccionada por el docente. Las demás actividades siguen en 0–10. El límite de columnas de actividades sigue siendo 40; no es un límite de firmas por alumno. Los respaldos previos siguen protegidos.

## SQL (relevo docente)
Para la carga normal no requiere SQL. Para que el relevo docente no descarte conteos superiores a 10, ejecutar `sql/ITHLA_JAGUAR_360_FIRMAS_RELEVO_V42.sql` primero en copia aislada. Solo adapta la definición existente si coincide exactamente con el fragmento esperado; no reescribe filas ni altera otras reglas o permisos. Si el bloque no coincide, detenerse y enviar el error. No reinstalar las migraciones anteriores. No se ejecutó PostgreSQL aquí.

## Verificación
11 casos aprobados de las dos suites seleccionadas (4 nuevos); comprueban lectura y regeneración de hojas en memoria, validación en el servidor con DB simulada, rechazo de notas >10 y preservación del total. Sintaxis de ambos JS de servidor revisada. No se hicieron pruebas reales de Supabase, Storage, Vercel ni renderizado PDF. Archivos `tests/` incluidos para repetir esas comprobaciones; no son necesarios para desplegar. Las firmas de documentos oficiales no fueron modificadas.
