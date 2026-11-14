-- Fixture local vacío; no usar en producción. Ensaya los contratos V36, sin Auth real.
BEGIN;
DO $$
DECLARE c uuid:='00000000-0000-4000-8000-000000000201'; e uuid:='00000000-0000-4000-8000-000000000202'; p uuid:='00000000-0000-4000-8000-000000000203'; u uuid:='00000000-0000-4000-8000-000000000204'; g1 bigint; g2 bigint; a bigint; r bigint; g bigint; n bigint; w1 bigint; w2 bigint; result jsonb; denied boolean;
BEGIN
 IF current_database() !~ '^jaguar360_clon_[a-z0-9_]+$' OR current_setting('jaguar360.isolated_clone',true) IS DISTINCT FROM 'validacion_sin_datos_reales' OR EXISTS(SELECT 1 FROM public.alumnos) OR EXISTS(SELECT 1 FROM public.perfiles) OR EXISTS(SELECT 1 FROM public.periodos_escolares) THEN RAISE EXCEPTION 'Fixture exclusivo de laboratorio vacío.'; END IF;
 INSERT INTO auth.users(id) VALUES(c),(e),(p),(u);
 INSERT INTO public.perfiles(id,nombre_completo,rol,activo) VALUES(c,'Control ficticio','control_escolar',true),(e,'Estudiantiles ficticio','servicios_estudiantiles',true),(p,'Prefectura ficticia','prefectura',true),(u,'Alumno ficticio','alumno',true);
 INSERT INTO public.periodos_escolares(nombre,ciclo_escolar,fecha_inicio,fecha_fin,activo,numero_periodo,es_periodo_actual) VALUES('Periodo ficticio','2090-2091','2090-08-01','2090-12-31',true,1,true);
 INSERT INTO public.grupos(clave,grado,letra,turno,activo) VALUES('1A',1,'A','matutino',true) RETURNING id INTO g1;
 INSERT INTO public.grupos(clave,grado,letra,turno,activo) VALUES('1B',1,'B','matutino',true) RETURNING id INTO g2;
 INSERT INTO public.alumnos(nombre_completo,matricula,grupo_id,activo,estado_escolar,auth_user_id) VALUES('Alumno de prueba','LAB-V36-A',g1,true,'activo',u) RETURNING id INTO a;
 INSERT INTO public.solicitudes_estudiantiles(alumno_id,tipo,motivo,estado,departamento_destino,valor_actual,valor_solicitado) VALUES(a,'grupo','Fixture','pendiente','servicios_estudiantiles',g1::text,g2::text) RETURNING id INTO r;
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 result:=public.jaguar360_cupos_grupos(ARRAY[g1,g2]);
 IF (result->g1::text->>'ocupados')::integer IS DISTINCT FROM 1 OR (result->g2::text->>'limite')::integer IS DISTINCT FROM 40 THEN RAISE EXCEPTION 'Cupos incorrectos.'; END IF;
 denied:=false; BEGIN PERFORM public.jaguar360_resolver_solicitud(e,r,'aprobada','solicitado',''); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Departamento ajeno resolvió.'; END IF;
 result:=public.jaguar360_resolver_solicitud(c,r,'aprobada','solicitado','Fixture');
 SELECT grupo_id INTO g FROM public.alumnos WHERE id=a AND matricula='LAB-V36-A';
 IF g IS DISTINCT FROM g2 OR result->>'estado' IS DISTINCT FROM 'aprobada' THEN RAISE EXCEPTION 'Movimiento o matrícula incorrecta.'; END IF;
 denied:=false; BEGIN PERFORM public.jaguar360_resolver_solicitud(c,r,'rechazada','solicitado',''); EXCEPTION WHEN serialization_failure THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Resolución repetida.'; END IF;
 IF (SELECT count(*) FROM public.notificaciones WHERE solicitud_id=r AND usuario_id=u AND tipo='resolucion_solicitud')<>1 THEN RAISE EXCEPTION 'Notificación de resolución no única.'; END IF;
 INSERT INTO public.solicitudes_estudiantiles(alumno_id,tipo,motivo,estado,departamento_destino,valor_solicitado) VALUES(a,'grado','Fixture','pendiente','servicios_estudiantiles','2') RETURNING id INTO r;
 denied:=false; BEGIN PERFORM public.jaguar360_resolver_solicitud(e,r,'aprobada','solicitado',''); EXCEPTION WHEN check_violation THEN denied:=true; END;
 IF NOT denied OR (SELECT estado FROM public.solicitudes_estudiantiles WHERE id=r)<>'pendiente' THEN RAISE EXCEPTION 'Cambio de grado no autorizado.'; END IF;
 INSERT INTO public.talleres(nombre,cupo,activo) VALUES('Taller ficticio A',2,true) RETURNING id INTO w1;
 INSERT INTO public.talleres(nombre,cupo,activo) VALUES('Taller ficticio B',2,true) RETURNING id INTO w2;
 INSERT INTO public.inscripciones_talleres(alumno_id,taller_id,ciclo_escolar,estado,fecha_inscripcion) VALUES(a,w1,'2090-2091','inscrito',current_date);
 INSERT INTO public.solicitudes_estudiantiles(alumno_id,tipo,motivo,estado,departamento_destino,valor_solicitado) VALUES(a,'taller','Fixture','pendiente','servicios_estudiantiles',w2::text) RETURNING id INTO r;
 result:=public.jaguar360_resolver_solicitud(e,r,'aprobada','solicitado','Fixture');
 SELECT count(*) INTO n FROM public.inscripciones_talleres WHERE alumno_id=a AND ((taller_id=w1 AND estado='baja') OR (taller_id=w2 AND estado='inscrito'));
 IF n<>2 OR result->>'estado' IS DISTINCT FROM 'aprobada' THEN RAISE EXCEPTION 'Cambio de taller incorrecto.'; END IF;
 INSERT INTO public.solicitudes_estudiantiles(alumno_id,tipo,motivo,estado) VALUES(a,'otro','Sin destino ficticio','pendiente') RETURNING id INTO r;
 denied:=false; BEGIN PERFORM public.jaguar360_resolver_solicitud(p,r,'rechazada','solicitado',''); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Solicitud sin destino visible a otro departamento.'; END IF;
 -- V37 creation is tied to Auth, rechecks the student's current group and fans out one notice per active owner.
 result:=public.jaguar360_crear_solicitud_ordinaria(u,'grupo','alterado',g1::text,'Prueba V37','prefectura');
 r:=(result->>'id')::bigint;
 IF result->>'valor_actual' IS DISTINCT FROM g2::text OR result->>'departamento_destino' IS DISTINCT FROM 'control_escolar' OR (result->>'notificaciones_registradas')::int<>1 THEN RAISE EXCEPTION 'Creación no conciliada.'; END IF;
 IF (SELECT count(*) FROM public.notificaciones WHERE solicitud_id=r AND usuario_id=c AND tipo='solicitud_estudiantil')<>1 OR EXISTS(SELECT 1 FROM public.notificaciones WHERE solicitud_id=r AND usuario_id<>c) THEN RAISE EXCEPTION 'Aviso departamental no único o fuera de alcance.'; END IF;
 denied:=false; BEGIN PERFORM public.jaguar360_crear_solicitud_ordinaria(u,'grupo',NULL,g1::text,'Otra solicitud','control_escolar'); EXCEPTION WHEN serialization_failure THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Solicitud duplicada.'; END IF;
 denied:=false; BEGIN PERFORM public.jaguar360_crear_solicitud_ordinaria(c,'otro',NULL,NULL,'Suplantación ficticia','prefectura'); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Actor no alumno admitido.'; END IF;
 IF has_column_privilege('authenticated','public.notificaciones','contenido','UPDATE') OR NOT has_column_privilege('authenticated','public.notificaciones','leida','UPDATE') THEN RAISE EXCEPTION 'Privilegios incorrectos.'; END IF;
END $$;
ROLLBACK;
