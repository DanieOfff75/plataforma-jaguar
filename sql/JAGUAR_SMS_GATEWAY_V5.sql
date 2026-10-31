-- Jaguar SMS Gateway · migración aislada V5. No toca V2/V4 ni recuperación por correo.
-- EJECUTAR primero en un proyecto de prueba; respaldo y aprobación técnica requeridos.
create extension if not exists pgcrypto;

create table if not exists public.jaguar_sms_v5_devices (
 id uuid primary key default gen_random_uuid(),
 label text not null check(char_length(label) between 3 and 80),
 token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
 status text not null default 'pending' check(status in ('pending','active','paused','revoked')),
 max_per_hour integer not null default 25 check(max_per_hour between 1 and 100),
 manufacturer text, model text, android_version text, carrier text,
 battery_percent integer check(battery_percent between 0 and 100),
 signal_level integer check(signal_level between 0 and 4),
 last_seen_at timestamptz, created_at timestamptz not null default now(),
 revoked_at timestamptz
);

create table if not exists public.jaguar_sms_v5_pairings (
 id uuid primary key default gen_random_uuid(),
 code_hash text not null unique check(code_hash ~ '^[0-9a-f]{64}$'),
 label text not null check(char_length(label) between 3 and 80),
 created_by uuid not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+ interval '3 minutes'),
 redeemed_at timestamptz,
 device_id uuid references public.jaguar_sms_v5_devices(id)
);
create index if not exists jaguar_sms_v5_pairings_creator_idx on public.jaguar_sms_v5_pairings(created_by,created_at desc);

create table if not exists public.jaguar_sms_v5_jobs (
 id uuid primary key default gen_random_uuid(),
 idem_key text not null unique check(char_length(idem_key) between 12 and 128),
 kind text not null check(kind in ('test','otp','notice')),
 destination text not null check(destination ~ '^\+[1-9][0-9]{7,14}$'),
 message text check(message is null or char_length(message) between 1 and 450),
 status text not null default 'queued' check(status in ('queued','claimed','submitted','sent','delivered','failed','uncertain','expired')),
 device_id uuid references public.jaguar_sms_v5_devices(id),
 attempts integer not null default 0,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+ interval '5 minutes'),
 claimed_at timestamptz, finished_at timestamptz
);
create index if not exists jaguar_sms_v5_jobs_queue_idx on public.jaguar_sms_v5_jobs(status,created_at);
create index if not exists jaguar_sms_v5_jobs_device_idx on public.jaguar_sms_v5_jobs(device_id,claimed_at desc);
create table if not exists public.jaguar_sms_v5_events (
 id bigint generated always as identity primary key,
 job_id uuid references public.jaguar_sms_v5_jobs(id) on delete cascade,
 device_id uuid references public.jaguar_sms_v5_devices(id),
 event_type text not null,
 created_at timestamptz not null default now()
);
create index if not exists jaguar_sms_v5_events_recent on public.jaguar_sms_v5_events(created_at desc);

alter table public.jaguar_sms_v5_devices enable row level security;
alter table public.jaguar_sms_v5_pairings enable row level security;
alter table public.jaguar_sms_v5_jobs enable row level security;
alter table public.jaguar_sms_v5_events enable row level security;
revoke all on public.jaguar_sms_v5_devices, public.jaguar_sms_v5_pairings, public.jaguar_sms_v5_jobs, public.jaguar_sms_v5_events from anon,authenticated;
revoke all on sequence public.jaguar_sms_v5_events_id_seq from anon,authenticated;

-- Canje atómico: si dos Android escanean el mismo QR, solo uno obtiene credencial.
create or replace function public.jaguar_sms_v5_redeem(p_hash text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.jaguar_sms_v5_pairings%rowtype; d uuid;
begin
 if p_hash !~ '^[0-9a-f]{64}$' or p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;
 select * into p from public.jaguar_sms_v5_pairings where code_hash=p_hash and redeemed_at is null and expires_at>now() for update;
 if not found then return null; end if;
 insert into public.jaguar_sms_v5_devices(label,token_hash) values(p.label,p_token_hash) returning id into d;
 update public.jaguar_sms_v5_pairings set redeemed_at=now(),device_id=d where id=p.id;
 return jsonb_build_object('id',d,'label',p.label);
end $$;

-- Mantenimiento conservador: trabajos reclamados que pierden contacto quedan inciertos,
-- NUNCA se reasignan automáticamente. El texto SMS se borra al terminar/vencer.
create or replace function public.jaguar_sms_v5_maintain()
returns void language plpgsql security definer set search_path=public as $$
begin
 update public.jaguar_sms_v5_jobs set status='expired',message=null,finished_at=now()
 where status='queued' and expires_at<=now();
 update public.jaguar_sms_v5_jobs set status='uncertain',message=null,finished_at=now()
 where status in ('claimed','submitted') and claimed_at<now()-interval '3 minutes';
 update public.jaguar_sms_v5_jobs set message=null where message is not null and
 (status in ('sent','delivered','failed','uncertain','expired') or expires_at<now()-interval '3 minutes');
 delete from public.jaguar_sms_v5_pairings where expires_at<now()-interval '1 day';
 delete from public.jaguar_sms_v5_events where created_at<now()-interval '30 days';
end $$;

-- Un mismo smartphone no monopoliza la cola: 20s de ventana preferente para equipos
-- online con menos trabajos. Luego se prioriza entregar en vez de bloquear el SMS.
create or replace function public.jaguar_sms_v5_claim(p_device uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.jaguar_sms_v5_devices%rowtype; j public.jaguar_sms_v5_jobs%rowtype;
declare own_count integer; other_count integer;
begin
 perform public.jaguar_sms_v5_maintain();
 select * into d from public.jaguar_sms_v5_devices where id=p_device and status='active' for update;
 if not found or d.last_seen_at is null or d.last_seen_at<now()-interval '90 seconds' then return null; end if;
 if d.battery_percent is not null and d.battery_percent<10 then return null; end if;
 select count(*) into own_count from public.jaguar_sms_v5_jobs where device_id=p_device and claimed_at>=now()-interval '1 hour';
 if own_count>=d.max_per_hour then return null; end if;
 select * into j from public.jaguar_sms_v5_jobs where status='queued' and expires_at>now() order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 if j.created_at>now()-interval '20 seconds' then
   select min(t.claims) into other_count from (
     select (select count(*) from public.jaguar_sms_v5_jobs x where x.device_id=z.id and x.claimed_at>=now()-interval '1 hour') as claims, z.max_per_hour
     from public.jaguar_sms_v5_devices z where z.status='active' and z.id<>p_device and z.last_seen_at>now()-interval '75 seconds'
       and (z.battery_percent is null or z.battery_percent>=10)
   ) t where t.claims<t.max_per_hour;
   if other_count is not null and other_count < own_count then return null; end if;
 end if;
 update public.jaguar_sms_v5_jobs set status='claimed',device_id=p_device,claimed_at=now(),attempts=attempts+1 where id=j.id;
 insert into public.jaguar_sms_v5_events(job_id,device_id,event_type) values(j.id,p_device,'claimed');
 return jsonb_build_object('id',j.id,'to',j.destination,'message',j.message,'kind',j.kind);
end $$;

create or replace function public.jaguar_sms_v5_report(p_device uuid,p_job uuid,p_status text)
returns boolean language plpgsql security definer set search_path=public as $$
declare changed int;
begin
 if p_status not in ('submitted','sent','delivered','failed','uncertain') then return false; end if;
 update public.jaguar_sms_v5_jobs set status=p_status,
 message=case when p_status in ('submitted','sent','delivered','failed','uncertain') then null else message end,
 finished_at=case when p_status in ('delivered','failed','uncertain') then now() else finished_at end
 where id=p_job and device_id=p_device and (
   (status='claimed' and p_status in ('submitted','sent','failed','uncertain')) or
   (status='submitted' and p_status in ('sent','failed','uncertain')) or
   (status='sent' and p_status in ('delivered','uncertain'))
 );
 get diagnostics changed=row_count;
 if changed=1 then insert into public.jaguar_sms_v5_events(job_id,device_id,event_type) values(p_job,p_device,p_status); end if;
 return changed=1;
end $$;

-- Ninguna función privilegiada es ejecutable por usuarios normales, ni por PUBLIC.
revoke all on function public.jaguar_sms_v5_redeem(text,text) from public,anon,authenticated;
revoke all on function public.jaguar_sms_v5_claim(uuid) from public,anon,authenticated;
revoke all on function public.jaguar_sms_v5_report(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.jaguar_sms_v5_maintain() from public,anon,authenticated;
grant execute on function public.jaguar_sms_v5_redeem(text,text) to service_role;
grant execute on function public.jaguar_sms_v5_claim(uuid) to service_role;
grant execute on function public.jaguar_sms_v5_report(uuid,uuid,text) to service_role;
grant execute on function public.jaguar_sms_v5_maintain() to service_role;
