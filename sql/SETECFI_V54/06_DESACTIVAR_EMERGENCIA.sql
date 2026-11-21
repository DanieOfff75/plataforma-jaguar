-- Solo para emergencia verificada por administracion tecnica. Deja evidencias intactas.
-- No borra ni modifica expedientes SETECFI. Anotar incidente y motivo por separado.
UPDATE public.setecfi_control_v54 SET obligatorio=false WHERE id=1;
