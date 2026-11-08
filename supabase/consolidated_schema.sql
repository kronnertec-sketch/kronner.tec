-- Complete Kroner Schema for Supabase
create extension if not exists btree_gist with schema extensions;
create schema if not exists kroner_private;
revoke all on schema kroner_private from public;

create table if not exists kroner_private.app_users (
 id uuid primary key default gen_random_uuid(),
 legacy_email text unique,
 clerk_subject text unique,
 created_at timestamptz not null default now()
);
alter table kroner_private.app_users enable row level security;
revoke all on kroner_private.app_users from public,anon,authenticated;

create table if not exists kroner_private.shops(
 id uuid primary key default gen_random_uuid(),
 owner uuid not null references kroner_private.app_users(id),
 slug text unique not null default encode(extensions.gen_random_bytes(8),'hex'),
 name text not null default 'Minha barbearia',
 cfg jsonb not null default '{}',
 active boolean not null default false,
 created_at timestamptz default now(),
 unique(owner)
);

create table if not exists kroner_private.professionals (
 id uuid primary key default gen_random_uuid(),
 shop uuid not null references kroner_private.shops,
 user_id uuid references kroner_private.app_users,
 name text not null,
 role text not null check(role in ('owner','partner','employee')),
 status text not null check(status in ('active','invited','inactive')),
 finance boolean not null default false,
 email text,
 invite_hash text,
 expires timestamptz,
 preferences jsonb not null default '{}',
 service_rates jsonb not null default '{}',
 commission_bps int not null default 0,
 unique(id,shop)
);
create unique index if not exists one_active_team on kroner_private.professionals(user_id) where status='active';
create unique index if not exists one_invite on kroner_private.professionals(shop,email) where status='invited';
alter table kroner_private.professionals enable row level security;
revoke all on kroner_private.professionals from public,authenticated,anon;

create or replace function kroner_private.shop_owner_chair() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into kroner_private.professionals(shop,user_id,name,role,status)
 values(new.id,new.owner,coalesce(nullif(new.cfg->>'professional',''),new.name),'owner','active')
 on conflict do nothing;
 return new;
end;$$;
revoke all on function kroner_private.shop_owner_chair() from public,authenticated,anon;
drop trigger if exists shop_owner_chair on kroner_private.shops;
create trigger shop_owner_chair after insert on kroner_private.shops for each row execute function kroner_private.shop_owner_chair();

create table if not exists kroner_private.services(
 id uuid primary key default gen_random_uuid(),
 shop uuid not null references kroner_private.shops,
 name text not null,
 price integer not null check(price>=0),
 duration integer not null check(duration between 5 and 480),
 active boolean default true,
 unique(id,shop)
);

create table if not exists kroner_private.clients(
 id uuid primary key default gen_random_uuid(),
 shop uuid not null references kroner_private.shops,
 user_id uuid references kroner_private.app_users,
 name text not null,
 phone text not null,
 created_at timestamptz default now(),
 unique(shop,user_id),
 unique(id,shop)
);

create table if not exists kroner_private.memberships(
 id uuid primary key default gen_random_uuid(),
 shop uuid not null references kroner_private.shops,
 client uuid not null,
 service_ids uuid[] not null,
 weekday integer check(weekday between 0 and 6),
 at_time time not null,
 price integer check(price>=0),
 due_day integer check(due_day between 0 and 28),
 active boolean default true,
 professional uuid references kroner_private.professionals(id),
 foreign key(client,shop) references kroner_private.clients(id,shop)
);

create table if not exists kroner_private.appointments(
 id uuid primary key default gen_random_uuid(),
 shop uuid not null references kroner_private.shops,
 client uuid not null,
 starts timestamptz not null,
 ends timestamptz not null,
 services jsonb not null,
 price integer not null check(price>=0),
 status text not null default 'booked' check(status in('booked','done','cancelled','absent')),
 membership uuid references kroner_private.memberships,
 request_id uuid not null unique,
 professional uuid references kroner_private.professionals,
 created_by uuid references kroner_private.app_users,
 created_at timestamptz default now(),
 foreign key(client,shop) references kroner_private.clients(id,shop),
 check(ends>starts)
);

create or replace function kroner_private.default_appointment_professional() returns trigger language plpgsql set search_path='' as $$
begin
 if new.professional is null then select id into new.professional from kroner_private.professionals where shop=new.shop and role='owner'; end if;
 new.created_by:=kroner_private.current_user_id();
 return new;
end;$$;
drop trigger if exists default_appointment_professional on kroner_private.appointments;
create trigger default_appointment_professional before insert on kroner_private.appointments for each row execute function kroner_private.default_appointment_professional();
revoke all on function kroner_private.default_appointment_professional() from public,anon,authenticated;

create table if not exists kroner_private.blocks(
 id uuid primary key default gen_random_uuid(),
 shop uuid not null references kroner_private.shops,
 starts timestamptz not null,
 ends timestamptz not null,
 reason text not null,
 check(ends>starts)
);

create table if not exists kroner_private.charges(
 id uuid primary key default gen_random_uuid(),
 shop uuid not null references kroner_private.shops,
 client uuid,
 appointment uuid unique references kroner_private.appointments,
 membership uuid references kroner_private.memberships,
 month date,
 description text not null,
 amount integer not null check(amount>=0),
 direction text not null default 'in' check(direction in('in','out')),
 category text not null default 'service',
 due date not null,
 created_at timestamptz default now(),
 unique(membership,month),
 foreign key(client,shop) references kroner_private.clients(id,shop)
);

create table if not exists kroner_private.payments(
 id uuid primary key default gen_random_uuid(),
 shop uuid not null references kroner_private.shops,
 charge uuid not null references kroner_private.charges,
 amount integer not null check(amount>0),
 fee integer not null check(fee>=0 and fee<=amount),
 method text not null check(method in('pix','cash','credit','debit')),
 paid_on date not null,
 settles_on date not null,
 request_id uuid not null unique,
 created_at timestamptz default now()
);

create table if not exists kroner_private.products(
 id uuid primary key default gen_random_uuid(),
 shop uuid not null references kroner_private.shops,
 name text not null,
 cost integer not null check(cost>=0),
 price integer not null check(price>=0),
 quantity integer not null default 0 check(quantity>=0),
 minimum integer not null default 2 check(minimum>=0),
 expires date,
 unit text not null default 'unidade',
 active boolean not null default true,
 updated_at timestamptz default now()
);

create table if not exists kroner_private.movements(
 id uuid primary key default gen_random_uuid(),
 shop uuid not null references kroner_private.shops,
 product uuid not null references kroner_private.products,
 quantity integer not null,
 kind text not null,
 unit_cost integer not null,
 charge uuid references kroner_private.charges,
 note text,
 created_at timestamptz default now()
);

create table if not exists kroner_private.recurring(
 id uuid primary key default gen_random_uuid(),
 shop uuid not null references kroner_private.shops,
 name text not null,
 amount integer not null check(amount>=0),
 day integer not null check(day between 1 and 28),
 variable boolean default false,
 active boolean default true
);

create table if not exists kroner_private.recurring_runs(
 recurring uuid references kroner_private.recurring,
 month date,
 charge uuid references kroner_private.charges,
 primary key(recurring,month)
);

create table if not exists kroner_private.audit(
 id bigint generated always as identity primary key,
 shop uuid references kroner_private.shops,
 actor uuid,
 action text not null,
 record_id uuid,
 created_at timestamptz default now()
);

create table if not exists kroner_private.requests(
 id uuid primary key,
 actor uuid not null,
 action text not null,
 result jsonb,
 created_at timestamptz default now()
);

create table if not exists kroner_private.calendar_events (
 id uuid primary key default gen_random_uuid(),
 shop uuid not null references kroner_private.shops,
 day date not null,
 name text not null,
 scope text not null,
 source text not null,
 state text not null,
 city text not null,
 actor uuid not null,
 updated_at timestamptz not null default now(),
 unique(shop,day,scope,state,city)
);

create table if not exists kroner_private.sales (
 id uuid primary key,
 shop uuid not null references kroner_private.shops,
 actor uuid not null,
 professional uuid not null references kroner_private.professionals,
 appointment uuid references kroner_private.appointments,
 charge uuid not null references kroner_private.charges,
 items jsonb not null default '[]',
 service_total int not null default 0,
 product_total int not null default 0,
 discount int not null default 0,
 commission int not null default 0,
 rate int not null default 0,
 refunded int not null default 0,
 created_at timestamptz not null default now()
);

create table if not exists kroner_private.register_closings (
 shop uuid not null references kroner_private.shops,
 day date not null,
 actor uuid not null,
 opening int not null,
 counted int not null,
 expected int not null,
 totals jsonb not null default '{}',
 created_at timestamptz not null default now(),
 primary key(shop,day)
);

create table if not exists kroner_private.service_earnings (
 appointment uuid primary key references kroner_private.appointments,
 shop uuid not null references kroner_private.shops,
 professional uuid not null references kroner_private.professionals,
 basis int not null,
 amount int not null,
 rules jsonb not null,
 created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_clients_shop on kroner_private.clients(shop);
create index if not exists idx_clients_user on kroner_private.clients(user_id);
create index if not exists idx_services_shop on kroner_private.services(shop);
create index if not exists idx_appointments_shop_starts on kroner_private.appointments(shop,starts);
create index if not exists idx_appointments_client on kroner_private.appointments(client);
create index if not exists idx_charges_shop_due on kroner_private.charges(shop,due);
create index if not exists idx_payments_charge on kroner_private.payments(charge);
create index if not exists idx_payments_settles on kroner_private.payments(shop,settles_on);
create index if not exists idx_products_shop on kroner_private.products(shop);
create index if not exists idx_blocks_starts on kroner_private.blocks(shop,starts);
create index if not exists idx_memberships_shop on kroner_private.memberships(shop);
create index if not exists idx_movements_shop on kroner_private.movements(shop);
create index if not exists idx_recurring_shop on kroner_private.recurring(shop);

do $$ declare t record;begin for t in select tablename from pg_tables where schemaname='kroner_private' loop execute format('alter table kroner_private.%I enable row level security',t.tablename);end loop;end $$;

-- Triggers for commissions
create or replace function kroner_private.record_earnings() returns trigger language plpgsql set search_path='' as $$
declare p kroner_private.professionals; basis int:=new.price;total int;commission int:=0;rules jsonb:='[]';item jsonb;rate int;
begin
 if new.status<>'done' or old.status='done' then return new;end if;
 select * into p from kroner_private.professionals where id=new.professional;
 select coalesce(sum((v->>'price')::int),0) into total from jsonb_array_elements(new.services)v;
 for item in select value from jsonb_array_elements(new.services) loop
 rate:=coalesce((p.service_rates->>(item->>'id'))::int,p.commission_bps);
 if total>0 then commission:=commission+round(basis::numeric*(item->>'price')::int/total*rate/10000);end if;
 rules:=rules||jsonb_build_object('service',item->>'id','rate',rate);end loop;
 insert into kroner_private.service_earnings values(new.id,new.shop,new.professional,basis,commission,rules,now()) on conflict(appointment) do nothing;
 return new;end;$$;
revoke all on function kroner_private.record_earnings() from public,anon,authenticated;
drop trigger if exists record_service_earnings on kroner_private.appointments;
create trigger record_service_earnings after update of status on kroner_private.appointments for each row execute function kroner_private.record_earnings();

create or replace function kroner_private.sale_commission() returns trigger language plpgsql set search_path='' as $$
declare commission int;
begin
 if new.appointment is not null then
 update kroner_private.service_earnings set amount=round(amount::numeric*(new.service_total+new.product_total-new.discount)/greatest(new.service_total+new.product_total,1)),basis=round(basis::numeric*(new.service_total+new.product_total-new.discount)/greatest(new.service_total+new.product_total,1)) where appointment=new.appointment returning amount into commission;
 new.commission:=coalesce(commission,0);end if;return new;end;$$;
revoke all on function kroner_private.sale_commission() from public,anon,authenticated;
drop trigger if exists sale_commission on kroner_private.sales;
create trigger sale_commission before insert on kroner_private.sales for each row execute function kroner_private.sale_commission();

-- Identity resolution
create or replace function kroner_private.current_user_id() returns uuid
language plpgsql security definer set search_path='' as $$
declare claims jsonb:=auth.jwt(); subject text:=claims->>'sub'; email text; result uuid; linked text;
begin
 if subject is null or subject='' then return null; end if;
 if claims->>'iss'='https://funky-phoenix-3915.clerk.accounts.dev' then
  if claims->>'role' is distinct from 'authenticated'
   or subject not like 'user_%'
   or claims->>'email_verified' is distinct from 'true'
   or not (
     coalesce(claims->>'azp','') in (
       'https://kroner-eight.vercel.app',
       'https://kroner-barbearias.vercel.app',
       'https://kroner-piloto.vercel.app',
       'https://kroner-piloto-jorgenetotz1-7118.vercel.app',
       'http://localhost:3000'
     )
     or claims->>'azp' like 'https://kroner%.vercel.app'
     or claims->>'azp' like 'https://%-jorgenetotz1-7118.vercel.app'
   ) then
   raise exception 'Sessão inválida. Confirme seu e-mail e entre novamente.';
  end if;
  email:=lower(trim(claims->>'email'));
  if email is null or email='' then raise exception 'E-mail confirmado ausente na sessão.';end if;
  perform pg_advisory_xact_lock(hashtextextended('kroner:clerk:'||subject,0));
  select id into result from kroner_private.app_users where clerk_subject=subject;
  if result is not null then return result;end if;
  select id,clerk_subject into result,linked from kroner_private.app_users where legacy_email=email for update;
  if result is not null then
   if linked is not null then raise exception 'Esta conta antiga já foi vinculada a outro acesso. Entre com o acesso original.';end if;
   update kroner_private.app_users set clerk_subject=subject where id=result;
  else
   insert into kroner_private.app_users(clerk_subject) values(subject) returning id into result;
  end if;
  return result;
 end if;
 if (claims->>'iss' in ('https://qqcmtajnrcbfqgkixame.supabase.co/auth/v1', 'https://azbccqwjnzrzrhvnlncy.supabase.co/auth/v1'))
  and claims->>'role'='authenticated' then
  select id into result from auth.users where id=subject::uuid;
  if result is not null then
   insert into kroner_private.app_users(id) values(result) on conflict(id) do nothing;
  end if;
  return result;
 end if;
 raise exception 'Provedor de acesso não autorizado.';
end;
$$;
revoke all on function kroner_private.current_user_id() from public,anon,authenticated;

-- Local holidays and slot availability
create or replace function kroner_private.local_holiday(sid uuid,d date) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from kroner_private.calendar_events e join kroner_private.shops s on s.id=e.shop where s.id=sid and e.day=d and (e.scope='Nacional' or e.state=s.cfg->>'state' and (e.scope='Estadual' or lower(e.city)=lower(s.cfg->>'city'))))
$$;
revoke all on function kroner_private.local_holiday(uuid,date) from public,anon,authenticated;

create or replace function kroner_private.chair_slots(sid uuid,chair uuid,svc uuid[],day date,period text,manual boolean default false) returns jsonb language plpgsql set search_path='' as $$
declare professional_row kroner_private.professionals; buffer_minutes integer; s kroner_private.shops; w jsonb; dur integer; price integer; n integer; lo time; hi time; lunch1 time; lunch2 time; a timestamptz; b timestamptz; cursor_t time; z text; result jsonb:='[]'; step integer;
begin
 select * into s from kroner_private.shops where id=sid and active; if s.id is null then return result;end if;
 select * into professional_row from kroner_private.professionals where id=chair and shop=sid and status='active';
 if professional_row.id is null then return result;end if;
 s.cfg:=s.cfg||professional_row.preferences;
 if (kroner_private.local_holiday(sid,day) or to_char(day,'MM-DD') in ('01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-25')) and coalesce(case when professional_row.role='owner' then s.cfg->'holidayDecisions' else professional_row.preferences->'holidayDecisions' end->>day::text,'')<>'open' then return result;end if;
 buffer_minutes:=coalesce((professional_row.preferences->>'buffer')::integer,10);
 select sum(coalesce((professional_row.preferences->'durations'->>id::text)::int,duration)),sum(services.price),count(*) into dur,price,n from kroner_private.services where shop=sid and active and id=any(svc) and not(coalesce(professional_row.preferences->'disabledServices','[]') ? id::text);
 if n=0 or n<>cardinality(svc) or dur>=1440 then return result;end if;
 z:=coalesce(s.cfg->>'timezone','America/Sao_Paulo');
 if day<(now() at time zone z)::date or day>(now() at time zone z)::date+coalesce((s.cfg->>'maxDays')::int,21) then return result;end if;
 w:=s.cfg->'week'->extract(dow from day)::int;if not coalesce((w->>'enabled')::boolean,false) then return result;end if;
 lo:=(w->>'open')::time;hi:=(w->>'close')::time;lunch1:=nullif(w->>'lunchStart','')::time;lunch2:=nullif(w->>'lunchEnd','')::time;
 if period='morning' then hi:=least(hi,coalesce(lunch1,'11:00'::time));
 elsif period='afternoon' then lo:=greatest(lo,coalesce(lunch2,'11:00'::time));hi:=least(hi,'18:00'::time);
 elsif period='night' then lo:=greatest(lo,'18:00'::time);
 else raise exception 'Período inválido.';end if;
 step:=greatest(5,coalesce((s.cfg->>'grid')::integer,15));cursor_t:=lo;
 while day+cursor_t+make_interval(mins=>dur)<=day+hi and cursor_t<hi loop
 a:=(day+cursor_t) at time zone z;b:=a+make_interval(mins=>dur);
 if a>=now()+make_interval(mins=>case when manual then 0 else coalesce((professional_row.preferences->>'notice')::int,10) end)
 and (lunch1 is null or not (cursor_t<lunch2 and day+cursor_t+make_interval(mins=>dur)>day+lunch1))
 and not exists(select 1 from kroner_private.appointments x where x.shop=sid and x.professional=chair and x.status in('booked','done') and x.starts<b+make_interval(mins=>buffer_minutes) and x.ends+make_interval(mins=>buffer_minutes)>a)
 and not exists(select 1 from kroner_private.blocks x where x.shop=sid and x.starts<b and x.ends>a)
 then result:=result||jsonb_build_object('start',a,'end',b,'label',to_char(cursor_t,'HH24:MI'),'duration',dur,'price',price);end if;
 exit when cursor_t+make_interval(mins=>step)<=cursor_t;cursor_t:=cursor_t+make_interval(mins=>step);
 end loop;return result;
end $$;

create or replace function kroner_private.available(sid uuid,svc uuid[],day date,period text) returns jsonb language plpgsql set search_path='' as $$
declare chair_rec record; combined jsonb:='[]';
begin
 for chair_rec in select id from kroner_private.professionals where shop=sid and status='active' loop
 combined:=combined||kroner_private.chair_slots(sid,chair_rec.id,svc,day,period);
 end loop;
 return coalesce((select jsonb_agg(x) from (select distinct on (value->>'start') value from jsonb_array_elements(combined) order by value->>'start') s(x)),'[]');
end $$;

-- Public & Private RPC functions
create or replace function public.kroner_billing_owner() returns uuid language sql volatile
security definer set search_path='' as $$
 select id from kroner_private.shops where owner=kroner_private.current_user_id()
$$;
revoke all on function public.kroner_billing_owner() from public,anon;
grant execute on function public.kroner_billing_owner() to authenticated;

create or replace function public.kroner_team(action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=kroner_private.current_user_id(); me kroner_private.professionals; target kroner_private.professionals; token text; mail text:=lower(auth.jwt()->>'email'); selected_role text:=payload->>'role';
week_day jsonb; d date; prefs jsonb; shoprow kroner_private.shops;
begin
 if uid is null then raise exception 'Entre na sua conta.';end if;
 select * into me from kroner_private.professionals where user_id=uid and status='active' for update;
 if action='accept' then
  select * into target from kroner_private.professionals where invite_hash=encode(extensions.digest(payload->>'token','sha256'),'hex') and status='invited' and expires>now() for update;
  if target.id is null or target.email is distinct from mail or auth.jwt()->>'email_verified' is distinct from 'true' then raise exception 'Convite expirado ou e-mail diferente do convidado.';end if;
  if me.id is not null then raise exception 'Esta conta já pertence a uma equipe.';end if;
  update kroner_private.professionals set user_id=uid,status='active',invite_hash=null where id=target.id;
  insert into kroner_private.audit(shop,actor,action,record_id) values(target.shop,uid,'team_accept',target.id);return '{"ok":true}';
 end if;
 if action='identity' then return jsonb_build_object('role',me.role,'shop',me.shop,'id',me.id,'revoked',exists(select 1 from kroner_private.professionals where user_id=uid and status='inactive'));end if;
 if me.id is null then raise exception 'Sem vínculo ativo com a equipe.';end if;
 select * into shoprow from kroner_private.shops where id=me.shop;
 if action='calendar_event' then
 if me.role<>'owner' or coalesce(length(trim(payload->>'name')),0)<2 or coalesce(payload->>'source','') !~ '^https?://[^ ]+$' or coalesce(shoprow.cfg->>'city','')='' then raise exception 'Informe o feriado, a localidade e o link da fonte oficial.';end if;
 insert into kroner_private.calendar_events(shop,day,name,scope,source,state,city,actor) values(me.shop,(payload->>'date')::date,trim(payload->>'name'),payload->>'scope',payload->>'source',shoprow.cfg->>'state',shoprow.cfg->>'city',uid) on conflict(shop,day,scope,state,city) do update set name=excluded.name,source=excluded.source,actor=uid,updated_at=now();
 insert into kroner_private.audit(shop,actor,action,record_id) values(me.shop,uid,'calendar_event_'||(payload->>'date'),me.id);
 return '{"ok":true}';end if;
 if action='clients' then return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'last',x.last,'monthly',exists(select 1 from kroner_private.memberships m where m.client=c.id and m.active),'receivable',b.pending,'debt',b.overdue) order by c.name) from kroner_private.clients c left join lateral (select max((a.starts at time zone coalesce(shoprow.cfg->>'timezone','America/Sao_Paulo'))::date) as last from kroner_private.appointments a where a.client=c.id and a.status='done') x on true left join lateral (select bool_or(ch.due is null or ch.due>=current_date) pending,bool_or(ch.due<current_date-30) overdue from kroner_private.charges ch where ch.client=c.id and ch.direction='in' and ch.amount>coalesce((select sum(pay.amount) from kroner_private.payments pay where pay.charge=ch.id),0)) b on true where c.shop=me.shop and c.user_id is not null),'[]');end if;
 if action='profile' then
 return jsonb_build_object('id',me.id,'slug',shoprow.slug,'role',me.role,'finance',me.finance,'calendar',coalesce((select jsonb_agg(jsonb_build_object('date',h.day,'name',h.name,'scope',h.scope,'source',h.source)) from kroner_private.calendar_events h where h.shop=me.shop and h.day>=current_date-1 and h.day<=current_date+370 and (h.scope='Nacional' or h.state=shoprow.cfg->>'state' and (h.scope='Estadual' or lower(h.city)=lower(shoprow.cfg->>'city')))),'[]'),'timezone',coalesce(shoprow.cfg->>'timezone','America/Sao_Paulo'),'preferences',me.preferences,'week',coalesce(me.preferences->'week',shoprow.cfg->'week'),'services',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'duration',duration) order by name) from kroner_private.services where shop=me.shop and active),'[]'));
 end if;
 if action='preferences' then
 prefs:=payload-'holidayDecisions';
 if jsonb_typeof(prefs)<>'object' or prefs-array['notice','buffer','week','durations','disabledServices']<>'{}'::jsonb or not(prefs ?& array['buffer','week','durations','disabledServices']) or coalesce((prefs->>'notice')::int,10) not between 0 and 10080 or (prefs->>'buffer')::int not between 0 and 180 or jsonb_array_length(prefs->'week')<>7 then raise exception 'Confira intervalos e expediente.';end if;
 for week_day in select value from jsonb_array_elements(prefs->'week') loop
 if (week_day->>'enabled')::boolean and (nullif(week_day->>'open','') is null or nullif(week_day->>'close','') is null or (week_day->>'open')::time >= (week_day->>'close')::time or (nullif(week_day->>'lunchStart','') is null)<>(nullif(week_day->>'lunchEnd','') is null) or nullif(week_day->>'lunchStart','')::time< (week_day->>'open')::time or nullif(week_day->>'lunchEnd','')::time>(week_day->>'close')::time or nullif(week_day->>'lunchEnd','')::time<=nullif(week_day->>'lunchStart','')::time) then raise exception 'Revise os horários e as pausas.';end if;end loop;
 if exists(select 1 from jsonb_each_text(prefs->'durations') e where e.value::int not between 1 and 720 or not exists(select 1 from kroner_private.services z where z.shop=me.shop and z.id=e.key::uuid)) then raise exception 'Duração inválida.';end if;
 update kroner_private.professionals set preferences=preferences||prefs where id=me.id;
 return '{"ok":true}';
 end if;
 if action='holiday' then
 d:=(payload->>'date')::date;
 if d is null or coalesce(payload->>'decision','') not in ('open','closed') then raise exception 'Decisão inválida.';end if;
 perform 1 from kroner_private.shops where id=me.shop for update;
 if payload->>'decision'='closed' and exists(select 1 from kroner_private.appointments where professional=me.id and status='booked' and (starts at time zone coalesce(shoprow.cfg->>'timezone','America/Sao_Paulo'))::date=d) then raise exception 'Transfira ou cancele primeiro as reservas deste dia.';end if;
 update kroner_private.professionals set preferences=preferences||jsonb_build_object('holidayDecisions',coalesce(preferences->'holidayDecisions','{}')||jsonb_build_object(d::text,payload->>'decision')) where id=me.id;
 insert into kroner_private.audit(shop,actor,action,record_id) values(me.shop,uid,'holiday_'||d::text||'_'||(payload->>'decision'),me.id);
 return '{"ok":true}';
 end if;
 if action='slots' then
 return kroner_private.chair_slots(me.shop,(payload->>'professional')::uuid,array(select value::uuid from jsonb_array_elements_text(payload->'services')),(payload->>'day')::date,payload->>'period',true);
 end if;
 if action='individual_finance' then
 if me.role='employee' and not me.finance then raise exception 'Financeiro individual desativado.';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('day',p.paid_on,'amount',p.amount,'fee',p.fee,'method',p.method) order by p.paid_on desc) from kroner_private.payments p join kroner_private.charges c on c.id=p.charge join kroner_private.appointments a on a.id=c.appointment where a.professional=me.id),'[]');end if;
 if action='list' then return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'role',role,'status',status,'finance',finance) order by name) from kroner_private.professionals where shop=me.shop and (me.role='owner' or status='active')),'[]');end if;
 if action='agenda' then return coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'professional',a.professional,'name',c.name,'starts',a.starts,'ends',a.ends,'status',a.status,'client',a.client,'serviceIds',(select jsonb_agg(v->>'id') from jsonb_array_elements(a.services)v),'services',(select string_agg(v->>'name',', ') from jsonb_array_elements(a.services)v)) order by a.starts) from kroner_private.appointments a join kroner_private.clients c on a.client=c.id join kroner_private.shops s on s.id=a.shop where a.shop=me.shop and (a.starts at time zone coalesce(s.cfg->>'timezone','America/Sao_Paulo'))::date=(payload->>'day')::date),'[]');end if;
 if me.role<>'owner' then raise exception 'Somente a conta principal gerencia a equipe.';end if;
 if action='invite' then
  if selected_role is null or selected_role not in ('partner','employee') or coalesce(length(trim(payload->>'name')),0) not between 2 and 100 or coalesce(payload->>'email','') !~ '^[^ @]+@[^ @]+\.[^ @]+$' then raise exception 'Confira nome, e-mail e papel.';end if;
  token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into kroner_private.professionals(shop,name,role,status,email,invite_hash,expires)
   values(me.shop,trim(payload->>'name'),selected_role,'invited',lower(trim(payload->>'email')),encode(extensions.digest(token,'sha256'),'hex'),now()+interval '7 days')
   on conflict(shop,email) where status='invited' do update set name=excluded.name,role=excluded.role,invite_hash=excluded.invite_hash,expires=excluded.expires returning * into target;
 elsif action in ('permissions','deactivate') then
  select * into target from kroner_private.professionals where id=(payload->>'id')::uuid and shop=me.shop and role<>'owner' and status<>'inactive' for update;
  if target.id is null then raise exception 'Profissional indisponível.';end if;
  if action='permissions' then
   if selected_role is null or selected_role not in ('partner','employee') then raise exception 'Papel inválido.';end if;
   update kroner_private.professionals set role=selected_role,finance=coalesce((payload->>'finance')::boolean,false) where id=target.id;
  else
   if exists(select 1 from kroner_private.appointments where professional=target.id and ends>now() and status='booked') then raise exception 'Transfira ou cancele os atendimentos futuros.';end if;
   update kroner_private.professionals set status='inactive',invite_hash=null where id=target.id;
  end if;
 else raise exception 'Operação desconhecida.';end if;
 insert into kroner_private.audit(shop,actor,action,record_id) values(me.shop,uid,'team_'||action,target.id);
 return jsonb_build_object('ok',true,'token',token);
end;$$;
revoke all on function public.kroner_team(text,jsonb) from public,anon;
grant execute on function public.kroner_team(text,jsonb) to authenticated;

create or replace function public.kroner_management(action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=kroner_private.current_user_id();me kroner_private.professionals;p kroner_private.products;delta int;op uuid:=(payload->>'request_id')::uuid;
begin
 select * into me from kroner_private.professionals where user_id=uid and status='active';if me.id is null then raise exception 'Sem vínculo ativo.';end if;
 if action='earnings' then
 if me.role='employee' and not me.finance then raise exception 'Sem acesso financeiro.';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('name',pr.name,'basis',x.basis,'commission',x.amount,'day',x.created_at,'rules',x.rules) order by x.created_at desc) from kroner_private.service_earnings x join kroner_private.professionals pr on pr.id=x.professional where x.shop=me.shop and (me.role<>'employee' or pr.id=me.id)),'[]');end if;
 if me.role not in ('owner','partner') then raise exception 'Operação exclusiva da gestão.';end if;
 if action='service_rate' then
 if me.role<>'owner' or (payload->>'rate')::int not between 0 and 10000 or not exists(select 1 from kroner_private.services where shop=me.shop and id=(payload->>'service')::uuid) then raise exception 'Percentual ou permissão inválida.';end if;
 update kroner_private.professionals set service_rates=service_rates||jsonb_build_object(payload->>'service',(payload->>'rate')::int) where shop=me.shop and id=(payload->>'professional')::uuid;return '{"ok":true}';end if;
 if action='inventory' then
 perform 1 from kroner_private.shops where id=me.shop for update;
 if op is null then raise exception 'Identificador obrigatório.';end if;
 if exists(select 1 from kroner_private.requests r where r.id=op and r.actor=uid and r.action='inventory') then return '{"ok":true}';end if;
 insert into kroner_private.requests values(op,uid,'inventory','{"ok":true}',now());
 select * into p from kroner_private.products where id=(payload->>'id')::uuid and shop=me.shop for update;
 if p.id is null or coalesce(length(trim(payload->>'reason')),0)<3 or coalesce((payload->>'count')::int,-1)<0 or coalesce(length(trim(payload->>'unit')),0) not between 1 and 30 then raise exception 'Revise a contagem, a unidade e o motivo.';end if;
 delta:=(payload->>'count')::int-p.quantity;
 update kroner_private.products set quantity=quantity+delta,unit=trim(payload->>'unit'),active=(payload->>'active')::boolean,updated_at=now() where id=p.id;
 insert into kroner_private.movements(shop,product,quantity,kind,unit_cost,note) values(me.shop,p.id,delta,'adjustment',p.cost,payload->>'reason');
 insert into kroner_private.audit(shop,actor,action,record_id) values(me.shop,uid,'inventory',p.id);return '{"ok":true}';end if;
 raise exception 'Operação inválida.';end;$$;
revoke all on function public.kroner_management(text,jsonb) from public,anon;
grant execute on function public.kroner_management(text,jsonb) to authenticated;

create or replace function public.kroner_pos(action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=kroner_private.current_user_id();me kroner_private.professionals;person kroner_private.professionals;s kroner_private.shops;prod kroner_private.products;apt kroner_private.appointments; sale kroner_private.sales;
 line jsonb;lines jsonb:='[]'; totals jsonb; op uuid:=(payload->>'request_id')::uuid;ch uuid;goods int:=0;svc int:=0;discount int:=coalesce((payload->>'discount')::int,0);qty int;amount int;refundable int;expected int;received int:=0; day date; counted int;opening int;
begin
 select * into me from kroner_private.professionals where user_id=uid and status='active';
 if me.role is null or me.role not in ('owner','partner') then raise exception 'Acesso restrito à gestão.';end if;
 select * into s from kroner_private.shops where id=me.shop for update;
 day:=(now() at time zone coalesce(s.cfg->>'timezone','America/Sao_Paulo'))::date;
 if action='list' then return jsonb_build_object('sales',coalesce((select jsonb_agg(to_jsonb(sa) order by sa.created_at desc) from kroner_private.sales sa where shop=s.id),'[]'),'rates',(select jsonb_agg(jsonb_build_object('id',id,'name',name,'rate',commission_bps)) from kroner_private.professionals where shop=s.id and status='active'),'closings',coalesce((select jsonb_agg(to_jsonb(rc) order by rc.day desc) from kroner_private.register_closings rc where shop=s.id),'[]'));end if;
 if action='rate' then
 if me.role<>'owner' then raise exception 'Somente o titular altera comissões.';end if;
 update kroner_private.professionals set commission_bps=(payload->>'rate')::int where id=(payload->>'id')::uuid and shop=s.id;return '{"ok":true}';end if;
 if op is null then raise exception 'Identificador obrigatório.';end if;
 if exists(select 1 from kroner_private.requests r where r.id=op and r.actor=uid and r.action='pos_'||kroner_pos.action) then return '{"ok":true}';end if;
 insert into kroner_private.requests values(op,uid,'pos_'||kroner_pos.action,'{"ok":true}',now());
 if action='close' then
 day:=(payload->>'day')::date;opening:=(payload->>'opening')::int;counted:=(payload->>'counted')::int;
 if day>(now() at time zone coalesce(s.cfg->>'timezone','America/Sao_Paulo'))::date or least(opening,counted)<0 then raise exception 'Conferência inválida.';end if;
 select coalesce(jsonb_object_agg(method,net),'{}') into totals from (select p.method,sum(case when c.direction='in' then p.amount else -p.amount end) net from kroner_private.payments p join kroner_private.charges c on p.charge=c.id where p.shop=s.id and p.paid_on=day group by p.method) x;
 expected:=opening+coalesce((totals->>'cash')::int,0);
 insert into kroner_private.register_closings values(s.id,day,uid,opening,counted,expected,totals,now());return '{"ok":true}';end if;
 if action='sale' then
 select * into person from kroner_private.professionals where shop=s.id and id=coalesce((payload->>'professional')::uuid,me.id) and status='active';
 if person.id is null then raise exception 'Profissional inválido.';end if;
 if nullif(payload->>'appointment','') is not null then
 select * into apt from kroner_private.appointments where shop=s.id and id=(payload->>'appointment')::uuid and status='booked' and membership is null for update;
 if apt.id is null then raise exception 'Atendimento indisponível.';end if;
 select * into person from kroner_private.professionals where id=apt.professional;svc:=apt.price;
 end if;
 for line in select value from jsonb_array_elements(payload->'items') loop
 qty:=(line->>'quantity')::int;select * into prod from kroner_private.products where id=(line->>'id')::uuid and shop=s.id for update;
 if prod.id is null or not prod.active or qty is null or qty<1 or qty>prod.quantity then raise exception 'Produto indisponível ou quantidade acima do estoque.';end if;
 goods:=goods+qty*prod.price;
 update kroner_private.products set quantity=quantity-qty,updated_at=now() where id=prod.id;
 lines:=lines||jsonb_build_object('id',prod.id,'name',prod.name,'quantity',qty,'unit_price',prod.price,'unit_cost',prod.cost);
 end loop;
 if svc+goods<=0 or discount<0 or discount>svc+goods then raise exception 'Confira o total e o desconto.';end if;
 insert into kroner_private.charges(shop,client,appointment,description,amount,due,category) values(s.id,apt.client,apt.id,'Venda no PDV',svc+goods-discount,day,case when apt.id is null then 'sale' else 'service' end) returning id into ch;
 for line in select value from jsonb_array_elements(lines) loop
 insert into kroner_private.movements(shop,product,quantity,kind,unit_cost,charge,note) values(s.id,(line->>'id')::uuid,(line->>'quantity')::int,'sale',(line->>'unit_cost')::int,ch,'PDV');
 end loop;
 for line in select value from jsonb_array_elements(payload->'payments') loop
 amount:=(line->>'amount')::int;if amount<=0 then raise exception 'Pagamento inválido.';end if;
 perform kroner_private.api('pay',jsonb_build_object('charge',ch,'amount',amount,'method',line->>'method','paid_on',day,'settles_on',day,'request_id',gen_random_uuid()));end loop;
 if apt.id is not null then update kroner_private.appointments set status='done' where id=apt.id; end if;
 insert into kroner_private.sales(id,shop,actor,professional,appointment,charge,items,service_total,product_total,discount,commission,rate) values(op,s.id,uid,person.id,apt.id,ch,lines,svc,goods,discount,round(svc::numeric*(svc+goods-discount)/(svc+goods)*person.commission_bps/10000),person.commission_bps);
 elsif action='refund' then
 select * into sale from kroner_private.sales where shop=s.id and id=(payload->>'sale')::uuid for update;
 select coalesce(sum(p.amount),0) into received from kroner_private.payments p where p.charge=sale.charge;
 amount:=(payload->>'amount')::int;refundable:=received-sale.refunded;
 if sale.id is null or amount is null or amount<=0 or amount>refundable or coalesce(length(trim(payload->>'reason')),0)<3 then raise exception 'Revise o motivo e o saldo disponível para estorno.';end if;
 insert into kroner_private.charges(shop,description,direction,amount,due,category) values(s.id,'Estorno PDV '||sale.id||' · '||left(payload->>'reason',150),'out',amount,day,'refund') returning id into ch;
 perform kroner_private.api('pay',jsonb_build_object('charge',ch,'amount',amount,'method',payload->>'method','paid_on',day,'settles_on',day,'request_id',gen_random_uuid()));
 update kroner_private.sales set refunded=refunded+amount where id=sale.id;
 if coalesce((payload->>'return_goods')::boolean,false) then
 if amount+sale.refunded<>sale.product_total+sale.service_total-sale.discount then raise exception 'Devolução integral exige estorno de todo o valor da venda.';end if;
 for line in select value from jsonb_array_elements(sale.items) loop
 update kroner_private.products set quantity=quantity+(line->>'quantity')::int where id=(line->>'id')::uuid;
 insert into kroner_private.movements(shop,product,quantity,kind,unit_cost,charge,note) values(s.id,(line->>'id')::uuid,(line->>'quantity')::int,'return',(line->>'unit_cost')::int,ch,payload->>'reason');end loop;end if;
 else raise exception 'Operação inválida.';end if;
 insert into kroner_private.audit(shop,actor,action,record_id) values(s.id,uid,'pos_'||kroner_pos.action,op);return '{"ok":true}';
end;$$;
revoke all on function public.kroner_pos(text,jsonb) from public,anon;
grant execute on function public.kroner_pos(text,jsonb) to authenticated;

-- Main API function
create or replace function kroner_private.api(action text, payload jsonb)
 returns jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
<<ctx>>
declare uid uuid:=kroner_private.current_user_id();s kroner_private.shops;sid uuid;cid uuid;rid uuid;aid uuid;ch uuid;pr kroner_private.products;apt kroner_private.appointments;c kroner_private.charges;m kroner_private.memberships;r record;cfg jsonb;sv uuid[];slots jsonb;slot jsonb;day date;dd date;period text;dur int;amount int;paid int;qty int;bps int;fee int;method text;result jsonb;w jsonb;op uuid;exists_result jsonb;month date;until_day date;
begin
 if octet_length(payload::text)>65536 then raise exception 'Solicitação muito grande.';end if;
 if action in('public','slots') then
 select * into s from kroner_private.shops where slug=payload->>'slug' and active;
 if s.id is null then raise exception 'Barbearia indisponível ou link inválido.';end if;
 if action='public' then
  if payload ? 'professional' and coalesce(payload->>'professional','auto')<>'auto' then
    if not exists(select 1 from kroner_private.professionals p where p.shop=s.id and p.id=(payload->>'professional')::uuid and p.status='active') then
      raise exception 'Profissional indisponível.';
    end if;
  end if;
  return jsonb_build_object(
    'id',s.id,
    'slug',s.slug,
    'name',s.name,
    'cfg',s.cfg-'phone'-'creditFee'-'debitFee',
    'professionals',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name)) from kroner_private.professionals where shop=s.id and status='active'),'[]'),
    'services',coalesce((select jsonb_agg(to_jsonb(v)) from kroner_private.services v where v.shop=s.id and v.active and (payload->>'professional' is null or payload->>'professional'='auto' or not(coalesce((select preferences->'disabledServices' from kroner_private.professionals where id=(payload->>'professional')::uuid and shop=s.id),'[]'::jsonb) ? v.id::text))),'[]')
  );
 end if;
 select array_agg(value::uuid) into sv from jsonb_array_elements_text(payload->'services');
 if payload ? 'professional' and coalesce(payload->>'professional','auto')<>'auto' then
   return kroner_private.chair_slots(s.id,(payload->>'professional')::uuid,sv,(payload->>'day')::date,payload->>'period');
 end if;
 return kroner_private.available(s.id,sv,(payload->>'day')::date,payload->>'period');
 end if;
 if uid is null then raise exception 'Entre na sua conta para continuar.';end if;
 if action='my_appointments' then return coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'starts',a.starts,'ends',a.ends,'services',a.services,'price',a.price,'status',a.status,'shop_name',x.name,'slug',x.slug,'timezone',x.cfg->>'timezone')) from kroner_private.appointments a join kroner_private.clients cl on cl.id=a.client join kroner_private.shops x on x.id=a.shop where cl.user_id=uid and a.starts>now()-interval '1 year'),'[]');end if;
 if action='book' then
 select * into s from kroner_private.shops where slug=payload->>'slug' and active for update;
 if s.id is null then raise exception 'Barbearia indisponível.';end if;
 else select * into s from kroner_private.shops where owner=uid for update;end if;
 if action='create_shop' then
 if exists(select 1 from kroner_private.professionals where (user_id=uid and status in ('active','inactive') and role<>'owner') or (email=lower(auth.jwt()->>'email') and status='invited' and expires>now())) then raise exception 'Acesse sua equipe pelo convite.';end if;
 insert into kroner_private.shops(owner) values(uid) on conflict(owner) do nothing;
 return '{"ok":true}';
 end if;
 if action='workspace' then
 if s.id is null then return '{"onboarding":true}';end if;
 return jsonb_build_object(
   'shop',to_jsonb(s),
   'professionals',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'role',role,'status',status,'finance',finance)) from kroner_private.professionals where shop=s.id and status='active'),'[]'),
   'services',coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.services x where shop=s.id),'[]'),
   'clients',coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.clients x where shop=s.id),'[]'),
   'appointments',coalesce((select jsonb_agg(to_jsonb(x) order by starts) from kroner_private.appointments x where shop=s.id),'[]'),
   'charges',coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.charges x where shop=s.id),'[]'),
   'payments',coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.payments x where shop=s.id),'[]'),
   'products',coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.products x where shop=s.id),'[]'),
   'memberships',coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.memberships x where shop=s.id),'[]'),
   'blocks',coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.blocks x where shop=s.id),'[]'),
   'recurring',coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.recurring x where shop=s.id),'[]'),
   'movements',coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.movements x where shop=s.id),'[]')
 );
 end if;
 if action='cancel_own' then
 select a.* into apt from kroner_private.appointments a join kroner_private.clients cl on cl.id=a.client where a.id=(payload->>'id')::uuid and cl.user_id=uid for update of a;
 if apt.id is null then raise exception 'Reserva não encontrada.';end if;
 select * into s from kroner_private.shops where id=apt.shop;
 if apt.status<>'booked' or apt.starts<now()+make_interval(mins=>coalesce((s.cfg->>'cancelMinutes')::int,120)) then raise exception 'Prazo de cancelamento encerrado. Fale com a barbearia.';end if;
 update kroner_private.appointments set status='cancelled' where id=apt.id;return '{"ok":true}';end if;
 if s.id is null then raise exception 'Configure sua barbearia primeiro.';end if;sid:=s.id;
 if action='settings' then
 cfg:=payload->'cfg';if cfg is null or jsonb_typeof(cfg)<>'object' then raise exception 'Configuração inválida.';end if;
 if coalesce(length(payload->>'name'),0)<2 then raise exception 'Informe o nome da barbearia.';end if;
 if coalesce(cfg->>'phone','')!~'^\+55[1-9][0-9][0-9]{8,9}$' then raise exception 'Informe telefone com DDD.';end if;
 if not cfg ?& array['phone','timezone','maxDays','grid','grace','notice','cancelMinutes','creditFee','debitFee','week','city','professional','state'] then raise exception 'Configurações essenciais ausentes.';end if;
 if cfg->>'timezone' not in('America/Sao_Paulo','America/Manaus','America/Rio_Branco','America/Noronha') then raise exception 'Fuso inválido.';end if;
 if (cfg->>'maxDays')::int not between 1 and 90 or (cfg->>'grid')::int not between 5 and 60 or (cfg->>'grace')::int not between 0 and 90 or (cfg->>'notice')::int<0 or (cfg->>'cancelMinutes')::int<0 then raise exception 'Prazos inválidos.';end if;
 if (cfg->>'creditFee')::int not between 0 and 10000 or (cfg->>'debitFee')::int not between 0 and 10000 then raise exception 'Taxa inválida.';end if;
 if jsonb_array_length(cfg->'week')<>7 then raise exception 'Configure os sete dias.';end if;
 for w in select value from jsonb_array_elements(cfg->'week') loop
 if (w->>'enabled')::boolean then
 if (w->>'open')::time >= (w->>'close')::time then raise exception 'Abertura deve ser anterior ao encerramento.';end if;
 if nullif(w->>'lunchStart','') is not null and ((w->>'lunchStart')::time >= (w->>'lunchEnd')::time or (w->>'lunchStart')::time < (w->>'open')::time or (w->>'lunchEnd')::time > (w->>'close')::time) then raise exception 'Pausa fora do expediente.';end if;
 end if;end loop;
 if coalesce((payload->>'activate')::boolean,false) then
 if not exists(select 1 from kroner_private.services where shop=sid and active) or not exists(select 1 from jsonb_array_elements(cfg->'week') a where (a->>'enabled')::boolean) or length(cfg->>'city')<2 or length(cfg->>'professional')<2 then raise exception 'Preencha serviços, profissional, cidade e expediente.';end if;
 end if;
 update kroner_private.shops set name=left(payload->>'name',100),cfg=ctx.cfg,active=active or coalesce((payload->>'activate')::boolean,false) where id=sid;
 update kroner_private.professionals set name=coalesce(nullif(ctx.cfg->>'professional',''),left(payload->>'name',100)) where shop=sid and role='owner';
 return '{"ok":true}';
 end if;
 if action='service' then
 if nullif(payload->>'id','') is null then insert into kroner_private.services(shop,name,price,duration) values(sid,left(payload->>'name',100),(payload->>'price')::int,(payload->>'duration')::int);
 else update kroner_private.services set name=left(payload->>'name',100),price=(payload->>'price')::int,duration=(payload->>'duration')::int,active=coalesce((payload->>'active')::boolean,true) where id=(payload->>'id')::uuid and shop=sid;end if;return '{"ok":true}';end if;
 if not s.active then raise exception 'Conclua as configurações obrigatórias.';end if;
 op:=nullif(payload->>'request_id','')::uuid;
 if op is not null and action not in('book','manual_book') then
 select x.result into exists_result from kroner_private.requests x where x.id=op and actor=uid and x.action=api.action;
 if exists_result is not null then return exists_result;end if;
 insert into kroner_private.requests(id,actor,action) values(op,uid,action);
 end if;
 if action='client' then
 if length(payload->>'name')<2 or payload->>'phone' !~'^\+55[1-9][0-9][0-9]{8,9}$' then raise exception 'Nome ou telefone inválido.';end if;
 insert into kroner_private.clients(shop,name,phone) values(sid,left(payload->>'name',100),payload->>'phone') returning id into cid;result:=jsonb_build_object('id',cid);
 elsif action in('book','manual_book','move') then
 if action='book' then
 if length(payload->>'name')<2 or payload->>'phone' !~'^\+55[1-9][0-9][0-9]{8,9}$' then raise exception 'Nome e telefone com DDD são obrigatórios.';end if;
 insert into kroner_private.clients(shop,user_id,name,phone) values(sid,uid,left(payload->>'name',100),payload->>'phone') on conflict(shop,user_id) do update set name=excluded.name,phone=excluded.phone returning id into cid;
 else cid:=(payload->>'client')::uuid;if not exists(select 1 from kroner_private.clients where id=cid and shop=sid) then raise exception 'Cliente inválido.';end if;end if;
 if op is null then raise exception 'Identificador da solicitação obrigatório.';end if;
 select id into aid from kroner_private.appointments where request_id=op and shop=sid and client=cid;if aid is not null then return jsonb_build_object('id',aid);end if;
 select array_agg(value::uuid) into sv from jsonb_array_elements_text(payload->'services');day:=(payload->>'day')::date;period:=payload->>'period';
 if action='move' then
 select * into apt from kroner_private.appointments where id=(payload->>'id')::uuid and shop=sid for update;if apt.id is null or apt.status<>'booked' then raise exception 'Somente reservas abertas podem ser remarcadas.';end if;
 if cid<>apt.client or (select array_agg(x order by x) from unnest(sv) x) is distinct from (select array_agg((value->>'id')::uuid order by (value->>'id')::uuid) from jsonb_array_elements(apt.services)) then raise exception 'Remarque mantendo o cliente e os serviços originais.';end if;
 update kroner_private.appointments set status='cancelled' where id=apt.id;
 end if;
 if payload ? 'professional' and coalesce(payload->>'professional','auto')<>'auto' then
   slots:=kroner_private.chair_slots(sid,(payload->>'professional')::uuid,sv,day,period,action='manual_book');
 else
   slots:=kroner_private.available(sid,sv,day,period);
 end if;
 select value into slot from jsonb_array_elements(slots) where (value->>'start')::timestamptz=(payload->>'start')::timestamptz;
 if slot is null then raise exception 'Horário indisponível. Atualize a agenda e escolha outro.';end if;
 select jsonb_agg(jsonb_build_object('id',id,'name',name,'duration',duration,'price',price)) into result from kroner_private.services where shop=sid and id=any(sv) and active;
 if action='move' then update kroner_private.appointments set starts=(slot->>'start')::timestamptz,ends=(slot->>'end')::timestamptz,status='booked' where id=apt.id;aid:=apt.id;
 else insert into kroner_private.appointments(shop,client,starts,ends,services,price,professional,request_id) values(sid,cid,(slot->>'start')::timestamptz,(slot->>'end')::timestamptz,result,(slot->>'price')::int,coalesce((payload->>'professional')::uuid,(select id from kroner_private.professionals where shop=sid and role='owner')),op) returning id into aid;end if;
 result:=jsonb_build_object('id',aid);
 elsif action='cancel' then
 update kroner_private.appointments set status=case when payload->>'status'='absent' then 'absent' else 'cancelled' end where id=(payload->>'id')::uuid and shop=sid and status='booked';result:='{"ok":true}';
 elsif action='finish' then
 select * into apt from kroner_private.appointments where id=(payload->>'id')::uuid and shop=sid for update;
 if apt.id is null or apt.status<>'booked' then raise exception 'Atendimento não está aberto.';end if;
 if payload->>'payment'='monthly' then
 if apt.membership is null then raise exception 'Este atendimento não está vinculado a uma mensalidade.';end if;
 else
 insert into kroner_private.charges(shop,client,appointment,description,amount,due) values(sid,apt.client,apt.id,'Atendimento',apt.price,(apt.starts at time zone coalesce(s.cfg->>'timezone','America/Sao_Paulo'))::date) returning id into ch;
 if payload->>'payment' in('full','partial') then
 amount:=case when payload->>'payment'='full' then apt.price else (payload->>'amount')::int end;
 perform kroner_private.api('pay',jsonb_build_object('charge',ch,'amount',amount,'method',payload->>'method','paid_on',payload->>'paid_on','settles_on',payload->>'settles_on','request_id',gen_random_uuid()));end if;
 end if;
 update kroner_private.appointments set status='done' where id=apt.id;result:='{"ok":true}';
 elsif action='charge' then
 if payload->>'category'='injection' and payload->>'direction'<>'in' or payload->>'category' in('withdrawal','expense') and payload->>'direction'<>'out' then raise exception 'Aporte é entrada; despesa e retirada são saídas.';end if;
 amount:=(payload->>'amount')::int;if amount<=0 then raise exception 'Valor deve ser positivo.';end if;
 insert into kroner_private.charges(shop,client,description,amount,direction,category,due) values(sid,nullif(payload->>'client','')::uuid,left(payload->>'description',200),amount,case when payload->>'direction'='out' then 'out' else 'in' end,case when payload->>'category' in('expense','injection','withdrawal','sale') then payload->>'category' else 'other' end,(payload->>'due')::date) returning id into ch;
 if coalesce((payload->>'paid')::boolean,false) then perform kroner_private.api('pay',jsonb_build_object('charge',ch,'amount',amount,'method',payload->>'method','paid_on',payload->>'due','settles_on',payload->>'due','request_id',gen_random_uuid()));end if;result:=jsonb_build_object('id',ch);
 elsif action='pay' then
 select * into c from kroner_private.charges where id=(payload->>'charge')::uuid and shop=sid for update;if c.id is null then raise exception 'Lançamento não encontrado.';end if;
 select coalesce(sum(p.amount),0) into paid from kroner_private.payments p where p.charge=c.id;
 amount:=(payload->>'amount')::int;if amount<=0 or amount>c.amount-paid then raise exception 'Recebimento maior que o saldo ou valor inválido.';end if;
 method:=payload->>'method';bps:=case when c.direction='out' then 0 when method='credit' then coalesce((s.cfg->>'creditFee')::int,0) when method='debit' then coalesce((s.cfg->>'debitFee')::int,0) else 0 end;fee:=round(amount*bps/10000.0);
 if (payload->>'settles_on')::date<(payload->>'paid_on')::date then raise exception 'Liquidação anterior ao pagamento.';end if;
 insert into kroner_private.payments(shop,charge,amount,fee,method,paid_on,settles_on,request_id) values(sid,c.id,amount,fee,method,(payload->>'paid_on')::date,(payload->>'settles_on')::date,coalesce(op,gen_random_uuid()));result:='{"ok":true}';
 elsif action='product' then
 insert into kroner_private.products(shop,name,cost,price,minimum,expires) values(sid,left(payload->>'name',100),(payload->>'cost')::int,(payload->>'price')::int,(payload->>'minimum')::int,nullif(payload->>'expires','')::date) returning id into rid;result:=jsonb_build_object('id',rid);
 elsif action='stock' then
 select * into pr from kroner_private.products where id=(payload->>'id')::uuid and shop=sid for update;if pr.id is null then raise exception 'Produto não encontrado.';end if;
 qty:=(payload->>'quantity')::int;if qty<=0 then raise exception 'Quantidade deve ser positiva.';end if;
 if payload->>'kind' not in('purchase','sale','loss','internal') then raise exception 'Movimento inválido.';end if;
 if payload->>'kind'<>'purchase' and qty>pr.quantity then raise exception 'Estoque insuficiente.';end if;
 if payload->>'kind' in('purchase','sale') then
 amount:=qty*case when payload->>'kind'='purchase' then pr.cost else pr.price end;
 insert into kroner_private.charges(shop,description,amount,direction,category,due) values(sid,qty||' × '||pr.name,amount,case when payload->>'kind'='purchase' then 'out' else 'in' end,case when payload->>'kind'='purchase' then 'stock_purchase' else 'sale' end,(payload->>'due')::date) returning id into ch;
 if coalesce((payload->>'paid')::boolean,false) and amount>0 then perform kroner_private.api('pay',jsonb_build_object('charge',ch,'amount',amount,'method',payload->>'method','paid_on',payload->>'due','settles_on',coalesce(payload->>'settles_on',payload->>'due'),'request_id',gen_random_uuid()));end if;
 end if;
 update kroner_private.products set quantity=quantity+case when payload->>'kind'='purchase' then qty else -qty end,updated_at=now() where id=pr.id;
 insert into kroner_private.movements(shop,product,quantity,kind,unit_cost,charge,note) values(sid,pr.id,qty,payload->>'kind',pr.cost,ch,left(payload->>'note',200));result:='{"ok":true}';
 elsif action='block' then
 if (payload->>'end')::timestamptz<=(payload->>'start')::timestamptz then raise exception 'Intervalo inválido.';end if;
 if exists(select 1 from kroner_private.appointments where shop=sid and status='booked' and starts<(payload->>'end')::timestamptz and ends>(payload->>'start')::timestamptz) then raise exception 'Há reservas nesse intervalo. Remarque ou cancele antes de bloquear.';end if;
 insert into kroner_private.blocks(shop,starts,ends,reason) values(sid,(payload->>'start')::timestamptz,(payload->>'end')::timestamptz,left(payload->>'reason',200));result:='{"ok":true}';
 elsif action='unblock' then delete from kroner_private.blocks where id=(payload->>'id')::uuid and shop=sid;result:='{"ok":true}';
 elsif action='recurring' then
 insert into kroner_private.recurring(shop,name,amount,day,variable) values(sid,left(payload->>'name',100),(payload->>'amount')::int,(payload->>'day')::int,(payload->>'variable')::boolean);result:='{"ok":true}';
 elsif action='generate_expenses' then
 month:=date_trunc('month',(payload->>'month')::date)::date;
 for r in select * from kroner_private.recurring where shop=sid and active loop
 if not exists(select 1 from kroner_private.recurring_runs where recurring=r.id and recurring_runs.month=ctx.month) and not r.variable then
 insert into kroner_private.charges(shop,description,amount,direction,category,due) values(sid,r.name,r.amount,'out','expense',month+r.day-1) returning id into ch;
 insert into kroner_private.recurring_runs values(r.id,month,ch);end if;end loop;result:='{"ok":true}';
 elsif action='membership' then
 select array_agg(value::uuid) into sv from jsonb_array_elements_text(payload->'services');
 if not exists(select 1 from kroner_private.clients where shop=sid and id=(payload->>'client')::uuid) or cardinality(sv)=0 or (select count(*) from kroner_private.services where shop=sid and id=any(sv) and active)<>cardinality(sv) then raise exception 'Cliente ou serviços inválidos.';end if;
 insert into kroner_private.memberships(shop,client,service_ids,weekday,at_time,price,due_day,professional) values(sid,(payload->>'client')::uuid,sv,(payload->>'weekday')::int,(payload->>'time')::time,(payload->>'price')::int,(payload->>'due_day')::int,nullif(payload->>'professional','')::uuid);result:='{"ok":true}';
 elsif action='monthly_generate' then
 select * into m from kroner_private.memberships where id=(payload->>'id')::uuid and shop=sid and active;if m.id is null then raise exception 'Plano inválido.';end if;
 month:=date_trunc('month',(payload->>'month')::date)::date;until_day:=(month+interval '1 month - 1 day')::date;dd:=month;
 if exists(select 1 from kroner_private.charges where membership=m.id and charges.month=ctx.month) then raise exception 'Este mês já foi gerado.';end if;
 select sum(duration),jsonb_agg(jsonb_build_object('id',id,'name',name,'price',price,'duration',duration)) into dur,result from kroner_private.services where shop=sid and id=any(m.service_ids) and active;
 if dur is null then raise exception 'Serviços desativados.';end if;
 day:=null;
 while dd<=until_day loop
 if extract(dow from dd)::int=m.weekday and dd >= (now() at time zone coalesce(s.cfg->>'timezone','America/Sao_Paulo'))::date then
 w:=s.cfg->'week'->m.weekday;
 if not coalesce((w->>'enabled')::boolean,false) or m.at_time<(w->>'open')::time or m.at_time+make_interval(mins=>dur)>(w->>'close')::time or (nullif(w->>'lunchStart','') is not null and m.at_time<(w->>'lunchEnd')::time and m.at_time+make_interval(mins=>dur)>(w->>'lunchStart')::time) then raise exception 'Horário fixo fora do expediente.';end if;
 if exists(select 1 from kroner_private.blocks where shop=sid and starts<((dd+m.at_time) at time zone coalesce(s.cfg->>'timezone','America/Sao_Paulo'))+make_interval(mins=>dur) and ends>((dd+m.at_time) at time zone coalesce(s.cfg->>'timezone','America/Sao_Paulo'))) then raise exception 'Há bloqueio em um dos horários fixos.';end if;
 insert into kroner_private.appointments(shop,client,starts,ends,services,price,membership,professional,request_id) values(sid,m.client,(dd+m.at_time) at time zone coalesce(s.cfg->>'timezone','America/Sao_Paulo'),((dd+m.at_time) at time zone coalesce(s.cfg->>'timezone','America/Sao_Paulo'))+make_interval(mins=>dur),result,0,m.id,m.professional,gen_random_uuid());day:=dd;
 end if;dd:=dd+1;end loop;
 if day is null then raise exception 'Nenhum atendimento futuro neste mês.';end if;
 insert into kroner_private.charges(shop,client,membership,month,description,amount,due,category) values(sid,m.client,m.id,month,'Mensalidade '||to_char(month,'MM/YYYY'),m.price,case when m.due_day=0 then day else month+m.due_day-1 end,'monthly');result:='{"ok":true}';
 elsif action='monthly_stop' then
 update kroner_private.memberships set active=false where id=(payload->>'id')::uuid and shop=sid;
 update kroner_private.appointments set status='cancelled' where membership=(payload->>'id')::uuid and shop=sid and status='booked' and starts>now();result:='{"ok":true}';
 else raise exception 'Operação desconhecida.';end if;
 insert into kroner_private.audit(shop,actor,action,record_id) values(sid,uid,action,coalesce(aid,ch,rid));
 if op is not null and action not in('book','manual_book') then update kroner_private.requests set result=ctx.result where id=op and actor=uid;end if;
 return result;
exception when exclusion_violation then raise exception 'Já existe um atendimento nesse horário. Escolha outro.';
end $function$;

create or replace function public.kroner_api(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select kroner_private.api(action,payload)$$;

grant usage on schema kroner_private to anon,authenticated;
grant execute on function public.kroner_api(text,jsonb) to anon,authenticated;
