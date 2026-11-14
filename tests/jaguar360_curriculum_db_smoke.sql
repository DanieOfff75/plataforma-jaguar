-- Ejecutar en una copia desechable de PostgreSQL/Supabase, después de V1 actualizado.
-- Como propietario de la migración: el helper no es RPC para usuarios.
BEGIN;
DO $$
DECLARE a jsonb; bad jsonb; rejected boolean;
BEGIN
 a:='[{"key":"TEST-1","grade":1,"name":"Materia ficticia","legacyId":null,"evaluation":"numerica","qualitativeMode":null,"required":true,"sessionMinutes":50,"dailyMin":0,"dailyMax":150,"weeklyMinutes":250,"monthlyMinutes":1000,"distribution":"flexible","shortfall":"resolution","periodMinutes":[1000,1000,1000],"totalMinutes":3000,"attendancePct":80,"periodAttendancePct":[null,90.5,null]}]'::jsonb;
 PERFORM public.jaguar360_validar_curriculum(a,3);
 FOREACH bad IN ARRAY ARRAY[
  jsonb_set(a,'{0,totalMinutes}','2999'),
  jsonb_set(a,'{0,sessionMinutes}','0'),
  jsonb_set(a,'{0,periodMinutes}','[1000,2000]'),
  jsonb_set(a,'{0,periodAttendancePct}','[null,101,null]'),
  jsonb_set(a,'{0,evaluation}','"no_aplica"'),
  jsonb_set(a,'{0,legacyId}','"invalid"'),
  a||a
 ] LOOP
  rejected:=false;
  BEGIN PERFORM public.jaguar360_validar_curriculum(bad,3); EXCEPTION WHEN raise_exception THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Se aceptó un currículo inválido: %',bad; END IF;
 END LOOP;
 IF has_function_privilege('authenticated','public.jaguar360_validar_curriculum(jsonb,integer)','EXECUTE') OR has_function_privilege('anon','public.jaguar360_validar_curriculum(jsonb,integer)','EXECUTE') THEN RAISE EXCEPTION 'Función auxiliar expuesta.'; END IF;
END $$;
ROLLBACK;
