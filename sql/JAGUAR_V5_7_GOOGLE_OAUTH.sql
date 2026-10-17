-- JAGUAR V5.7: conexión de Servicios Docentes con Google (OAuth).
-- Requiere previamente sql/JAGUAR_V5_6_CLASSROOM_FASE1.sql.
-- La aplicación almacena aquí tokens AES-256-GCM CIFRADOS con GOOGLE_TOKEN_KEY del servidor.
-- Nunca crear políticas de acceso para anon/authenticated ni publicar esta tabla.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jaguar_google_conexiones (
 clave text PRIMARY KEY CHECK(clave='servicios_docentes'),
 correo text NOT NULL,
 google_subject text NOT NULL,
 access_token_cifrado text NOT NULL,
 refresh_token_cifrado text NOT NULL,
 expires_at timestamptz NOT NULL,
 permisos text NOT NULL DEFAULT '',
 conectado_por uuid NOT NULL REFERENCES auth.users(id),
 actualizado_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.jaguar_google_conexiones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jaguar_google_conexiones FROM PUBLIC,anon,authenticated;
COMMIT;
