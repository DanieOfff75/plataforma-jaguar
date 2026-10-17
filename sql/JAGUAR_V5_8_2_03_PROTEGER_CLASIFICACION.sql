-- JAGUAR V5.8.2 | No reclasificar un aula mientras tenga horarios.
CREATE OR REPLACE FUNCTION public.jaguar_evitar_reclasificar_aula_asignada()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $jgr_clasificacion$
BEGIN
    IF OLD.tipo_espacio = 'aula' AND NEW.tipo_espacio <> 'aula'
       AND EXISTS (
          SELECT 1 FROM public.horarios h
          WHERE upper(btrim(coalesce(h.aula, ''))) = upper(btrim(OLD.nombre))
       ) THEN
        RAISE EXCEPTION 'Esta aula ya tiene horarios asignados. Reasigna sus grupos antes de convertirla en otro tipo de espacio.';
    END IF;
    RETURN NEW;
END;
$jgr_clasificacion$;

DROP TRIGGER IF EXISTS jaguar_no_reclasificar_aula_asignada ON public.jaguar_aulas;
CREATE TRIGGER jaguar_no_reclasificar_aula_asignada
BEFORE UPDATE OF tipo_espacio ON public.jaguar_aulas
FOR EACH ROW EXECUTE FUNCTION public.jaguar_evitar_reclasificar_aula_asignada();
