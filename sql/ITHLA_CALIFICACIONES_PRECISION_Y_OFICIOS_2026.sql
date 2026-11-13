-- JAGUAR: aplica en Supabase SQL Editor antes de desplegar los cambios.
-- Sólo añade política académica, registro de oficios y transacción de notificaciones.
-- NO modifica tablas ni calificaciones existentes.
create table if not exists public.jaguar_precision_calificaciones (
  ciclo_escolar text primary key check (ciclo_escolar ~ '^\d{4}-\d{4}$'),
  permite_decimales boolean not null default false,
  version integer not null default 0 check (version >= 0),
  actualizado_por uuid,
  actualizado_at timestamptz not null default now()
);
create table if not exists public.jaguar_oficios_precision_calificaciones (
  id bigint generated always as identity primary key,
  ciclo_escolar text not null,
  version integer not null,
  antes_permite_decimales boolean not null,
  ahora_permite_decimales boolean not null,
  motivo text not null check (length(btrim(motivo)) >= 15),
  actor_id uuid not null,
  actor_nombre text not null,
  creado_at timestamptz not null default now(),
  unique(ciclo_escolar,version)
);
-- Sin acceso directo del navegador: sólo APIs del servidor autenticadas.
alter table public.jaguar_precision_calificaciones enable row level security;
alter table public.jaguar_oficios_precision_calificaciones enable row level security;
revoke all on public.jaguar_precision_calificaciones from anon, authenticated;
revoke all on public.jaguar_oficios_precision_calificaciones from anon, authenticated;

-- Política + oficio + notificaciones a TODO el personal en una sola transacción.
create or replace function public.jaguar_cambiar_precision_calificaciones(
  p_ciclo text, p_permite_decimales boolean, p_motivo text,
  p_actor uuid, p_actor_nombre text, p_version_esperada integer
) returns bigint language plpgsql security definer set search_path=public as $$
declare v_actual public.jaguar_precision_calificaciones%rowtype;
        v_oficio bigint; v_version integer;
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
    raise exception 'Esta operación sólo puede ejecutarse desde el servidor de Jaguar.' using errcode='42501';
  end if;
  if p_ciclo is null or p_ciclo !~ '^\d{4}-\d{4}$' then raise exception 'Ciclo escolar inválido.'; end if;
  if p_motivo is null or length(btrim(p_motivo)) < 15 or length(p_motivo)>300 then
    raise exception 'El oficio requiere un motivo de 15 a 300 caracteres.';
  end if;
  if p_actor is null or nullif(btrim(p_actor_nombre),'') is null then raise exception 'Falta el responsable del cambio.'; end if;
  insert into public.jaguar_precision_calificaciones(ciclo_escolar) values(p_ciclo)
    on conflict(ciclo_escolar) do nothing;
  select * into strict v_actual from public.jaguar_precision_calificaciones
    where ciclo_escolar=p_ciclo for update;
  if v_actual.version <> p_version_esperada then
    raise exception 'La configuración cambió en otra sesión. Recarga antes de guardar.' using errcode='40001';
  end if;
  if v_actual.permite_decimales=p_permite_decimales then
    raise exception 'El criterio seleccionado ya está vigente.';
  end if;
  v_version:=v_actual.version+1;
  update public.jaguar_precision_calificaciones set permite_decimales=p_permite_decimales,
    version=v_version,actualizado_por=p_actor,actualizado_at=now()
    where ciclo_escolar=p_ciclo;
  insert into public.jaguar_oficios_precision_calificaciones
    (ciclo_escolar,version,antes_permite_decimales,ahora_permite_decimales,motivo,actor_id,actor_nombre)
    values(p_ciclo,v_version,v_actual.permite_decimales,p_permite_decimales,btrim(p_motivo),p_actor,btrim(p_actor_nombre))
    returning id into v_oficio;
  insert into public.notificaciones(usuario_id,titulo,contenido,tipo,solicitud_id,leida)
  select p.id,
    'Oficio institucional ITHLA-PC-'||v_oficio||' · Criterio de calificaciones',
    'Ciclo '||p_ciclo||'. Se cambió el criterio de calificaciones a '||
      case when p_permite_decimales then 'CON UN DECIMAL' else 'SIN DECIMALES' end||
      '. Motivo: '||left(btrim(p_motivo),500)||'. Consulta y descarga el oficio ITHLA-PC-'||v_oficio||'.',
    'oficio_precision_calificaciones',null,false
  from public.perfiles p where p.activo=true
    and p.rol not in ('alumno','aspirante','padre','tutor');
  return v_oficio;
end $$;
revoke all on function public.jaguar_cambiar_precision_calificaciones(text,boolean,text,uuid,text,integer) from public, anon, authenticated;
grant execute on function public.jaguar_cambiar_precision_calificaciones(text,boolean,text,uuid,text,integer) to service_role;

-- Guardián central: protege también otros caminos existentes que escriben a calificaciones,
-- incluidos lotes aceptados. No toca notas históricas al activar la migración.
create or replace function public.jaguar_normalizar_calificacion_oficial()
returns trigger language plpgsql set search_path=public as $$
declare v_ciclo text; v_decimal boolean; v_n numeric;
begin
  if new.calificacion is null then return new; end if;
  if tg_op='UPDATE' and new.calificacion is not distinct from old.calificacion then
    return new; -- cambios en observaciones/firmas no recalculan notas históricas
  end if;
  v_n := new.calificacion::numeric;
  if v_n < 0 or v_n > 10 then raise exception 'La calificación oficial está fuera de 0 a 10.'; end if;
  select ciclo_escolar into v_ciclo from public.periodos_escolares where id=new.periodo_id;
  if v_ciclo is null then raise exception 'Periodo escolar inexistente para esta calificación.'; end if;
  select permite_decimales into v_decimal from public.jaguar_precision_calificaciones where ciclo_escolar=v_ciclo;
  new.calificacion := round(v_n,case when coalesce(v_decimal,false) then 1 else 0 end);
  return new;
end $$;
drop trigger if exists trg_jaguar_normalizar_calificacion_oficial on public.calificaciones;
create trigger trg_jaguar_normalizar_calificacion_oficial
before insert or update of calificacion on public.calificaciones
for each row execute function public.jaguar_normalizar_calificacion_oficial();
