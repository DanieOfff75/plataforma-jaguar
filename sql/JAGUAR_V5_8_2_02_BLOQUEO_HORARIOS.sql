-- JAGUAR V5.8.2 | Bloqueo en BD: no introducir espacios especiales en horarios.
-- NO crea tablas y NO modifica las 540 clases ni las calificaciones.
CREATE OR REPLACE FUNCTION public.jaguar_bloquear_espacios_no_aula()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $jgr_tipo$
BEGIN
    IF NEW.aula IS NULL OR btrim(NEW.aula) = '' THEN
        RETURN NEW;
    END IF;
    -- No interrumpe la modificación de un horario histórico que ya tuviera
    -- un espacio especial y cuyo campo aula permanece sin cambios.
    IF TG_OP = 'UPDATE' AND NEW.aula IS NOT DISTINCT FROM OLD.aula THEN
        RETURN NEW;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.jaguar_aulas a
        WHERE upper(btrim(a.nombre)) = upper(btrim(NEW.aula))
          AND a.activo = true AND a.tipo_espacio = 'aula'
    ) THEN
        RAISE EXCEPTION 'Solo aulas ordinarias activas son asignables a grupos. Laboratorios, auditorios y oficinas están excluidos.';
    END IF;
    RETURN NEW;
END;
$jgr_tipo$;

DROP TRIGGER IF EXISTS jaguar_solo_aula_ordinaria_en_horarios ON public.horarios;
CREATE TRIGGER jaguar_solo_aula_ordinaria_en_horarios
BEFORE INSERT OR UPDATE OF aula ON public.horarios
FOR EACH ROW EXECUTE FUNCTION public.jaguar_bloquear_espacios_no_aula();
