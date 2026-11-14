-- SOLO psql en base VACÍA DESECHABLE; no ejecutar en Supabase real.
\set ON_ERROR_STOP on
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE TABLE public.perfiles(id uuid primary key,nombre_completo text,rol text,activo boolean);
INSERT INTO public.perfiles VALUES
('00000000-0000-4000-8000-000000000001','Coordinador ficticio','coordinacion_academica',true),
('00000000-0000-4000-8000-000000000002','Directora ficticia','direccion_escolar',true),
('00000000-0000-4000-8000-000000000003','Docente ficticio','docente',true);
\ir ../sql/ITHLA_JAGUAR_360_PLANIFICACION_V1.sql
SET ROLE service_role;
SET request.jwt.claims = '{"role":"service_role"}';
SELECT id,version,estado FROM public.jaguar360_registrar_plan('00000000-0000-4000-8000-000000000001','2026-2027',0,'proponer','{"cycle":"2026-2027","policy":{"periods":1,"scheduleModel":"fixed"},"calendar":[{}]}','Propuesta ficticia de prueba SQL');
DO $$BEGIN
 BEGIN PERFORM public.jaguar360_registrar_plan('00000000-0000-4000-8000-000000000003','2026-2027',1,'validar',NULL,'Intento no autorizado de prueba'); RAISE EXCEPTION 'FALLO: permiso docente'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALLO:%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.jaguar360_registrar_plan('00000000-0000-4000-8000-000000000002','2026-2027',0,'validar',NULL,'Intento de versión obsoleta'); RAISE EXCEPTION 'FALLO: versión obsoleta'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALLO:%' THEN RAISE; END IF; END;
END$$;
SELECT id,version,estado FROM public.jaguar360_registrar_plan('00000000-0000-4000-8000-000000000002','2026-2027',1,'validar',NULL,'Validación ficticia de prueba SQL');
DO $$ BEGIN IF (SELECT count(*) FROM public.jaguar360_planes_ciclo)<>2 THEN RAISE EXCEPTION 'Historial incorrecto'; END IF; END $$;
RESET ROLE;
DO $$BEGIN IF has_function_privilege('authenticated','public.jaguar360_registrar_plan(uuid,text,integer,text,jsonb,text)','EXECUTE') THEN RAISE EXCEPTION 'RPC expuesto'; END IF; IF has_table_privilege('service_role','public.jaguar360_planes_ciclo','UPDATE') THEN RAISE EXCEPTION 'Historial mutable'; END IF; END $$;
