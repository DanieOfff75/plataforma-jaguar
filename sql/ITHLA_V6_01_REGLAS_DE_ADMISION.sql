-- Instalar DESPUÉS de 00_NUCLEO_INSTITUCIONAL.
-- Registro atómico y serializado contra cierre de convocatoria. Service-role solamente.
BEGIN;
CREATE OR REPLACE FUNCTION public.ithla_registrar_aspirante_if_open(p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $ithla$
DECLARE
  v_estado jsonb; v_curp text; v_folio text; v_id bigint; v_modalidad text; v_estado_aspirante text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Acceso exclusivo del servidor';
  END IF;
  IF jsonb_typeof(p_datos) <> 'object' THEN RAISE EXCEPTION 'Solicitud inválida'; END IF;
  -- Compartimos el bloqueo de fila con el cierre/apertura de convocatoria.
  SELECT valor INTO v_estado FROM public.ithla_config WHERE clave='admisiones' FOR SHARE;
  IF v_estado IS NULL OR v_estado->>'estado' <> 'abierto' OR
     (nullif(v_estado->>'fecha_inicio','') IS NOT NULL AND now()< (v_estado->>'fecha_inicio')::timestamptz) OR
     (nullif(v_estado->>'fecha_fin','') IS NOT NULL AND now()>= (v_estado->>'fecha_fin')::timestamptz)
  THEN RAISE EXCEPTION 'Periodo de admisión finalizado o no disponible'; END IF;
  v_curp:=upper(trim(p_datos->>'curp'));
  IF v_curp !~ '^[A-Z]{4}[0-9]{6}[HM][A-Z]{5}[A-Z0-9][0-9]$' THEN RAISE EXCEPTION 'CURP inválida'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_curp));
  IF EXISTS(SELECT 1 FROM public.aspirantes WHERE upper(curp)=v_curp) THEN
    RAISE EXCEPTION 'Ya existe una solicitud registrada con esa CURP';
  END IF;
  v_modalidad:=left(trim(p_datos->>'modalidad_ingreso'),100);
  v_estado_aspirante:=CASE WHEN v_modalidad ILIKE '%Examen%' THEN 'pendiente_examen' WHEN v_modalidad ILIKE '%Beca%' THEN 'pendiente_beca' WHEN v_modalidad ILIKE '%Promedio%' THEN 'pendiente_promedio' ELSE 'pendiente' END;
  v_folio:='ITHLA-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  INSERT INTO public.aspirantes(numero_ficha,nombre_completo,curp,sexo,fecha_nacimiento,escuela_origen,promedio,taller,turno,correo,telefono,calle_numero,codigo_postal,municipio,modalidad_ingreso,nombre_tutor,telefono_tutor,estado)
  VALUES(
    v_folio,left(trim(p_datos->>'nombre_completo'),180),v_curp,left(trim(p_datos->>'sexo'),20),
    (p_datos->>'fecha_nacimiento')::date,left(trim(p_datos->>'escuela_origen'),200),(p_datos->>'promedio')::numeric,
    left(trim(p_datos->>'taller'),180),left(trim(p_datos->>'turno'),50),left(trim(p_datos->>'correo'),200),left(trim(p_datos->>'telefono'),30),
    left(trim(p_datos->>'calle_numero'),200),left(trim(p_datos->>'codigo_postal'),10),left(trim(p_datos->>'municipio'),240),
    v_modalidad,left(trim(p_datos->>'nombre_tutor'),180),left(trim(p_datos->>'telefono_tutor'),30),v_estado_aspirante
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('id',v_id,'numero_ficha',v_folio);
END
$ithla$;
REVOKE ALL ON FUNCTION public.ithla_registrar_aspirante_if_open(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ithla_registrar_aspirante_if_open(jsonb) TO service_role;
COMMIT;
