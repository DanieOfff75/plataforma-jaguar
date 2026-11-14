-- NO EJECUTAR EN PRODUCCIÓN. Requiere V1–V9 y fixtures FICTICIOS de base aislada.
-- Elegir un periodo de un ciclo de prueba con plan y conciliación completa.
-- Si no existe una evidencia completa, falla deliberadamente: no reportar éxito por omisión.
BEGIN;
DO $$
DECLARE director uuid; ce uuid; pid bigint; preview jsonb; after_seal jsonb; target record; result jsonb; rid bigint; denied boolean; snapshot jsonb;
BEGIN
 SELECT id INTO director FROM public.perfiles WHERE activo IS TRUE AND rol='direccion_escolar' LIMIT 1;
 SELECT id INTO ce FROM public.perfiles WHERE activo IS TRUE AND rol IN ('control_escolar','control') LIMIT 1;
 IF director IS NULL OR ce IS NULL THEN RAISE EXCEPTION 'Faltan actores ficticios.'; END IF;
 FOR target IN SELECT id FROM public.periodos_escolares ORDER BY id LOOP
  preview:=public.jaguar360_cierre_periodo(director,target.id);
  IF (preview->>'ready')::boolean THEN pid:=target.id; EXIT; END IF;
 END LOOP;
 IF pid IS NULL THEN RAISE EXCEPTION 'Falta fixture completo de cierre. No se ejecutaron los casos positivos.'; END IF;
 denied:=false;
 BEGIN PERFORM public.jaguar360_cierre_periodo(ce,pid,(preview->>'planVersion')::int,preview->>'fingerprint','Intento de cierre por actor no autorizado'); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Permiso insuficiente no bloqueado'; END IF;
 denied:=false;
 BEGIN PERFORM public.jaguar360_cierre_periodo(director,pid,(preview->>'planVersion')::int,repeat('0',32),'Intento de sello con huella obsoleta'); EXCEPTION WHEN raise_exception THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Huella no válida aceptada'; END IF;
 after_seal:=public.jaguar360_cierre_periodo(director,pid,(preview->>'planVersion')::int,preview->>'fingerprint','Sello de prueba sobre evidencia ficticia');
 IF after_seal->>'sealed'<>'true' THEN RAISE EXCEPTION 'Sello no persistido'; END IF;
 SELECT evidencia INTO snapshot FROM public.jaguar360_cierres_periodo WHERE periodo_id=pid;
 SELECT n.alumno_id,n.grupo_materia_id,n.calificacion INTO target FROM jsonb_to_recordset(snapshot->'notas') n(alumno_id bigint,grupo_materia_id bigint,evaluacion text,calificacion numeric) WHERE n.evaluacion='numerica' LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Fixture sin nota numérica.'; END IF;
 denied:=false;
 BEGIN UPDATE public.calificaciones SET calificacion=calificacion WHERE periodo_id=pid AND alumno_id=target.alumno_id AND grupo_materia_id=target.grupo_materia_id; EXCEPTION WHEN check_violation THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Escritura ordinaria no bloqueada'; END IF;
 result:=public.jaguar360_rectificar_sello(ce,pid,target.alumno_id,target.grupo_materia_id,'proponer',CASE WHEN target.calificacion=6.75 THEN 4.25 ELSE 6.75 END,NULL,NULL,'Solicitud de rectificación ficticia','Acta de prueba');
 rid:=(result->'history'->0->>'id')::bigint;
 IF rid IS NULL OR result->'effectiveId'<>'null'::jsonb THEN RAISE EXCEPTION 'Propuesta no persistida o aplicada prematuramente'; END IF;
 result:=public.jaguar360_rectificar_sello(director,pid,target.alumno_id,target.grupo_materia_id,'autorizar',NULL,NULL,rid,'Motivo de autorización ficticia',NULL);
 IF result->>'effectiveId' IS DISTINCT FROM rid::text THEN RAISE EXCEPTION 'Rectificación no autorizada'; END IF;
 IF (SELECT evidencia FROM public.jaguar360_cierres_periodo WHERE periodo_id=pid) IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'Sello original alterado'; END IF;
 IF (SELECT calificacion FROM public.calificaciones WHERE periodo_id=pid AND alumno_id=target.alumno_id AND grupo_materia_id=target.grupo_materia_id) IS DISTINCT FROM target.calificacion THEN RAISE EXCEPTION 'Nota legada alterada'; END IF;
END $$;
ROLLBACK;
