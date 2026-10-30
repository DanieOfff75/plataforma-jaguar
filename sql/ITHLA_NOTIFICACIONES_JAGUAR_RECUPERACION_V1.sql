-- Notificaciones Jaguar | recuperación de contraseña por correo con códigos OTP.
-- Solo requiere la migración previa de perfiles y de sesiones ITHLA; no modifica contraseñas.
CREATE TABLE IF NOT EXISTS public.jaguar_recuperacion_intentos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_hash text NOT NULL,
  actor_hash text NOT NULL,
  creado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jaguar_rec_intentos_ip ON public.jaguar_recuperacion_intentos(ip_hash, creado_at DESC);
CREATE INDEX IF NOT EXISTS jaguar_rec_intentos_actor ON public.jaguar_recuperacion_intentos(actor_hash, creado_at DESC);
CREATE TABLE IF NOT EXISTS public.jaguar_recuperacion_codigos (
  id uuid PRIMARY KEY,
  usuario_id uuid NOT NULL,
  codigo_hash text NOT NULL,
  prueba_hash text,
  intentos integer NOT NULL DEFAULT 0 CHECK (intentos BETWEEN 0 AND 5),
  creado_at timestamptz NOT NULL DEFAULT now(),
  vence_at timestamptz NOT NULL DEFAULT (now()+interval '5 minutes'),
  verificado_at timestamptz,
  consumido_at timestamptz
);
CREATE INDEX IF NOT EXISTS jaguar_rec_codigos_usuario ON public.jaguar_recuperacion_codigos(usuario_id, creado_at DESC);
ALTER TABLE public.jaguar_recuperacion_intentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jaguar_recuperacion_codigos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar_recuperacion_intentos, public.jaguar_recuperacion_codigos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.jaguar_recuperacion_intentos, public.jaguar_recuperacion_codigos TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.jaguar_recuperacion_intentos_id_seq TO service_role;

-- Registra intentos incluso cuando el usuario no exista, para mitigar enumeración.
CREATE OR REPLACE FUNCTION public.jaguar_recuperacion_emitir(
  p_id uuid, p_actor uuid, p_ip_hash text, p_actor_hash text, p_codigo_hash text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_ip_hash));
  PERFORM pg_advisory_xact_lock(hashtext(p_actor_hash));
  DELETE FROM public.jaguar_recuperacion_intentos WHERE creado_at < now()-interval '7 days';
  DELETE FROM public.jaguar_recuperacion_codigos WHERE creado_at < now()-interval '7 days';
  IF (SELECT count(*) FROM public.jaguar_recuperacion_intentos WHERE ip_hash=p_ip_hash AND creado_at>now()-interval '15 minutes') >= 6
    OR (SELECT count(*) FROM public.jaguar_recuperacion_intentos WHERE ip_hash=p_ip_hash AND creado_at>now()-interval '1 day') >= 24
    OR (SELECT count(*) FROM public.jaguar_recuperacion_intentos WHERE actor_hash=p_actor_hash AND creado_at>now()-interval '15 minutes') >= 3
    OR (SELECT count(*) FROM public.jaguar_recuperacion_intentos WHERE actor_hash=p_actor_hash AND creado_at>now()-interval '1 day') >= 8 THEN
      RETURN false;
  END IF;
  INSERT INTO public.jaguar_recuperacion_intentos(ip_hash,actor_hash) VALUES(p_ip_hash,p_actor_hash);
  IF p_actor IS NOT NULL THEN
    UPDATE public.jaguar_recuperacion_codigos SET consumido_at=now()
    WHERE usuario_id=p_actor AND consumido_at IS NULL;
    INSERT INTO public.jaguar_recuperacion_codigos(id,usuario_id,codigo_hash)
      VALUES (p_id,p_actor,p_codigo_hash);
  END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.jaguar_recuperacion_verificar(
  p_id uuid, p_codigo_hash text, p_prueba_hash text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.jaguar_recuperacion_codigos%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.jaguar_recuperacion_codigos WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR r.consumido_at IS NOT NULL OR r.verificado_at IS NOT NULL
    OR r.vence_at <= now() OR r.intentos>=5 THEN RETURN false; END IF;
  IF r.codigo_hash IS DISTINCT FROM p_codigo_hash THEN
    UPDATE public.jaguar_recuperacion_codigos SET intentos=intentos+1 WHERE id=p_id;
    RETURN false;
  END IF;
  UPDATE public.jaguar_recuperacion_codigos SET verificado_at=now(), prueba_hash=p_prueba_hash,
    vence_at=LEAST(vence_at,now()+interval '3 minutes') WHERE id=p_id;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.jaguar_recuperacion_consumir(
  p_id uuid, p_prueba_hash text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_user uuid;
BEGIN
  UPDATE public.jaguar_recuperacion_codigos r SET consumido_at=now()
  WHERE r.id=p_id AND r.prueba_hash=p_prueba_hash AND r.verificado_at IS NOT NULL
    AND r.consumido_at IS NULL AND r.vence_at>now()
    AND EXISTS (SELECT 1 FROM public.perfiles p WHERE p.id=r.usuario_id AND p.activo=true AND p.shield_correo_verificado_at IS NOT NULL)
  RETURNING r.usuario_id INTO v_user;
  RETURN v_user;
END $$;

REVOKE ALL ON FUNCTION public.jaguar_recuperacion_emitir(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.jaguar_recuperacion_verificar(uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.jaguar_recuperacion_consumir(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jaguar_recuperacion_emitir(uuid,uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.jaguar_recuperacion_verificar(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.jaguar_recuperacion_consumir(uuid,text) TO service_role;
