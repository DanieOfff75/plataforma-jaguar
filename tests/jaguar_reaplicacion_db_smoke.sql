-- SOLO PostgreSQL desechable y vacío, ejecutado con psql como propietario.
-- NO ejecutar en Supabase de producción ni en una base con datos reales.
-- psql -v ON_ERROR_STOP=1 -d jaguar_prueba_vacia -f tests/jaguar_reaplicacion_db_smoke.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF to_regclass('public.calificaciones') IS NOT NULL OR to_regclass('public.perfiles') IS NOT NULL THEN
  RAISE EXCEPTION 'Esta prueba requiere una base vacía y desechable.';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE TABLE public.perfiles(id uuid PRIMARY KEY,rol text,activo boolean);
CREATE TABLE public.periodos_escolares(id bigint PRIMARY KEY,ciclo_escolar text);
CREATE TABLE public.notificaciones(usuario_id uuid,titulo text,contenido text,tipo text,solicitud_id bigint,leida boolean);
CREATE TABLE public.calificaciones(id bigint PRIMARY KEY,periodo_id bigint,calificacion numeric,observaciones text,detalle_evaluacion jsonb);
CREATE FUNCTION public.jaguar_evaluacion_abierta(bigint) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
INSERT INTO public.perfiles VALUES ('00000000-0000-0000-0000-000000000001','control_escolar',true),('00000000-0000-0000-0000-000000000002','docente',true),('00000000-0000-0000-0000-000000000003','alumno',true);
INSERT INTO public.periodos_escolares VALUES (1,'2026-2027'),(2,'2025-2026');
INSERT INTO public.calificaciones VALUES
 (1,1,2,'Justificación docente',NULL), (2,1,3,NULL,NULL),(3,1,5.9,NULL,NULL),(4,1,6,NULL,NULL),(5,2,4,NULL,NULL),
 (6,2,NULL,NULL,NULL),
 (7,1,8,'Calificación registrada desde VALOR TOTAL de Excel docente.','{"fuente":"excel_valor_total","valor_total_excel":7.625,"calificacion":8,"politica_precision":{"permite_decimales":false,"minima_aprobatoria":6,"permitir_reprobatorias_inferiores":true}}');
\ir ../sql/ITHLA_CALIFICACIONES_PRECISION_Y_OFICIOS_2026.sql
\ir ../sql/ITHLA_CALIFICACIONES_REAPLICACION_2026.sql
CREATE TRIGGER jaguar_control_calificaciones_periodo BEFORE INSERT OR UPDATE OR DELETE ON public.calificaciones FOR EACH ROW EXECUTE FUNCTION public.jaguar_bloquear_escritura_calificacion();
DO $$ BEGIN
 IF (SELECT calificacion FROM public.calificaciones WHERE id=1)<>2 THEN RAISE EXCEPTION 'La instalación mutó datos'; END IF;
 IF has_function_privilege('authenticated','public.jaguar_aplicar_criterios_calificaciones(text,boolean,text,uuid,text,integer,integer,boolean,text,boolean,text)','EXECUTE') THEN RAISE EXCEPTION 'El RPC está expuesto al navegador'; END IF;
END $$;
SET ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
DO $$ DECLARE p jsonb;r jsonb; BEGIN
 p:=public.jaguar_aplicar_criterios_calificaciones('2026-2027',false,'Prueba de piso reprobatorio','00000000-0000-0000-0000-000000000001','CE ficticio',0,6,false,'todos',true,NULL);
 IF (p->>'notas_cambian')::int<>4 OR (p->>'evaluadas')::int<>6 THEN RAISE EXCEPTION 'Vista previa inesperada: %',p; END IF;
 BEGIN
  PERFORM public.jaguar_aplicar_criterios_calificaciones('2026-2027',false,'Prueba de piso reprobatorio','00000000-0000-0000-0000-000000000001','CE ficticio',0,6,false,'todos',false,'invalida');
  RAISE EXCEPTION 'Huella incorrecta fue aceptada';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 r:=public.jaguar_aplicar_criterios_calificaciones('2026-2027',false,'Prueba de piso reprobatorio','00000000-0000-0000-0000-000000000001','CE ficticio',0,6,false,'todos',false,p->>'huella');
 IF (r->>'registros_actualizados')::int<>4 THEN RAISE EXCEPTION 'Reaplicación inesperada: %',r; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.calificaciones WHERE id IN (1,2,3,5) AND (calificacion<>5 OR observaciones NOT LIKE 'REPROBADO.%')) THEN RAISE EXCEPTION 'Piso incorrecto'; END IF;
 IF (SELECT calificacion_original_politica FROM public.calificaciones WHERE id=1)<>2 THEN RAISE EXCEPTION 'Original perdido'; END IF;
 IF EXISTS(SELECT 1 FROM public.notificaciones WHERE usuario_id='00000000-0000-0000-0000-000000000003') THEN RAISE EXCEPTION 'Aviso enviado a alumno'; END IF;
 BEGIN UPDATE public.calificaciones SET calificacion=9 WHERE id=1; RAISE EXCEPTION 'Captura de periodo cerrado quedó abierta'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SET ROLE service_role;
DO $$ DECLARE p jsonb;r jsonb; BEGIN
 p:=public.jaguar_aplicar_criterios_calificaciones('2026-2027',true,'Prueba de restauración de fuentes','00000000-0000-0000-0000-000000000001','CE ficticio',1,6,true,'todos',true,NULL);
 r:=public.jaguar_aplicar_criterios_calificaciones('2026-2027',true,'Prueba de restauración de fuentes','00000000-0000-0000-0000-000000000001','CE ficticio',1,6,true,'todos',false,p->>'huella');
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT calificacion FROM public.calificaciones WHERE id=1)<>2 OR (SELECT calificacion FROM public.calificaciones WHERE id=2)<>3 OR (SELECT calificacion FROM public.calificaciones WHERE id=5)<>4 OR (SELECT calificacion FROM public.calificaciones WHERE id=3)<>5.9 OR (SELECT calificacion FROM public.calificaciones WHERE id=7)<>7.6 THEN RAISE EXCEPTION 'Restauración incorrecta'; END IF;
 IF (SELECT count(*) FROM public.jaguar_reaplicacion_calificaciones)<>9 THEN RAISE EXCEPTION 'Auditoría incompleta'; END IF;
END $$;
SELECT 'Prueba SQL de reaplicación superada' AS resultado;
