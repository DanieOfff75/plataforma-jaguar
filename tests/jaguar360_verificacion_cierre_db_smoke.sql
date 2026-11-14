-- SOLO copia aislada de base de datos después de V1,V2,V3 actualizado y V6.
-- No certifica un cierre ni modifica expedientes. Requiere perfiles reales de prueba.
BEGIN;
DO $$
DECLARE director uuid; ce uuid; pid bigint; v jsonb; n bigint; denied boolean:=false;
BEGIN
 SELECT id INTO director FROM public.perfiles WHERE activo IS TRUE AND rol='direccion_escolar' LIMIT 1;
 SELECT id INTO ce FROM public.perfiles WHERE activo IS TRUE AND rol IN ('control','control_escolar') LIMIT 1;
 SELECT id INTO pid FROM public.periodos_escolares ORDER BY id DESC LIMIT 1;
 IF director IS NULL OR ce IS NULL OR pid IS NULL THEN RAISE EXCEPTION 'Faltan fixtures de prueba'; END IF;
 v:=public.jaguar360_verificar_cierre(director,pid);
 IF v->>'cierre_definitivo' IS DISTINCT FROM 'false' OR v->>'huella' IS NULL OR v ? 'notas' OR v ? 'asistencias' THEN RAISE EXCEPTION 'Contrato de privacidad o estado incorrecto: %',v; END IF;
 BEGIN
  PERFORM public.jaguar360_verificar_cierre(ce,pid,v->>'huella','Prueba de permiso insuficiente');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Control pudo registrar una verificación'; END IF;
 SELECT count(*) INTO n FROM public.jaguar360_verificaciones_cierre WHERE periodo_id=pid;
 BEGIN
  PERFORM public.jaguar360_verificar_cierre(director,pid,CASE WHEN v->>'huella'=repeat('0',32) THEN repeat('1',32) ELSE repeat('0',32) END,'Prueba de huella desactualizada');
  RAISE EXCEPTION 'La huella desactualizada no fue rechazada' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL;
 END;
 IF (SELECT count(*) FROM public.jaguar360_verificaciones_cierre WHERE periodo_id=pid)<>n THEN RAISE EXCEPTION 'Una verificación rechazada dejó escritura'; END IF;
 IF (v->>'verificacion_posible')::boolean THEN
  v:=public.jaguar360_verificar_cierre(director,pid,v->>'huella','Prueba aislada de verificación completa');
  IF v->>'verificacion_vigente' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'No se conservó instantánea'; END IF;
  PERFORM public.jaguar360_verificar_cierre(director,pid,v->>'huella','Prueba de reintento idempotente');
  IF (SELECT count(*) FROM public.jaguar360_verificaciones_cierre WHERE periodo_id=pid)>n+1 THEN RAISE EXCEPTION 'Reintento duplicado'; END IF;
 ELSE
  BEGIN
   PERFORM public.jaguar360_verificar_cierre(director,pid,v->>'huella','Prueba de verificación incompleta');
   RAISE EXCEPTION 'Se aceptó una verificación incompleta' USING ERRCODE='XX000';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
 END IF;
END $$;
ROLLBACK;
