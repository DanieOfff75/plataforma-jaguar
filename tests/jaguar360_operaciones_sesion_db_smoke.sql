-- SOLO copia aislada de PostgreSQL/Supabase, con las migraciones V1,V2,V3,V6,V7,V8 del mismo ZIP.
-- Requiere perfiles activos de prueba (Dirección, CA, CE, Prefectura y docente), un plan validado,
-- y una sesión del ciclo actual, con padrón/sesiones revisados y docente asignado.
-- Las operaciones se revierten. No ejecutar con datos de producción.
BEGIN;
DO $$
DECLARE ca uuid; ce uuid; pf uuid; docente uuid; p_id bigint; gm bigint; f date; v_start time; ctx jsonb; marks jsonb; n bigint; denied boolean; v integer; al bigint;
BEGIN
 SELECT id INTO ca FROM public.perfiles WHERE activo IS TRUE AND rol='coordinacion_academica' LIMIT 1;
 SELECT id INTO ce FROM public.perfiles WHERE activo IS TRUE AND rol IN ('control_escolar','control') LIMIT 1;
 SELECT id INTO pf FROM public.perfiles WHERE activo IS TRUE AND rol='prefectura' LIMIT 1;
 IF ca IS NULL OR ce IS NULL OR pf IS NULL THEN RAISE EXCEPTION 'Faltan perfiles ficticios de prueba.'; END IF;
 IF has_table_privilege('authenticated','public.jaguar360_listas_sesion','SELECT') OR has_table_privilege('anon','public.jaguar360_listas_sesion','SELECT') OR has_table_privilege('authenticated','public.jaguar360_convocatorias','SELECT') THEN RAISE EXCEPTION 'ACL excesiva.'; END IF;
 IF has_function_privilege('authenticated','public.jaguar360_contexto_sesion(uuid,bigint,bigint,date,time)','EXECUTE') OR has_function_privilege('anon','public.jaguar360_fuentes_acreditacion(uuid,text,bigint)','EXECUTE') THEN RAISE EXCEPTION 'RPC expuesto.'; END IF;
 SELECT e.periodo_id,h.grupo_materia_id,h.fecha,h.inicio,p.id INTO p_id,gm,f,v_start,docente
 FROM public.jaguar360_evidencias_periodo e
 JOIN public.periodos_escolares pe ON pe.id=e.periodo_id
 CROSS JOIN LATERAL jsonb_to_recordset(e.contenido->'rows') AS h(grupo_materia_id bigint,fecha date,inicio time,estado text)
 JOIN public.asignaciones_docentes ad ON ad.grupo_materia_id=h.grupo_materia_id AND ad.ciclo_escolar=pe.ciclo_escolar AND ad.activo IS TRUE
 JOIN public.docentes d ON d.id=ad.docente_id AND d.activo IS TRUE JOIN public.perfiles p ON p.id=d.auth_user_id AND p.activo IS TRUE AND p.rol='docente'
 WHERE e.tipo='sesiones' AND e.estado='revisada' AND e.version=(SELECT max(x.version) FROM public.jaguar360_evidencias_periodo x WHERE x.periodo_id=e.periodo_id AND x.tipo=e.tipo)
 AND h.estado IN ('programada','impartida') AND h.fecha<(now() AT TIME ZONE 'America/Mexico_City')::date
 AND EXISTS(SELECT 1 FROM public.periodos_escolares z WHERE z.es_periodo_actual IS TRUE AND z.ciclo_escolar=pe.ciclo_escolar)
 AND EXISTS(SELECT 1 FROM public.jaguar360_evidencias_periodo x WHERE x.periodo_id=e.periodo_id AND x.tipo='padron' AND x.estado='revisada' AND x.version=(SELECT max(y.version) FROM public.jaguar360_evidencias_periodo y WHERE y.periodo_id=x.periodo_id AND y.tipo=x.tipo))
 AND NOT EXISTS(SELECT 1 FROM public.jaguar360_listas_sesion l WHERE l.periodo_id=e.periodo_id AND l.grupo_materia_id=h.grupo_materia_id AND l.fecha=h.fecha AND l.inicio=h.inicio)
 AND NOT EXISTS(SELECT 1 FROM public.asistencias a WHERE a.grupo_materia_id=h.grupo_materia_id AND a.fecha=h.fecha)
 LIMIT 1;
 IF p_id IS NULL THEN RAISE EXCEPTION 'Falta sesión ficticia sin registro legado ni lista previa.'; END IF;
 ctx:=public.jaguar360_contexto_sesion(docente,p_id,gm,f,v_start);
 IF ctx->>'canWrite' IS DISTINCT FROM 'true' OR ctx->>'version' IS DISTINCT FROM '0' THEN RAISE EXCEPTION 'Fixture sin autorización de captura.'; END IF;
 SELECT jsonb_agg(jsonb_build_object('student',x->>'student','state','falta')) INTO marks FROM jsonb_array_elements(ctx->'rows') x;
 SELECT (ctx->'rows'->0->>'student')::bigint INTO al;
 n:=(SELECT count(*) FROM public.jaguar360_listas_sesion);
 denied:=false; BEGIN PERFORM public.jaguar360_registrar_sesion(pf,p_id,gm,f,v_start,'save',0,(ctx->>'rosterVersion')::integer,(ctx->>'scheduleVersion')::integer,marks,NULL,'Prueba ficticia de acceso indebido'); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Prefectura pudo reemplazar una lista.'; END IF;
 denied:=false; BEGIN PERFORM public.jaguar360_registrar_sesion(docente,p_id,gm,f,v_start,'save',0,(ctx->>'rosterVersion')::integer,(ctx->>'scheduleVersion')::integer,'[]'::jsonb,NULL,'Prueba ficticia de lista incompleta'); EXCEPTION WHEN raise_exception THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Lista incompleta admitida.'; END IF;
 PERFORM public.jaguar360_registrar_sesion(docente,p_id,gm,f,v_start,'save',0,(ctx->>'rosterVersion')::integer,(ctx->>'scheduleVersion')::integer,marks,NULL,'Captura ficticia de la lista completa');
 ctx:=public.jaguar360_contexto_sesion(docente,p_id,gm,f,v_start);
 IF ctx->>'version' IS DISTINCT FROM '1' OR ctx->>'sessionState' IS DISTINCT FROM 'impartida' THEN RAISE EXCEPTION 'Lista completa no confirmó sesión.'; END IF;
 denied:=false; BEGIN PERFORM public.jaguar360_registrar_sesion(docente,p_id,gm,f,v_start,'save',0,(ctx->>'rosterVersion')::integer,(ctx->>'scheduleVersion')::integer,marks,NULL,'Prueba ficticia de versión antigua'); EXCEPTION WHEN raise_exception THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Versión obsoleta admitida.'; END IF;
 PERFORM public.jaguar360_registrar_sesion(pf,p_id,gm,f,v_start,'justify',1,(ctx->>'rosterVersion')::integer,(ctx->>'scheduleVersion')::integer,NULL,al,'Justificante ficticio de prueba aislada');
 ctx:=public.jaguar360_contexto_sesion(pf,p_id,gm,f,v_start);
 IF ctx->>'version' IS DISTINCT FROM '2' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(ctx->'rows') x WHERE x->>'student'=al::text AND x->>'state'='justificada') THEN RAISE EXCEPTION 'No se conservó justificante.'; END IF;
 IF (SELECT count(*) FROM public.jaguar360_listas_sesion)<>n+2 THEN RAISE EXCEPTION 'Historial o reintento incorrecto.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.jaguar360_listas_sesion l CROSS JOIN LATERAL jsonb_array_elements(l.marcas) x WHERE l.periodo_id=p_id AND l.grupo_materia_id=gm AND l.fecha=f AND l.inicio=v_start AND l.version=1 AND x->>'student'=al::text AND x->>'state'='falta') THEN RAISE EXCEPTION 'Se perdió la falta histórica.'; END IF;
END $$;
ROLLBACK;
-- Agregar fixtures programadas dobles el mismo día, conflictos con legado,
-- cierre, concurrencia entre transacciones y convocatorias válidas/obsoletas antes de desplegar.
