# Jaguar V51 · Registro final por materia o general
Requiere V49 instalada y su migración. Incluye el generador monocromático y escudo de V50; no necesita aplicar V50 por separado. No hay migraciones SQL.

## Archivos a reemplazar o agregar (respetar rutas)
- sistema.html
- assets/jaguar-tutoria.js
- assets/tutoria-logo-bn.jpg
- routes/tutoria.js
- lib/jaguar_tutoria_pdf.js

Si modificaste alguno localmente desde V49/V50, compara antes de reemplazar. Documentación y pruebas no son archivos necesarios para desplegar.

## Uso
Docente > Calificaciones > Registros finales PDF · por materia o general. Seleccionar grupo, un periodo del ciclo vigente, una materia o General (sólo asesor vigente del grupo), y en blanco o con notas finales. Las descargas rápidas anteriores permanecen. Los documentos generales incluyen todas las materias evaluables activas, paginadas si es necesario; no incluyen actividades. Las consultas de notas se restringen a periodo_id exacto. El asesor también puede descargar una materia del grupo aunque no la imparta. Docente no asesor sólo ve sus propias asignaturas. No cambiar notas ni asignaciones. No se reconstruyen padrones históricos.

## Validación
Sobre base V49/V50: 27 pruebas de código aprobadas, incluidas 4 adicionales de V51 (API simulada; PDF real y lectura del contenido). Node --check de scripts JS e inline. Chromium con API simulada: periodo obligatorio, matriz en blanco, materia con notas, cambio de grupo/permisos y ancho móvil. Pendiente instalación y prueba con la sesión y base reales. No se modificó Supabase, no se desplegó Vercel, no se verificaron cambios locales posteriores del usuario.

Para repetir pruebas en el repositorio completo: `node --test tests/jaguar_tutoria_v51.test.mjs`.
