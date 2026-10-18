-- NEXO AI 1.0: cuota atómica para una cuenta Groq Free.
-- Ejecutar una vez en el SQL Editor del proyecto Supabase de Jaguar.
-- No habilita ninguna consulta a datos escolares privados.
create table if not exists public.ithla_nexo_ai_quotas (
  bucket text not null,
  actor_hash text not null,
  period_key text not null,
  used integer not null default 0 check (used >= 0),
  primary key (bucket, actor_hash, period_key)
);
alter table public.ithla_nexo_ai_quotas enable row level security;
revoke all on table public.ithla_nexo_ai_quotas from public, anon, authenticated;

create or replace function public.ithla_nexo_ai_take_quota(p_client_hash text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  k_day text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD');
  k_minute text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD HH24:MI');
  n integer;
begin
  if p_client_hash !~ '^[0-9a-f]{64}$' then return false; end if;
  -- Consistencia entre instancias concurrentes de Vercel.
  perform pg_advisory_xact_lock(184291, 90601);

  -- Límite institucional global: 80 solicitudes IA/día y 12/min.
  select used into n from public.ithla_nexo_ai_quotas where bucket='global-day' and actor_hash='shared' and period_key=k_day;
  if coalesce(n,0)>=80 then return false; end if;
  select used into n from public.ithla_nexo_ai_quotas where bucket='global-minute' and actor_hash='shared' and period_key=k_minute;
  if coalesce(n,0)>=12 then return false; end if;
  -- Límite individual: 10 consultas diarias y 3 por minuto.
  select used into n from public.ithla_nexo_ai_quotas where bucket='client-day' and actor_hash=p_client_hash and period_key=k_day;
  if coalesce(n,0)>=10 then return false; end if;
  select used into n from public.ithla_nexo_ai_quotas where bucket='client-minute' and actor_hash=p_client_hash and period_key=k_minute;
  if coalesce(n,0)>=3 then return false; end if;

  insert into public.ithla_nexo_ai_quotas(bucket,actor_hash,period_key,used)
  values('global-day','shared',k_day,1),('global-minute','shared',k_minute,1),
        ('client-day',p_client_hash,k_day,1),('client-minute',p_client_hash,k_minute,1)
  on conflict(bucket,actor_hash,period_key) do update set used=public.ithla_nexo_ai_quotas.used+1;
  return true;
end;
$$;
revoke all on function public.ithla_nexo_ai_take_quota(text) from public, anon, authenticated;
grant execute on function public.ithla_nexo_ai_take_quota(text) to service_role;
-- Limpieza manual ocasional (no es obligatoria para el funcionamiento):
-- delete from public.ithla_nexo_ai_quotas where period_key < to_char((now() at time zone 'UTC') - interval '7 days','YYYY-MM-DD');
