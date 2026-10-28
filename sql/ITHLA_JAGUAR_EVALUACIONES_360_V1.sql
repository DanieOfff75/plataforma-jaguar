-- Ventanas de captura: se instalan CERRADAS por defecto. Respalda la DB y prueba en Preview.
create table if not exists public.jaguar_evaluacion_ventanas(
 periodo_id bigint primary key references public.periodos_escolares(id) on delete restrict,
 habilitada boolean not null default false,
 actualizado_por uuid,
 actualizado_at timestamptz not null default now()
);
alter table public.jaguar_evaluacion_ventanas enable row level security;
revoke all on public.jaguar_evaluacion_ventanas from public,anon,authenticated;

create table if not exists public.jaguar_evaluacion_ventanas_auditoria(
 id bigint generated always as identity primary key,
 periodo_id bigint not null,
 habilitada boolean not null,
 actor uuid not null,
 fecha timestamptz not null default now()
);
alter table public.jaguar_evaluacion_ventanas_auditoria enable row level security;
revoke all on public.jaguar_evaluacion_ventanas_auditoria from public,anon,authenticated;

create or replace function public.jaguar_abrir_cerrar_evaluacion(p_periodo_id bigint,p_habilitada boolean,p_actor uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
   raise exception 'Operación restringida al servicio autorizado.' using errcode='42501';
 end if;
 if not exists (select 1 from public.periodos_escolares where id=p_periodo_id and (activo=true or p_habilitada=false)) then
   raise exception 'Periodo no válido o inactivo.' using errcode='23514';
 end if;
 insert into public.jaguar_evaluacion_ventanas(periodo_id,habilitada,actualizado_por,actualizado_at)
 values (p_periodo_id,p_habilitada,p_actor,now())
 on conflict(periodo_id) do update set habilitada=excluded.habilitada,actualizado_por=excluded.actualizado_por,actualizado_at=now();
 insert into public.jaguar_evaluacion_ventanas_auditoria(periodo_id,habilitada,actor)values(p_periodo_id,p_habilitada,p_actor);
end;$$;
revoke all on function public.jaguar_abrir_cerrar_evaluacion(bigint,boolean,uuid) from public,anon,authenticated;
grant execute on function public.jaguar_abrir_cerrar_evaluacion(bigint,boolean,uuid) to service_role;

create or replace function public.jaguar_evaluacion_abierta(p_periodo_id bigint)
returns boolean language sql stable security definer set search_path=public as $$
 select exists (select 1 from public.jaguar_evaluacion_ventanas v join public.periodos_escolares p on p.id=v.periodo_id
 where v.periodo_id=p_periodo_id and v.habilitada and p.activo is distinct from false)
$$;
revoke all on function public.jaguar_evaluacion_abierta(bigint) from public,anon,authenticated;
grant execute on function public.jaguar_evaluacion_abierta(bigint) to service_role;

-- Se valida también en la BD: no basta con deshabilitar botones del navegador.
create or replace function public.jaguar_bloquear_escritura_calificacion()
returns trigger language plpgsql security definer set search_path=public as $$
declare pid bigint; r_id bigint;
begin
 if TG_TABLE_NAME='evaluacion_notas' then
   r_id := case when TG_OP='DELETE' then OLD.rubrica_id else NEW.rubrica_id end;
   select periodo_id into pid from public.rubricas_evaluacion where id=r_id;
 else
   pid:=case when TG_OP='DELETE' then OLD.periodo_id else NEW.periodo_id end;
 end if;
 if pid is null or not public.jaguar_evaluacion_abierta(pid) then
   raise exception 'Dirección Escolar no ha habilitado la captura de calificaciones de este periodo.' using errcode='23514';
 end if;
 if TG_OP='DELETE' then return OLD; end if;
 return NEW;
end;$$;

do $$ begin
 if to_regclass('public.evaluacion_notas') is not null then
  drop trigger if exists jaguar_control_notas_periodo on public.evaluacion_notas;
  create trigger jaguar_control_notas_periodo before insert or update or delete on public.evaluacion_notas
  for each row execute function public.jaguar_bloquear_escritura_calificacion();
 end if;
 if to_regclass('public.calificaciones') is not null then
  drop trigger if exists jaguar_control_calificaciones_periodo on public.calificaciones;
  create trigger jaguar_control_calificaciones_periodo before insert or update or delete on public.calificaciones
  for each row execute function public.jaguar_bloquear_escritura_calificacion();
 end if;
 if to_regclass('public.cierres_evaluacion') is not null then
  drop trigger if exists jaguar_control_cierres_periodo on public.cierres_evaluacion;
  create trigger jaguar_control_cierres_periodo before insert or update or delete on public.cierres_evaluacion
  for each row execute function public.jaguar_bloquear_escritura_calificacion();
 end if;
end $$;
