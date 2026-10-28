-- ITHLA: operación académica de baja y cobertura; requiere tablas Jaguar existentes.
-- Ejecutar UNA VEZ en Supabase, tras respaldar la base de datos.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar_bajas_docentes (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 docente_id bigint NOT NULL REFERENCES public.docentes(id) ON DELETE RESTRICT,
 estado text NOT NULL DEFAULT 'solicitada' CHECK (estado IN ('solicitada','notificada','conformidad','autorizada','ejecutada','cancelada')),
 motivo text NOT NULL CHECK (length(btrim(motivo))>=20),
 fecha_efectiva date NOT NULL,
 creado_por uuid NOT NULL, creado_at timestamptz NOT NULL DEFAULT now(),
 notificado_at timestamptz, enterado_at timestamptz, conformidad_texto text,
 autorizado_por uuid, autorizado_at timestamptz, justificacion_sin_firma text,
 ejecutado_por uuid, ejecutado_at timestamptz, cancelado_por uuid,
 CONSTRAINT no_entregado_sin_autorizacion CHECK (estado<>'ejecutada' OR autorizado_por IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS jaguar_bajas_docente_pendiente_idx ON public.jaguar_bajas_docentes(docente_id)
 WHERE estado IN ('solicitada','notificada','conformidad','autorizada');
CREATE TABLE IF NOT EXISTS public.jaguar_vacantes_docentes (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 baja_id bigint NOT NULL REFERENCES public.jaguar_bajas_docentes(id) ON DELETE RESTRICT,
 asignacion_anterior_id bigint NOT NULL UNIQUE REFERENCES public.asignaciones_docentes(id) ON DELETE RESTRICT,
 docente_anterior_id bigint NOT NULL REFERENCES public.docentes(id) ON DELETE RESTRICT,
 grupo_materia_id bigint NOT NULL REFERENCES public.grupo_materias(id) ON DELETE RESTRICT,
 ciclo_escolar text NOT NULL, horas_asignadas numeric NOT NULL DEFAULT 0,
 estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','cubierta')),
 docente_nuevo_id bigint REFERENCES public.docentes(id) ON DELETE RESTRICT,
 nueva_asignacion_id bigint REFERENCES public.asignaciones_docentes(id) ON DELETE RESTRICT,
 cubierta_por uuid, cubierta_at timestamptz,
 creado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jaguar_vacantes_estado_idx ON public.jaguar_vacantes_docentes(estado,ciclo_escolar);
CREATE TABLE IF NOT EXISTS public.jaguar_relevo_recursos (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 vacante_id bigint NOT NULL REFERENCES public.jaguar_vacantes_docentes(id) ON DELETE RESTRICT,
 tipo text NOT NULL CHECK (tipo IN ('planeacion','rubrica','actividad','nota_institucional','oficio_no_personal','otro_material')),
 titulo text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 3 AND 160),
 descripcion text NOT NULL DEFAULT '' CHECK (length(descripcion)<=4000),
 referencia text NOT NULL DEFAULT '' CHECK (length(referencia)<=300),
 autorizado_por uuid NOT NULL, autorizado_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.jaguar_relevo_auditoria (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, baja_id bigint REFERENCES public.jaguar_bajas_docentes(id),
 vacante_id bigint REFERENCES public.jaguar_vacantes_docentes(id),
 accion text NOT NULL, actor uuid NOT NULL, detalle jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
DO $$BEGIN
  -- Las clases sin titular mantienen horario académico, pero no pueden anunciar al docente saliente.
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='horarios' AND column_name='docente_id') THEN
   ALTER TABLE public.horarios ALTER COLUMN docente_id DROP NOT NULL;
  END IF;
END$$;
ALTER TABLE public.jaguar_bajas_docentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar_vacantes_docentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar_relevo_recursos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar_relevo_auditoria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar_bajas_docentes,public.jaguar_vacantes_docentes,public.jaguar_relevo_recursos,public.jaguar_relevo_auditoria FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.jaguar_bajas_docentes,public.jaguar_vacantes_docentes,public.jaguar_relevo_recursos,public.jaguar_relevo_auditoria TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.jaguar_bajas_docentes_id_seq,public.jaguar_vacantes_docentes_id_seq,public.jaguar_relevo_recursos_id_seq,public.jaguar_relevo_auditoria_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.jaguar_gestion_baja(
 p_accion text,p_id bigint,p_docente_id bigint,p_actor uuid,p_detalle jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $ithla$
DECLARE v_rol text; v_b public.jaguar_bajas_docentes%ROWTYPE;
 v_doc public.docentes%ROWTYPE; v_v public.jaguar_vacantes_docentes%ROWTYPE;
 v_a public.asignaciones_docentes%ROWTYPE; v_num bigint; v_nuevo bigint;
 v_just text; v_nota text; v_aid bigint; v_total integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Operación exclusiva de servidor'; END IF;
 SELECT rol INTO v_rol FROM public.perfiles WHERE id=p_actor AND activo=true;
 IF v_rol IS NULL THEN RAISE EXCEPTION 'Actor sin sesión activa'; END IF;
 IF p_accion='solicitar' THEN
  IF v_rol NOT IN ('servicios_docentes','direccion_escolar') THEN RAISE EXCEPTION 'Solo Servicios Docentes o Dirección inicia una baja'; END IF;
  SELECT * INTO v_doc FROM public.docentes WHERE id=p_docente_id FOR UPDATE;
  IF NOT FOUND OR v_doc.activo IS DISTINCT FROM true THEN RAISE EXCEPTION 'Docente inexistente o inactivo'; END IF;
  v_just=btrim(coalesce(p_detalle->>'motivo',''));
  IF length(v_just)<20 THEN RAISE EXCEPTION 'Explica el motivo administrativo con al menos 20 caracteres'; END IF;
  INSERT INTO public.jaguar_bajas_docentes(docente_id,motivo,fecha_efectiva,creado_por)
   VALUES(p_docente_id,v_just,coalesce(nullif(p_detalle->>'fecha_efectiva','')::date,current_date),p_actor) RETURNING id INTO v_num;
  INSERT INTO public.jaguar_relevo_auditoria(baja_id,accion,actor) VALUES(v_num,'solicitar',p_actor);
  RETURN jsonb_build_object('id',v_num,'estado','solicitada');
 END IF;
 IF p_accion='cubrir' OR p_accion='recurso' THEN
  IF v_rol NOT IN ('servicios_docentes','coordinacion_academica','direccion_escolar') THEN RAISE EXCEPTION 'Sin autorización para gestionar coberturas'; END IF;
  SELECT * INTO v_v FROM public.jaguar_vacantes_docentes WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vacante no encontrada'; END IF;
  IF p_accion='recurso' THEN
   IF v_v.estado<>'cubierta' AND v_v.estado<>'pendiente' THEN RAISE EXCEPTION 'Estado inválido'; END IF;
   IF (p_detalle->>'tipo') NOT IN ('planeacion','rubrica','actividad','nota_institucional','oficio_no_personal','otro_material') THEN RAISE EXCEPTION 'Tipo de recurso inválido'; END IF;
   INSERT INTO public.jaguar_relevo_recursos(vacante_id,tipo,titulo,descripcion,referencia,autorizado_por)
    VALUES(v_v.id,p_detalle->>'tipo',btrim(coalesce(p_detalle->>'titulo','')),btrim(coalesce(p_detalle->>'descripcion','')),btrim(coalesce(p_detalle->>'referencia','')),p_actor)
    RETURNING id INTO v_num;
   INSERT INTO public.jaguar_relevo_auditoria(vacante_id,accion,actor) VALUES(v_v.id,'recurso',p_actor);
   RETURN jsonb_build_object('recurso_id',v_num);
  END IF;
  PERFORM 1 FROM public.grupo_materias WHERE id=v_v.grupo_materia_id FOR UPDATE;
  IF v_v.estado<>'pendiente' THEN RAISE EXCEPTION 'La vacante ya fue cubierta'; END IF;
  SELECT * INTO v_doc FROM public.docentes WHERE id=p_docente_id FOR UPDATE;
  IF NOT FOUND OR v_doc.activo IS DISTINCT FROM true OR v_doc.id=v_v.docente_anterior_id THEN RAISE EXCEPTION 'Sustituto no disponible'; END IF;
  IF EXISTS(SELECT 1 FROM public.asignaciones_docentes WHERE grupo_materia_id=v_v.grupo_materia_id AND ciclo_escolar=v_v.ciclo_escolar AND activo=true) THEN
   RAISE EXCEPTION 'Este grupo/materia ya tiene una asignación activa';
  END IF;
  IF EXISTS(
   SELECT 1 FROM public.horarios libre JOIN public.horarios ocupado
   ON ocupado.docente_id=p_docente_id AND ocupado.ciclo_escolar=libre.ciclo_escolar
    AND ocupado.dia_semana=libre.dia_semana
    AND ocupado.hora_inicio<libre.hora_fin AND ocupado.hora_fin>libre.hora_inicio
   WHERE libre.grupo_materia_id=v_v.grupo_materia_id AND libre.ciclo_escolar=v_v.ciclo_escolar
  ) THEN RAISE EXCEPTION 'El sustituto tiene un choque de horarios'; END IF;
  UPDATE public.grupo_materias SET activo=true WHERE id=v_v.grupo_materia_id;
  PERFORM set_config('jaguar.relevo_autorizado','true',true);
  INSERT INTO public.asignaciones_docentes(docente_id,grupo_materia_id,ciclo_escolar,horas_asignadas,activo,origen)
   VALUES(p_docente_id,v_v.grupo_materia_id,v_v.ciclo_escolar,v_v.horas_asignadas,true,'manual') RETURNING id INTO v_aid;
  UPDATE public.horarios SET docente_id=p_docente_id WHERE grupo_materia_id=v_v.grupo_materia_id AND ciclo_escolar=v_v.ciclo_escolar AND docente_id IS NULL;
  UPDATE public.docentes SET horas_asignadas=(SELECT coalesce(sum(coalesce(horas_asignadas,0)),0) FROM public.asignaciones_docentes WHERE docente_id=p_docente_id AND activo=true AND ciclo_escolar=v_v.ciclo_escolar) WHERE id=p_docente_id;
  UPDATE public.jaguar_vacantes_docentes SET estado='cubierta',docente_nuevo_id=p_docente_id,nueva_asignacion_id=v_aid,cubierta_por=p_actor,cubierta_at=now() WHERE id=v_v.id;
  -- Las calificaciones permanecen en sus registros históricos; NO se copian ni sobrescriben.
  INSERT INTO public.jaguar_relevo_auditoria(vacante_id,accion,actor,detalle) VALUES(v_v.id,'cubrir',p_actor,jsonb_build_object('nuevo_docente_id',p_docente_id));
  RETURN jsonb_build_object('vacante_id',v_v.id,'estado','cubierta','nueva_asignacion_id',v_aid);
 END IF;
 SELECT * INTO v_b FROM public.jaguar_bajas_docentes WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud de baja inexistente'; END IF;
 IF p_accion='enterado' THEN
  IF v_b.estado<>'notificada' THEN RAISE EXCEPTION 'La baja no está notificada'; END IF;
  IF v_rol<>'docente' OR NOT EXISTS(SELECT 1 FROM public.docentes WHERE id=v_b.docente_id AND auth_user_id=p_actor) THEN
   RAISE EXCEPTION 'Solo el docente titular puede confirmar recepción'; END IF;
  UPDATE public.jaguar_bajas_docentes SET estado='conformidad',enterado_at=now(),conformidad_texto='Constancia de recepción del aviso; no implica renuncia a derechos.' WHERE id=v_b.id;
 ELSIF p_accion='notificar' THEN
  IF v_rol NOT IN ('servicios_docentes','direccion_escolar') OR v_b.estado<>'solicitada' THEN RAISE EXCEPTION 'No es posible notificar'; END IF;
  UPDATE public.jaguar_bajas_docentes SET estado='notificada',notificado_at=now() WHERE id=v_b.id;
 ELSIF p_accion='autorizar' THEN
  IF v_rol<>'direccion_escolar' OR v_b.estado NOT IN ('notificada','conformidad') THEN RAISE EXCEPTION 'Solo Dirección autoriza solicitudes notificadas'; END IF;
  v_just=btrim(coalesce(p_detalle->>'motivo_sin_firma',''));
  IF v_b.estado='notificada' AND length(v_just)<20 THEN RAISE EXCEPTION 'Sin constancia docente: Dirección debe fundamentar la excepción (20 caracteres)'; END IF;
  UPDATE public.jaguar_bajas_docentes SET estado='autorizada',autorizado_por=p_actor,autorizado_at=now(),justificacion_sin_firma=nullif(v_just,'') WHERE id=v_b.id;
 ELSIF p_accion='ejecutar' THEN
  IF v_rol NOT IN ('direccion_escolar','servicios_docentes') OR v_b.estado<>'autorizada' THEN RAISE EXCEPTION 'La baja necesita autorización de Dirección'; END IF;
  SELECT * INTO v_doc FROM public.docentes WHERE id=v_b.docente_id FOR UPDATE;
  IF NOT FOUND OR v_doc.activo IS DISTINCT FROM true THEN RAISE EXCEPTION 'Docente ya inactivo'; END IF;
  FOR v_a IN SELECT * FROM public.asignaciones_docentes WHERE docente_id=v_doc.id AND activo=true FOR UPDATE LOOP
   INSERT INTO public.jaguar_vacantes_docentes(baja_id,asignacion_anterior_id,docente_anterior_id,grupo_materia_id,ciclo_escolar,horas_asignadas)
    VALUES(v_b.id,v_a.id,v_doc.id,v_a.grupo_materia_id,v_a.ciclo_escolar,coalesce(v_a.horas_asignadas,0));
  END LOOP;
  UPDATE public.asignaciones_docentes SET activo=false WHERE docente_id=v_doc.id AND activo=true;
  UPDATE public.grupo_materias gm SET activo=false WHERE gm.id IN (
   SELECT grupo_materia_id FROM public.jaguar_vacantes_docentes WHERE baja_id=v_b.id
  ) AND NOT EXISTS(SELECT 1 FROM public.asignaciones_docentes a WHERE a.grupo_materia_id=gm.id AND a.activo=true);

  UPDATE public.horarios h SET docente_id=NULL WHERE h.docente_id=v_doc.id
   AND EXISTS(SELECT 1 FROM public.jaguar_vacantes_docentes v WHERE v.baja_id=v_b.id AND v.grupo_materia_id=h.grupo_materia_id AND v.ciclo_escolar=h.ciclo_escolar);
  UPDATE public.docentes SET activo=false,estado_profesional='archivado',archivado_at=now(),archivado_por=p_actor,archivado_motivo=v_b.motivo,horas_asignadas=0 WHERE id=v_doc.id;
  IF v_doc.auth_user_id IS NOT NULL THEN UPDATE public.perfiles SET activo=false WHERE id=v_doc.auth_user_id; END IF;
  UPDATE public.jaguar_bajas_docentes SET estado='ejecutada',ejecutado_por=p_actor,ejecutado_at=now() WHERE id=v_b.id;
 ELSIF p_accion='cancelar' THEN
  IF v_rol<>'direccion_escolar' OR v_b.estado IN ('ejecutada','cancelada') THEN RAISE EXCEPTION 'No puede cancelarse'; END IF;
  UPDATE public.jaguar_bajas_docentes SET estado='cancelada',cancelado_por=p_actor WHERE id=v_b.id;
 ELSE RAISE EXCEPTION 'Acción no reconocida'; END IF;
 INSERT INTO public.jaguar_relevo_auditoria(baja_id,accion,actor) VALUES(v_b.id,p_accion,p_actor);
 RETURN jsonb_build_object('id',v_b.id,'estado',(SELECT estado FROM public.jaguar_bajas_docentes WHERE id=v_b.id));
END $ithla$;
REVOKE ALL ON FUNCTION public.jaguar_gestion_baja(text,bigint,bigint,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jaguar_gestion_baja(text,bigint,bigint,uuid,jsonb) TO service_role;


-- Prohíbe saltarse el flujo de cobertura con edición manual o asignación aleatoria.
CREATE OR REPLACE FUNCTION public.jaguar_bloquear_cobertura_pendiente()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $ithla$
BEGIN
 IF NEW.activo IS TRUE AND EXISTS(
   SELECT 1 FROM public.jaguar_vacantes_docentes
   WHERE grupo_materia_id=NEW.grupo_materia_id AND ciclo_escolar=NEW.ciclo_escolar AND estado='pendiente'
 ) AND current_setting('jaguar.relevo_autorizado',true) IS DISTINCT FROM 'true' THEN
   RAISE EXCEPTION 'Esta materia tiene una vacante pendiente: usa Gestión de bajas y relevos';
 END IF;
 RETURN NEW;
END $ithla$;
DROP TRIGGER IF EXISTS jaguar_guardar_cobertura_formal ON public.asignaciones_docentes;
CREATE TRIGGER jaguar_guardar_cobertura_formal BEFORE INSERT OR UPDATE OF activo,docente_id,grupo_materia_id,ciclo_escolar
ON public.asignaciones_docentes FOR EACH ROW EXECUTE FUNCTION public.jaguar_bloquear_cobertura_pendiente();

-- Copia académica de la rúbrica del saliente: nunca sobrescribe la original ni sus notas.
CREATE OR REPLACE FUNCTION public.jaguar_relevo_adoptar_rubrica(
 p_vacante_id bigint,p_periodo_id bigint,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $ithla$
DECLARE v_v public.jaguar_vacantes_docentes%ROWTYPE; v_prev public.rubricas_evaluacion%ROWTYPE;
 v_nuevo bigint;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Solo servidor'; END IF;
 SELECT * INTO v_v FROM public.jaguar_vacantes_docentes WHERE id=p_vacante_id FOR UPDATE;
 IF NOT FOUND OR v_v.estado<>'cubierta' THEN RAISE EXCEPTION 'Cobertura no confirmada'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.docentes WHERE id=v_v.docente_nuevo_id AND auth_user_id=p_actor AND activo=true) THEN
  RAISE EXCEPTION 'Solo el sustituto autenticado puede adoptar la rúbrica'; END IF;
 IF EXISTS(SELECT 1 FROM public.rubricas_evaluacion WHERE docente_id=v_v.docente_nuevo_id AND grupo_materia_id=v_v.grupo_materia_id AND periodo_id=p_periodo_id) THEN
  RAISE EXCEPTION 'Ya tienes una rúbrica en este periodo; conserva la existente'; END IF;
 SELECT * INTO v_prev FROM public.rubricas_evaluacion WHERE docente_id=v_v.docente_anterior_id AND grupo_materia_id=v_v.grupo_materia_id AND periodo_id=p_periodo_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'No existe rúbrica original'; END IF;
 IF v_prev.estado='cerrada' THEN RAISE EXCEPTION 'El periodo original está cerrado: consultar historial, no duplicar calificaciones'; END IF;
 INSERT INTO public.rubricas_evaluacion(docente_id,grupo_materia_id,periodo_id,titulo,descripcion,escala_maxima,estado,version)
  VALUES(v_v.docente_nuevo_id,v_v.grupo_materia_id,p_periodo_id,v_prev.titulo, v_prev.descripcion, v_prev.escala_maxima,'borrador',1) RETURNING id INTO v_nuevo;
 INSERT INTO public.rubrica_componentes(rubrica_id,nombre,ponderacion,maximo,orden)
  SELECT v_nuevo,nombre,ponderacion,maximo,orden FROM public.rubrica_componentes WHERE rubrica_id=v_prev.id;
 INSERT INTO public.jaguar_relevo_auditoria(vacante_id,accion,actor,detalle)
  VALUES(v_v.id,'adoptar_rubrica',p_actor,jsonb_build_object('original',v_prev.id,'copia',v_nuevo));
 RETURN jsonb_build_object('rubrica_id',v_nuevo,'original_id',v_prev.id,'estado','borrador');
END $ithla$;
REVOKE ALL ON FUNCTION public.jaguar_relevo_adoptar_rubrica(bigint,bigint,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jaguar_relevo_adoptar_rubrica(bigint,bigint,uuid) TO service_role;

COMMIT;
