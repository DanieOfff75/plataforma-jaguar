# Jaguar V5.8.4 — Boleta de 10 materias, carga por grupo y validación docente

## Alcance

- **Boleta:** se elimina la exclusión de Artes; las materias salen del catálogo `grupo_materias` del alumno, incluso sin calificación. Se conserva intacta la plantilla oficial de 27 variantes. El límite sigue siendo 10: si el grupo supera diez materias, se avisa y no se imprime una boleta que omita cursos.
- **Consulta PDF:** escudo institucional, desglose existente, footer de responsables, nombre del docente y firma institucional almacenada cuando esté disponible. Si se trata de una carga por grupo aceptada, el PDF utiliza la firma de la persona de Control Escolar/Dirección que emitió la carga y la firma del docente que la aceptó. No se inventan firmas.
- **Carga por grupo:** botón `Calificaciones → Cargas por grupo y oficios docentes`. Control Escolar/Dirección elige grupo y periodo, descarga un XLSX con todas las materias, introduce totales de 0 a 10, carga y ve resumen antes de firmar/envíar. El servidor valida alumnos, asignaturas, docente vigente, firma y ausencia de notas oficiales previas.
- **Oficios:** cada materia se crea como expediente pendiente; se notifica al docente correspondiente y su bandeja permite consultar y descargar el oficio PDF, corregir notas con explicación y firmar. Las notas pasan a oficiales *sólo después de la aceptación de ese docente*. La operación de cada materia es transaccional, con ambos conjuntos de valores archivados.

## Instalación cautelosa

1. Hacer copia de seguridad de Supabase y **ensayar en un proyecto de pruebas**. No aplicar primero a producción. El nuevo sistema exige el esquema actual de `perfiles`, `docentes`, `alumnos`, `grupos`, `grupo_materias`, `asignaciones_docentes`, `periodos_escolares` y `calificaciones`.
2. Abrir **New query** en Supabase SQL Editor, pegar TODO el archivo `sql/JAGUAR_V5_8_4_00_DIAGNOSTICO.sql` y ejecutar. Las cuatro tablas deben existir.
3. Pegar y ejecutar COMPLETO `01_TABLAS.sql`. Comprobar las dos tablas nuevas.
4. Pegar y ejecutar COMPLETO `02_FUNCIONES.sql` en una consulta nueva. No pegar sólo fragmentos `IF` ni aceptar líneas RLS añadidas dentro de los bloques con `$jaguar_crear$` o `$jaguar_aceptar$`. El archivo debe acabar en `COMMIT;` y `NOTIFY`.
5. Ejecutar `03_VERIFICAR.sql`: se esperan cuatro `true`.
6. Subir los archivos del parche a GitHub conservando carpetas. Esperar despliegue correcto de Vercel Hobby y recargar. No hay nuevas funciones en `/api`, variables ni permisos de Google.
7. Probar una boleta de primero que tenga Artes asignada: debe aparecer como décima materia, o con raya si aún no tiene nota. Comparar diseño con boleta anterior y no publicar si difiere.
8. Probar carga por grupo en base de **pruebas**, un periodo todavía abierto, todas las materias con docente y firmantes registrados. Primero verificar que antes de aceptar no se crea ninguna nota; después probar una materia, modificar una nota con justificación y confirmar que la original, el motivo y la nueva quedan guardados. Comprobar el oficio PDF y el desglose PDF.

## Restricciones importantes

- Un periodo inactivo o finalizado **no se desbloquea**. Su carga histórica requiere un procedimiento formal de rectificación diferente.
- Una calificación oficial previa **bloquea** el lote. No se sobrescribe por esta vía.
- El docente debe contar con perfil y firma institucional; la persona emisora también.
- Los oficios pendientes son registros de revisión, no calificaciones oficiales.
- Un profesor sólo puede aceptar una materia donde figure como docente responsable.
- Los PDFs están sujetos a prueba visual con logos/firmas reales en el entorno instalado.
- No se probó la migración SQL en la base del usuario ni el flujo completo con sesiones Google/Supabase/Vercel reales. Las pruebas locales son sintácticas y de regresión; no constituyen garantía del 100% en producción.

## Archivos actualizados

`api/data.js`, `api/reports.js`, `index.html`, `lib/academic_grade_report_pdf.js` y tres bibliotecas nuevas: `lib/group_grade_batch.js`, `lib/grade_batch_office_pdf.js`. Cuatro SQL numerados y este README.
