-- EJECUTAR en el editor SQL de Supabase. Solo accesible por service_role.
create extension if not exists pgcrypto;
create table if not exists public.jaguar_sms_jobs (
 id uuid primary key default gen_random_uuid(), destination text not null check(destination ~ '^\+[1-9][0-9]{9,14}$'),
 message text not null check(length(message) between 1 and 450),
 status text not null default 'queued' check(status in ('queued','claimed','submitted','failed')),
 created_at timestamptz not null default now(), claimed_at timestamptz, finished_at timestamptz,
 expires_at timestamptz not null default (now()+interval '5 minutes')
);
create index if not exists jaguar_sms_jobs_queue_idx on public.jaguar_sms_jobs(status,created_at);
alter table public.jaguar_sms_jobs enable row level security;
revoke all on public.jaguar_sms_jobs from anon,authenticated;
create or replace function public.jaguar_sms_claim() returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.jaguar_sms_jobs%rowtype;
begin
 select * into j from public.jaguar_sms_jobs where status='queued' and expires_at>now() order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 update public.jaguar_sms_jobs set status='claimed',claimed_at=now() where id=j.id;
 return jsonb_build_object('id',j.id,'to',j.destination,'message',j.message);
end $$;
create or replace function public.jaguar_sms_report(p_id uuid,p_status text) returns boolean language plpgsql security definer set search_path=public as $$
declare affected int;
begin
 if p_status not in ('submitted','failed') then return false; end if;
 update public.jaguar_sms_jobs set status=p_status,finished_at=now() where id=p_id and status='claimed' and claimed_at>now()-interval '2 minutes';
 get diagnostics affected=row_count; return affected=1;
end $$;
revoke all on function public.jaguar_sms_claim() from public,anon,authenticated;
revoke all on function public.jaguar_sms_report(uuid,text) from public,anon,authenticated;
grant execute on function public.jaguar_sms_claim() to service_role;
grant execute on function public.jaguar_sms_report(uuid,text) to service_role;
-- PRUEBA CONTROLADA: reemplazar número con uno propio y autorizado, ejecutar UNA SOLA VEZ.
-- insert into public.jaguar_sms_jobs(destination,message) values ('+5255XXXXXXXX','Prueba autorizada de Notificaciones Jaguar.');
