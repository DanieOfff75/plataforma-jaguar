-- INSTALAR SOLO DESPUES DE VERIFICAR EL PORTAL.
-- Por defecto todas las guardas se crean DESACTIVADAS.
-- No modifica fichas, asignaciones, calificaciones ni roles existentes.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE IF NOT EXISTS public.setecfi_control_v54 (
 id smallint PRIMARY KEY CHECK(id=1),
 obligatorio boolean NOT NULL DEFAULT false,
 activado_en timestamptz
);
INSERT INTO public.setecfi_control_v54(id,obligatorio) VALUES(1,false) ON CONFLICT(id) DO NOTHING;
ALTER TABLE public.setecfi_control_v54 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.setecfi_control_v54 FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.setecfi_control_v54 TO service_role;
CREATE OR REPLACE FUNCTION public.setecfi_guard_personal_v54()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $fn$
DECLARE gated boolean; required_kind text; candidate uuid; name text; subject_id bigint; subject_user uuid;
BEGIN
 SELECT obligatorio INTO gated FROM public.setecfi_control_v54 WHERE id=1;
 IF gated IS DISTINCT FROM true THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='docentes' THEN
  name:=NEW.nombre_completo;
  IF TG_OP='INSERT' THEN required_kind:='alta_docente';
  ELSIF OLD.activo IS DISTINCT FROM NEW.activo AND NEW.activo=false OR OLD.estado_profesional IS DISTINCT FROM NEW.estado_profesional AND NEW.estado_profesional='archivado' THEN required_kind:='baja_docente';
  ELSIF OLD.activo IS DISTINCT FROM NEW.activo AND NEW.activo=true THEN required_kind:='reingreso_docente';
  ELSIF OLD.suspension_fecha IS DISTINCT FROM NEW.suspension_fecha AND NEW.suspension_fecha IS NOT NULL THEN required_kind:='permiso_docente';
  ELSE RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN subject_id:=NEW.id; END IF;
  SELECT id INTO candidate FROM public.setecfi_expedientes_v54
   WHERE tipo=required_kind AND estado_direccion='aprobado' AND estado_setecfi='aprobado' AND aplicado_en IS NULL
   AND (vigencia_hasta IS NULL OR vigencia_hasta>=current_date)
   AND ((subject_id IS NOT NULL AND docente_id=subject_id) OR (subject_id IS NULL AND lower(btrim(persona_nombre))=lower(btrim(name))))
   ORDER BY creado_en ASC LIMIT 1 FOR UPDATE;
 ELSE
  IF TG_OP='INSERT' THEN
   IF NEW.rol<>'direccion_escolar' THEN RETURN NEW; END IF;
   required_kind:='alta_direccion';
  ELSIF OLD.rol IS DISTINCT FROM NEW.rol AND NEW.rol='direccion_escolar' THEN required_kind:='alta_direccion';
  ELSIF OLD.rol IS DISTINCT FROM NEW.rol AND OLD.rol='direccion_escolar' THEN required_kind:='baja_direccion';
  ELSIF OLD.activo IS DISTINCT FROM NEW.activo AND OLD.rol='direccion_escolar' AND NEW.activo=false THEN required_kind:='baja_direccion';
  ELSE RETURN NEW; END IF;
  name:=NEW.nombre_completo;subject_user:=NEW.id;
  SELECT id INTO candidate FROM public.setecfi_expedientes_v54
   WHERE tipo=required_kind AND estado_direccion='aprobado' AND estado_setecfi='aprobado' AND aplicado_en IS NULL
   AND (vigencia_hasta IS NULL OR vigencia_hasta>=current_date)
   AND (persona_auth_id=subject_user OR (persona_auth_id IS NULL AND lower(btrim(persona_nombre))=lower(btrim(name))))
   ORDER BY creado_en ASC LIMIT 1 FOR UPDATE;
 END IF;
 IF candidate IS NULL THEN RAISE EXCEPTION 'Movimiento % bloqueado: primero se requiere aprobacion de Direccion y Portal SETECFI',required_kind USING ERRCODE='P0001'; END IF;
 UPDATE public.setecfi_expedientes_v54 SET aplicado_en=now(),actualizado_en=now() WHERE id=candidate AND aplicado_en IS NULL;
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS setecfi_guard_docentes_v54 ON public.docentes;
CREATE TRIGGER setecfi_guard_docentes_v54 BEFORE INSERT OR UPDATE ON public.docentes FOR EACH ROW EXECUTE FUNCTION public.setecfi_guard_personal_v54();
DROP TRIGGER IF EXISTS setecfi_guard_perfiles_v54 ON public.perfiles;
CREATE TRIGGER setecfi_guard_perfiles_v54 BEFORE INSERT OR UPDATE ON public.perfiles FOR EACH ROW EXECUTE FUNCTION public.setecfi_guard_personal_v54();
REVOKE ALL ON FUNCTION public.setecfi_guard_personal_v54() FROM PUBLIC,anon,authenticated;
COMMIT;
