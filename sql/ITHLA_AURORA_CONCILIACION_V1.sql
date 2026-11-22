-- Jaguar / ITHLA · Confirmaciones verificadas contra Banco Aurora.
-- Módulo independiente de conciliación, sin modificar registros monetarios existentes.
-- Instalar una vez, después del esquema de Recursos Monetarios.
CREATE TABLE IF NOT EXISTS public.recursos_aurora_verificaciones (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 aurora_intent_id uuid NOT NULL UNIQUE,
 cargo_id bigint NOT NULL REFERENCES public.recursos_cargos(id),
 referencia text NOT NULL UNIQUE,
 importe numeric(14,2) NOT NULL CHECK(importe>0),
 validado_por uuid NOT NULL,
 validado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recursos_aurora_cargo
 ON public.recursos_aurora_verificaciones(cargo_id);
ALTER TABLE public.recursos_aurora_verificaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recursos_aurora_verificaciones FROM anon,authenticated;

-- La confirmacion queda en tabla separada. NO crea recursos_pagos ni
-- recalcula recursos_cargos: la automatizacion del asiento oficial
-- requiere cotejo de importe, destinatario, ciclo y políticas del instituto.
