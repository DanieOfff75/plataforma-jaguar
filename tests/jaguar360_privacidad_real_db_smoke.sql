-- Exclusivamente laboratorio vacío reconstruido, con fixture ficticio y ROLLBACK.
BEGIN;
DO $$
DECLARE actor uuid:='00000000-0000-4000-8000-000000000101'; pref uuid:='00000000-0000-4000-8000-000000000102';
 learner uuid:='00000000-0000-4000-8000-000000000103'; cur bigint; prev bigint; g bigint; gm bigint; s bigint; mt bigint; rec bigint; metrics jsonb; note numeric; raw numeric; denied boolean;
BEGIN
 IF current_database() !~ '^jaguar360_clon_[a-z0-9_]+$' OR current_setting('jaguar360.isolated_clone',true) IS DISTINCT FROM 'validacion_sin_datos_reales' OR EXISTS(SELECT 1 FROM public.alumnos) OR EXISTS(SELECT 1 FROM public.periodos_escolares) OR EXISTS(SELECT 1 FROM public.perfiles) THEN RAISE EXCEPTION 'Fixture exclusivo de laboratorio nuevo.'; END IF;
 IF has_function_privilege('anon','public.generar_horario_grupo(bigint)','EXECUTE') OR has_function_privilege('authenticated','public.generar_horario_grupo(bigint)','EXECUTE') OR has_function_privilege('service_role','public.generar_horario_grupo(bigint)','EXECUTE') THEN RAISE EXCEPTION 'Generador anterior todavía accesible.'; END IF;
 IF has_table_privilege('authenticated','public.incidencias_prefectura','SELECT') OR has_table_privilege('authenticated','public.solicitudes_estudiantiles','SELECT') OR NOT has_table_privilege('service_role','public.incidencias_prefectura','SELECT') THEN RAISE EXCEPTION 'ACL incorrecta.'; END IF;
 INSERT INTO auth.users(id) VALUES(actor),(pref),(learner);
 INSERT INTO public.perfiles(id,nombre_completo,rol,activo) VALUES(actor,'Servicios ficticios','servicios_estudiantiles',true),(pref,'Prefectura ficticia','prefectura',true),(learner,'Alumno ficticio','alumno',true);
 INSERT INTO public.periodos_escolares(nombre,ciclo_escolar,fecha_inicio,fecha_fin,activo,numero_periodo,es_periodo_actual) VALUES('Periodo actual de prueba','2090-2091','2090-08-01','2090-12-31',true,1,true) RETURNING id INTO cur;
 INSERT INTO public.periodos_escolares(nombre,ciclo_escolar,fecha_inicio,fecha_fin,activo,numero_periodo,es_periodo_actual) VALUES('Periodo anterior de prueba','2089-2090','2089-08-01','2089-12-31',true,1,false) RETURNING id INTO prev;
 INSERT INTO public.jaguar_evaluacion_ventanas(periodo_id,habilitada) VALUES(cur,true),(prev,true);
 INSERT INTO public.grupos(clave,grado,letra,turno,activo) VALUES('1A',1,'A','matutino',true) RETURNING id INTO g;
 INSERT INTO public.materias(nombre,grado,activa) VALUES('Materia ficticia V35',1,true) RETURNING id INTO mt;
 INSERT INTO public.grupo_materias(grupo_id,materia_id) VALUES(g,mt) ON CONFLICT(grupo_id,materia_id) DO NOTHING;
 SELECT id INTO STRICT gm FROM public.grupo_materias WHERE grupo_id=g AND materia_id=mt;
 -- Bind a tiny configured capacity in this fixture only, without asserting an actual approved plan.
 INSERT INTO public.jaguar360_planes_ciclo(ciclo,version,estado,plan,motivo,actor_id,actor_nombre,actor_cargo) VALUES('2090-2091',1,'validada_para_planificacion','{}'::jsonb,'Fixture ficticio exclusivamente para probar capacidad',actor,'Ficticio','servicios_estudiantiles');
 INSERT INTO public.jaguar360_grupos_ciclo(grupo_id,ciclo,version_plan,huella_catalogo,cupo,referencia,actor_id) VALUES(g,'2090-2091',1,repeat('0',32),1,'FIXTURE-V35',actor);
 INSERT INTO public.alumnos(nombre_completo,matricula,grupo_id,activo,estado_escolar,auth_user_id) VALUES('Alumno de prueba','LAB-V35-A',g,true,'activo',learner) RETURNING id INTO s;
 denied:=false;
 BEGIN INSERT INTO public.alumnos(nombre_completo,matricula,grupo_id,activo,estado_escolar) VALUES('Exceso ficticio','LAB-V35-B',g,true,'activo'); EXCEPTION WHEN check_violation THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Se superó cupo configurado.'; END IF;
 INSERT INTO public.jaguar_precision_calificaciones(ciclo_escolar,permite_decimales,minima_aprobatoria,permitir_reprobatorias_inferiores,redondeo_ordinario) VALUES('2090-2091',false,6,true,'nearest'),('2089-2090',false,6,true,'nearest');
 INSERT INTO public.calificaciones(alumno_id,grupo_materia_id,periodo_id,calificacion,calificacion_original_politica) VALUES(s,gm,cur,5.99,5.99) RETURNING id,calificacion,calificacion_original_politica INTO rec,note,raw;
 IF note IS DISTINCT FROM 5::numeric OR raw IS DISTINCT FROM 5.99::numeric THEN RAISE EXCEPTION 'Se perdió fuente o se aprobó redondeando.'; END IF;
 UPDATE public.calificaciones SET calificacion=7.5,calificacion_original_politica=7.5 WHERE id=rec RETURNING calificacion,calificacion_original_politica INTO note,raw;
 IF note IS DISTINCT FROM 8::numeric OR raw IS DISTINCT FROM 7.5::numeric THEN RAISE EXCEPTION 'Redondeo ordinario incorrecto.'; END IF;
 INSERT INTO public.calificaciones(alumno_id,grupo_materia_id,periodo_id,calificacion,calificacion_original_politica) VALUES(s,gm,prev,10,10);
 UPDATE public.periodos_escolares SET activo=false WHERE id=prev;
 INSERT INTO public.incidencias_prefectura(alumno_id,tipo,titulo,descripcion,fecha) VALUES(s,'reporte','Actual ficticia','Fixture','2090-09-01'),(s,'reporte','Anterior ficticia','Fixture','2089-09-01');
 INSERT INTO public.solicitudes_estudiantiles(alumno_id,tipo,motivo,estado,departamento_destino) VALUES(s,'grupo','Prueba de departamento','pendiente','servicios_estudiantiles'),(s,'otro','Otra atribución','pendiente','direccion_escolar');
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 metrics:=public.jaguar360_cupos_grupos(ARRAY[g]);
 IF (metrics->g::text->>'limite')::integer IS DISTINCT FROM 1 OR (metrics->g::text->>'ocupados')::integer IS DISTINCT FROM 1 OR (metrics->g::text->>'lleno')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Cupo configurado no reflejado en API.'; END IF;
 metrics:=public.jaguar360_panel_departamento(actor);
 IF (metrics->>'average')::numeric IS DISTINCT FROM 8::numeric OR (metrics->>'pendingRequests')::integer IS DISTINCT FROM 0 OR metrics ? 'grades' OR metrics ? 'incidents' OR metrics->>'academicSource' IS DISTINCT FROM 'ordinarias_registradas' THEN RAISE EXCEPTION 'Agregación o privacidad incorrectas.'; END IF;
 metrics:=public.jaguar360_panel_departamento(pref);
 IF (metrics->>'incidentCount')::integer IS DISTINCT FROM 1 OR metrics->>'average' IS NOT NULL THEN RAISE EXCEPTION 'Incidencias de otro ciclo o notas expuestas a Prefectura.'; END IF;
 denied:=false; BEGIN PERFORM public.jaguar360_panel_departamento(learner); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Actor alumno obtuvo panel departamental.'; END IF;
END $$;
ROLLBACK;
