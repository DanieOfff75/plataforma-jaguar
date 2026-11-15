# Jaguar V43 — Corte provisional de boleta

Base: V40–V42 instaladas. Reemplazar api/reports.js y los tres archivos de lib indicados. No modificar SQL, no reinstalar V40–V42. El archivo tests es opcional (pruebas locales).

Permite emitir una boleta de las calificaciones disponibles sin sellar periodos, incluso si faltan fechas o las fechas están solapadas. El número de periodo puede recuperarse de su nombre inequívoco si está ausente. Conserva IDs, valores fuente, AP/RP, decimales, celdas pendientes, fondo, coordenadas y QR. Si el calendario es inconciliable no calcula faltas: imprime Faltas sin conciliar. El corte se identifica como provisional y su QR no expone datos académicos. No modifica la base ni elimina los triggers de seguridad.

Conserva la vía estricta para expedientes con sellos u otras incompatibilidades históricas (recuperación, recursamiento, rectificación, etc.). No habilita la vía provisional para un expediente que ya requiere evidencia histórica. Rechaza identidades ambiguas, números duplicados o periodos faltantes. Mantiene el límite de 3 periodos y 10 materias de la plantilla.

Verificación: sintaxis de los cuatro archivos JS y pruebas locales de lógica y contrato; no se ejecutó contra Supabase ni se renderizó un PDF.
