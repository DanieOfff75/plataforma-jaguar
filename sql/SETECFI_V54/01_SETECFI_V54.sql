-- SETECFI V54, instalacion aditiva: no altera docentes, cuentas, calificaciones ni nombramientos.
-- Proyecto INSTITUCIONAL ITHLA. No certifica habilitacion SEP ni emite credenciales estatales.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE IF NOT EXISTS public.setecfi_operadores_v54 (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  nivel text NOT NULL CHECK (nivel IN ('admin','revisor')),
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.setecfi_expedientes_v54 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('alta_docente','baja_docente','permiso_docente','reingreso_docente','suplencia_docente','alta_direccion','baja_direccion','permiso_direccion')),
  persona_nombre text NOT NULL CHECK (char_length(btrim(persona_nombre)) BETWEEN 5 AND 160),
  persona_correo text CHECK (persona_correo IS NULL OR char_length(persona_correo) BETWEEN 5 AND 180),
  docente_id bigint REFERENCES public.docentes(id) ON DELETE RESTRICT,
  persona_auth_id uuid,
  ciclo text NOT NULL CHECK (ciclo ~ '^[0-9]{4}-[0-9]{4}(/[1-9])?$'),
  materias_propuestas text[] NOT NULL DEFAULT '{}',
  motivo text NOT NULL CHECK (char_length(btrim(motivo)) BETWEEN 15 AND 2000),
  fecha_inicio date,
  fecha_fin date,
  estado_direccion text NOT NULL DEFAULT 'pendiente' CHECK (estado_direccion IN ('pendiente','aprobado','rechazado')),
  direccion_por uuid,
  direccion_en timestamptz,
  direccion_motivo text,
  estado_setecfi text NOT NULL DEFAULT 'sin_revision' CHECK (estado_setecfi IN ('sin_revision','aprobado','rechazado','revocado')),
  setecfi_por uuid,
  setecfi_en timestamptz,
  setecfi_motivo text,
  evidencia_revision text,
  materias_validadas text[] NOT NULL DEFAULT '{}',
  vigencia_hasta date,
  folio text UNIQUE,
  codigo_verificacion text UNIQUE,
  aplicado_en timestamptz,
  aplicado_por uuid,
  revocado_en timestamptz,
  revocado_por uuid,
  solicitado_por uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT setecfi_fecha_coherente_v54 CHECK (fecha_fin IS NULL OR fecha_inicio IS NULL OR fecha_fin>=fecha_inicio),
  CONSTRAINT setecfi_aprobacion_direccion_v54 CHECK (estado_setecfi='sin_revision' OR estado_direccion='aprobado')
);
CREATE TABLE IF NOT EXISTS public.setecfi_eventos_v54 (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  expediente_id uuid NOT NULL REFERENCES public.setecfi_expedientes_v54(id) ON DELETE RESTRICT,
  etapa text NOT NULL,
  accion text NOT NULL,
  actor uuid NOT NULL,
  detalle text NOT NULL DEFAULT '',
  fecha timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS setecfi_expedientes_estados_idx ON public.setecfi_expedientes_v54(estado_direccion,estado_setecfi,creado_en DESC);
CREATE INDEX IF NOT EXISTS setecfi_expedientes_solicitante_idx ON public.setecfi_expedientes_v54(solicitado_por,creado_en DESC);
CREATE INDEX IF NOT EXISTS setecfi_eventos_expediente_idx ON public.setecfi_eventos_v54(expediente_id,fecha);
-- RLS y accesos: SOLO operaciones mediante APIs del servidor que autentican el rol.
ALTER TABLE public.setecfi_operadores_v54 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setecfi_expedientes_v54 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setecfi_eventos_v54 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.setecfi_operadores_v54,public.setecfi_expedientes_v54,public.setecfi_eventos_v54 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.setecfi_operadores_v54 TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.setecfi_expedientes_v54 TO service_role;
GRANT SELECT,INSERT ON public.setecfi_eventos_v54 TO service_role;
REVOKE ALL ON SEQUENCE public.setecfi_eventos_v54_id_seq FROM PUBLIC,anon,authenticated;
GRANT USAGE,SELECT ON SEQUENCE public.setecfi_eventos_v54_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.setecfi_direccion_decidir_v54(p_id uuid,p_actor uuid,p_decision text,p_motivo text)
RETURNS public.setecfi_expedientes_v54 LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $fn$
DECLARE x public.setecfi_expedientes_v54; r text;
BEGIN
 IF p_decision NOT IN ('aprobado','rechazado') OR length(btrim(coalesce(p_motivo,''))) NOT BETWEEN 15 AND 1200 THEN RAISE EXCEPTION 'Decision o motivo invalido'; END IF;
 SELECT rol INTO r FROM public.perfiles WHERE id=p_actor AND activo IS TRUE;
 IF r IS DISTINCT FROM 'direccion_escolar' THEN RAISE EXCEPTION 'Solo Direccion Escolar puede resolver'; END IF;
 SELECT * INTO x FROM public.setecfi_expedientes_v54 WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR x.estado_direccion<>'pendiente' THEN RAISE EXCEPTION 'Expediente no pendiente'; END IF;
 IF x.solicitado_por=p_actor OR x.persona_auth_id=p_actor THEN RAISE EXCEPTION 'No puedes autorizar tu propio expediente'; END IF;
 UPDATE public.setecfi_expedientes_v54 SET estado_direccion=p_decision,direccion_por=p_actor,direccion_en=now(),direccion_motivo=btrim(p_motivo),actualizado_en=now() WHERE id=p_id RETURNING * INTO x;
 INSERT INTO public.setecfi_eventos_v54(expediente_id,etapa,accion,actor,detalle) VALUES(p_id,'direccion',p_decision,p_actor,btrim(p_motivo));
 RETURN x;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.setecfi_resolver_v54(
 p_id uuid,p_actor uuid,p_decision text,p_motivo text,p_evidencia text DEFAULT '',p_materias text[] DEFAULT '{}',p_vigencia date DEFAULT NULL)
RETURNS public.setecfi_expedientes_v54 LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $fn$
DECLARE x public.setecfi_expedientes_v54; n text; es_alta boolean; f text; c text;
BEGIN
 IF p_decision NOT IN ('aprobado','rechazado','revocado') OR length(btrim(coalesce(p_motivo,''))) NOT BETWEEN 15 AND 1200 THEN RAISE EXCEPTION 'Decision o motivo invalido'; END IF;
 SELECT nivel INTO n FROM public.setecfi_operadores_v54 WHERE user_id=p_actor AND activo IS TRUE;
 IF n IS NULL OR (p_decision='revocado' AND n<>'admin') THEN RAISE EXCEPTION 'Operador SETECFI no autorizado'; END IF;
 SELECT * INTO x FROM public.setecfi_expedientes_v54 WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR x.estado_direccion<>'aprobado' THEN RAISE EXCEPTION 'Falta autorizacion de Direccion Escolar'; END IF;
 IF x.solicitado_por=p_actor OR x.direccion_por=p_actor OR x.persona_auth_id=p_actor THEN RAISE EXCEPTION 'Revisor no independiente'; END IF;
 IF p_decision='revocado' THEN
  IF x.estado_setecfi<>'aprobado' THEN RAISE EXCEPTION 'Solo puede revocarse una resolucion vigente'; END IF;
  UPDATE public.setecfi_expedientes_v54 SET estado_setecfi='revocado',revocado_por=p_actor,revocado_en=now(),setecfi_motivo=btrim(p_motivo),actualizado_en=now() WHERE id=p_id RETURNING * INTO x;
 ELSE
  IF x.estado_setecfi<>'sin_revision' THEN RAISE EXCEPTION 'Expediente ya resuelto'; END IF;
  es_alta:=x.tipo IN ('alta_docente','reingreso_docente','alta_direccion');
  IF p_decision='aprobado' AND es_alta AND (char_length(btrim(coalesce(p_evidencia,'')))<25 OR p_vigencia IS NULL OR p_vigencia<=current_date OR (x.tipo<>'alta_direccion' AND coalesce(array_length(p_materias,1),0)=0)) THEN
   RAISE EXCEPTION 'Registrar evidencia revisada, asignaturas y vigencia antes de validar idoneidad'; END IF;
  IF p_decision='aprobado' THEN
   f:='SETECFI-INT-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(encode(gen_random_bytes(5),'hex'),1,10));
   c:=upper(encode(gen_random_bytes(16),'hex'));
  END IF;
  UPDATE public.setecfi_expedientes_v54 SET estado_setecfi=p_decision,setecfi_por=p_actor,setecfi_en=now(),setecfi_motivo=btrim(p_motivo),evidencia_revision=left(btrim(coalesce(p_evidencia,'')),2000),materias_validadas=CASE WHEN p_decision='aprobado' THEN p_materias ELSE '{}' END,vigencia_hasta=CASE WHEN p_decision='aprobado' THEN p_vigencia ELSE NULL END,folio=f,codigo_verificacion=c,actualizado_en=now() WHERE id=p_id RETURNING * INTO x;
 END IF;
 INSERT INTO public.setecfi_eventos_v54(expediente_id,etapa,accion,actor,detalle) VALUES(p_id,'setecfi',p_decision,p_actor,btrim(p_motivo));
 RETURN x;
END;
$fn$;
REVOKE ALL ON FUNCTION public.setecfi_direccion_decidir_v54(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.setecfi_resolver_v54(uuid,uuid,text,text,text,text[],date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.setecfi_direccion_decidir_v54(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.setecfi_resolver_v54(uuid,uuid,text,text,text[],date) TO service_role;

-- Alta de expediente desde Jaguar. Transaccion unica con auditoria.
CREATE OR REPLACE FUNCTION public.setecfi_solicitar_v54(
 p_actor uuid,p_tipo text,p_nombre text,p_correo text,p_docente bigint,p_persona uuid,
 p_ciclo text,p_motivo text,p_materias text[],p_inicio date,p_fin date)
RETURNS public.setecfi_expedientes_v54 LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $fn$
DECLARE x public.setecfi_expedientes_v54; v_role text;
BEGIN
 SELECT p.rol INTO v_role FROM public.perfiles p WHERE p.id=p_actor AND p.activo IS TRUE;
 IF v_role NOT IN ('servicios_docentes','coordinacion_academica','control_escolar','direccion_escolar','docente') OR v_role IS NULL THEN RAISE EXCEPTION 'Rol no autorizado'; END IF;
 IF p_tipo NOT IN ('alta_docente','baja_docente','permiso_docente','reingreso_docente','suplencia_docente','alta_direccion','baja_direccion','permiso_direccion')
 OR p_ciclo !~ '^[0-9]{4}-[0-9]{4}(/[1-9])?$' OR length(btrim(coalesce(p_nombre,''))) NOT BETWEEN 5 AND 160
 OR length(btrim(coalesce(p_motivo,''))) NOT BETWEEN 15 AND 2000 OR (p_fin IS NOT NULL AND p_inicio IS NOT NULL AND p_fin<p_inicio) THEN RAISE EXCEPTION 'Solicitud incompleta'; END IF;
 IF v_role='docente' AND (p_tipo<>'permiso_docente' OR NOT EXISTS(SELECT 1 FROM public.docentes WHERE id=p_docente AND auth_user_id=p_actor)) THEN RAISE EXCEPTION 'Docente solo puede solicitar permiso propio'; END IF;
 IF p_tipo IN ('alta_direccion','baja_direccion','permiso_direccion') AND v_role NOT IN ('servicios_docentes','control_escolar','coordinacion_academica') THEN RAISE EXCEPTION 'La solicitud de Direccion debe ser preparada por un departamento independiente'; END IF;
 IF p_tipo='alta_docente' AND (p_docente IS NOT NULL OR length(btrim(coalesce(p_correo,'')))<5) THEN RAISE EXCEPTION 'Alta debe identificar correo nuevo y sin ficha'; END IF;
 IF p_tipo NOT IN ('alta_docente','alta_direccion') AND p_docente IS NULL AND p_persona IS NULL THEN RAISE EXCEPTION 'Identifica a la persona existente'; END IF;
 IF p_tipo IN ('alta_docente','reingreso_docente') AND coalesce(array_length(p_materias,1),0)=0 THEN RAISE EXCEPTION 'Anota las materias propuestas'; END IF;
 IF EXISTS(SELECT 1 FROM public.setecfi_expedientes_v54 WHERE tipo=p_tipo AND ciclo=p_ciclo AND estado_direccion<>'rechazado' AND estado_setecfi NOT IN ('rechazado','revocado') AND aplicado_en IS NULL AND ((p_docente IS NOT NULL AND docente_id=p_docente) OR (p_persona IS NOT NULL AND persona_auth_id=p_persona) OR (p_docente IS NULL AND p_persona IS NULL AND lower(persona_correo)=lower(p_correo))) ) THEN RAISE EXCEPTION 'Existe una solicitud abierta para esa persona y movimiento'; END IF;
 INSERT INTO public.setecfi_expedientes_v54(tipo,persona_nombre,persona_correo,docente_id,persona_auth_id,ciclo,motivo,materias_propuestas,fecha_inicio,fecha_fin,solicitado_por)
 VALUES(p_tipo,btrim(p_nombre),nullif(lower(btrim(coalesce(p_correo,''))),''),p_docente,p_persona,p_ciclo,btrim(p_motivo),coalesce(p_materias,'{}'),p_inicio,p_fin,p_actor) RETURNING * INTO x;
 INSERT INTO public.setecfi_eventos_v54(expediente_id,etapa,accion,actor,detalle) VALUES(x.id,'solicitud','registrada',p_actor,x.motivo);
 RETURN x;
END;
$fn$;
REVOKE ALL ON FUNCTION public.setecfi_solicitar_v54(uuid,text,text,text,bigint,uuid,text,text,text[],date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.setecfi_solicitar_v54(uuid,text,text,text,bigint,uuid,text,text,text[],date,date) TO service_role;

COMMIT;
