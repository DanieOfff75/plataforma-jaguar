-- Sólo tras crear/verificar al estudiante en el padrón real public.alumnos de Jaguar.
-- Este flujo NUNCA crea cuentas automáticamente al aceptar.
BEGIN;
CREATE OR REPLACE FUNCTION public.ithla_confirmar_inscripcion(p_aspirante_id bigint,p_matricula text,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $ithla$
DECLARE v_asp public.aspirantes%ROWTYPE; v_alumno_id bigint;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Acceso sólo desde el servidor'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND rol IN ('control','control_escolar') AND activo=true) THEN
   RAISE EXCEPTION 'Se requiere Control Escolar activo';
 END IF;
 IF p_matricula IS NULL OR length(trim(p_matricula))<4 THEN RAISE EXCEPTION 'Matrícula inválida'; END IF;
 SELECT * INTO v_asp FROM public.aspirantes WHERE id=p_aspirante_id FOR UPDATE;
 IF NOT FOUND OR v_asp.estado<>'aceptado' THEN RAISE EXCEPTION 'Aspirante no aceptado'; END IF;
 IF v_asp.numero_matricula IS NOT NULL THEN RAISE EXCEPTION 'La inscripción ya tiene matrícula asignada'; END IF;
 -- Nunca enlazamos únicamente por nombre: ambas identidades deben coincidir.
 SELECT id INTO v_alumno_id FROM public.alumnos
 WHERE upper(trim(matricula))=upper(trim(p_matricula))
   AND upper(trim(curp))=upper(trim(v_asp.curp)) AND grupo_id IS NOT NULL
 LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'No existe un alumno de Jaguar con esa matrícula, CURP y grupo confirmado'; END IF;
 UPDATE public.aspirantes SET numero_matricula=upper(trim(p_matricula)) WHERE id=p_aspirante_id;
 INSERT INTO public.ithla_inscripciones_pendientes(aspirante_id,aceptado_en,documentos_confirmados_en,confirmado_por,matriculado_en)
 VALUES(p_aspirante_id,coalesce(v_asp.fecha_resolucion,now()),now(),p_actor,now())
 ON CONFLICT(aspirante_id) DO UPDATE SET documentos_confirmados_en=now(),confirmado_por=p_actor,matriculado_en=now();
 INSERT INTO public.ithla_auditoria(accion,actor,clave,posterior)
 VALUES('inscripcion_confirmada',p_actor,'admisiones',jsonb_build_object('aspirante_id',p_aspirante_id,'alumno_id',v_alumno_id));
 RETURN jsonb_build_object('ok',true,'alumno_id',v_alumno_id,'matricula',upper(trim(p_matricula)));
END
$ithla$;
REVOKE ALL ON FUNCTION public.ithla_confirmar_inscripcion(bigint,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ithla_confirmar_inscripcion(bigint,text,uuid) TO service_role;
COMMIT;
