-- V44. Revisión diferencial por grupo. No transforma datos al instalar.
BEGIN;
CREATE OR REPLACE FUNCTION public.jaguar44_celda(p_gm bigint,p_pid bigint,p_alumno bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.calificaciones%ROWTYPE; m public.jaguar360_modos_materia%ROWTYPE; pol public.jaguar_precision_calificaciones%ROWTYPE; cyc text; mid bigint; val text; fuente numeric; protected boolean; native boolean; cnt bigint;
BEGIN
 SELECT p.ciclo_escolar,gm.materia_id INTO cyc,mid FROM public.periodos_escolares p CROSS JOIN public.grupo_materias gm WHERE p.id=p_pid AND gm.id=p_gm;
 SELECT * INTO m FROM public.jaguar360_modos_materia WHERE ciclo=cyc AND materia_id=mid;
 SELECT * INTO pol FROM public.jaguar_precision_calificaciones WHERE ciclo_escolar=cyc;
 SELECT count(*) INTO cnt FROM public.calificaciones WHERE grupo_materia_id=p_gm AND periodo_id=p_pid AND alumno_id=p_alumno;
 IF cnt>1 THEN RAISE EXCEPTION 'Calificaciones duplicadas; concilia primero.'; END IF;
 SELECT * INTO c FROM public.calificaciones WHERE grupo_materia_id=p_gm AND periodo_id=p_pid AND alumno_id=p_alumno;
 IF c.calificacion IS NOT NULL THEN
   fuente:=coalesce(c.calificacion_original_politica,public.jaguar_fuente_cierre_verificada(to_jsonb(c)->'detalle_evaluacion',c.calificacion::numeric,c.observaciones),c.calificacion::numeric);
   val:=CASE WHEN m.modo='cualitativa' THEN CASE WHEN fuente>=m.min_ap THEN 'AP' ELSE 'RP' END ELSE trim_scale(c.calificacion::numeric)::text END;
 END IF;
 SELECT EXISTS(SELECT 1 FROM public.jaguar360_planes_ciclo t CROSS JOIN LATERAL jsonb_array_elements(coalesce(t.plan->'curriculum','[]'::jsonb)) r WHERE t.ciclo=cyc AND t.estado='validada_para_planificacion' AND r->>'legacyId'=mid::text AND r->>'evaluation'<>'numerica') INTO native;
 protected:=native OR NOT EXISTS(SELECT 1 FROM public.grupo_materias WHERE id=p_gm AND activo IS TRUE) OR (c.id IS NOT NULL AND (c.detalle_evaluacion IS NOT NULL OR c.calificacion_calculada IS NOT NULL OR c.rubrica_id IS NOT NULL OR c.cierre_evaluacion_id IS NOT NULL OR (c.calificacion IS NOT NULL AND EXISTS(SELECT 1 FROM public.bitacora_excel_diaria WHERE grupo_materia_id=p_gm AND periodo_id=p_pid AND estado='vigente')) OR (c.docente_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.asignaciones_docentes WHERE grupo_materia_id=p_gm AND ciclo_escolar=cyc AND activo IS TRUE AND docente_id=c.docente_id)))) OR EXISTS(SELECT 1 FROM public.rubricas_evaluacion WHERE grupo_materia_id=p_gm AND periodo_id=p_pid AND estado='cerrada');
 RETURN jsonb_build_object('valor',val,'fuente',fuente,'modo',coalesce(m.modo,'numerica'),'min_ap',m.min_ap,'decimales',coalesce(pol.permite_decimales,false),'minima',coalesce(pol.minima_aprobatoria,6),'reprobatorias_inferiores',coalesce(pol.permitir_reprobatorias_inferiores,true),'protegida',protected,'pendiente',EXISTS(SELECT 1 FROM public.jaguar_cargas_materias r JOIN public.jaguar_cargas_grupo b ON b.id=r.carga_id WHERE b.periodo_id=p_pid AND r.grupo_materia_id=p_gm AND r.estado='pendiente' AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.notas_originales) x WHERE x->>'alumno_id'=p_alumno::text)), 'huella',md5(jsonb_build_array(to_jsonb(c),to_jsonb(m),to_jsonb(pol),protected)::text));
END $$;
CREATE OR REPLACE FUNCTION public.jaguar44_ventana(p_grupo bigint,p_pid bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.grupos WHERE id=p_grupo AND activo IS TRUE)
 AND EXISTS(SELECT 1 FROM public.periodos_escolares p WHERE p.id=p_pid AND p.activo IS TRUE AND public.jaguar_evaluacion_abierta(p.id) AND NOT EXISTS(SELECT 1 FROM public.jaguar360_cierres_periodo s WHERE s.periodo_id=p.id)
 AND p.ciclo_escolar IN (SELECT ciclo_escolar FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE))
 AND (SELECT count(*) FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE)=1
 AND NOT EXISTS(SELECT 1 FROM public.jaguar360_grupos_ciclo gc JOIN public.periodos_escolares p ON p.id=p_pid WHERE gc.grupo_id=p_grupo AND gc.ciclo<>p.ciclo_escolar)
$$;
CREATE OR REPLACE FUNCTION public.jaguar44_matriz(p_actor uuid,p_grupo bigint,p_pid bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; cyc text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('control_escolar','control','direccion_escolar')) THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 SELECT ciclo_escolar INTO cyc FROM public.periodos_escolares WHERE id=p_pid;
 IF cyc IS NULL OR NOT EXISTS(SELECT 1 FROM public.grupos WHERE id=p_grupo AND activo IS TRUE) THEN RAISE EXCEPTION 'Grupo o periodo inválido.'; END IF;
 IF (SELECT count(*) FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE)<>1 OR NOT EXISTS(SELECT 1 FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE AND ciclo_escolar=cyc) OR EXISTS(SELECT 1 FROM public.jaguar360_grupos_ciclo WHERE grupo_id=p_grupo AND ciclo<>cyc) THEN RAISE EXCEPTION 'Selecciona un periodo del ciclo vigente; el padrón histórico se consulta por separado.'; END IF;
 IF (SELECT count(*) FROM public.alumnos WHERE grupo_id=p_grupo AND activo IS TRUE)>500 OR (SELECT count(*) FROM public.grupo_materias WHERE grupo_id=p_grupo)>30 THEN RAISE EXCEPTION 'Grupo excede el tamaño de carga admitido.'; END IF;
 SELECT jsonb_build_object('abierta',public.jaguar44_ventana(p_grupo,p_pid),'ciclo',cyc,
 'estudiantes',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id::text,'matricula',a.matricula,'nombre',a.nombre_completo) ORDER BY a.nombre_completo,a.id) FROM public.alumnos a WHERE a.grupo_id=p_grupo AND a.activo IS TRUE),'[]'::jsonb),
 'materias',coalesce((SELECT jsonb_agg(jsonb_build_object('id',gm.id::text,'nombre',m.nombre,'docente', (SELECT count(DISTINCT ad.docente_id)=1 AND bool_and(d.activo IS TRUE) FROM public.asignaciones_docentes ad JOIN public.docentes d ON d.id=ad.docente_id WHERE ad.grupo_materia_id=gm.id AND ad.ciclo_escolar=cyc AND ad.activo IS TRUE)) ORDER BY m.nombre,gm.id) FROM public.grupo_materias gm JOIN public.materias m ON m.id=gm.materia_id WHERE gm.grupo_id=p_grupo),'[]'::jsonb),
 'celdas',coalesce((SELECT jsonb_agg(public.jaguar44_celda(gm.id,p_pid,a.id)||jsonb_build_object('alumno_id',a.id::text,'grupo_materia_id',gm.id::text)) FROM public.alumnos a CROSS JOIN public.grupo_materias gm WHERE a.grupo_id=p_grupo AND a.activo IS TRUE AND gm.grupo_id=p_grupo),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.jaguar44_nota(p_input text,p_celda jsonb) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE s text:=upper(btrim(p_input)); n numeric; expected text;
BEGIN
 IF s IS NULL OR s !~ '^(?:(AP|RP):)?([0-9]|10)(\.[0-9]{1,6})?$' THEN RAISE EXCEPTION 'Ingresa una nota de 0 a 10 o AP:nota/RP:nota con fuente real (hasta seis decimales).'; END IF;
 n:=regexp_replace(s,'^(AP|RP):','')::numeric;
 IF n NOT BETWEEN 0 AND 10 THEN RAISE EXCEPTION 'Nota fuera de rango.'; END IF;
 IF position(':' in s)>0 THEN
  IF p_celda->>'modo'<>'cualitativa' THEN RAISE EXCEPTION 'AP/RP no corresponde a la materia.'; END IF;
  expected:=CASE WHEN n >= (p_celda->>'min_ap')::numeric THEN 'AP' ELSE 'RP' END;
  IF split_part(s,':',1)<>expected THEN RAISE EXCEPTION 'La fuente no corresponde al resultado AP/RP.'; END IF;
 END IF;
 RETURN n;
END $$;
-- Bloqueos cortos y NOWAIT: evitan carreras contra escritura, sellado y cambio de política.
CREATE OR REPLACE FUNCTION public.jaguar44_lock() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 LOCK TABLE public.calificaciones,public.jaguar_cargas_grupo,public.jaguar_cargas_materias IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 LOCK TABLE public.perfiles,public.docentes,public.alumnos,public.grupos,public.grupo_materias,public.periodos_escolares,public.asignaciones_docentes,public.jaguar_evaluacion_ventanas,public.jaguar360_cierres_periodo,public.jaguar360_modos_materia,public.jaguar_precision_calificaciones,public.jaguar360_planes_ciclo,public.jaguar360_grupos_ciclo,public.rubricas_evaluacion,public.bitacora_excel_diaria IN SHARE MODE NOWAIT;
END $$;
CREATE OR REPLACE FUNCTION public.jaguar_crear_carga_grupo(p_actor uuid,p_operacion uuid,p_grupo_id bigint,p_periodo_id bigint,p_materias jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.perfiles%ROWTYPE; cyc text; subj jsonb; x jsonb; gmid bigint; st bigint; td bigint; bid bigint; cell jsonb; n numeric; newrows jsonb; reason text; showval text; existing public.calificaciones%ROWTYPE;
BEGIN
 PERFORM public.jaguar44_lock();
 SELECT * INTO a FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol IN ('control_escolar','control','direccion_escolar');
 IF NOT FOUND THEN RAISE EXCEPTION 'Sin atribución.' USING ERRCODE='42501'; END IF;
 IF nullif(a.firma_path,'') IS NULL OR nullif(a.firma_sha256,'') IS NULL THEN RAISE EXCEPTION 'Registra tu firma institucional.'; END IF;
 IF NOT public.jaguar44_ventana(p_grupo_id,p_periodo_id) THEN RAISE EXCEPTION 'Captura no habilitada, ciclo no vigente o periodo sellado.'; END IF;
 SELECT ciclo_escolar INTO cyc FROM public.periodos_escolares WHERE id=p_periodo_id;
 IF jsonb_typeof(p_materias) IS DISTINCT FROM 'array' OR jsonb_array_length(p_materias) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Lote vacío o inválido.'; END IF;
 IF (SELECT count(DISTINCT r->>'grupo_materia_id') FROM jsonb_array_elements(p_materias) r)<>jsonb_array_length(p_materias) THEN RAISE EXCEPTION 'Materias repetidas.'; END IF;
 INSERT INTO public.jaguar_cargas_grupo(operacion_id,grupo_id,periodo_id,actor_id,actor_nombre,actor_rol,firma_departamento_path,firma_departamento_sha256) VALUES(p_operacion,p_grupo_id,p_periodo_id,p_actor,a.nombre_completo,a.rol,a.firma_path,a.firma_sha256) RETURNING id INTO bid;
 FOR subj IN SELECT value FROM jsonb_array_elements(p_materias) LOOP
  IF coalesce(subj->>'grupo_materia_id','') !~ '^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION 'Identificador de materia inválido.'; END IF;
  gmid:=(subj->>'grupo_materia_id')::bigint;
  IF NOT EXISTS(SELECT 1 FROM public.grupo_materias WHERE id=gmid AND grupo_id=p_grupo_id) THEN RAISE EXCEPTION 'Materia ajena al grupo.'; END IF;
  SELECT min(docente_id) INTO td FROM public.asignaciones_docentes WHERE grupo_materia_id=gmid AND ciclo_escolar=cyc AND activo IS TRUE HAVING count(DISTINCT docente_id)=1;
  IF td IS NULL OR NOT EXISTS(SELECT 1 FROM public.docentes WHERE id=td AND activo IS TRUE) THEN RAISE EXCEPTION 'Materia % sin docente único.',gmid; END IF;
  IF jsonb_typeof(subj->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(subj->'rows') NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Filas inválidas.'; END IF;
  IF (SELECT count(DISTINCT r->>'alumno_id') FROM jsonb_array_elements(subj->'rows') r)<>jsonb_array_length(subj->'rows') THEN RAISE EXCEPTION 'Alumnos repetidos.'; END IF;
  newrows:='[]'::jsonb;
  FOR x IN SELECT value FROM jsonb_array_elements(subj->'rows') LOOP
   IF coalesce(x->>'alumno_id','') !~ '^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION 'Identificador de alumno inválido.'; END IF;
   st:=(x->>'alumno_id')::bigint;
   IF NOT EXISTS(SELECT 1 FROM public.alumnos WHERE id=st AND grupo_id=p_grupo_id AND activo IS TRUE) THEN RAISE EXCEPTION 'Alumno ajeno al padrón.'; END IF;
   cell:=public.jaguar44_celda(gmid,p_periodo_id,st);
   IF x->>'huella' IS DISTINCT FROM cell->>'huella' THEN RAISE EXCEPTION 'Cambió una nota o política. Vuelve a cargar la matriz.'; END IF;
   IF (cell->>'protegida')::boolean OR (cell->>'pendiente')::boolean THEN RAISE EXCEPTION 'Nota protegida o con oficio pendiente.'; END IF;
   n:=public.jaguar44_nota(x->>'calificacion',cell);
   showval:=CASE WHEN cell->>'modo'='cualitativa' THEN CASE WHEN n >= (cell->>'min_ap')::numeric THEN 'AP' ELSE 'RP' END ELSE trim_scale(public.jaguar_nota_segun_criterio(n,(cell->>'decimales')::boolean,(cell->>'minima')::integer,(cell->>'reprobatorias_inferiores')::boolean))::text END;
   IF cell->>'valor' IS NOT NULL AND n IS NOT DISTINCT FROM (cell->>'fuente')::numeric THEN RAISE EXCEPTION 'El lote incluye una nota sin cambio.'; END IF;
   reason:=btrim(coalesce(x->>'motivo',''));
   IF cell->>'valor' IS NOT NULL AND length(reason)<12 THEN RAISE EXCEPTION 'Justifica los cambios de notas existentes (12 caracteres).'; END IF;
   IF length(reason)>1500 THEN RAISE EXCEPTION 'Motivo demasiado largo.'; END IF;
   SELECT * INTO existing FROM public.calificaciones WHERE alumno_id=st AND grupo_materia_id=gmid AND periodo_id=p_periodo_id;
   newrows:=newrows||jsonb_build_array(jsonb_build_object('alumno_id',st::text,'calificacion',n,'visible',showval,'modo',cell->>'modo','min_ap',cell->'min_ap','huella',cell->>'huella','anterior',cell->'valor','registro_anterior',to_jsonb(existing),'motivo',reason));
  END LOOP;
  INSERT INTO public.jaguar_cargas_materias(carga_id,grupo_materia_id,docente_id,notas_originales) VALUES(bid,gmid,td,newrows);
 END LOOP;
 RETURN bid;
END $$;
CREATE OR REPLACE FUNCTION public.jaguar_aceptar_carga_materia(p_actor uuid,p_revision_id bigint,p_notas jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.perfiles%ROWTYPE; r public.jaguar_cargas_materias%ROWTYPE; b public.jaguar_cargas_grupo%ROWTYPE; x jsonb; oldrow jsonb; c public.calificaciones%ROWTYPE; cell jsonb; st bigint; n numeric; why text; finalrows jsonb:='[]'; cyc text; currentteacher bigint;
BEGIN
 PERFORM public.jaguar44_lock();
 SELECT * INTO a FROM public.perfiles WHERE id=p_actor AND activo IS TRUE AND rol='docente';
 IF NOT FOUND OR nullif(a.firma_path,'') IS NULL OR nullif(a.firma_sha256,'') IS NULL THEN RAISE EXCEPTION 'Docente activo con firma requerida.' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.jaguar_cargas_materias WHERE id=p_revision_id AND estado='pendiente';
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.docentes WHERE id=r.docente_id AND auth_user_id=p_actor AND activo IS TRUE) THEN RAISE EXCEPTION 'Oficio no disponible para este docente.' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM public.jaguar_cargas_grupo WHERE id=r.carga_id;
 IF NOT public.jaguar44_ventana(b.grupo_id,b.periodo_id) THEN RAISE EXCEPTION 'Captura no habilitada o periodo sellado.'; END IF;
 SELECT ciclo_escolar INTO cyc FROM public.periodos_escolares WHERE id=b.periodo_id;
 SELECT min(docente_id) INTO currentteacher FROM public.asignaciones_docentes WHERE grupo_materia_id=r.grupo_materia_id AND ciclo_escolar=cyc AND activo IS TRUE HAVING count(DISTINCT docente_id)=1;
 IF currentteacher IS DISTINCT FROM r.docente_id OR NOT EXISTS(SELECT 1 FROM public.grupo_materias WHERE id=r.grupo_materia_id AND grupo_id=b.grupo_id) THEN RAISE EXCEPTION 'Cambió la asignación docente o materia.'; END IF;
 IF jsonb_typeof(p_notas) IS DISTINCT FROM 'array' OR jsonb_array_length(p_notas)<>jsonb_array_length(r.notas_originales) OR (SELECT count(DISTINCT z->>'alumno_id') FROM jsonb_array_elements(p_notas) z)<>jsonb_array_length(p_notas) THEN RAISE EXCEPTION 'La revisión debe conservar cada alumno una sola vez.'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_notas) LOOP
  IF coalesce(x->>'alumno_id','') !~ '^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION 'Identificador de alumno inválido.'; END IF;
   st:=(x->>'alumno_id')::bigint;
  SELECT value INTO oldrow FROM jsonb_array_elements(r.notas_originales) WHERE value->>'alumno_id'=st::text;
  IF oldrow IS NULL OR NOT EXISTS(SELECT 1 FROM public.alumnos WHERE id=st AND grupo_id=b.grupo_id AND activo IS TRUE) THEN RAISE EXCEPTION 'Alumno no conciliado.'; END IF;
  cell:=public.jaguar44_celda(r.grupo_materia_id,b.periodo_id,st);
  IF (cell->>'protegida')::boolean THEN RAISE EXCEPTION 'Nota protegida por evidencia docente.'; END IF;
  IF oldrow ? 'huella' THEN
   IF oldrow->>'huella' IS DISTINCT FROM cell->>'huella' THEN RAISE EXCEPTION 'Cambió una nota o política desde la emisión; no se sobrescribió.'; END IF;
  ELSIF cell->>'valor' IS NOT NULL OR cell->>'modo'<>'numerica' THEN RAISE EXCEPTION 'Oficio anterior incompatible con nota o modo actual.'; END IF;
  n:=public.jaguar44_nota(x->>'calificacion',cell); why:=btrim(coalesce(x->>'motivo',''));
  IF n IS DISTINCT FROM (oldrow->>'calificacion')::numeric AND length(why)<12 THEN RAISE EXCEPTION 'Justifica el cambio docente (12 caracteres).'; END IF;
  IF length(why)>1500 THEN RAISE EXCEPTION 'Motivo demasiado largo.'; END IF;
  SELECT * INTO c FROM public.calificaciones WHERE alumno_id=st AND grupo_materia_id=r.grupo_materia_id AND periodo_id=b.periodo_id;
  IF c.id IS NOT NULL THEN
   IF c.calificacion IS NOT NULL AND NOT(oldrow ? 'huella') THEN RAISE EXCEPTION 'Ya hay nota oficial.'; END IF;
   UPDATE public.calificaciones SET calificacion=n,calificacion_original_politica=n WHERE id=c.id RETURNING * INTO c;
  ELSE
   INSERT INTO public.calificaciones(alumno_id,grupo_materia_id,periodo_id,docente_id,calificacion,calificacion_original_politica,observaciones) VALUES(st,r.grupo_materia_id,b.periodo_id,r.docente_id,n,n,nullif(why,'')) RETURNING * INTO c;
  END IF;
  finalrows:=finalrows||jsonb_build_array(jsonb_build_object('alumno_id',st::text,'original',oldrow->'calificacion','calificacion',c.calificacion,'fuente',n,'visible',CASE WHEN cell->>'modo'='cualitativa' THEN CASE WHEN n >= (cell->>'min_ap')::numeric THEN 'AP' ELSE 'RP' END ELSE trim_scale(c.calificacion::numeric)::text END,'motivo',why));
 END LOOP;
 UPDATE public.jaguar_cargas_materias SET estado='aceptada',notas_finales=finalrows,firmado_por=p_actor,firma_docente_path=a.firma_path,firma_docente_sha256=a.firma_sha256,firmado_at=now() WHERE id=r.id;
 IF NOT EXISTS(SELECT 1 FROM public.jaguar_cargas_materias WHERE carga_id=b.id AND estado<>'aceptada') THEN UPDATE public.jaguar_cargas_grupo SET estado='completa' WHERE id=b.id; END IF;
 RETURN jsonb_build_object('materia_id',r.grupo_materia_id,'aceptadas',jsonb_array_length(finalrows),'revision_id',r.id);
END $$;
REVOKE ALL ON FUNCTION public.jaguar44_celda(bigint,bigint,bigint),public.jaguar44_ventana(bigint,bigint),public.jaguar44_nota(text,jsonb),public.jaguar44_lock(),public.jaguar44_matriz(uuid,bigint,bigint),public.jaguar_crear_carga_grupo(uuid,uuid,bigint,bigint,jsonb),public.jaguar_aceptar_carga_materia(uuid,bigint,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar44_matriz(uuid,bigint,bigint),public.jaguar_crear_carga_grupo(uuid,uuid,bigint,bigint,jsonb),public.jaguar_aceptar_carga_materia(uuid,bigint,jsonb) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
