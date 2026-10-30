-- Jaguar Shield V1. Ejecutar una sola vez en SQL Editor después del respaldo.
-- Ningún cambio activa SMS, modifica correos o abre periodos.
ALTER TABLE public.perfiles ADD COLUMN IF NOT EXISTS shield_correo_verificado_at timestamptz;
CREATE TABLE IF NOT EXISTS public.jaguar_shield_desafios (
 id uuid PRIMARY KEY,
 usuario_id uuid NOT NULL,
 sesion_id uuid NOT NULL,
 proposito text NOT NULL CHECK (proposito IN ('enroll','change_old','change_new','eval_open','eval_close')),
 contexto text NOT NULL,
 destino text NOT NULL,
 canal text NOT NULL DEFAULT 'email' CHECK (canal IN ('email')),
 codigo_hash text NOT NULL,
 prueba_hash text,
 intentos smallint NOT NULL DEFAULT 0,
 verificado_at timestamptz,
 usado_at timestamptz,
 creado_at timestamptz NOT NULL DEFAULT now(),
 vence_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes')
);
CREATE INDEX IF NOT EXISTS jaguar_shield_desafios_usuario_idx ON public.jaguar_shield_desafios(usuario_id,creado_at DESC);
ALTER TABLE public.jaguar_shield_desafios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar_shield_desafios FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.jaguar_shield_desafios TO service_role;
-- Evitar que una carga masiva / error humano reinicie el estado verificado al editar otro campo.
CREATE OR REPLACE FUNCTION public.jaguar_shield_emitir(
 p_id uuid,p_actor uuid,p_sesion uuid,p_proposito text,p_contexto text,p_destino text,p_codigo_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(p_actor::text));
 DELETE FROM public.jaguar_shield_desafios WHERE creado_at<now()-interval '30 days';
 IF (SELECT count(*) FROM public.jaguar_shield_desafios WHERE usuario_id=p_actor AND creado_at>now()-interval '1 minute')>=2
 OR (SELECT count(*) FROM public.jaguar_shield_desafios WHERE usuario_id=p_actor AND creado_at>now()-interval '1 hour')>=10 THEN
  RETURN false;
 END IF;
 INSERT INTO public.jaguar_shield_desafios(id,usuario_id,sesion_id,proposito,contexto,destino,codigo_hash)
 VALUES(p_id,p_actor,p_sesion,p_proposito,p_contexto,p_destino,p_codigo_hash);
 RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.jaguar_shield_verificar(
 p_id uuid,p_actor uuid,p_sesion uuid,p_codigo_hash text,p_prueba_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.jaguar_shield_desafios%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.jaguar_shield_desafios WHERE id=p_id AND usuario_id=p_actor AND sesion_id=p_sesion FOR UPDATE;
 IF NOT FOUND OR r.usado_at IS NOT NULL OR r.verificado_at IS NOT NULL OR r.vence_at<=now() OR r.intentos>=5 THEN RETURN false; END IF;
 IF r.codigo_hash<>p_codigo_hash THEN
  UPDATE public.jaguar_shield_desafios SET intentos=intentos+1 WHERE id=p_id;
  RETURN false;
 END IF;
 UPDATE public.jaguar_shield_desafios SET verificado_at=now(),prueba_hash=p_prueba_hash,vence_at=LEAST(vence_at,now()+interval '3 minutes') WHERE id=p_id;
 RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.jaguar_shield_consumir(
 p_actor uuid,p_sesion uuid,p_proposito text,p_contexto text,p_prueba_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid;
BEGIN
 UPDATE public.jaguar_shield_desafios SET usado_at=now()
 WHERE id=(SELECT id FROM public.jaguar_shield_desafios WHERE usuario_id=p_actor AND sesion_id=p_sesion
   AND proposito=p_proposito AND contexto=p_contexto AND prueba_hash=p_prueba_hash
   AND verificado_at IS NOT NULL AND usado_at IS NULL AND vence_at>now()
   ORDER BY verificado_at DESC LIMIT 1 FOR UPDATE)
 RETURNING id INTO v_id;
 RETURN v_id IS NOT NULL;
END $$;
CREATE OR REPLACE FUNCTION public.jaguar_shield_confirmar_correo(p_actor uuid,p_sesion uuid,p_prueba_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(p_actor::text));
 SELECT d.id INTO v_id FROM public.jaguar_shield_desafios d JOIN public.perfiles p ON p.id=d.usuario_id
 WHERE d.usuario_id=p_actor AND d.sesion_id=p_sesion AND d.proposito='enroll'
  AND d.contexto=lower(trim(p.correo_recuperacion)) AND d.prueba_hash=p_prueba_hash
  AND d.verificado_at IS NOT NULL AND d.usado_at IS NULL AND d.vence_at>now()
 ORDER BY d.verificado_at DESC LIMIT 1 FOR UPDATE OF d;
 IF v_id IS NULL THEN RETURN false; END IF;
 UPDATE public.perfiles SET shield_correo_verificado_at=now() WHERE id=p_actor;
 UPDATE public.jaguar_shield_desafios SET usado_at=now() WHERE id=v_id;
 RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.jaguar_shield_cambiar_correo(
 p_actor uuid,p_sesion uuid,p_anterior text,p_nuevo text,p_prueba_anterior text,p_prueba_nueva text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE old_id uuid; new_id uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(p_actor::text));
 IF NOT EXISTS (SELECT 1 FROM public.perfiles WHERE id=p_actor AND lower(trim(correo_recuperacion))=p_anterior
  AND shield_correo_verificado_at IS NOT NULL) THEN RETURN false; END IF;
 SELECT id INTO old_id FROM public.jaguar_shield_desafios WHERE usuario_id=p_actor AND sesion_id=p_sesion
  AND proposito='change_old' AND contexto=p_nuevo AND destino=p_anterior AND prueba_hash=p_prueba_anterior
  AND verificado_at IS NOT NULL AND usado_at IS NULL AND vence_at>now() ORDER BY verificado_at DESC LIMIT 1 FOR UPDATE;
 SELECT id INTO new_id FROM public.jaguar_shield_desafios WHERE usuario_id=p_actor AND sesion_id=p_sesion
  AND proposito='change_new' AND contexto=p_nuevo AND destino=p_nuevo AND prueba_hash=p_prueba_nueva
  AND verificado_at IS NOT NULL AND usado_at IS NULL AND vence_at>now() ORDER BY verificado_at DESC LIMIT 1 FOR UPDATE;
 IF old_id IS NULL OR new_id IS NULL THEN RETURN false; END IF;
 UPDATE public.perfiles SET correo_recuperacion=p_nuevo,correo_auth=p_nuevo,shield_correo_verificado_at=now() WHERE id=p_actor;
 UPDATE public.jaguar_shield_desafios SET usado_at=now() WHERE id IN (old_id,new_id);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.jaguar_shield_emitir(uuid,uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.jaguar_shield_verificar(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.jaguar_shield_consumir(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.jaguar_shield_confirmar_correo(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.jaguar_shield_cambiar_correo(uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
-- No se concede acceso directo desde navegadores. Solo el servidor usa la service role.
GRANT EXECUTE ON FUNCTION public.jaguar_shield_emitir(uuid,uuid,uuid,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.jaguar_shield_verificar(uuid,uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.jaguar_shield_consumir(uuid,uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.jaguar_shield_confirmar_correo(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.jaguar_shield_cambiar_correo(uuid,uuid,text,text,text,text) TO service_role;
-- Protección contra escrituras directas del navegador si una política RLS futura
-- permite actualizar perfiles: solo el servidor privilegiado modifica estos campos.
CREATE OR REPLACE FUNCTION public.jaguar_shield_proteger_perfil()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF current_user NOT IN ('service_role','postgres','supabase_admin') AND
    (NEW.correo_recuperacion IS DISTINCT FROM OLD.correo_recuperacion OR
     NEW.correo_auth IS DISTINCT FROM OLD.correo_auth OR
     NEW.shield_correo_verificado_at IS DISTINCT FROM OLD.shield_correo_verificado_at) THEN
   RAISE EXCEPTION 'Los datos de recuperación se modifican exclusivamente mediante Jaguar Shield' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS jaguar_shield_proteger_perfil_trg ON public.perfiles;
CREATE TRIGGER jaguar_shield_proteger_perfil_trg BEFORE UPDATE ON public.perfiles
FOR EACH ROW EXECUTE FUNCTION public.jaguar_shield_proteger_perfil();
