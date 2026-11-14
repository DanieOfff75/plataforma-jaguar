-- ITHLA · Hotfix criterios + reaplicación retroactiva auditable.
-- Ejecutar DESPUÉS de ITHLA_CALIFICACIONES_PRECISION_Y_OFICIOS_2026.sql.
-- Instalar no transforma ninguna nota. La operación sólo ocurre desde Jaguar.
BEGIN;
ALTER TABLE public.calificaciones ADD COLUMN IF NOT EXISTS calificacion_original_politica numeric;
ALTER TABLE public.jaguar_oficios_precision_calificaciones
 ADD COLUMN IF NOT EXISTS reaplicacion_retroactiva boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS calificaciones_modificadas bigint NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS public.jaguar_reaplicacion_calificaciones (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 oficio_id bigint NOT NULL REFERENCES public.jaguar_oficios_precision_calificaciones(id),
 calificacion_id text NOT NULL,
 transaccion bigint NOT NULL,
 anterior numeric NOT NULL, posterior numeric NOT NULL, original numeric NOT NULL,
 original_anterior numeric, observaciones_anteriores text, observaciones_posteriores text,
 origen text NOT NULL CHECK (origen IN ('original_conservado','evidencia_cierre_verificada','nota_registrada_legacy')),
 creado_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(oficio_id,calificacion_id)
);
ALTER TABLE public.jaguar_reaplicacion_calificaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar_reaplicacion_calificaciones FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX IF NOT EXISTS jaguar_reaplicacion_tx_idx ON public.jaguar_reaplicacion_calificaciones(transaccion,calificacion_id);

CREATE OR REPLACE FUNCTION public.jaguar_nota_segun_criterio(p_original numeric,p_decimal boolean,p_minima integer,p_permitir boolean)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE STRICT SET search_path='' AS $$
DECLARE v_final numeric;
BEGIN
 IF p_original NOT BETWEEN 0 AND 10 THEN RAISE EXCEPTION 'Calificación fuera de 0 a 10.'; END IF;
 v_final:=round(p_original,CASE WHEN p_decimal THEN 1 ELSE 0 END);
 IF p_original<p_minima THEN
  v_final:=least(v_final,p_minima-CASE WHEN p_decimal THEN 0.1 ELSE 1 END);
  IF NOT p_permitir THEN v_final:=greatest(v_final,p_minima-1); END IF;
 END IF;
 RETURN v_final;
END $$;
REVOKE ALL ON FUNCTION public.jaguar_nota_segun_criterio(numeric,boolean,integer,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jaguar_nota_segun_criterio(numeric,boolean,integer,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.jaguar_observacion_segun_criterio(p_original numeric,p_minima integer,p_obs text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN p_original<p_minima THEN rtrim('REPROBADO. '||regexp_replace(coalesce(p_obs,''),'^REPROBADO\.[[:space:]]*','','i'))
 WHEN p_obs IS NULL THEN NULL ELSE regexp_replace(p_obs,'^REPROBADO\.[[:space:]]*','','i') END
$$;
REVOKE ALL ON FUNCTION public.jaguar_observacion_segun_criterio(numeric,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jaguar_observacion_segun_criterio(numeric,integer,text) TO service_role;

-- Recupera fuentes anteriores solamente si el cierre identifica el origen, la nota
-- persistida coincide y la política archivada reproduce exactamente esa nota.
-- Una rectificación o ajuste manual no se deshace por inferencia.
CREATE OR REPLACE FUNCTION public.jaguar_fuente_cierre_verificada(p_detalle jsonb,p_nota numeric,p_obs text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v_obs text;v_raw numeric;v_p jsonb;v_min integer;
BEGIN
 IF p_detalle IS NULL OR jsonb_typeof(p_detalle) IS DISTINCT FROM 'object' OR p_detalle ? 'ajuste' THEN RETURN NULL; END IF;
 v_obs:=regexp_replace(coalesce(p_obs,''),'^REPROBADO\.[[:space:]]*','','i');
 IF v_obs='Calificación registrada desde VALOR TOTAL de Excel docente.' AND p_detalle->>'fuente'='excel_valor_total' THEN
  IF jsonb_typeof(p_detalle->'valor_total_excel') IS DISTINCT FROM 'number' THEN RETURN NULL; END IF;
  v_raw:=(p_detalle->>'valor_total_excel')::numeric;
 ELSIF v_obs='Calificación calculada mediante rúbrica docente.' THEN
  IF jsonb_typeof(p_detalle->'calificacion_sin_redondeo') IS DISTINCT FROM 'number' THEN RETURN NULL; END IF;
  v_raw:=(p_detalle->>'calificacion_sin_redondeo')::numeric;
 ELSE RETURN NULL; END IF;
 IF v_raw NOT BETWEEN 0 AND 10 OR jsonb_typeof(p_detalle->'calificacion') IS DISTINCT FROM 'number' THEN RETURN NULL; END IF;
 IF (p_detalle->>'calificacion')::numeric IS DISTINCT FROM p_nota THEN RETURN NULL; END IF;
 v_p:=p_detalle->'politica_precision';
 IF jsonb_typeof(v_p->'permite_decimales') IS DISTINCT FROM 'boolean' OR jsonb_typeof(v_p->'permitir_reprobatorias_inferiores') IS DISTINCT FROM 'boolean' OR coalesce(v_p->>'minima_aprobatoria','') !~ '^([1-9]|10)$' THEN RETURN NULL; END IF;
 v_min:=(v_p->>'minima_aprobatoria')::integer;
 IF public.jaguar_nota_segun_criterio(v_raw,(v_p->>'permite_decimales')::boolean,v_min,(v_p->>'permitir_reprobatorias_inferiores')::boolean) IS DISTINCT FROM p_nota THEN RETURN NULL; END IF;
 RETURN v_raw;
END $$;
REVOKE ALL ON FUNCTION public.jaguar_fuente_cierre_verificada(jsonb,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jaguar_fuente_cierre_verificada(jsonb,numeric,text) TO service_role;

-- El permiso excepcional es una coincidencia exacta de la auditoría privada de ESTA transacción.
-- No es una variable de sesión que un usuario pueda activar ni deshabilita los triggers.
CREATE OR REPLACE FUNCTION public.jaguar_reaplicacion_autorizada(p_old jsonb,p_new jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (p_old - ARRAY['calificacion','observaciones','calificacion_original_politica']) =
        (p_new - ARRAY['calificacion','observaciones','calificacion_original_politica'])
 AND EXISTS (SELECT 1 FROM public.jaguar_reaplicacion_calificaciones a
 WHERE a.transaccion=txid_current() AND a.calificacion_id=p_old->>'id'
 AND a.anterior=(p_old->>'calificacion')::numeric AND a.posterior=(p_new->>'calificacion')::numeric
 AND a.original_anterior IS NOT DISTINCT FROM (p_old->>'calificacion_original_politica')::numeric
 AND a.original=(p_new->>'calificacion_original_politica')::numeric
 AND a.observaciones_anteriores IS NOT DISTINCT FROM p_old->>'observaciones'
 AND a.observaciones_posteriores IS NOT DISTINCT FROM p_new->>'observaciones')
$$;
REVOKE ALL ON FUNCTION public.jaguar_reaplicacion_autorizada(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

create or replace function public.jaguar_cambiar_precision_calificaciones(
  p_ciclo text,p_permite_decimales boolean,p_motivo text,
  p_actor uuid,p_actor_nombre text,p_version_esperada integer,
  p_minima_aprobatoria integer,p_permitir_reprobatorias_inferiores boolean
) returns bigint language plpgsql security definer set search_path='' as $$
declare v_actual public.jaguar_precision_calificaciones%rowtype; v_rol text;
        v_oficio bigint;v_version integer;v_cambios text;
begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role',nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('role',true),'')) is distinct from 'service_role' then
    raise exception 'Solo el servidor autenticado de Jaguar puede modificar criterios.' using errcode='42501';
  end if;
  if p_ciclo is null or p_ciclo !~ '^\d{4}-\d{4}$' then raise exception 'Ciclo escolar inválido.'; end if;
  if p_minima_aprobatoria is null or p_minima_aprobatoria not between 1 and 10 then raise exception 'Mínima aprobatoria fuera del rango 1 a 10.'; end if;
  if p_permite_decimales is null or p_permitir_reprobatorias_inferiores is null then raise exception 'Faltan criterios académicos.'; end if;
  if p_motivo is null or length(btrim(p_motivo))<15 or length(p_motivo)>300 then
    raise exception 'El motivo institucional debe tener entre 15 y 300 caracteres.';
  end if;
  if p_actor is null or nullif(btrim(p_actor_nombre),'') is null then raise exception 'Falta el responsable del criterio.'; end if;
  insert into public.jaguar_precision_calificaciones(ciclo_escolar) values(p_ciclo)
    on conflict(ciclo_escolar) do nothing;
  select * into strict v_actual from public.jaguar_precision_calificaciones
    where ciclo_escolar=p_ciclo for update;
  select rol::text into v_rol from public.perfiles where id=p_actor and activo is true;
  if v_rol is null or v_rol not in ('control','control_escolar','coordinacion_academica','direccion_escolar') then
    raise exception 'Autoridad académica activa requerida.' using errcode='42501';
  end if;
  if v_rol not in ('control','control_escolar') and v_actual.permite_decimales is distinct from p_permite_decimales then
    raise exception 'Solo Control Escolar modifica decimales.' using errcode='42501';
  end if;
  if v_actual.version<>p_version_esperada then
    raise exception 'El criterio fue modificado en otra sesión. Recarga la configuración.' using errcode='40001';
  end if;
  v_version:=v_actual.version+1;
  update public.jaguar_precision_calificaciones
     set permite_decimales=p_permite_decimales,minima_aprobatoria=p_minima_aprobatoria,
         permitir_reprobatorias_inferiores=p_permitir_reprobatorias_inferiores,
         version=v_version,actualizado_por=p_actor,actualizado_at=now()
     where ciclo_escolar=p_ciclo;
  insert into public.jaguar_oficios_precision_calificaciones
    (ciclo_escolar,version,antes_permite_decimales,ahora_permite_decimales,
     antes_minima_aprobatoria,ahora_minima_aprobatoria,
     antes_permitir_reprobatorias_inferiores,ahora_permitir_reprobatorias_inferiores,
     motivo,actor_id,actor_nombre)
  values(p_ciclo,v_version,v_actual.permite_decimales,p_permite_decimales,
     v_actual.minima_aprobatoria,p_minima_aprobatoria,
     v_actual.permitir_reprobatorias_inferiores,p_permitir_reprobatorias_inferiores,
     btrim(p_motivo),p_actor,btrim(p_actor_nombre))
  returning id into v_oficio;
  v_cambios:='Calificaciones: '||case when p_permite_decimales then 'un decimal' else 'enteros' end||
    '; mínima aprobatoria '||p_minima_aprobatoria::text||
    '; notas inferiores '||case when p_permitir_reprobatorias_inferiores then 'permitidas' else 'con piso '||(p_minima_aprobatoria-1)::text end;
  insert into public.notificaciones(usuario_id,titulo,contenido,tipo,solicitud_id,leida)
  select p.id,'Oficio institucional ITHLA-PC-'||v_oficio||' · Criterios de calificaciones',
    'Ciclo '||p_ciclo||'. '||v_cambios||'. Motivo: '||btrim(p_motivo)||
      '. Consulta el oficio ITHLA-PC-'||v_oficio||'.',
    'oficio_precision_calificaciones',null,false
    from public.perfiles p where p.activo=true and p.rol not in ('alumno','aspirante','padre','tutor');
  return v_oficio;
end $$;
revoke all on function public.jaguar_cambiar_precision_calificaciones(text,boolean,text,uuid,text,integer,integer,boolean) from public,anon,authenticated;
revoke all on function public.jaguar_cambiar_precision_calificaciones(text,boolean,text,uuid,text,integer,integer,boolean) from PUBLIC,anon,authenticated,service_role;

create or replace function public.jaguar_bloquear_escritura_calificacion()
returns trigger language plpgsql security definer set search_path='' as $$
declare pid bigint; r_id bigint;
begin
 if TG_TABLE_NAME='calificaciones' and TG_OP='UPDATE' then
   if public.jaguar_reaplicacion_autorizada(to_jsonb(old),to_jsonb(new)) then return new; end if;
 end if;
 if TG_TABLE_NAME='evaluacion_notas' then
   r_id := case when TG_OP='DELETE' then OLD.rubrica_id else NEW.rubrica_id end;
   select periodo_id into pid from public.rubricas_evaluacion where id=r_id;
 else
   pid:=case when TG_OP='DELETE' then OLD.periodo_id else NEW.periodo_id end;
 end if;
 if pid is null or not public.jaguar_evaluacion_abierta(pid) then
   raise exception 'Dirección Escolar no ha habilitado la captura de calificaciones de este periodo.' using errcode='23514';
 end if;
 if TG_OP='DELETE' then return OLD; end if;
 return NEW;
end;$$;

-- Conserva la nota fuente en toda escritura futura. La nota oficial es derivada.
CREATE OR REPLACE FUNCTION public.jaguar_normalizar_calificacion_oficial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_ciclo text;v_decimal boolean;v_minima integer;v_permitir boolean;v_original numeric;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF public.jaguar_reaplicacion_autorizada(to_jsonb(old),to_jsonb(new)) THEN RETURN new; END IF;
  IF new.calificacion_original_politica IS NOT DISTINCT FROM old.calificacion_original_politica AND new.calificacion IS NOT DISTINCT FROM old.calificacion THEN RETURN new; END IF;
 END IF;
 IF new.calificacion IS NULL THEN new.calificacion_original_politica:=NULL; RETURN new; END IF;
 IF TG_OP='INSERT' THEN v_original:=coalesce(new.calificacion_original_politica,new.calificacion::numeric);
 ELSIF new.calificacion_original_politica IS DISTINCT FROM old.calificacion_original_politica THEN v_original:=coalesce(new.calificacion_original_politica,new.calificacion::numeric);
 ELSE v_original:=new.calificacion::numeric; END IF;
 SELECT ciclo_escolar INTO v_ciclo FROM public.periodos_escolares WHERE id=new.periodo_id;
 IF v_ciclo IS NULL THEN RAISE EXCEPTION 'Periodo escolar inexistente para esta calificación.'; END IF;
 SELECT permite_decimales,minima_aprobatoria,permitir_reprobatorias_inferiores INTO v_decimal,v_minima,v_permitir FROM public.jaguar_precision_calificaciones WHERE ciclo_escolar=v_ciclo;
 v_minima:=coalesce(v_minima,6);
 new.calificacion_original_politica:=v_original;
 new.calificacion:=public.jaguar_nota_segun_criterio(v_original,coalesce(v_decimal,false),v_minima,coalesce(v_permitir,true));
 new.observaciones:=public.jaguar_observacion_segun_criterio(v_original,v_minima,new.observaciones);
 RETURN new;
END $$;
DROP TRIGGER IF EXISTS trg_jaguar_normalizar_calificacion_oficial ON public.calificaciones;
CREATE TRIGGER trg_jaguar_normalizar_calificacion_oficial BEFORE INSERT OR UPDATE OF calificacion,calificacion_original_politica ON public.calificaciones FOR EACH ROW EXECUTE FUNCTION public.jaguar_normalizar_calificacion_oficial();

-- Previsualización y aplicación usan la misma consulta y fórmula; confirmación vinculada a huella.
CREATE OR REPLACE FUNCTION public.jaguar_aplicar_criterios_calificaciones(
 p_ciclo text,p_permite_decimales boolean,p_motivo text,p_actor uuid,p_actor_nombre text,
 p_version_esperada integer,p_minima_aprobatoria integer,p_permitir_reprobatorias_inferiores boolean,
 p_alcance text,p_previsualizar boolean,p_huella text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_role text;v_rol text;v_actual public.jaguar_precision_calificaciones%rowtype;
 v_ciclos text[];v_ciclo text;v_huella text;v_resumen jsonb;v_oficio bigint;v_principal bigint;
 v_oficios jsonb:='[]'::jsonb;v_num bigint;v_total bigint:=0;v_actualizadas bigint;v_version integer;v_execution_allowed boolean;
BEGIN
 v_role:=coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role',nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('role',true),''));
 IF v_role IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Solo el servidor autenticado de Jaguar puede modificar criterios.' USING ERRCODE='42501'; END IF;
 SELECT rol::text INTO v_rol FROM public.perfiles WHERE id=p_actor AND activo IS TRUE;
 IF v_rol IS NULL OR v_rol NOT IN ('control','control_escolar','coordinacion_academica','direccion_escolar') THEN RAISE EXCEPTION 'Autoridad académica activa requerida.' USING ERRCODE='42501'; END IF;
 IF p_alcance IS NULL OR p_alcance NOT IN ('ciclo','todos') OR p_previsualizar IS NULL THEN RAISE EXCEPTION 'Alcance inválido.'; END IF;
 IF p_alcance='todos' AND v_rol NOT IN ('control','control_escolar') THEN RAISE EXCEPTION 'Solo Control Escolar puede cambiar todos los ciclos.' USING ERRCODE='42501'; END IF;
 IF p_ciclo IS NULL OR p_ciclo !~ '^\d{4}-\d{4}$' OR p_permite_decimales IS NULL OR p_permitir_reprobatorias_inferiores IS NULL OR p_minima_aprobatoria IS NULL OR p_minima_aprobatoria NOT BETWEEN 1 AND 10 OR p_version_esperada IS NULL OR p_motivo IS NULL OR length(btrim(p_motivo)) NOT BETWEEN 15 AND 300 THEN RAISE EXCEPTION 'Criterios o motivo inválidos.'; END IF;
 -- Serializa calificaciones y criterios durante la confirmación. No abre ventanas docentes.
 LOCK TABLE public.periodos_escolares,public.jaguar_evaluacion_ventanas IN SHARE MODE NOWAIT;
 LOCK TABLE public.calificaciones IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.jaguar_precision_calificaciones IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO v_actual FROM public.jaguar_precision_calificaciones WHERE ciclo_escolar=p_ciclo;
 IF coalesce(v_actual.version,0)<>p_version_esperada THEN RAISE EXCEPTION 'El criterio cambió. Recarga y revisa nuevamente.' USING ERRCODE='40001'; END IF;
 IF v_rol NOT IN ('control','control_escolar') AND coalesce(v_actual.permite_decimales,false) IS DISTINCT FROM p_permite_decimales THEN RAISE EXCEPTION 'Solo Control Escolar modifica decimales.' USING ERRCODE='42501'; END IF;
 IF p_alcance='todos' THEN
  SELECT array_agg(c ORDER BY c) INTO v_ciclos FROM (SELECT p_ciclo AS c UNION SELECT DISTINCT p.ciclo_escolar FROM public.periodos_escolares p WHERE p.ciclo_escolar ~ '^\d{4}-\d{4}$') x;
 ELSE v_ciclos:=ARRAY[p_ciclo]; END IF;
 -- No tocar filas sin periodo/ciclo válido. En modo todos advertir en vez de ocultarlas.
 IF p_alcance='todos' AND EXISTS(SELECT 1 FROM public.calificaciones g LEFT JOIN public.periodos_escolares p ON p.id=g.periodo_id WHERE g.calificacion IS NOT NULL AND (p.ciclo_escolar IS NULL OR p.ciclo_escolar !~ '^\d{4}-\d{4}$')) THEN RAISE EXCEPTION 'Existen notas sin ciclo válido. Corrige su periodo antes de aplicar a todos los ciclos.'; END IF;
 WITH base AS (
  SELECT g.id,g.calificacion::numeric AS nota,g.calificacion_original_politica AS fuente,g.observaciones,p.ciclo_escolar,
   public.jaguar_fuente_cierre_verificada(to_jsonb(g)->'detalle_evaluacion',g.calificacion::numeric,g.observaciones) AS evidencia,
   coalesce(g.calificacion_original_politica,public.jaguar_fuente_cierre_verificada(to_jsonb(g)->'detalle_evaluacion',g.calificacion::numeric,g.observaciones),g.calificacion::numeric) AS original
  FROM public.calificaciones g JOIN public.periodos_escolares p ON p.id=g.periodo_id
  WHERE p.ciclo_escolar=ANY(v_ciclos) AND g.calificacion IS NOT NULL
 ), calc AS (
  SELECT *,public.jaguar_nota_segun_criterio(original,p_permite_decimales,p_minima_aprobatoria,p_permitir_reprobatorias_inferiores) AS nueva,
   public.jaguar_observacion_segun_criterio(original,p_minima_aprobatoria,observaciones) AS obs_nueva FROM base
 ) SELECT jsonb_build_object('evaluadas',count(*),'notas_cambian',count(*) FILTER(WHERE nota IS DISTINCT FROM nueva),
  'registros_cambian',count(*) FILTER(WHERE nota IS DISTINCT FROM nueva OR observaciones IS DISTINCT FROM obs_nueva),
  'suben',count(*) FILTER(WHERE nueva>nota),'bajan',count(*) FILTER(WHERE nueva<nota),
  'reprobadas',count(*) FILTER(WHERE original<p_minima_aprobatoria),'sin_original',count(*) FILTER(WHERE fuente IS NULL AND evidencia IS NULL),
  'ciclos',to_jsonb(v_ciclos)),
  md5(coalesce(string_agg(md5(jsonb_build_array(id,nota,fuente,evidencia,original,observaciones,ciclo_escolar,nueva,obs_nueva)::text),'' ORDER BY id),''))
 INTO v_resumen,v_huella FROM calc;
 v_huella:=md5(v_huella||jsonb_build_array(p_actor,p_ciclo,p_alcance,p_permite_decimales,p_minima_aprobatoria,p_permitir_reprobatorias_inferiores,btrim(p_motivo),v_ciclos)::text||coalesce((SELECT string_agg(md5(to_jsonb(q)::text),'' ORDER BY q.ciclo_escolar) FROM public.jaguar_precision_calificaciones q WHERE q.ciclo_escolar=ANY(v_ciclos)),''));
 -- The preview and mutation use the SAME protection predicate. A preview does not grant authority.
 v_execution_allowed:=p_alcance='ciclo' AND (SELECT count(*) FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE)=1
    AND EXISTS(SELECT 1 FROM public.periodos_escolares WHERE es_periodo_actual IS TRUE AND activo IS TRUE AND ciclo_escolar=p_ciclo)
    AND NOT EXISTS(SELECT 1 FROM public.calificaciones g JOIN public.periodos_escolares pe ON pe.id=g.periodo_id WHERE pe.ciclo_escolar=p_ciclo AND g.calificacion IS NOT NULL AND public.jaguar_evaluacion_abierta(pe.id) IS DISTINCT FROM TRUE)
    AND coalesce(to_jsonb(v_actual)->>'redondeo_ordinario','nearest')='nearest';
 IF p_previsualizar THEN RETURN v_resumen||jsonb_build_object('huella',v_huella,'execution_allowed',v_execution_allowed); END IF;
 IF v_execution_allowed IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Reaplicación histórica, periodo cerrado o criterio distinto: se requiere autorización versionada. Solo se permite previsualizar.' USING ERRCODE='42501'; END IF;
 IF p_huella IS DISTINCT FROM v_huella THEN RAISE EXCEPTION 'Los datos cambiaron desde la vista previa. Revisa nuevamente.' USING ERRCODE='40001'; END IF;
 FOREACH v_ciclo IN ARRAY v_ciclos LOOP
  SELECT coalesce((SELECT version FROM public.jaguar_precision_calificaciones WHERE ciclo_escolar=v_ciclo),0) INTO v_version;
  v_oficio:=public.jaguar_cambiar_precision_calificaciones(v_ciclo,p_permite_decimales,p_motivo,p_actor,p_actor_nombre,v_version,p_minima_aprobatoria,p_permitir_reprobatorias_inferiores);
  IF v_ciclo=p_ciclo THEN v_principal:=v_oficio; END IF;
  WITH base AS (
   SELECT g.id,g.calificacion::numeric AS nota,g.calificacion_original_politica AS fuente,g.observaciones,
    public.jaguar_fuente_cierre_verificada(to_jsonb(g)->'detalle_evaluacion',g.calificacion::numeric,g.observaciones) AS evidencia,
   coalesce(g.calificacion_original_politica,public.jaguar_fuente_cierre_verificada(to_jsonb(g)->'detalle_evaluacion',g.calificacion::numeric,g.observaciones),g.calificacion::numeric) AS original
   FROM public.calificaciones g JOIN public.periodos_escolares p ON p.id=g.periodo_id WHERE p.ciclo_escolar=v_ciclo AND g.calificacion IS NOT NULL
  ), calc AS (
   SELECT *,public.jaguar_nota_segun_criterio(original,p_permite_decimales,p_minima_aprobatoria,p_permitir_reprobatorias_inferiores) AS nueva,
    public.jaguar_observacion_segun_criterio(original,p_minima_aprobatoria,observaciones) AS obs_nueva FROM base
  ) INSERT INTO public.jaguar_reaplicacion_calificaciones(oficio_id,calificacion_id,transaccion,anterior,posterior,original,original_anterior,observaciones_anteriores,observaciones_posteriores,origen)
  SELECT v_oficio,id::text,txid_current(),nota,nueva,original,fuente,observaciones,obs_nueva,CASE WHEN fuente IS NOT NULL THEN 'original_conservado' WHEN evidencia IS NOT NULL THEN 'evidencia_cierre_verificada' ELSE 'nota_registrada_legacy' END
  FROM calc WHERE nota IS DISTINCT FROM nueva OR observaciones IS DISTINCT FROM obs_nueva;
  GET DIAGNOSTICS v_num=ROW_COUNT;
  UPDATE public.calificaciones g SET calificacion=a.posterior,observaciones=a.observaciones_posteriores,calificacion_original_politica=a.original
   FROM public.jaguar_reaplicacion_calificaciones a WHERE a.oficio_id=v_oficio AND a.calificacion_id=g.id::text;
  GET DIAGNOSTICS v_actualizadas=ROW_COUNT;
  IF v_actualizadas<>v_num OR EXISTS (
   SELECT 1 FROM public.jaguar_reaplicacion_calificaciones a JOIN public.calificaciones g ON g.id::text=a.calificacion_id
   WHERE a.oficio_id=v_oficio AND (g.calificacion::numeric IS DISTINCT FROM a.posterior OR g.observaciones IS DISTINCT FROM a.observaciones_posteriores OR g.calificacion_original_politica IS DISTINCT FROM a.original)
  ) THEN RAISE EXCEPTION 'No se aplicaron exactamente todas las notas previstas; se revierte la operación.'; END IF;
  UPDATE public.jaguar_oficios_precision_calificaciones SET reaplicacion_retroactiva=true,calificaciones_modificadas=v_num WHERE id=v_oficio;
  -- Complementa la notificación del mismo folio; no crea una bandeja adicional.
  UPDATE public.notificaciones SET contenido=contenido||' Aplicación retroactiva: '||v_num||' registros oficiales modificados; se conservan los originales.'
   WHERE tipo='oficio_precision_calificaciones' AND titulo='Oficio institucional ITHLA-PC-'||v_oficio||' · Criterios de calificaciones';
  v_total:=v_total+v_num; v_oficios:=v_oficios||jsonb_build_array(jsonb_build_object('ciclo',v_ciclo,'id',v_oficio,'registros',v_num));
 END LOOP;
 IF v_total<>(v_resumen->>'registros_cambian')::bigint THEN RAISE EXCEPTION 'El cotejo de actualización no coincide; operación revertida.'; END IF;
 RETURN v_resumen||jsonb_build_object('oficio_id',v_principal,'oficios',v_oficios,'registros_actualizados',v_total);
END $$;
REVOKE ALL ON FUNCTION public.jaguar_aplicar_criterios_calificaciones(text,boolean,text,uuid,text,integer,integer,boolean,text,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jaguar_aplicar_criterios_calificaciones(text,boolean,text,uuid,text,integer,integer,boolean,text,boolean,text) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
