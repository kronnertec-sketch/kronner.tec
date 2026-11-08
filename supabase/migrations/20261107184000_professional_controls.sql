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
 if action='profile' then
 return jsonb_build_object('id',me.id,'slug',shoprow.slug,'timezone',coalesce(shoprow.cfg->>'timezone','America/Sao_Paulo'),'preferences',me.preferences,'week',coalesce(me.preferences->'week',shoprow.cfg->'week'),'services',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'duration',duration) order by name) from kroner_private.services where shop=me.shop and active),'[]'));
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

CREATE OR REPLACE FUNCTION kroner_private.api(action text, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
<<ctx>>
declare actor_seat kroner_private.professionals; chair uuid; chair_role text; uid uuid:=kroner_private.current_user_id();s kroner_private.shops;sid uuid;cid uuid;rid uuid;aid uuid;ch uuid;pr kroner_private.products;apt kroner_private.appointments;c kroner_private.charges;m kroner_private.memberships;r record;cfg jsonb;sv uuid[];slots jsonb;slot jsonb;day date;dd date;period text;dur int;amount int;paid int;qty int;bps int;fee int;method text;result jsonb;w jsonb;op uuid;exists_result jsonb;month date;until_day date;
begin
 if octet_length(payload::text)>65536 then raise exception 'Solicitação muito grande.';end if;
 if action in('public','slots') then
 select * into s from kroner_private.shops where slug=payload->>'slug' and active;
 if s.id is null then raise exception 'Barbearia indisponível ou link inválido.';end if;
 select id,role into chair,chair_role from kroner_private.professionals where shop=s.id and status='active' and (case when coalesce(payload->>'professional','auto')='auto' then role='owner' else id=(payload->>'professional')::uuid end);
 if chair is null then raise exception 'Este profissional está indisponível. Acesse o link geral da barbearia.';end if;
 if action='public' then return jsonb_build_object('id',s.id,'slug',s.slug,'name',s.name,'professionals',(select jsonb_agg(jsonb_build_object('id',p.id,'name',case when p.role='owner' then coalesce(s.cfg->>'professional',p.name) else p.name end,'owner',p.role='owner') order by (p.role='owner') desc,p.name) from kroner_private.professionals p where p.shop=s.id and p.status='active'),'professional',chair,'cfg',s.cfg-'phone'-'creditFee'-'debitFee','services',coalesce((select jsonb_agg(to_jsonb(v)||jsonb_build_object('duration',coalesce((p.preferences->'durations'->>v.id::text)::int,v.duration))) from kroner_private.services v join kroner_private.professionals p on p.id=chair where v.shop=s.id and v.active and not(coalesce(p.preferences->'disabledServices','[]') ? v.id::text)),'[]'));end if;
 select array_agg(value::uuid) into sv from jsonb_array_elements_text(payload->'services');
 if payload->>'professional'='auto' then
 return coalesce((select jsonb_agg(item order by item->>'start') from (select distinct on (v->>'start') v||jsonb_build_object('professional',p.id,'professionalName',case when p.role='owner' then coalesce(s.cfg->>'professional',p.name) else p.name end) as item from kroner_private.professionals p cross join lateral jsonb_array_elements(kroner_private.chair_slots(s.id,p.id,sv,(payload->>'day')::date,payload->>'period',false)) v where p.shop=s.id and p.status='active' order by v->>'start',p.id) options),'[]');
 end if;
 return kroner_private.chair_slots(s.id,chair,sv,(payload->>'day')::date,payload->>'period',false);
 end if;
 if uid is null then raise exception 'Entre na sua conta para continuar.';end if;
 if action='my_appointments' then return coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'starts',a.starts,'ends',a.ends,'services',a.services,'price',a.price,'status',a.status,'shop_name',x.name,'slug',x.slug,'timezone',x.cfg->>'timezone')) from kroner_private.appointments a join kroner_private.clients cl on cl.id=a.client join kroner_private.shops x on x.id=a.shop where cl.user_id=uid and a.starts>now()-interval '1 year'),'[]');end if;
 if action='book' then
 select * into s from kroner_private.shops where slug=payload->>'slug' and active for update;
 if s.id is null then raise exception 'Barbearia indisponível.';end if;
 else
 select * into actor_seat from kroner_private.professionals where user_id=uid and status='active' for share;
 select * into s from kroner_private.shops where id=actor_seat.shop for update;
 if actor_seat.role='partner' and action not in ('workspace','manual_book','move','cancel','finish','pay','client','charge','product','stock','membership','monthly_generate','monthly_stop','generate_expenses','recurring','cancel_own') then raise exception 'Esta operação exige a conta principal.';end if;
 if actor_seat.role='employee' then
 if action not in ('manual_book','move','cancel','finish','pay','client','cancel_own') then raise exception 'Operação restrita para funcionário.';end if;
 if action in ('move','cancel','finish') and not exists(select 1 from kroner_private.appointments where id=(payload->>'id')::uuid and shop=s.id and professional=actor_seat.id) then raise exception 'Você só pode alterar os próprios atendimentos.';end if;
 if action='pay' and not exists(select 1 from kroner_private.charges c join kroner_private.appointments a on a.id=c.appointment where c.id=(payload->>'charge')::uuid and c.shop=s.id and a.professional=actor_seat.id) then raise exception 'Recebimento de outro profissional.';end if;
 end if;
 end if;
 if action='create_shop' then
 if exists(select 1 from kroner_private.professionals where (user_id=uid and status in ('active','inactive') and role<>'owner') or (email=lower(auth.jwt()->>'email') and status='invited' and expires>now())) then raise exception 'Acesse sua equipe pelo convite.';end if;
 insert into kroner_private.shops(owner) values(uid) on conflict(owner) do nothing;
 return '{"ok":true}';
 end if;
 if action='workspace' then
 if s.id is null then return '{"onboarding":true}';end if;
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
 update kroner_private.shops set name=left(payload->>'name',100),cfg=ctx.cfg,active=active or coalesce((payload->>'activate')::boolean,false) where id=sid;return '{"ok":true}';
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
 select * into apt from kroner_private.appointments where id=(payload->>'id')::uuid and shop=sid for update;if apt.id is null or apt.status<>'booked' then raise exception 'Somente reservas abertas podem ser remarcadas.';end if;
 if cid<>apt.client or (select array_agg(x order by x) from unnest(sv) x) is distinct from (select array_agg((value->>'id')::uuid order by (value->>'id')::uuid) from jsonb_array_elements(apt.services)) then raise exception 'Remarque mantendo o cliente e os serviços originais.';end if;
 update kroner_private.appointments set status='cancelled' where id=apt.id;
 end if;
 select id into chair from kroner_private.professionals where shop=sid and status='active' and (case when coalesce(payload->>'professional','auto')='auto' then role='owner' else id=(payload->>'professional')::uuid end);
 slots:=kroner_private.chair_slots(sid,chair,sv,day,period,action<>'book');
 select value into slot from jsonb_array_elements(slots) where (value->>'start')::timestamptz=(payload->>'start')::timestamptz;
 if slot is null then raise exception 'Horário indisponível. Atualize a agenda e escolha outro.';end if;
 select jsonb_agg(jsonb_build_object('id',id,'name',name,'duration',duration,'price',price)) into result from kroner_private.services where shop=sid and id=any(sv) and active;
 if action='move' then update kroner_private.appointments set professional=chair,starts=(slot->>'start')::timestamptz,ends=(slot->>'end')::timestamptz,status='booked' where id=apt.id;aid:=apt.id;
 else insert into kroner_private.appointments(shop,professional,client,starts,ends,services,price,request_id) values(sid,chair,cid,(slot->>'start')::timestamptz,(slot->>'end')::timestamptz,result,(slot->>'price')::int,op) returning id into aid;end if;
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
 insert into kroner_private.memberships(shop,client,service_ids,weekday,at_time,price,due_day) values(sid,(payload->>'client')::uuid,sv,(payload->>'weekday')::int,(payload->>'time')::time,(payload->>'price')::int,(payload->>'due_day')::int);result:='{"ok":true}';
 elsif action='monthly_generate' then
 select * into m from kroner_private.memberships where id=(payload->>'id')::uuid and shop=sid and active;if m.id is null then raise exception 'Plano inválido.';end if;
 month:=date_trunc('month',(payload->>'month')::date)::date;until_day:=(month+interval '1 month - 1 day')::date;dd:=month;
 if exists(select 1 from kroner_private.charges where membership=m.id and charges.month=ctx.month) then raise exception 'Este mês já foi gerado.';end if;
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
 if op is not null and action not in('book','manual_book') then update kroner_private.requests set result=ctx.result where id=op and actor=uid;end if;
 return result;
exception when exclusion_violation then raise exception 'Já existe um atendimento nesse horário. Escolha outro.';
end $function$;
