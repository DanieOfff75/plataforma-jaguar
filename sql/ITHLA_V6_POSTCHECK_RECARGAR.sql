-- Verifica resultados antes de usar datos reales.
SELECT clave,revision,actualizado_en FROM public.ithla_config ORDER BY clave;
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND proname LIKE 'ithla_%' ORDER BY proname;
NOTIFY pgrst, 'reload schema';
