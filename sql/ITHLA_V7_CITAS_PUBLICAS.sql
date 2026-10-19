-- ITHLA Portal Público V7 · Citas: activar manualmente solo después de revisar la política de datos.
-- El sistema NO crea horarios ficticios; Dirección/área autorizada publica horarios explícitamente.
create extension if not exists pgcrypto;
create table if not exists public.ithla_cita_horarios (
 id uuid primary key default gen_random_uuid(), departamento text not null check(length(departamento) between 3 and 90),
 inicio timestamptz not null, fin timestamptz not null, capacidad integer not null default 1 check(capacidad between 1 and 20),
 reservadas integer not null default 0 check(reservadas>=0), estado text not null default 'borrador' check(estado in ('borrador','publicado','cancelado')),
 creado_en timestamptz not null default now(), check(fin>inicio), check(reservadas<=capacidad)
);
create index if not exists ix_ithla_horarios_publicados on public.ithla_cita_horarios(estado,inicio);
create table if not exists public.ithla_cita_solicitudes (
 id uuid primary key default gen_random_uuid(), slot_id uuid not null references public.ithla_cita_horarios(id),
 referencia text not null unique, nombre text not null check(length(nombre) between 3 and 110),
 correo text not null check(length(correo) between 5 and 160),
 motivo text not null check(length(motivo) between 10 and 300),
 cliente_hash text not null check(length(cliente_hash)=64), consentimiento boolean not null check(consentimiento),
 estado text not null default 'confirmada' check(estado in ('confirmada','cancelada','atendida')),
 creado_en timestamptz not null default now()
);
create index if not exists ix_ithla_citas_hash on public.ithla_cita_solicitudes(cliente_hash,creado_en);
create index if not exists ix_ithla_citas_slot on public.ithla_cita_solicitudes(slot_id,estado);
-- Nunca acceso público directo a nombres, correos, horas o reservas.
alter table public.ithla_cita_horarios enable row level security;
alter table public.ithla_cita_solicitudes enable row level security;
revoke all on public.ithla_cita_horarios from anon,authenticated;
revoke all on public.ithla_cita_solicitudes from anon,authenticated;

create or replace function public.ithla_reservar_cita_publica(
 p_slot_id uuid,p_referencia text,p_nombre text,p_correo text,p_motivo text,p_cliente_hash text,p_consentimiento boolean
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_slot public.ithla_cita_horarios%rowtype;v_count integer;
begin
 if p_consentimiento is distinct from true or length(coalesce(p_nombre,'')) not between 3 and 110
    or length(coalesce(p_correo,'')) not between 5 and 160 or length(coalesce(p_motivo,'')) not between 10 and 300
    or length(coalesce(p_cliente_hash,''))<>64 or length(coalesce(p_referencia,'')) not between 10 and 24
    or p_correo !~* '^[^[:space:]@]+@[^[:space:]@]+\.[a-zA-Z]{2,}$' then return false;end if;
 -- Serializa solicitudes del mismo origen contra el límite diario.
 perform pg_advisory_xact_lock(9741007); -- Límite global serializado, protección antiabuso.
 select count(*) into v_count from public.ithla_cita_solicitudes where creado_en>now()-interval '1 hour';
 if v_count>=40 then return false;end if;
 perform pg_advisory_xact_lock(hashtext(p_cliente_hash));
 select count(*) into v_count from public.ithla_cita_solicitudes
 where cliente_hash=p_cliente_hash and creado_en>now()-interval '24 hours';
 if v_count>=3 then return false;end if;
 select * into v_slot from public.ithla_cita_horarios where id=p_slot_id for update;
 if not found or v_slot.estado<>'publicado' or v_slot.inicio<now()+interval '30 minutes'
  or v_slot.reservadas>=v_slot.capacidad then return false;end if;
 -- Evita duplicaciones accidentales de un mismo correo en el mismo horario.
 if exists(select 1 from public.ithla_cita_solicitudes where slot_id=p_slot_id
   and lower(correo)=lower(p_correo) and estado='confirmada') then return false; end if;
 update public.ithla_cita_horarios set reservadas=reservadas+1 where id=p_slot_id;
 insert into public.ithla_cita_solicitudes(slot_id,referencia,nombre,correo,motivo,cliente_hash,consentimiento)
 values(p_slot_id,p_referencia,p_nombre,lower(p_correo),p_motivo,p_cliente_hash,true);
 return true;
end;$$;
revoke all on function public.ithla_reservar_cita_publica(uuid,text,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.ithla_reservar_cita_publica(uuid,text,text,text,text,text,boolean) to service_role;
-- OPERACIÓN INSTITUCIONAL:
-- Publicar horario SOLO si existe atención real: INSERT INTO public.ithla_cita_horarios(departamento,inicio,fin,capacidad,estado)
-- VALUES ('Control Escolar','2026-11-05T10:00:00-06:00','2026-11-05T10:30:00-06:00',1,'publicado');
-- La instrucción anterior es un EJEMPLO, NO ejecutar sin validar fecha, personal y disponibilidad.
-- Protección de datos: elaborar aviso de privacidad y un procedimiento de eliminación periódica para registros vencidos.
