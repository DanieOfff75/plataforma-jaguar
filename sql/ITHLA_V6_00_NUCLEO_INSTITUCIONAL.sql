-- Jaguar 6.0 / ITHLA - MIGRACION INCREMENTAL. Ejecutar una sola vez luego del diagnóstico.
-- Conservar respaldo. No elimina/renombra tablas antiguas ni usuarios.
-- No publicar datos académicos en estas tablas de configuración.
BEGIN;
CREATE TABLE IF NOT EXISTS public.ithla_config (
  clave text PRIMARY KEY CHECK (clave IN ('institucion','admisiones','portal','nexo','sesiones')),
  valor jsonb NOT NULL CHECK(jsonb_typeof(valor)='object'),
  revision integer NOT NULL DEFAULT 1,
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ithla_centro_operadores (
  usuario_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  rol text NOT NULL CHECK(rol='tecnico'),
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ithla_cambios (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clave text NOT NULL REFERENCES public.ithla_config(clave),
  propuesto jsonb NOT NULL CHECK (jsonb_typeof(propuesto)='object'),
  motivo text NOT NULL CHECK(length(trim(motivo)) BETWEEN 12 AND 1500),
  propuesto_por uuid NOT NULL REFERENCES auth.users(id),
  revision_origen integer NOT NULL DEFAULT 1,
  estado text NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','aprobado','rechazado')),
  resuelto_por uuid REFERENCES auth.users(id),
  resuelto_en timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ithla_auditoria (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  accion text NOT NULL,
  actor uuid,
  clave text,
  anterior jsonb,
  posterior jsonb,
  cambio_id bigint,
  registrado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ithla_sesiones (
  id uuid PRIMARY KEY,
  usuario_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  aplicacion text NOT NULL CHECK(aplicacion IN ('jaguar','admisiones','centro')),
  perfil text NOT NULL,
  ultimo_uso timestamptz NOT NULL DEFAULT now(),
  vence_absoluto timestamptz NOT NULL,
  revocada_en timestamptz,
  creada_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ithla_sesiones_usuario_idx ON public.ithla_sesiones(usuario_id,creada_en DESC);
CREATE TABLE IF NOT EXISTS public.ithla_inscripciones_pendientes (
  aspirante_id bigint PRIMARY KEY REFERENCES public.aspirantes(id) ON DELETE CASCADE,
  aceptado_en timestamptz NOT NULL DEFAULT now(),
  documentos_confirmados_en timestamptz,
  confirmado_por uuid,
  observaciones text,
  matriculado_en timestamptz
);

INSERT INTO public.ithla_config(clave,valor) VALUES
 ('institucion','{"nombre_institucion":"Instituto Tecnológico e Histórico Latinoamericano","siglas":"ITHLA","lema":"Scientia, Humanitas et Progressum","cct":"15USU0128X","dominio_institucional":"ithla.edu.mx","color_primary":"#1B365D","color_secondary":"#008080","color_accent":"#D4AF37","logo_url":"/assets/ithla-logo.png","url_admisiones":"https://registro-escolar-virid.vercel.app/"}'::jsonb),
 ('admisiones','{"estado":"cerrado","fecha_inicio":null,"fecha_fin":null,"mensaje":"La convocatoria de nuevo ingreso no está abierta. Consulta los avisos institucionales."}'::jsonb),
 ('portal','{"titulo":"Instituto Tecnológico e Histórico Latinoamericano","subtitulo":"Ciencia, Humanidad y Progreso","avisos":[],"eventos":[],"enlaces":[]}'::jsonb),
 ('nexo','{"activo":true,"preguntas":[],"mensaje_no_encontrado":"No encontré un procedimiento oficial que responda con seguridad. Consulta a Control Escolar para recibir orientación."}'::jsonb),
 ('sesiones','{"tecnico":{"inactividad":10,"absoluta":240},"direccion_escolar":{"inactividad":15,"absoluta":240},"control_escolar":{"inactividad":15,"absoluta":360},"administrativo":{"inactividad":15,"absoluta":360},"docente":{"inactividad":30,"absoluta":480},"alumno":{"inactividad":30,"absoluta":480},"aspirante":{"inactividad":20,"absoluta":120}}'::jsonb)
ON CONFLICT (clave) DO NOTHING;

-- Migrar configuración previa SIN BORRARLA y sólo durante primer seed.
-- Al existir ya una tabla anterior, replicar campos conocidos en la nueva configuración.
DO $ithla$
BEGIN
 IF to_regclass('public.institucion_config') IS NOT NULL THEN
   UPDATE public.ithla_config s
     SET valor=s.valor || (SELECT to_jsonb(i) - 'id' - 'updated_by' - 'updated_at' FROM public.institucion_config i WHERE i.id=1),
         revision=s.revision+1
     WHERE s.clave='institucion' AND s.revision=1
       AND EXISTS(SELECT 1 FROM public.institucion_config WHERE id=1);
 END IF;
END
$ithla$;

-- Los lectores públicos sólo acceden mediante endpoints con whitelist.
ALTER TABLE public.ithla_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ithla_centro_operadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ithla_cambios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ithla_auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ithla_sesiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ithla_inscripciones_pendientes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ithla_config, public.ithla_centro_operadores,public.ithla_cambios,public.ithla_auditoria,public.ithla_sesiones,public.ithla_inscripciones_pendientes FROM anon, authenticated;
-- No otorgar acceso directo a tablas a usuarios autenticados; APIs verifican privilegios.
COMMIT;
