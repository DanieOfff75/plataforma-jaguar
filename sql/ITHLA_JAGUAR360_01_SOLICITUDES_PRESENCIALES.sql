-- Jaguar 360: trámites iniciados en línea, documentos privados ENTREGADOS PRESENCIALMENTE.
-- Aplicar primero en Supabase de prueba; respaldo y revisión de permisos obligatorios.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar360_solicitudes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 folio text NOT NULL UNIQUE DEFAULT ('J360-'||to_char(now(),'YYYY')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
 alumno_id bigint NOT NULL REFERENCES public.alumnos(id) ON DELETE RESTRICT,
 solicitante_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 tipo text NOT NULL CHECK (tipo IN ('constancia_estudios','boleta_certificada','historial_academico','aclaracion_documental','credencial_reposicion','consulta_taller','revision_pago','constancia_conducta')),
 departamento text NOT NULL CHECK (departamento IN ('control_escolar','archivo_escolar','servicios_estudiantiles','recursos_monetarios','prefectura')),
 asunto text NOT NULL CHECK (char_length(btrim(asunto)) BETWEEN 6 AND 140),
 detalle text NOT NULL DEFAULT '' CHECK (char_length(detalle) <= 1500),
 estado text NOT NULL DEFAULT 'recibida' CHECK (estado IN ('recibida','en_revision','requiere_aclaracion','lista_para_recoger','entregada','rechazada','cancelada')),
 comentario_publico text NOT NULL DEFAULT '' CHECK (char_length(comentario_publico)<=700),
 nota_interna text NOT NULL DEFAULT '' CHECK (char_length(nota_interna)<=1500),
 atendido_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 cerrado_at timestamptz
);
CREATE INDEX IF NOT EXISTS j360_sol_alumno ON public.jaguar360_solicitudes (alumno_id,created_at DESC);
CREATE INDEX IF NOT EXISTS j360_sol_departamento ON public.jaguar360_solicitudes (departamento,estado,created_at DESC);
CREATE TABLE IF NOT EXISTS public.jaguar360_solicitud_eventos (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 solicitud_id uuid NOT NULL REFERENCES public.jaguar360_solicitudes(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 estado_anterior text,
 estado_nuevo text NOT NULL,
 descripcion text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS j360_eventos_sol ON public.jaguar360_solicitud_eventos (solicitud_id,created_at);
ALTER TABLE public.jaguar360_solicitudes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar360_solicitud_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar360_solicitudes,public.jaguar360_solicitud_eventos FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.jaguar360_solicitudes,public.jaguar360_solicitud_eventos TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.jaguar360_solicitud_eventos_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.jaguar360_crear_solicitud(p_actor uuid,p_tipo text,p_asunto text,p_detalle text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_rol text;v_alumno bigint;v_departamento text;v_r public.jaguar360_solicitudes%ROWTYPE;v_conteo integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Solo API institucional'; END IF;
 SELECT rol INTO v_rol FROM public.perfiles WHERE id=p_actor AND activo=true;
 IF v_rol IS DISTINCT FROM 'alumno' THEN RAISE EXCEPTION 'Se requiere sesión activa de alumno'; END IF;
 SELECT id INTO v_alumno FROM public.alumnos WHERE auth_user_id=p_actor AND activo=true;
 IF v_alumno IS NULL THEN RAISE EXCEPTION 'No existe vínculo seguro del alumno a su sesión'; END IF;
 v_departamento := CASE p_tipo
  WHEN 'constancia_estudios' THEN 'control_escolar'
  WHEN 'boleta_certificada' THEN 'control_escolar'
  WHEN 'historial_academico' THEN 'archivo_escolar'
  WHEN 'aclaracion_documental' THEN 'archivo_escolar'
  WHEN 'credencial_reposicion' THEN 'servicios_estudiantiles'
  WHEN 'consulta_taller' THEN 'servicios_estudiantiles'
  WHEN 'revision_pago' THEN 'recursos_monetarios'
  WHEN 'constancia_conducta' THEN 'prefectura'
  ELSE NULL END;
 IF v_departamento IS NULL THEN RAISE EXCEPTION 'Tipo de trámite no permitido'; END IF;
 IF char_length(btrim(coalesce(p_asunto,''))) NOT BETWEEN 6 AND 140 OR char_length(coalesce(p_detalle,''))>1500
 THEN RAISE EXCEPTION 'Asunto o descripción fuera del límite permitido'; END IF;
 -- Bloqueo serializado por solicitante para evitar spam concurrente.
 PERFORM 1 FROM public.alumnos WHERE id=v_alumno FOR UPDATE;
 SELECT count(*) INTO v_conteo FROM public.jaguar360_solicitudes
  WHERE alumno_id=v_alumno AND estado NOT IN ('entregada','rechazada','cancelada');
 IF v_conteo>=10 THEN RAISE EXCEPTION 'Tienes diez solicitudes en curso. Contacta al departamento para continuar'; END IF;
 INSERT INTO public.jaguar360_solicitudes(alumno_id,solicitante_id,tipo,departamento,asunto,detalle)
 VALUES(v_alumno,p_actor,p_tipo,v_departamento,btrim(p_asunto),btrim(coalesce(p_detalle,''))) RETURNING * INTO v_r;
 INSERT INTO public.jaguar360_solicitud_eventos(solicitud_id,actor_id,estado_nuevo,descripcion)
 VALUES(v_r.id,p_actor,'recibida','Solicitud recibida por Jaguar; documento privado solo presencial');
 RETURN jsonb_build_object('id',v_r.id,'folio',v_r.folio,'estado',v_r.estado,'departamento',v_r.departamento);
END;$fn$;

CREATE OR REPLACE FUNCTION public.jaguar360_cambiar_estado(p_actor uuid,p_id uuid,p_estado text,p_comentario text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_rol text;v_sol public.jaguar360_solicitudes%ROWTYPE;v_siguiente text;v_coment text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Solo API institucional'; END IF;
 SELECT rol INTO v_rol FROM public.perfiles WHERE id=p_actor AND activo=true;
 IF v_rol IS NULL THEN RAISE EXCEPTION 'Perfil inválido'; END IF;
 SELECT * INTO v_sol FROM public.jaguar360_solicitudes WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud inexistente'; END IF;
 v_coment:=btrim(coalesce(p_comentario,''));
 IF char_length(v_coment)>700 THEN RAISE EXCEPTION 'Comentario demasiado extenso'; END IF;
 IF v_rol='alumno' THEN
  IF v_sol.solicitante_id<>p_actor OR p_estado<>'cancelada' OR v_sol.estado NOT IN ('recibida','requiere_aclaracion')
  THEN RAISE EXCEPTION 'No autorizado para cancelar esta solicitud'; END IF;
 ELSE
  -- Dirección puede supervisar solicitudes, pero la decisión sigue en el área responsable.
  IF NOT (v_rol=v_sol.departamento OR (v_rol='control' AND v_sol.departamento='control_escolar'))
  THEN RAISE EXCEPTION 'La solicitud corresponde a otro departamento'; END IF;
  IF p_estado='en_revision' AND v_sol.estado IN ('recibida','requiere_aclaracion') THEN NULL;
  ELSIF p_estado='requiere_aclaracion' AND v_sol.estado IN ('recibida','en_revision') THEN
   IF char_length(v_coment)<10 THEN RAISE EXCEPTION 'Explica qué aclaración necesitas'; END IF;
  ELSIF p_estado='lista_para_recoger' AND v_sol.estado='en_revision' THEN
   IF char_length(v_coment)<10 THEN RAISE EXCEPTION 'Indica dónde y cuándo recogerlo, sin adjuntar documento'; END IF;
  ELSIF p_estado='entregada' AND v_sol.estado='lista_para_recoger' THEN
   IF char_length(v_coment)<10 THEN RAISE EXCEPTION 'Registra una constancia breve de la entrega presencial'; END IF;
  ELSIF p_estado='rechazada' AND v_sol.estado IN ('recibida','en_revision','requiere_aclaracion') THEN
   IF char_length(v_coment)<10 THEN RAISE EXCEPTION 'Explica el rechazo'; END IF;
  ELSE RAISE EXCEPTION 'Transición de estado no permitida'; END IF;
 END IF;
 v_siguiente:=p_estado;
 UPDATE public.jaguar360_solicitudes SET estado=v_siguiente, comentario_publico=v_coment,
  atendido_por=CASE WHEN v_rol='alumno' THEN atendido_por ELSE p_actor END,
  updated_at=now(),cerrado_at=CASE WHEN v_siguiente IN ('entregada','rechazada','cancelada') THEN now() ELSE NULL END
 WHERE id=v_sol.id;
 INSERT INTO public.jaguar360_solicitud_eventos(solicitud_id,actor_id,estado_anterior,estado_nuevo,descripcion)
 VALUES(v_sol.id,p_actor,v_sol.estado,v_siguiente,v_coment);
 RETURN jsonb_build_object('folio',v_sol.folio,'estado',v_siguiente);
END;$fn$;
REVOKE ALL ON FUNCTION public.jaguar360_crear_solicitud(uuid,text,text,text),public.jaguar360_cambiar_estado(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jaguar360_crear_solicitud(uuid,text,text,text),public.jaguar360_cambiar_estado(uuid,uuid,text,text) TO service_role;
COMMIT;
