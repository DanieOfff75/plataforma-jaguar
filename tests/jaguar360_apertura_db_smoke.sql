-- Run only in isolated DB as migration owner, after V22. No real pupil data.
-- This verifies helper and ACL, not a full cycle transition fixture.
BEGIN;
DO $$
BEGIN
 IF public.jaguar360_nota_ordinaria(7.9,false,6,true,'truncate')<>7 OR public.jaguar360_nota_ordinaria(7.9,false,6,true,'nearest')<>8 OR public.jaguar360_nota_ordinaria(5.99,true,6,true,'nearest')<>5.9 OR public.jaguar360_nota_ordinaria(2.3,false,6,false,'truncate')<>5 THEN RAISE EXCEPTION 'Resultado decimal incorrecto'; END IF;
 IF has_function_privilege('authenticated','public.jaguar360_abrir_ciclo(uuid,text,text,text,text)','execute') OR has_function_privilege('anon','public.jaguar360_abrir_ciclo(uuid,text,text,text,text)','execute') OR NOT has_function_privilege('service_role','public.jaguar360_abrir_ciclo(uuid,text,text,text,text)','execute') THEN RAISE EXCEPTION 'Permisos RPC incorrectos'; END IF;
 IF has_table_privilege('authenticated','public.jaguar360_aperturas_ciclo','insert') OR has_table_privilege('service_role','public.jaguar360_aperturas_ciclo','update') THEN RAISE EXCEPTION 'Permisos de registro incorrectos'; END IF;
END $$;
ROLLBACK;
