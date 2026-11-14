BEGIN;
-- Read-only coherent snapshot: original sealed values and current rectification IDs, without changing trajectory fingerprints.
CREATE OR REPLACE FUNCTION public.jaguar360_informe_trayectoria(p_actor uuid,p_ciclo text,p_alumno bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx jsonb; original jsonb;
BEGIN
 ctx:=public.jaguar360_contexto_trayectoria(p_actor,p_ciclo,p_alumno);
 SELECT coalesce(jsonb_agg(jsonb_build_object('period',pe.numero_periodo,'groupMaterialId',n.grupo_materia_id::text,'source',n.fuente_original,'grade',n.calificacion,'result',n.resultado,'rectification',r.id::text) ORDER BY pe.numero_periodo,n.grupo_materia_id),'[]'::jsonb) INTO original
 FROM public.jaguar360_cierres_periodo seal JOIN public.periodos_escolares pe ON pe.id=seal.periodo_id
 CROSS JOIN LATERAL jsonb_to_recordset(seal.evidencia->'notas') AS n(alumno_id bigint,grupo_materia_id bigint,fuente_original numeric,calificacion numeric,resultado text)
 LEFT JOIN LATERAL (SELECT x.id FROM public.jaguar360_rectificaciones x JOIN public.jaguar360_rectificacion_resoluciones d ON d.rectificacion_id=x.id AND d.estado='autorizada' WHERE x.periodo_id=pe.id AND x.alumno_id=n.alumno_id AND x.grupo_materia_id=n.grupo_materia_id ORDER BY x.id DESC LIMIT 1) r ON true
 WHERE seal.ciclo=p_ciclo AND n.alumno_id=p_alumno;
 RETURN jsonb_build_object('context',ctx,'sealed',original);
END $$;
REVOKE ALL ON FUNCTION public.jaguar360_informe_trayectoria(uuid,text,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.jaguar360_informe_trayectoria(uuid,text,bigint) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
