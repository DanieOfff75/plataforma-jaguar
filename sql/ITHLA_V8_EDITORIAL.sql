-- V8: instalar antes de desplegar Jaguar público. No publica contenido existente por defecto.
create extension if not exists pgcrypto;
alter table public.avisos add column if not exists destino_publicacion text not null default 'plataforma';
alter table public.avisos drop constraint if exists avisos_destino_publicacion_check;
alter table public.avisos add constraint avisos_destino_publicacion_check check (destino_publicacion in ('plataforma','publica','ambas'));
create index if not exists ix_avisos_destino_publicacion on public.avisos(destino_publicacion,fecha_publicacion desc);
create table if not exists public.ithla_public_directory_optin(
 departamento_clave text primary key,
 visible boolean not null default false,
 aprobado_por uuid,
 actualizado_en timestamptz not null default now()
);
create table if not exists public.ithla_eventos_publicos(
 id uuid primary key default gen_random_uuid(),
 titulo text not null check(char_length(titulo) between 5 and 180),
 descripcion text not null default '',
 fecha_inicio timestamptz not null,
 fecha_fin timestamptz,
 estado text not null default 'borrador' check(estado in ('borrador','publicado','archivado')),
 publicado_por uuid,
 creado_en timestamptz not null default now(),
 check(fecha_fin is null or fecha_fin>=fecha_inicio)
);
create index if not exists ix_public_eventos_fecha on public.ithla_eventos_publicos(estado,fecha_inicio);
alter table public.ithla_public_directory_optin enable row level security;
alter table public.ithla_eventos_publicos enable row level security;
revoke all on public.ithla_public_directory_optin from anon,authenticated;
revoke all on public.ithla_eventos_publicos from anon,authenticated;
-- Citas requieren también sql/ITHLA_V7_CITAS_PUBLICAS.sql
