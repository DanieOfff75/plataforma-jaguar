-- Corrección no destructiva: concatenación de folio Aurora.
-- Aplicada a Supabase de Jaguar; solo recrea la función, no toca pagos ni cargos.
CREATE OR REPLACE FUNCTION public.jaguar_aurora_acreditar_pago_verificado(p_intent uuid, p_cargo bigint, p_ref text, p_amount numeric, p_actor uuid, p_method text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
 v_cargo public.recursos_cargos%ROWTYPE;
 v_paid numeric(14,2);
 v_due numeric(14,2);
 v_existing public.recursos_aurora_verificaciones%ROWTYPE;
 v_id bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(135971,194825);
 IF p_intent IS NULL OR p_cargo IS NULL OR p_actor IS NULL OR p_ref !~ '^AU-[A-Fa-f0-9]{32}$'
   OR p_method NOT IN ('tarjeta','deposito','transferencia') OR p_amount IS NULL OR p_amount<=0
 THEN RAISE EXCEPTION 'Solicitud de conciliación inválida'; END IF;
 SELECT * INTO v_existing FROM public.recursos_aurora_verificaciones
 WHERE aurora_intent_id=p_intent OR referencia=upper(p_ref);
 IF FOUND THEN
  IF v_existing.cargo_id<>p_cargo OR v_existing.importe<>p_amount OR v_existing.referencia<>upper(p_ref)
     OR v_existing.recurso_pago_id IS NULL THEN
    RAISE EXCEPTION 'La referencia ya fue usada o está pendiente de revisión';
  END IF;
  RETURN jsonb_build_object('ok',true,'already',true,'pago_id',v_existing.recurso_pago_id);
 END IF;
 SELECT * INTO v_cargo FROM public.recursos_cargos WHERE id=p_cargo FOR UPDATE;
 IF NOT FOUND OR v_cargo.estado NOT IN('pendiente','parcial')
 THEN RAISE EXCEPTION 'Cargo no disponible para acreditación'; END IF;
 SELECT COALESCE(sum(importe),0) INTO v_paid FROM public.recursos_pagos
 WHERE cargo_id=p_cargo AND estado='registrado';
 v_due:=v_cargo.importe-v_paid;
 IF v_due<>p_amount THEN RAISE EXCEPTION 'El abono no coincide con el saldo pendiente: %',v_due; END IF;
 v_id:=nextval('public.recursos_aurora_pago_seq');
 INSERT INTO public.recursos_pagos
 (id,folio,alumno_id,cargo_id,concepto_id,cuenta_id,ciclo_escolar,importe,metodo_pago,
  referencia_pago,fecha_pago,estado,recibio_por,notas)
 VALUES(v_id,'AU-'||substring(upper(p_ref) from 4),v_cargo.alumno_id,p_cargo,v_cargo.concepto_id,
  2,v_cargo.ciclo_escolar,p_amount,p_method,upper(p_ref),current_date,'registrado',p_actor,
  'Pago virtual confirmado por Banco Aurora. Referencia verificada desde servidor.');
 INSERT INTO public.recursos_aurora_verificaciones
 (aurora_intent_id,cargo_id,referencia,importe,validado_por,origen,recurso_pago_id)
 VALUES(p_intent,p_cargo,upper(p_ref),p_amount,p_actor,
        CASE WHEN p_method='tarjeta' THEN 'checkout' WHEN p_method='deposito' THEN 'deposito' ELSE 'transferencia' END,v_id);
 RETURN jsonb_build_object('ok',true,'already',false,'pago_id',v_id);
END
$function$;
REVOKE ALL ON FUNCTION public.jaguar_aurora_acreditar_pago_verificado(uuid,bigint,text,numeric,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jaguar_aurora_acreditar_pago_verificado(uuid,bigint,text,numeric,uuid,text) TO service_role;
