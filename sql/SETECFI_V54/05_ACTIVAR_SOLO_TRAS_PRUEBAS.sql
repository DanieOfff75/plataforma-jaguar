-- ATENCION: habilitar obliga a registrar solicitudes para altas, bajas y nuevas direcciones.
-- Ejecutar SOLO tras: portal publicado, admin habilitado, altas/bajas probadas en staging,
-- direccion que pueda resolver solicitudes y respaldo reciente de base de datos.
BEGIN;
DO $setecfi_activacion$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.setecfi_operadores_v54 WHERE activo=true AND nivel='admin') THEN RAISE EXCEPTION 'Primero configura el administrador SETECFI'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.perfiles WHERE rol='direccion_escolar' AND activo=true) THEN RAISE EXCEPTION 'Primero debe haber Direccion Escolar activa'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.setecfi_control_v54 WHERE id=1 AND obligatorio=false) THEN RAISE EXCEPTION 'Las guardas no estan instaladas o ya se encuentran activadas'; END IF;
END;
$setecfi_activacion$;
UPDATE public.setecfi_control_v54 SET obligatorio=true,activado_en=now() WHERE id=1;
COMMIT;
