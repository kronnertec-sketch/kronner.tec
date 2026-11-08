create table kroner_private.calendar_events(
 id uuid primary key default gen_random_uuid(),shop uuid not null references kroner_private.shops,day date not null,name text not null,scope text not null check(scope in ('Municipal','Estadual','Nacional')),source text not null,state text not null,city text not null,actor uuid not null references kroner_private.app_users,updated_at timestamptz not null default now(),
 unique(shop,day,scope,state,city)
);
alter table kroner_private.calendar_events enable row level security;
revoke all on kroner_private.calendar_events from public,anon,authenticated;
create function kroner_private.local_holiday(sid uuid,d date) returns boolean language sql stable set search_path='' as $$
select exists(select 1 from kroner_private.calendar_events h join kroner_private.shops s on s.id=h.shop where s.id=sid and h.day=d and (h.scope='Nacional' or h.state=s.cfg->>'state' and (h.scope='Estadual' or lower(h.city)=lower(s.cfg->>'city'))));$$;
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
 if a>=now()+make_interval(mins=>case when manual then 0 else coalesce((s.cfg->>'notice')::int,10) end)
 and (lunch1 is null or not (cursor_t<lunch2 and day+cursor_t+make_interval(mins=>dur)>day+lunch1))
 and not exists(select 1 from kroner_private.appointments x where x.shop=sid and x.professional=chair and x.status in('booked','done') and x.starts<b+make_interval(mins=>buffer_minutes) and x.ends+make_interval(mins=>buffer_minutes)>a)
 and not exists(select 1 from kroner_private.blocks x where x.shop=sid and x.starts<b and x.ends>a)
 then result:=result||jsonb_build_object('start',a,'end',b,'label',to_char(cursor_t,'HH24:MI'),'duration',dur,'price',price);end if;
 exit when cursor_t+make_interval(mins=>step)<=cursor_t;cursor_t:=cursor_t+make_interval(mins=>step);
 end loop;return result;
end $$;



create or replace function kroner_private.check_holiday_booking() returns trigger language plpgsql set search_path='' as $$
declare local_day date; decisions jsonb;
begin
 if new.status<>'booked' then return new;end if;
 if tg_op='UPDATE' and old.starts=new.starts and old.professional=new.professional then return new;end if;
 select (new.starts at time zone coalesce(s.cfg->>'timezone','America/Sao_Paulo'))::date,
 case when p.role='owner' or p.id is null then coalesce(p.preferences->'holidayDecisions',s.cfg->'holidayDecisions') else p.preferences->'holidayDecisions' end
 into local_day,decisions from kroner_private.shops s left join kroner_private.professionals p on p.id=new.professional where s.id=new.shop;
 if (kroner_private.local_holiday(new.shop,local_day) or to_char(local_day,'MM-DD') in ('01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-25')) and coalesce(decisions->>local_day::text,'')<>'open' then raise exception 'Agenda fechada neste feriado.';end if;
 return new;
end;$$;

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
 if jsonb_typeof(prefs)<>'object' or prefs-array['buffer','week','durations','disabledServices']<>'{}'::jsonb or not(prefs ?& array['buffer','week','durations','disabledServices']) or (prefs->>'buffer')::int not between 0 and 180 or jsonb_array_length(prefs->'week')<>7 then raise exception 'Confira intervalos e expediente.';end if;
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

