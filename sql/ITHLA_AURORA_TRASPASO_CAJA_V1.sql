-- ITHLA Caja -> Banco Aurora. Instalado en el proyecto actual.
-- Ruta segura: verificar en Aurora el depósito institucional, luego llamar esta RPC desde service_role.
-- No ejecutar sobre una base sin Recursos Monetarios previamente instalado.
CREATE SEQUENCE IF NOT EXISTS public.recursos_aurora_caja_traspaso_seq START WITH 910000000 INCREMENT BY 1;
REVOKE ALL ON SEQUENCE public.recursos_aurora_caja_traspaso_seq FROM anon,authenticated;
CREATE TABLE IF NOT EXISTS public.recursos_aurora_caja_traspasos(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 aurora_operation_id uuid NOT NULL UNIQUE,
 referencia text NOT NULL UNIQUE,
 importe numeric(14,2) NOT NULL CHECK(importe>0),
 transferencia_id bigint NOT NULL UNIQUE REFERENCES public.recursos_transferencias(id),
 registrado_por uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.recursos_aurora_caja_traspasos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recursos_aurora_caja_traspasos FROM anon,authenticated;

CREATE OR REPLACE FUNCTION public.jaguar_aurora_conciliar_caja_depositada(p_operation uuid, p_reference text, p_amount numeric, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
 v_previous public.recursos_aurora_caja_traspasos%ROWTYPE;
 v_saldo numeric(14,2);
 v_transfer_id bigint;
 v_cycle text;
BEGIN
 PERFORM pg_advisory_xact_lock(137914,260611);
 IF p_operation IS NULL OR p_actor IS NULL OR p_reference !~ '^AU-[a-fA-F0-9]{32}$'
   OR p_amount IS NULL OR p_amount<=0 OR p_amount>1000000000
 THEN RAISE EXCEPTION 'Parámetros de transferencia inválidos'; END IF;
 SELECT * INTO v_previous FROM public.recursos_aurora_caja_traspasos WHERE aurora_operation_id=p_operation OR referencia=upper(p_reference);
 IF FOUND THEN
   IF v_previous.aurora_operation_id<>p_operation OR v_previous.importe<>p_amount OR v_previous.referencia<>upper(p_reference)
   THEN RAISE EXCEPTION 'Referencia bancaria ya utilizada en otra operación'; END IF;
   RETURN jsonb_build_object('ok',true,'repeat',true,'transferencia_id',v_previous.transferencia_id);
 END IF;
 PERFORM 1 FROM public.recursos_cuentas WHERE id IN(1,2) ORDER BY id FOR UPDATE;
 SELECT public.jaguar_recursos_saldo_cuenta(1,current_date) INTO v_saldo;
 IF v_saldo IS NULL OR v_saldo+0.005<p_amount THEN
   RAISE EXCEPTION 'Caja sin efectivo suficiente. Disponible: %',COALESCE(v_saldo,0);
 END IF;
 SELECT ciclo_escolar INTO v_cycle FROM public.recursos_transferencias ORDER BY id DESC LIMIT 1;
 v_transfer_id:=nextval('public.recursos_aurora_caja_traspaso_seq');
 INSERT INTO public.recursos_transferencias
 (id,folio,ciclo_escolar,cuenta_origen_id,cuenta_destino_id,importe,fecha_transferencia,referencia,concepto,estado,creado_por)
 VALUES(v_transfer_id,'CAJA-AU-'||substring(upper(p_reference) from 4),COALESCE(v_cycle,'2026-2027'),
        1,2,p_amount,current_date,upper(p_reference),
        'Depósito de efectivo de caja institucional confirmado por ventanilla Banco Aurora','registrado',p_actor);
 INSERT INTO public.recursos_aurora_caja_traspasos(aurora_operation_id,referencia,importe,transferencia_id,registrado_por)
 VALUES(p_operation,upper(p_reference),p_amount,v_transfer_id,p_actor);
 RETURN jsonb_build_object('ok',true,'repeat',false,'transferencia_id',v_transfer_id);
END
$function$
;

REVOKE ALL ON FUNCTION public.jaguar_aurora_conciliar_caja_depositada(uuid,text,numeric,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jaguar_aurora_conciliar_caja_depositada(uuid,text,numeric,uuid) TO service_role;
