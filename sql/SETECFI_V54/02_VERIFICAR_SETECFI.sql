SELECT table_name, (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid=('public.'||table_name)::regclass) AS rls
FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('setecfi_operadores_v54','setecfi_expedientes_v54','setecfi_eventos_v54') ORDER BY table_name;
SELECT proname, prosecdef FROM pg_proc WHERE oid IN('public.setecfi_direccion_decidir_v54(uuid,uuid,text,text)'::regprocedure,'public.setecfi_resolver_v54(uuid,uuid,text,text,text,text[],date)'::regprocedure);
SELECT count(*) AS operadores_cargados FROM public.setecfi_operadores_v54;
