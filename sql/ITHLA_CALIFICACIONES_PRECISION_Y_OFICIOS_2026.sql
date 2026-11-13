-- JAGUAR · Política académica integral (PRECISIÓN + MÍNIMA APROBATORIA + PISO)
-- Este archivo SUSTITUYE al SQL de los ZIP anteriores: aplicar UNA SOLA VEZ.
-- No actualiza calificaciones históricas ni reabre cierres.
create table if not exists public.jaguar_precision_calificaciones (
  ciclo_escolar text primary key check (ciclo_escolar ~ '^\d{4}-\d{4}$'),
  permite_decimales boolean not null default false,
  minima_aprobatoria integer not null default 6 check (minima_aprobatoria between 1 and 10),
  permitir_reprobatorias_inferiores boolean not null default true,
  version integer not null default 0 check (version >= 0),
  actualizado_por uuid,
  actualizado_at timestamptz not null default now()
);
-- Compatible con una instalación parcial anterior.
alter table public.jaguar_precision_calificaciones
  add column if not exists minima_aprobatoria integer not null default 6,
  add column if not exists permitir_reprobatorias_inferiores boolean not null default true;

create table if not exists public.jaguar_oficios_precision_calificaciones (
  id bigint generated always as identity primary key,
  ciclo_escolar text not null,
  version integer not null,
  antes_permite_decimales boolean not null,
  ahora_permite_decimales boolean not null,
  antes_minima_aprobatoria integer not null default 6,
  ahora_minima_aprobatoria integer not null default 6,
  antes_permitir_reprobatorias_inferiores boolean not null default true,
  ahora_permitir_reprobatorias_inferiores boolean not null default true,
  motivo text not null check (length(btrim(motivo)) >= 15),
  actor_id uuid not null,
  actor_nombre text not null,
  creado_at timestamptz not null default now(),
  unique(ciclo_escolar,version)
);
alter table public.jaguar_oficios_precision_calificaciones
  add column if not exists antes_minima_aprobatoria integer not null default 6,
  add column if not exists ahora_minima_aprobatoria integer not null default 6,
  add column if not exists antes_permitir_reprobatorias_inferiores boolean not null default true,
  add column if not exists ahora_permitir_reprobatorias_inferiores boolean not null default true;

alter table public.jaguar_precision_calificaciones enable row level security;
alter table public.jaguar_oficios_precision_calificaciones enable row level security;
revoke all on public.jaguar_precision_calificaciones from anon,authenticated;
revoke all on public.jaguar_oficios_precision_calificaciones from anon,authenticated;

-- Evita una sobrecarga ambigua si se ejecutó una versión preliminar del SQL.
drop function if exists public.jaguar_cambiar_precision_calificaciones(text,boolean,text,uuid,text,integer);
create or replace function public.jaguar_cambiar_precision_calificaciones(
  p_ciclo text,p_permite_decimales boolean,p_motivo text,
  p_actor uuid,p_actor_nombre text,p_version_esperada integer,
  p_minima_aprobatoria integer,p_permitir_reprobatorias_inferiores boolean
) returns bigint language plpgsql security definer set search_path=public as $$
declare v_actual public.jaguar_precision_calificaciones%rowtype;
        v_oficio bigint;v_version integer;v_cambios text;
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
    raise exception 'Solo el servidor autenticado de Jaguar puede modificar criterios.' using errcode='42501';
  end if;
  if p_ciclo is null or p_ciclo !~ '^\d{4}-\d{4}$' then raise exception 'Ciclo escolar inválido.'; end if;
  if p_minima_aprobatoria is null or p_minima_aprobatoria not between 1 and 10 then raise exception 'Mínima aprobatoria fuera del rango 1 a 10.'; end if;
  if p_permite_decimales is null or p_permitir_reprobatorias_inferiores is null then raise exception 'Faltan criterios académicos.'; end if;
  if p_motivo is null or length(btrim(p_motivo))<15 or length(p_motivo)>300 then
    raise exception 'El motivo institucional debe tener entre 15 y 300 caracteres.';
  end if;
  if p_actor is null or nullif(btrim(p_actor_nombre),'') is null then raise exception 'Falta el responsable del criterio.'; end if;
  insert into public.jaguar_precision_calificaciones(ciclo_escolar) values(p_ciclo)
    on conflict(ciclo_escolar) do nothing;
  select * into strict v_actual from public.jaguar_precision_calificaciones
    where ciclo_escolar=p_ciclo for update;
  if v_actual.version<>p_version_esperada then
    raise exception 'El criterio fue modificado en otra sesión. Recarga la configuración.' using errcode='40001';
  end if;
  if v_actual.permite_decimales=p_permite_decimales and
     v_actual.minima_aprobatoria=p_minima_aprobatoria and
     v_actual.permitir_reprobatorias_inferiores=p_permitir_reprobatorias_inferiores then
    raise exception 'Los criterios seleccionados ya están vigentes.';
  end if;
  v_version:=v_actual.version+1;
  update public.jaguar_precision_calificaciones
     set permite_decimales=p_permite_decimales,minima_aprobatoria=p_minima_aprobatoria,
         permitir_reprobatorias_inferiores=p_permitir_reprobatorias_inferiores,
         version=v_version,actualizado_por=p_actor,actualizado_at=now()
     where ciclo_escolar=p_ciclo;
  insert into public.jaguar_oficios_precision_calificaciones
    (ciclo_escolar,version,antes_permite_decimales,ahora_permite_decimales,
     antes_minima_aprobatoria,ahora_minima_aprobatoria,
     antes_permitir_reprobatorias_inferiores,ahora_permitir_reprobatorias_inferiores,
     motivo,actor_id,actor_nombre)
  values(p_ciclo,v_version,v_actual.permite_decimales,p_permite_decimales,
     v_actual.minima_aprobatoria,p_minima_aprobatoria,
     v_actual.permitir_reprobatorias_inferiores,p_permitir_reprobatorias_inferiores,
     btrim(p_motivo),p_actor,btrim(p_actor_nombre))
  returning id into v_oficio;
  v_cambios:='Calificaciones: '||case when p_permite_decimales then 'un decimal' else 'enteros' end||
    '; mínima aprobatoria '||p_minima_aprobatoria::text||
    '; notas inferiores '||case when p_permitir_reprobatorias_inferiores then 'permitidas' else 'con piso '||(p_minima_aprobatoria-1)::text end;
  insert into public.notificaciones(usuario_id,titulo,contenido,tipo,solicitud_id,leida)
  select p.id,'Oficio institucional ITHLA-PC-'||v_oficio||' · Criterios de calificaciones',
    'Ciclo '||p_ciclo||'. '||v_cambios||'. Motivo: '||btrim(p_motivo)||
      '. Consulta el oficio ITHLA-PC-'||v_oficio||'.',
    'oficio_precision_calificaciones',null,false
    from public.perfiles p where p.activo=true and p.rol not in ('alumno','aspirante','padre','tutor');
  return v_oficio;
end $$;
revoke all on function public.jaguar_cambiar_precision_calificaciones(text,boolean,text,uuid,text,integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.jaguar_cambiar_precision_calificaciones(text,boolean,text,uuid,text,integer,integer,boolean) to service_role;

-- Guardián transversal: bloquea el redondeo aprobatorio incluso fuera de rúbrica.
-- No toca expedientes anteriores. No redondea aspectos de Excel ni actividades.
create or replace function public.jaguar_normalizar_calificacion_oficial()
returns trigger language plpgsql set search_path=public as $$
declare v_ciclo text;v_decimal boolean;v_minima integer;v_permitir boolean;
        v_original numeric;v_final numeric;v_max_reprobatorio numeric;
        v_prefijo constant text:='REPROBADO. ';v_obs text;
begin
  if new.calificacion is null then return new; end if;
  if tg_op='UPDATE' and new.calificacion is not distinct from old.calificacion then
    return new; -- no reescribir historia por una edición de observaciones
  end if;
  v_original:=new.calificacion::numeric;
  if v_original<0 or v_original>10 then raise exception 'La calificación oficial está fuera de 0 a 10.'; end if;
  select ciclo_escolar into v_ciclo from public.periodos_escolares where id=new.periodo_id;
  if v_ciclo is null then raise exception 'Periodo escolar inexistente para esta calificación.'; end if;
  select permite_decimales,minima_aprobatoria,permitir_reprobatorias_inferiores
  into v_decimal,v_minima,v_permitir from public.jaguar_precision_calificaciones where ciclo_escolar=v_ciclo;
  v_minima:=coalesce(v_minima,6);v_decimal:=coalesce(v_decimal,false);v_permitir:=coalesce(v_permitir,true);
  v_final:=round(v_original,case when v_decimal then 1 else 0 end);
  if v_original<v_minima then
    v_max_reprobatorio:=v_minima-case when v_decimal then 0.1 else 1 end;
    v_final:=least(v_final,v_max_reprobatorio);
    if not v_permitir then v_final:=greatest(v_final,v_minima-1); end if;
  end if;
  new.calificacion:=v_final;
  -- Observación institucional y observación docente permanecen separables.
  v_obs:=coalesce(new.observaciones,'');
  if left(upper(v_obs),length(v_prefijo))=v_prefijo then
    v_obs:=ltrim(substr(v_obs,length(v_prefijo)+1));
  end if;
  if v_original<v_minima then new.observaciones:=v_prefijo||v_obs;
  else new.observaciones:=v_obs; end if;
  return new;
end $$;
drop trigger if exists trg_jaguar_normalizar_calificacion_oficial on public.calificaciones;
create trigger trg_jaguar_normalizar_calificacion_oficial
before insert or update of calificacion on public.calificaciones
for each row execute function public.jaguar_normalizar_calificacion_oficial();
