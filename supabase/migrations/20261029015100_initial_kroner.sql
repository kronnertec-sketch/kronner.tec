create extension if not exists btree_gist with schema extensions;
create schema if not exists kroner_private;
revoke all on schema kroner_private from public;
create table kroner_private.shops(id uuid primary key default gen_random_uuid(), owner uuid not null references auth.users(id), slug text unique not null default encode(extensions.gen_random_bytes(8),'hex'), name text not null default 'Minha barbearia', cfg jsonb not null default '{}', active boolean not null default false, created_at timestamptz default now(), unique(owner));
create table kroner_private.services(id uuid primary key default gen_random_uuid(),shop uuid not null references kroner_private.shops, name text not null,price integer not null check(price>=0),duration integer not null check(duration between 5 and 480),active boolean default true,unique(id,shop));
create table kroner_private.clients(id uuid primary key default gen_random_uuid(),shop uuid not null references kroner_private.shops,user_id uuid references auth.users,name text not null,phone text not null,created_at timestamptz default now(),unique(shop,user_id),unique(id,shop));
create table kroner_private.memberships(id uuid primary key default gen_random_uuid(),shop uuid not null references kroner_private.shops,client uuid not null,service_ids uuid[] not null,weekday integer check(weekday between 0 and 6),at_time time not null,price integer check(price>=0),due_day integer check(due_day between 0 and 28),active boolean default true, foreign key(client,shop) references kroner_private.clients(id,shop));
create table kroner_private.appointments(id uuid primary key default gen_random_uuid(),shop uuid not null references kroner_private.shops,client uuid not null,starts timestamptz not null,ends timestamptz not null,services jsonb not null,price integer not null check(price>=0),status text not null default 'booked' check(status in('booked','done','cancelled','absent')),membership uuid references kroner_private.memberships,request_id uuid not null unique,created_at timestamptz default now(),foreign key(client,shop) references kroner_private.clients(id,shop),check(ends>starts),exclude using gist(shop with =,tstzrange(starts,ends,'[)') with &&) where(status in('booked','done')));
create table kroner_private.blocks(id uuid primary key default gen_random_uuid(),shop uuid not null references kroner_private.shops,starts timestamptz not null,ends timestamptz not null,reason text not null,check(ends>starts));
create table kroner_private.charges(id uuid primary key default gen_random_uuid(),shop uuid not null references kroner_private.shops,client uuid,appointment uuid unique references kroner_private.appointments, membership uuid references kroner_private.memberships,month date,description text not null,amount integer not null check(amount>=0),direction text not null default 'in' check(direction in('in','out')),category text not null default 'service',due date not null,created_at timestamptz default now(),unique(membership,month),foreign key(client,shop) references kroner_private.clients(id,shop));
create table kroner_private.payments(id uuid primary key default gen_random_uuid(),shop uuid not null references kroner_private.shops,charge uuid not null references kroner_private.charges,amount integer not null check(amount>0),fee integer not null check(fee>=0 and fee<=amount),method text not null check(method in('pix','cash','credit','debit')),paid_on date not null,settles_on date not null,request_id uuid not null unique,created_at timestamptz default now());
create table kroner_private.products(id uuid primary key default gen_random_uuid(),shop uuid not null references kroner_private.shops,name text not null,cost integer not null check(cost>=0),price integer not null check(price>=0),quantity integer not null default 0 check(quantity>=0),minimum integer not null default 2 check(minimum>=0),expires date,updated_at timestamptz default now());
create table kroner_private.movements(id uuid primary key default gen_random_uuid(),shop uuid not null references kroner_private.shops,product uuid not null references kroner_private.products,quantity integer not null,kind text not null,unit_cost integer not null,charge uuid references kroner_private.charges,note text,created_at timestamptz default now());
create table kroner_private.recurring(id uuid primary key default gen_random_uuid(),shop uuid not null references kroner_private.shops,name text not null,amount integer not null check(amount>=0),day integer not null check(day between 1 and 28),variable boolean default false,active boolean default true);
create table kroner_private.recurring_runs(recurring uuid references kroner_private.recurring,month date,charge uuid references kroner_private.charges,primary key(recurring,month));
create table kroner_private.audit(id bigint generated always as identity primary key,shop uuid references kroner_private.shops,actor uuid,action text not null,record_id uuid,created_at timestamptz default now());
create table kroner_private.requests(id uuid primary key,actor uuid not null,action text not null,result jsonb,created_at timestamptz default now());
create index on kroner_private.clients(shop);create index on kroner_private.clients(user_id);create index on kroner_private.services(shop);create index on kroner_private.appointments(shop,starts);create index on kroner_private.appointments(client);create index on kroner_private.charges(shop,due);create index on kroner_private.payments(charge);create index on kroner_private.payments(shop,settles_on);create index on kroner_private.products(shop);create index on kroner_private.blocks(shop,starts);create index on kroner_private.memberships(shop);create index on kroner_private.movements(shop);create index on kroner_private.recurring(shop);
do $$ declare t record;begin for t in select tablename from pg_tables where schemaname='kroner_private' loop execute format('alter table kroner_private.%I enable row level security',t.tablename);end loop;end $$;

create function kroner_private.available(sid uuid,svc uuid[],day date,period text) returns jsonb language plpgsql set search_path='' as $$
declare s kroner_private.shops; w jsonb; dur integer; price integer; n integer; lo time; hi time; lunch1 time; lunch2 time; a timestamptz; b timestamptz; cursor_t time; z text; result jsonb:='[]'; step integer;
begin
 select * into s from kroner_private.shops where id=sid and active; if s.id is null then return result;end if;
 select sum(duration),sum(services.price),count(*) into dur,price,n from kroner_private.services where shop=sid and active and id=any(svc);
 if n=0 or n<>cardinality(svc) then return result;end if;
 z:=coalesce(s.cfg->>'timezone','America/Sao_Paulo');
 if day<(now() at time zone z)::date or day>(now() at time zone z)::date+coalesce((s.cfg->>'maxDays')::int,21) then return result;end if;
 w:=s.cfg->'week'->extract(dow from day)::int;if not coalesce((w->>'enabled')::boolean,false) then return result;end if;
 lo:=(w->>'open')::time;hi:=(w->>'close')::time;lunch1:=nullif(w->>'lunchStart','')::time;lunch2:=nullif(w->>'lunchEnd','')::time;
 if period='morning' then hi:=least(hi,coalesce(lunch1,'11:00'::time));
 elsif period='afternoon' then lo:=greatest(lo,coalesce(lunch2,'11:00'::time));hi:=least(hi,'18:00'::time);
 elsif period='night' then lo:=greatest(lo,'18:00'::time);
 else raise exception 'Período inválido.';end if;
 step:=greatest(5,coalesce((s.cfg->>'grid')::integer,15));cursor_t:=lo;
 while cursor_t+make_interval(mins=>dur)<=hi and cursor_t<hi loop
 a:=(day+cursor_t) at time zone z;b:=a+make_interval(mins=>dur);
 if a>=now()+make_interval(mins=>coalesce((s.cfg->>'notice')::int,30))
 and (lunch1 is null or not (cursor_t<lunch2 and cursor_t+make_interval(mins=>dur)>lunch1))
 and not exists(select 1 from kroner_private.appointments x where x.shop=sid and x.status in('booked','done') and x.starts<b and x.ends>a)
 and not exists(select 1 from kroner_private.blocks x where x.shop=sid and x.starts<b and x.ends>a)
 then result:=result||jsonb_build_object('start',a,'end',b,'label',to_char(cursor_t,'HH24:MI'),'duration',dur,'price',price);end if;
 exit when cursor_t+make_interval(mins=>step)<=cursor_t;cursor_t:=cursor_t+make_interval(mins=>step);
 end loop;return result;
end $$;

create function kroner_private.api(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();s kroner_private.shops;sid uuid;cid uuid;rid uuid;aid uuid;ch uuid;pr kroner_private.products;apt kroner_private.appointments;c kroner_private.charges;m kroner_private.memberships;r record;cfg jsonb;sv uuid[];slots jsonb;slot jsonb;day date;dd date;period text;dur int;amount int;paid int;qty int;bps int;fee int;method text;result jsonb;w jsonb;op uuid;exists_result jsonb;month date;until_day date;
begin
 if action in('public','slots') then
 select * into s from kroner_private.shops where slug=payload->>'slug' and active;
 if s.id is null then raise exception 'Barbearia indisponível ou link inválido.';end if;
 if action='public' then return jsonb_build_object('id',s.id,'slug',s.slug,'name',s.name,'cfg',s.cfg-'phone'-'creditFee'-'debitFee','services',coalesce((select jsonb_agg(to_jsonb(v)) from kroner_private.services v where v.shop=s.id and v.active),'[]'));end if;
 select array_agg(value::uuid) into sv from jsonb_array_elements_text(payload->'services');
 return kroner_private.available(s.id,sv,(payload->>'day')::date,payload->>'period');
 end if;
 if uid is null then raise exception 'Entre na sua conta para continuar.';end if;
 if action='my_appointments' then return coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'starts',a.starts,'ends',a.ends,'services',a.services,'price',a.price,'status',a.status,'shop_name',x.name,'slug',x.slug,'timezone',x.cfg->>'timezone')) from kroner_private.appointments a join kroner_private.clients cl on cl.id=a.client join kroner_private.shops x on x.id=a.shop where cl.user_id=uid and a.starts>now()-interval '1 year'),'[]');end if;
 if action='book' then
 select * into s from kroner_private.shops where slug=payload->>'slug' and active for update;
 if s.id is null then raise exception 'Barbearia indisponível.';end if;
 else select * into s from kroner_private.shops where owner=uid for update;end if;
 if action='workspace' then
 if s.id is null then insert into kroner_private.shops(owner) values(uid) on conflict(owner) do nothing;select * into s from kroner_private.shops where owner=uid;end if;
 return jsonb_build_object('shop',to_jsonb(s),'services',coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.services x where shop=s.id),'[]'),'clients',coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.clients x where shop=s.id),'[]'),'appointments',coalesce((select jsonb_agg(to_jsonb(x) order by starts) from kroner_private.appointments x where shop=s.id),'[]'),'charges',coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.charges x where shop=s.id),'[]'),'payments',coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.payments x where shop=s.id),'[]'),'products',coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.products x where shop=s.id),'[]'),'memberships',coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.memberships x where shop=s.id),'[]'),'blocks',coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.blocks x where shop=s.id),'[]'),'recurring',coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.recurring x where shop=s.id),'[]'),'movements',coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.movements x where shop=s.id),'[]'));
 end if;
 if action='cancel_own' then
 select a.* into apt from kroner_private.appointments a join kroner_private.clients cl on cl.id=a.client where a.id=(payload->>'id')::uuid and cl.user_id=uid for update of a;
 if apt.id is null then raise exception 'Reserva não encontrada.';end if;
 select * into s from kroner_private.shops where id=apt.shop;
 if apt.status<>'booked' or apt.starts<now()+make_interval(mins=>coalesce((s.cfg->>'cancelMinutes')::int,120)) then raise exception 'Prazo de cancelamento encerrado. Fale com a barbearia.';end if;
 update kroner_private.appointments set status='cancelled' where id=apt.id;return '{"ok":true}';end if;
 if s.id is null then raise exception 'Configure sua barbearia primeiro.';end if;sid:=s.id;
 if action='settings' then
 cfg:=payload->'cfg';if jsonb_typeof(cfg)<>'object' then raise exception 'Configuração inválida.';end if;
 if length(payload->>'name')<2 then raise exception 'Informe o nome da barbearia.';end if;
 if coalesce(cfg->>'phone','')!~'^\+55[1-9][0-9][0-9]{8,9}$' then raise exception 'Informe telefone com DDD.';end if;
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
 update kroner_private.shops set name=left(payload->>'name',100),cfg=cfg,active=active or coalesce((payload->>'activate')::boolean,false) where id=sid;return '{"ok":true}';
 end if;
 if action='service' then
 if nullif(payload->>'id','') is null then insert into kroner_private.services(shop,name,price,duration) values(sid,left(payload->>'name',100),(payload->>'price')::int,(payload->>'duration')::int);
 else update kroner_private.services set name=left(payload->>'name',100),price=(payload->>'price')::int,duration=(payload->>'duration')::int,active=coalesce((payload->>'active')::boolean,true) where id=(payload->>'id')::uuid and shop=sid;end if;return '{"ok":true}';end if;
 if not s.active then raise exception 'Conclua as configurações obrigatórias.';end if;
 -- Every operation locks its shop; financial requests are independently idempotent.
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
 select * into apt from kroner_private.appointments where id=(payload->>'id')::uuid and shop=sid for update;if apt.status<>'booked' then raise exception 'Somente reservas abertas podem ser remarcadas.';end if;
 update kroner_private.appointments set status='cancelled' where id=apt.id;
 end if;
 slots:=kroner_private.available(sid,sv,day,period);
 select value into slot from jsonb_array_elements(slots) where (value->>'start')::timestamptz=(payload->>'start')::timestamptz;
 if slot is null then raise exception 'Horário indisponível. Atualize a agenda e escolha outro.';end if;
 select jsonb_agg(jsonb_build_object('id',id,'name',name,'duration',duration,'price',price)) into result from kroner_private.services where shop=sid and id=any(sv) and active;
 if action='move' then update kroner_private.appointments set starts=(slot->>'start')::timestamptz,ends=(slot->>'end')::timestamptz,status='booked' where id=apt.id;aid:=apt.id;
 else insert into kroner_private.appointments(shop,client,starts,ends,services,price,request_id) values(sid,cid,(slot->>'start')::timestamptz,(slot->>'end')::timestamptz,result,(slot->>'price')::int,op) returning id into aid;end if;
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
 if not exists(select 1 from kroner_private.recurring_runs where recurring=r.id and recurring_runs.month=api.month) and not r.variable then
 insert into kroner_private.charges(shop,description,amount,direction,category,due) values(sid,r.name,r.amount,'out','expense',month+r.day-1) returning id into ch;
 insert into kroner_private.recurring_runs values(r.id,month,ch);end if;end loop;result:='{"ok":true}';
 elsif action='membership' then
 select array_agg(value::uuid) into sv from jsonb_array_elements_text(payload->'services');
 if not exists(select 1 from kroner_private.clients where shop=sid and id=(payload->>'client')::uuid) or cardinality(sv)=0 or (select count(*) from kroner_private.services where shop=sid and id=any(sv) and active)<>cardinality(sv) then raise exception 'Cliente ou serviços inválidos.';end if;
 insert into kroner_private.memberships(shop,client,service_ids,weekday,at_time,price,due_day) values(sid,(payload->>'client')::uuid,sv,(payload->>'weekday')::int,(payload->>'time')::time,(payload->>'price')::int,(payload->>'due_day')::int);result:='{"ok":true}';
 elsif action='monthly_generate' then
 select * into m from kroner_private.memberships where id=(payload->>'id')::uuid and shop=sid and active;if m.id is null then raise exception 'Plano inválido.';end if;
 month:=date_trunc('month',(payload->>'month')::date)::date;until_day:=(month+interval '1 month - 1 day')::date;dd:=month;
 if exists(select 1 from kroner_private.charges where membership=m.id and charges.month=api.month) then raise exception 'Este mês já foi gerado.';end if;
 select sum(duration),jsonb_agg(jsonb_build_object('id',id,'name',name,'price',price,'duration',duration)) into dur,result from kroner_private.services where shop=sid and id=any(m.service_ids) and active;
 if dur is null then raise exception 'Serviços desativados.';end if;
 day:=null;
 while dd<=until_day loop
 if extract(dow from dd)::int=m.weekday and dd >= (now() at time zone coalesce(s.cfg->>'timezone','America/Sao_Paulo'))::date then
 -- Recurring appointments are explicitly manager-authorized, outside the public advance window.
 w:=s.cfg->'week'->m.weekday;
 if not coalesce((w->>'enabled')::boolean,false) or m.at_time<(w->>'open')::time or m.at_time+make_interval(mins=>dur)>(w->>'close')::time or (nullif(w->>'lunchStart','') is not null and m.at_time<(w->>'lunchEnd')::time and m.at_time+make_interval(mins=>dur)>(w->>'lunchStart')::time) then raise exception 'Horário fixo fora do expediente.';end if;
 if exists(select 1 from kroner_private.blocks where shop=sid and starts<((dd+m.at_time) at time zone coalesce(s.cfg->>'timezone','America/Sao_Paulo'))+make_interval(mins=>dur) and ends>((dd+m.at_time) at time zone coalesce(s.cfg->>'timezone','America/Sao_Paulo'))) then raise exception 'Há bloqueio em um dos horários fixos.';end if;
 insert into kroner_private.appointments(shop,client,starts,ends,services,price,membership,request_id) values(sid,m.client,(dd+m.at_time) at time zone coalesce(s.cfg->>'timezone','America/Sao_Paulo'),((dd+m.at_time) at time zone coalesce(s.cfg->>'timezone','America/Sao_Paulo'))+make_interval(mins=>dur),result,0,m.id,gen_random_uuid());day:=dd;
 end if;dd:=dd+1;end loop;
 if day is null then raise exception 'Nenhum atendimento futuro neste mês.';end if;
 insert into kroner_private.charges(shop,client,membership,month,description,amount,due,category) values(sid,m.client,m.id,month,'Mensalidade '||to_char(month,'MM/YYYY'),m.price,case when m.due_day=0 then day else month+m.due_day-1 end,'monthly');result:='{"ok":true}';
 elsif action='monthly_stop' then
 update kroner_private.memberships set active=false where id=(payload->>'id')::uuid and shop=sid;
 update kroner_private.appointments set status='cancelled' where membership=(payload->>'id')::uuid and shop=sid and status='booked' and starts>now();result:='{"ok":true}';
 else raise exception 'Operação desconhecida.';end if;
 insert into kroner_private.audit(shop,actor,action,record_id) values(sid,uid,action,coalesce(aid,ch,rid));
 if op is not null and action not in('book','manual_book') then update kroner_private.requests set result=api.result where id=op and actor=uid;end if;
 return result;
exception when exclusion_violation then raise exception 'Já existe um atendimento nesse horário. Escolha outro.';
end $$;
create function public.kroner_api(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select kroner_private.api(action,payload)$$;
revoke all on function kroner_private.api(text,jsonb) from public;
revoke all on function kroner_private.available(uuid,uuid[],date,text) from public;
revoke all on function public.kroner_api(text,jsonb) from public;
grant usage on schema kroner_private to anon,authenticated;
grant execute on function kroner_private.api(text,jsonb),public.kroner_api(text,jsonb) to anon,authenticated;
revoke all on all tables in schema kroner_private from anon,authenticated;
