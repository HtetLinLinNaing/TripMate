-- Apply to an isolated/new Supabase project. Anonymous Auth users have the authenticated role.
create schema if not exists tripmate_private;
revoke all on schema tripmate_private from public;

create table public.trips (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 100),
 organiser_id uuid not null references auth.users(id), starts_on date not null, ends_on date not null,
 notes text not null default '' check(length(notes)<=2000), status text not null default 'draft' check(status in ('draft','active','completed')),
 currency text not null default 'THB' check(currency='THB'), cash_holder_id uuid references auth.users(id),
 created_at timestamptz not null default now(), check(ends_on>=starts_on)
);
create table public.memberships (
 trip_id uuid not null references public.trips(id), user_id uuid not null references auth.users(id),
 display_name text not null check(length(trim(display_name)) between 1 and 60),
 role text not null check(role in ('organiser','member')), joined_at timestamptz not null default now(),
 primary key(trip_id,user_id)
);
create table public.invitations (
 trip_id uuid primary key references public.trips(id), token text unique not null,
 status text not null default 'active' check(status in ('active','revoked')), expires_at timestamptz
);
create table public.contributions (
 id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.trips(id),
 contributor_id uuid not null, recorder_id uuid not null references auth.users(id),
 amount numeric(12,2) not null check(amount>0), note text not null default '' check(length(note)<=500),
 operation_id uuid not null, created_at timestamptz not null default now(),
 foreign key(trip_id,contributor_id) references public.memberships(trip_id,user_id), unique(recorder_id,operation_id)
);
create table public.expenses (
 id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.trips(id),
 payer_id uuid not null, recorder_id uuid not null references auth.users(id),
 description text not null check(length(trim(description)) between 1 and 200),
 payment_source text not null check(payment_source in ('personal','shared_pool')),
 amount numeric(12,2) not null check(amount>0), operation_id uuid not null,
 request_body jsonb not null, created_at timestamptz not null default now(),
 foreign key(trip_id,payer_id) references public.memberships(trip_id,user_id), unique(recorder_id,operation_id), unique(id,trip_id)
);
create table public.allocations (
 id uuid primary key default gen_random_uuid(), expense_id uuid not null, trip_id uuid not null,
 member_id uuid not null, amount numeric(12,2) not null check(amount>0), part_label text not null,
 is_extra boolean not null, foreign key(expense_id,trip_id) references public.expenses(id,trip_id),
 foreign key(trip_id,member_id) references public.memberships(trip_id,user_id)
);
create index on public.memberships(user_id);
create index on public.expenses(trip_id,created_at);
create index on public.contributions(trip_id,created_at);
create index on public.allocations(trip_id);

create function tripmate_private.member(t uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships where trip_id=t and user_id=auth.uid());
$$;
-- No direct inserts/updates/deletes: only the narrowly scoped command functions below may write.
alter table public.trips enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.contributions enable row level security;
alter table public.expenses enable row level security;
alter table public.allocations enable row level security;
create policy trip_read on public.trips for select to authenticated using(tripmate_private.member(id));
create policy member_read on public.memberships for select to authenticated using(tripmate_private.member(trip_id));
create policy contribution_read on public.contributions for select to authenticated using(tripmate_private.member(trip_id));
create policy expense_read on public.expenses for select to authenticated using(tripmate_private.member(trip_id));
create policy allocation_read on public.allocations for select to authenticated using(tripmate_private.member(trip_id));
grant usage on schema tripmate_private to authenticated;
grant execute on function tripmate_private.member(uuid) to authenticated;
revoke all on public.trips,public.memberships,public.invitations,public.contributions,public.expenses,public.allocations from anon,authenticated;
grant select on public.trips,public.memberships,public.contributions,public.expenses,public.allocations to authenticated;

create function public.create_trip(p jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare t uuid;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if length(trim(coalesce(p->>'displayName',''))) not between 1 and 60 then raise exception 'Enter your display name'; end if;
 if (select count(*) from public.trips where organiser_id=auth.uid() and created_at>now()-interval '1 hour')>=10 then raise exception 'Too many trips. Try again later.'; end if;
 insert into public.trips(name,organiser_id,starts_on,ends_on,notes) values(trim(p->>'name'),auth.uid(),(p->>'startsOn')::date,(p->>'endsOn')::date,coalesce(p->>'notes','')) returning id into t;
 insert into public.memberships values(t,auth.uid(),trim(p->>'displayName'),'organiser',now());
 insert into public.invitations(trip_id,token) values(t,replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''));
 return t;
end $$;

create function public.invitation_context(p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invitations; t public.trips;
begin
 if auth.uid() is null or length(p_token)<>64 then return null; end if;
 select * into i from public.invitations where token=p_token;
 if not found then return null; end if;
 select * into t from public.trips where id=i.trip_id;
 if tripmate_private.member(t.id) then return jsonb_build_object('id',t.id,'name',t.name,'existing',true); end if;
 if i.status<>'active' or i.expires_at<=now() then return null; end if;
 return jsonb_build_object('name',t.name,'starts_on',t.starts_on,'ends_on',t.ends_on,'existing',false);
end $$;

create function public.join_trip(p_token text,p_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare i public.invitations;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select * into i from public.invitations where token=p_token for update;
 if not found then raise exception 'This invitation is no longer valid. Ask the organiser for a new link.'; end if;
 if tripmate_private.member(i.trip_id) then return i.trip_id; end if;
 if i.status<>'active' or i.expires_at<=now() then raise exception 'This invitation is no longer valid. Ask the organiser for a new link.'; end if;
 if length(trim(coalesce(p_name,''))) not between 1 and 60 then raise exception 'Enter your display name'; end if;
 insert into public.memberships values(i.trip_id,auth.uid(),trim(p_name),'member',now()) on conflict do nothing;
 return i.trip_id;
end $$;

create function public.configure_trip(p_trip uuid,p_holder uuid,p_start boolean) returns void language plpgsql security definer set search_path='' as $$
declare t public.trips;
begin
 select * into t from public.trips where id=p_trip for update;
 if t.organiser_id is distinct from auth.uid() or auth.uid() is null then raise exception 'Only the organiser can configure this trip'; end if;
 if not exists(select 1 from public.memberships where trip_id=p_trip and user_id=p_holder) then raise exception 'Choose a current member'; end if;
 if p_start and (select count(*) from public.memberships where trip_id=p_trip)<2 then raise exception 'Invite one more person to start'; end if;
 update public.trips set cash_holder_id=p_holder,status=case when p_start then 'active' else status end where id=p_trip;
end $$;

create function public.complete_trip(p_trip uuid) returns void language plpgsql security definer set search_path='' as $$
declare t public.trips;
begin
 select * into t from public.trips where id=p_trip for update;
 if t.organiser_id is distinct from auth.uid() or auth.uid() is null then raise exception 'Only the organiser can end this trip'; end if;
 if t.status<>'active' then raise exception 'Only active trips can be completed'; end if;
 update public.trips set status='completed' where id=p_trip;
end $$;

create function public.trip_snapshot(p_trip uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not tripmate_private.member(p_trip) then raise exception 'You do not have access to this trip'; end if;
 select jsonb_build_object('trip',to_jsonb(t),'members',(select coalesce(jsonb_agg(m order by joined_at,user_id),'[]') from public.memberships m where trip_id=p_trip),
 'contributions',(select coalesce(jsonb_agg(c order by created_at desc),'[]') from public.contributions c where trip_id=p_trip),
 'expenses',(select coalesce(jsonb_agg(to_jsonb(e)-'request_body' order by created_at desc),'[]') from public.expenses e where trip_id=p_trip),
 'allocations',(select coalesce(jsonb_agg(a),'[]') from public.allocations a where trip_id=p_trip),
 'invitation',case when t.organiser_id=auth.uid() then (select token from public.invitations where trip_id=p_trip and status='active') else null end) into result from public.trips t where id=p_trip;
 return result;
end $$;

create function public.save_contribution(p_trip uuid,p_member uuid,p_cents bigint,p_note text,p_operation uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare t public.trips; prior public.contributions; entry uuid;
begin
 select * into t from public.trips where id=p_trip for update;
 if not tripmate_private.member(p_trip) then raise exception 'You do not have access to this trip'; end if;
 if t.status='completed' then raise exception 'This is a completed trip; no new ledger entries can be recorded'; end if;
 if t.status<>'active' then raise exception 'Start the trip before recording funds'; end if;
 if p_cents is null or p_cents<=0 or p_cents>999999999999 then raise exception 'Enter a positive THB amount'; end if;
 select * into prior from public.contributions where recorder_id=auth.uid() and operation_id=p_operation;
 if found then
   if prior.trip_id<>p_trip or prior.contributor_id<>p_member or prior.amount<>p_cents/100.0 or prior.note is distinct from p_note then raise exception 'Operation already used with different data'; end if;
   return prior.id;
 end if;
 insert into public.contributions(trip_id,contributor_id,recorder_id,amount,note,operation_id) values(p_trip,p_member,auth.uid(),p_cents/100.0,p_note,p_operation) returning id into entry;
 return entry;
end $$;

create function public.save_expense(p_trip uuid,p jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare t public.trips; prior public.expenses; entry uuid; total bigint; part jsonb; parts jsonb; ids uuid[]; member uuid;
 n integer; ordinal integer; part_cents bigint; allocated bigint:=0; balance numeric; share bigint; label text;
begin
 select * into t from public.trips where id=p_trip for update;
 if not tripmate_private.member(p_trip) then raise exception 'You do not have access to this trip'; end if;
 if t.status='completed' then raise exception 'This is a completed trip; no new ledger entries can be recorded'; end if;
 if t.status<>'active' then raise exception 'Start the trip before recording expenses'; end if;
 select * into prior from public.expenses where recorder_id=auth.uid() and operation_id=(p->>'operation')::uuid;
 if found then
   if prior.trip_id<>p_trip or prior.request_body<>p then raise exception 'Operation already used with different data'; end if;
   return prior.id;
 end if;
 if jsonb_typeof(p->'cents')<>'number' or (p->>'cents')::numeric<>trunc((p->>'cents')::numeric) then raise exception 'Invalid amount'; end if;
 total:=(p->>'cents')::bigint;
 if total is null or total<=0 or total>999999999999 then raise exception 'Enter a positive THB amount'; end if;
 if p->>'mode' not in ('everyone','selected','mixed') or p->>'mode' is null then raise exception 'Choose a split method'; end if;
 if p->>'source'='shared_pool' then
  select coalesce((select sum(amount) from public.contributions where trip_id=p_trip),0)-coalesce((select sum(amount) from public.expenses where trip_id=p_trip and payment_source='shared_pool'),0) into balance;
  if balance*100<total and ((p->>'confirmedBalance')::numeric is distinct from balance*100) then raise exception 'POOL_CONFIRM:%',balance*100; end if;
 end if;
 if p->>'mode'='everyone' then
   select jsonb_build_array(jsonb_build_object('label','Everyone','cents',total,'members',jsonb_agg(user_id order by user_id))) into parts from public.memberships where trip_id=p_trip;
 elsif p->>'mode'='selected' then parts:=jsonb_build_array(jsonb_build_object('label','Selected people','cents',total,'members',p->'members'));
 else parts:=p->'parts'; end if;
 if parts is null or jsonb_typeof(parts)<>'array' or jsonb_array_length(parts) not between 1 and 50 then raise exception 'Add valid expense parts'; end if;
 insert into public.expenses(trip_id,payer_id,recorder_id,description,payment_source,amount,operation_id,request_body)
 values(p_trip,(p->>'payer')::uuid,auth.uid(),trim(p->>'description'),p->>'source',total/100.0,(p->>'operation')::uuid,p) returning id into entry;
 for part in select value from jsonb_array_elements(parts) loop
  if jsonb_typeof(part->'cents')<>'number' or (part->>'cents')::numeric<>trunc((part->>'cents')::numeric) then raise exception 'Invalid part amount'; end if;
  part_cents:=(part->>'cents')::bigint; label:=trim(part->>'label');
  if part_cents is null or part_cents<=0 or part_cents>total or coalesce(length(label),0) not between 1 and 100 then raise exception 'Invalid expense part'; end if;
  if jsonb_typeof(part->'members') is distinct from 'array' then raise exception 'Choose members'; end if;
  select array_agg(value::uuid order by value::uuid) into ids from jsonb_array_elements_text(part->'members');
  n:=coalesce(array_length(ids,1),0);
  if n=0 or n<>(select count(distinct x) from unnest(ids) x) or part_cents<n then raise exception 'Each share must be positive; choose distinct members'; end if;
  ordinal:=0;
  foreach member in array ids loop
   if not exists(select 1 from public.memberships where trip_id=p_trip and user_id=member) then raise exception 'Choose current trip members'; end if;
   share:=part_cents/n+case when ordinal<part_cents%n then 1 else 0 end;
   insert into public.allocations(expense_id,trip_id,member_id,amount,part_label,is_extra) values(entry,p_trip,member,share/100.0,label,n=1);
   ordinal:=ordinal+1;
  end loop;
  allocated:=allocated+part_cents;
 end loop;
 if allocated<>total then raise exception 'Expense parts must equal the total'; end if;
 return entry;
end $$;

revoke execute on function public.create_trip(jsonb),public.invitation_context(text),public.join_trip(text,text),public.configure_trip(uuid,uuid,boolean),public.complete_trip(uuid),public.trip_snapshot(uuid),public.save_contribution(uuid,uuid,bigint,text,uuid),public.save_expense(uuid,jsonb) from public,anon;
grant execute on function public.create_trip(jsonb),public.invitation_context(text),public.join_trip(text,text),public.configure_trip(uuid,uuid,boolean),public.complete_trip(uuid),public.trip_snapshot(uuid),public.save_contribution(uuid,uuid,bigint,text,uuid),public.save_expense(uuid,jsonb) to authenticated;

-- Realtime SELECT uses the same membership policies. Private rows never enter public broadcasts.
alter publication supabase_realtime add table public.trips,public.memberships,public.contributions,public.expenses;
