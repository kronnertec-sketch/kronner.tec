-- ============================================================================
-- Kronner Security Hardening Round 2 Migration (2026-11-24)
-- Fixes:
--   - ALTA-01: Per-client active booking cap (max 3/shop) & 24h rate limit (max 10/user)
--   - MÉDIA-01: Remove unsolicited-invite hard block in create_shop + add 'decline' in kroner_team
--   - MÉDIA-04: Default 15-day trial seat_limit = 5 (allows testing up to 4 extra chairs;
--               blocks 101-chair abuse) + RPC helper to read shop billing metadata/chair count
--   - MÉDIA-05: Monotonic event ordering (last_stripe_event_created) in shop_subscriptions
--   - BAIXA-01: CHECK (commission_bps BETWEEN 0 AND 10000) + validation in kroner_pos('rate')
--   - BAIXA-02: IS DISTINCT FROM NULL-safe direction check in action = 'charge'
--   - BAIXA-03: Proportional service_earnings adjustment on POS refund
-- Idempotent: safe to run directly in Supabase SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- [BAIXA-01] Enforce commission_bps range 0..10000 at schema level
-- ----------------------------------------------------------------------------
update kroner_private.professionals
set commission_bps = greatest(0, least(10000, coalesce(commission_bps, 0)))
where commission_bps is null or commission_bps < 0 or commission_bps > 10000;

alter table kroner_private.professionals
  drop constraint if exists professionals_commission_bps_check;

alter table kroner_private.professionals
  add constraint professionals_commission_bps_check
  check (commission_bps between 0 and 10000);

-- ----------------------------------------------------------------------------
-- [MÉDIA-04 & MÉDIA-05] Add last_stripe_event_created + bump trial seat_limit to 5
-- ----------------------------------------------------------------------------
alter table kroner_private.shop_subscriptions
  add column if not exists last_stripe_event_created bigint not null default 0;

-- Allow existing trialing shops without a Stripe subscription yet to test up to 5 chairs
update kroner_private.shop_subscriptions
set seat_limit = greatest(seat_limit, 5)
where status = 'trialing' and stripe_subscription_id is null and seat_limit < 5;

drop function if exists public.kroner_sync_subscription(uuid, text, text, text, integer, timestamptz);

create or replace function public.kroner_sync_subscription(
  p_shop uuid,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_status text,
  p_seat_limit integer,
  p_current_period_end timestamptz,
  p_event_created bigint default 0
) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into kroner_private.shop_subscriptions (
    shop, stripe_customer_id, stripe_subscription_id, status, seat_limit,
    current_period_end, last_stripe_event_created, updated_at
  )
  values (
    p_shop, p_stripe_customer_id, p_stripe_subscription_id, p_status,
    greatest(1, least(101, coalesce(p_seat_limit, 1))),
    p_current_period_end, greatest(0, coalesce(p_event_created, 0)), now()
  )
  on conflict (shop) do update set
    stripe_customer_id = coalesce(excluded.stripe_customer_id, kroner_private.shop_subscriptions.stripe_customer_id),
    stripe_subscription_id = coalesce(excluded.stripe_subscription_id, kroner_private.shop_subscriptions.stripe_subscription_id),
    status = excluded.status,
    seat_limit = excluded.seat_limit,
    current_period_end = excluded.current_period_end,
    last_stripe_event_created = greatest(kroner_private.shop_subscriptions.last_stripe_event_created, excluded.last_stripe_event_created),
    updated_at = now()
  where excluded.last_stripe_event_created = 0
     or excluded.last_stripe_event_created >= kroner_private.shop_subscriptions.last_stripe_event_created;
end;
$$;
revoke all on function public.kroner_sync_subscription(uuid, text, text, text, integer, timestamptz, bigint) from public, anon, authenticated;
grant execute on function public.kroner_sync_subscription(uuid, text, text, text, integer, timestamptz, bigint) to service_role;

-- Helper for /api/assinatura to read persisted customer_id and active/invited chair count without hitting Stripe Search
create or replace function public.kroner_billing_context()
returns jsonb language sql volatile security definer set search_path = '' as $$
  select jsonb_build_object(
    'shop', s.id,
    'stripeCustomerId', sub.stripe_customer_id,
    'status', sub.status,
    'seatLimit', sub.seat_limit,
    'extraChairs', greatest(0, (
      select count(*)::int - 1
      from kroner_private.professionals p
      where p.shop = s.id and p.status in ('active', 'invited')
    ))
  )
  from kroner_private.shops s
  left join kroner_private.shop_subscriptions sub on sub.shop = s.id
  where s.owner = kroner_private.current_user_id()
  limit 1;
$$;
revoke all on function public.kroner_billing_context() from public, anon;
grant execute on function public.kroner_billing_context() to authenticated;

-- ----------------------------------------------------------------------------
-- [BAIXA-01 & BAIXA-03] Hardened kroner_pos(): validate rate 0..10000 & adjust service_earnings on refund
-- ----------------------------------------------------------------------------
create or replace function public.kroner_pos(action text, payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid := kroner_private.current_user_id();
  me kroner_private.professionals;
  person kroner_private.professionals;
  s kroner_private.shops;
  prod kroner_private.products;
  apt kroner_private.appointments;
  sale kroner_private.sales;
  line jsonb; lines jsonb := '[]'; totals jsonb;
  op uuid := (payload->>'request_id')::uuid;
  ch uuid; goods int := 0; svc int := 0;
  discount int := coalesce((payload->>'discount')::int, 0);
  qty int; amount int; refundable int; expected int; received int := 0;
  day date; counted int; opening int; new_rate int;
  net_total int; remaining_after int;
begin
  select * into me from kroner_private.professionals where user_id = uid and status = 'active';
  if me.role is null or me.role not in ('owner', 'partner') then raise exception 'Acesso restrito à gestão.'; end if;
  select * into s from kroner_private.shops where id = me.shop for update;
  day := (now() at time zone coalesce(s.cfg->>'timezone', 'America/Sao_Paulo'))::date;

  if action = 'list' then
    return jsonb_build_object(
      'sales', coalesce((select jsonb_agg(to_jsonb(sa) order by sa.created_at desc) from kroner_private.sales sa where shop = s.id), '[]'),
      'rates', (select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'rate', commission_bps)) from kroner_private.professionals where shop = s.id and status = 'active'),
      'closings', coalesce((select jsonb_agg(to_jsonb(rc) order by rc.day desc) from kroner_private.register_closings rc where shop = s.id), '[]')
    );
  end if;

  if not kroner_private.shop_entitled(s.id) then raise exception 'Assinatura inativa. Regularize para operar o PDV.'; end if;

  -- [BAIXA-01] Validate commission_bps strictly between 0 and 10000
  if action = 'rate' then
    if me.role <> 'owner' then raise exception 'Somente o titular altera comissões.'; end if;
    new_rate := (payload->>'rate')::int;
    if new_rate is null or new_rate not between 0 and 10000 then
      raise exception 'Percentual de comissão inválido (0% a 100%).';
    end if;
    update kroner_private.professionals set commission_bps = new_rate where id = (payload->>'id')::uuid and shop = s.id;
    return '{"ok":true}';
  end if;

  if op is null then raise exception 'Identificador obrigatório.'; end if;
  if exists(select 1 from kroner_private.requests r where r.id = op and r.actor = uid and r.action = 'pos_' || kroner_pos.action) then return '{"ok":true}'; end if;
  insert into kroner_private.requests values(op, uid, 'pos_' || kroner_pos.action, '{"ok":true}', now());

  if action = 'close' then
    day := (payload->>'day')::date; opening := (payload->>'opening')::int; counted := (payload->>'counted')::int;
    if day > (now() at time zone coalesce(s.cfg->>'timezone', 'America/Sao_Paulo'))::date or least(opening, counted) < 0 then raise exception 'Conferência inválida.'; end if;
    select coalesce(jsonb_object_agg(method, net), '{}') into totals
    from (select p.method, sum(case when c.direction = 'in' then p.amount else -p.amount end) net from kroner_private.payments p join kroner_private.charges c on p.charge = c.id where p.shop = s.id and p.paid_on = day group by p.method) x;
    expected := opening + coalesce((totals->>'cash')::int, 0);
    insert into kroner_private.register_closings values(s.id, day, uid, opening, counted, expected, totals, now());
    return '{"ok":true}';
  end if;

  if action = 'sale' then
    select * into person from kroner_private.professionals where shop = s.id and id = coalesce((payload->>'professional')::uuid, me.id) and status = 'active';
    if person.id is null then raise exception 'Profissional inválido.'; end if;
    if nullif(payload->>'appointment', '') is not null then
      select * into apt from kroner_private.appointments where shop = s.id and id = (payload->>'appointment')::uuid and status = 'booked' and membership is null for update;
      if apt.id is null then raise exception 'Atendimento indisponível.'; end if;
      select * into person from kroner_private.professionals where id = apt.professional and shop = s.id;
      svc := apt.price;
    end if;
    for line in select value from jsonb_array_elements(payload->'items') loop
      qty := (line->>'quantity')::int;
      select * into prod from kroner_private.products where id = (line->>'id')::uuid and shop = s.id for update;
      if prod.id is null or not prod.active or qty is null or qty < 1 or qty > prod.quantity then raise exception 'Produto indisponível ou quantidade acima do estoque.'; end if;
      goods := goods + qty * prod.price;
      update kroner_private.products set quantity = quantity - qty, updated_at = now() where id = prod.id;
      lines := lines || jsonb_build_object('id', prod.id, 'name', prod.name, 'quantity', qty, 'unit_price', prod.price, 'unit_cost', prod.cost);
    end loop;
    if svc + goods <= 0 or discount < 0 or discount > svc + goods then raise exception 'Confira o total e o desconto.'; end if;
    insert into kroner_private.charges(shop, client, appointment, description, amount, due, category) values(s.id, apt.client, apt.id, 'Venda no PDV', svc + goods - discount, day, case when apt.id is null then 'sale' else 'service' end) returning id into ch;
    for line in select value from jsonb_array_elements(lines) loop
      insert into kroner_private.movements(shop, product, quantity, kind, unit_cost, charge, note) values(s.id, (line->>'id')::uuid, (line->>'quantity')::int, 'sale', (line->>'unit_cost')::int, ch, 'PDV');
    end loop;
    for line in select value from jsonb_array_elements(payload->'payments') loop
      amount := (line->>'amount')::int; if amount <= 0 then raise exception 'Pagamento inválido.'; end if;
      perform kroner_private.api('pay', jsonb_build_object('charge', ch, 'amount', amount, 'method', line->>'method', 'paid_on', day, 'settles_on', day, 'request_id', gen_random_uuid()));
    end loop;
    if apt.id is not null then update kroner_private.appointments set status = 'done' where id = apt.id; end if;
    insert into kroner_private.sales(id, shop, actor, professional, appointment, charge, items, service_total, product_total, discount, commission, rate)
      values(op, s.id, uid, person.id, apt.id, ch, lines, svc, goods, discount, round(svc::numeric * (svc + goods - discount) / (svc + goods) * person.commission_bps / 10000), person.commission_bps);
  elsif action = 'refund' then
    select * into sale from kroner_private.sales where shop = s.id and id = (payload->>'sale')::uuid for update;
    select coalesce(sum(p.amount), 0) into received from kroner_private.payments p where p.charge = sale.charge;
    amount := (payload->>'amount')::int; refundable := received - sale.refunded;
    if sale.id is null or amount is null or amount <= 0 or amount > refundable or coalesce(length(trim(payload->>'reason')), 0) < 3 then
      raise exception 'Revise o motivo e o saldo disponível para estorno.';
    end if;
    insert into kroner_private.charges(shop, description, direction, amount, due, category)
      values(s.id, 'Estorno PDV ' || sale.id || ' · ' || left(payload->>'reason', 150), 'out', amount, day, 'refund') returning id into ch;
    perform kroner_private.api('pay', jsonb_build_object('charge', ch, 'amount', amount, 'method', payload->>'method', 'paid_on', day, 'settles_on', day, 'request_id', gen_random_uuid()));
    update kroner_private.sales set refunded = refunded + amount where id = sale.id;

    -- [BAIXA-03] Proportionally adjust service_earnings when refunding an appointment sale
    if sale.appointment is not null then
      net_total := greatest(1, sale.product_total + sale.service_total - sale.discount);
      remaining_after := greatest(0, net_total - (sale.refunded + amount));
      update kroner_private.service_earnings
      set basis = round(sale.service_total::numeric * remaining_after / greatest(1, sale.service_total + sale.product_total)),
          amount = round(sale.commission::numeric * remaining_after / net_total)
      where appointment = sale.appointment and shop = s.id;
    end if;

    if coalesce((payload->>'return_goods')::boolean, false) then
      if amount + sale.refunded <> sale.product_total + sale.service_total - sale.discount then
        raise exception 'Devolução integral exige estorno de todo o valor da venda.';
      end if;
      for line in select value from jsonb_array_elements(sale.items) loop
        update kroner_private.products set quantity = quantity + (line->>'quantity')::int where id = (line->>'id')::uuid and shop = s.id;
        insert into kroner_private.movements(shop, product, quantity, kind, unit_cost, charge, note)
          values(s.id, (line->>'id')::uuid, (line->>'quantity')::int, 'return', (line->>'unit_cost')::int, ch, payload->>'reason');
      end loop;
    end if;
  else
    raise exception 'Operação inválida.';
  end if;

  insert into kroner_private.audit(shop, actor, action, record_id) values(s.id, uid, 'pos_' || kroner_pos.action, op);
  return '{"ok":true}';
end;
$$;
revoke all on function public.kroner_pos(text, jsonb) from public, anon;
grant execute on function public.kroner_pos(text, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- [MÉDIA-01] Add 'decline' action in public.kroner_team() for unwanted invites
-- ----------------------------------------------------------------------------
create or replace function public.kroner_team(action text, payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid := kroner_private.current_user_id();
  me kroner_private.professionals;
  target kroner_private.professionals;
  token text;
  mail text := lower(trim(auth.jwt()->>'email'));
  selected_role text := payload->>'role';
  week_day jsonb;
  d date;
  prefs jsonb;
  shoprow kroner_private.shops;
  subrow kroner_private.shop_subscriptions;
  seat_count int;
  recent_invites int;
begin
  if uid is null then raise exception 'Entre na sua conta.'; end if;
  select * into me from kroner_private.professionals where user_id = uid and status = 'active' for update;

  if action = 'pending_invites' then
    if auth.jwt()->>'email_verified' is distinct from 'true' or mail is null or mail = '' then
      return '[]'::jsonb;
    end if;
    return coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'shopName', s.name, 'role', p.role, 'expires', p.expires) order by p.expires desc)
      from kroner_private.professionals p
      join kroner_private.shops s on s.id = p.shop
      where p.email = mail and p.status = 'invited' and p.expires > now()
    ), '[]'::jsonb);
  end if;

  -- [MÉDIA-01] Allow invitees to decline unsolicited invites
  if action = 'decline' then
    if auth.jwt()->>'email_verified' is distinct from 'true' or mail is null or mail = '' then
      raise exception 'Convite indisponível.';
    end if;
    update kroner_private.professionals
    set status = 'inactive', invite_hash = null
    where id = nullif(payload->>'id', '')::uuid and email = mail and status = 'invited'
    returning * into target;
    if target.id is null then raise exception 'Convite indisponível.'; end if;
    insert into kroner_private.audit(shop, actor, action, record_id) values(target.shop, uid, 'team_decline', target.id);
    return '{"ok":true}';
  end if;

  if action = 'accept' then
    if auth.jwt()->>'email_verified' is distinct from 'true' or mail is null or mail = '' then
      raise exception 'Convite expirado ou e-mail diferente do convidado.';
    end if;
    if nullif(payload->>'token', '') is not null then
      select * into target from kroner_private.professionals
      where invite_hash = encode(extensions.digest(payload->>'token', 'sha256'), 'hex')
        and status = 'invited' and expires > now() for update;
    elsif nullif(payload->>'id', '') is not null then
      select * into target from kroner_private.professionals
      where id = (payload->>'id')::uuid
        and email = mail
        and status = 'invited' and expires > now() for update;
    end if;
    if target.id is null or target.email is distinct from mail then
      raise exception 'Convite expirado ou e-mail diferente do convidado.';
    end if;
    if me.id is not null or exists(select 1 from kroner_private.shops where owner = uid) then
      raise exception 'Esta conta já pertence a uma barbearia.';
    end if;
    select * into subrow from kroner_private.shop_subscriptions where shop = target.shop for update;
    if not kroner_private.shop_entitled(target.shop) then
      raise exception 'Ative ou regularize sua assinatura para convidar profissionais.';
    end if;
    select count(*) into seat_count from kroner_private.professionals where shop = target.shop and status = 'active';
    if subrow.shop is not null and seat_count >= subrow.seat_limit then
      raise exception 'Limite de cadeiras do plano atingido. Adicione cadeiras na assinatura.';
    end if;
    update kroner_private.professionals set user_id = uid, status = 'active', invite_hash = null where id = target.id;
    insert into kroner_private.audit(shop, actor, action, record_id) values(target.shop, uid, 'team_accept', target.id);
    return jsonb_build_object('ok', true, 'role', target.role);
  end if;

  if action = 'identity' then
    return jsonb_build_object(
      'role', me.role,
      'shop', me.shop,
      'id', me.id,
      'revoked', exists(select 1 from kroner_private.professionals where user_id = uid and status = 'inactive')
    );
  end if;

  if me.id is null then raise exception 'Sem vínculo ativo com a equipe.'; end if;
  select * into shoprow from kroner_private.shops where id = me.shop;

  if action = 'calendar_event' then
    if me.role <> 'owner' or coalesce(length(trim(payload->>'name')), 0) < 2 or coalesce(payload->>'source', '') !~ '^https?://[^ ]+$' or coalesce(shoprow.cfg->>'city', '') = '' then
      raise exception 'Informe o feriado, a localidade e o link da fonte oficial.';
    end if;
    insert into kroner_private.calendar_events(shop, day, name, scope, source, state, city, actor)
      values(me.shop, (payload->>'date')::date, trim(payload->>'name'), payload->>'scope', payload->>'source', shoprow.cfg->>'state', shoprow.cfg->>'city', uid)
      on conflict(shop, day, scope, state, city) do update set name = excluded.name, source = excluded.source, actor = uid, updated_at = now();
    insert into kroner_private.audit(shop, actor, action, record_id) values(me.shop, uid, 'calendar_event_' || (payload->>'date'), me.id);
    return '{"ok":true}';
  end if;

  if action = 'clients' then
    return coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'last', x.last,
          'monthly', exists(select 1 from kroner_private.memberships m where m.client = c.id and m.shop = me.shop and m.active),
          'receivable', case when me.role = 'employee' and not me.finance then false else coalesce(b.pending, false) end,
          'debt', case when me.role = 'employee' and not me.finance then false else coalesce(b.overdue, false) end
        ) order by c.name
      )
      from kroner_private.clients c
      left join lateral (
        select max((a.starts at time zone coalesce(shoprow.cfg->>'timezone', 'America/Sao_Paulo'))::date) as last
        from kroner_private.appointments a
        where a.client = c.id and a.shop = me.shop and a.status = 'done'
      ) x on true
      left join lateral (
        select bool_or(ch.due is null or ch.due >= current_date) pending,
               bool_or(ch.due < current_date - 30) overdue
        from kroner_private.charges ch
        where ch.client = c.id and ch.shop = me.shop and ch.direction = 'in'
          and ch.amount > coalesce((select sum(pay.amount) from kroner_private.payments pay where pay.charge = ch.id), 0)
      ) b on true
      where c.shop = me.shop and c.user_id is not null
    ), '[]');
  end if;

  if action = 'profile' then
    return jsonb_build_object(
      'id', me.id,
      'slug', shoprow.slug,
      'role', me.role,
      'finance', me.finance,
      'calendar', coalesce((select jsonb_agg(jsonb_build_object('date', h.day, 'name', h.name, 'scope', h.scope, 'source', h.source)) from kroner_private.calendar_events h where h.shop = me.shop and h.day >= current_date - 1 and h.day <= current_date + 370 and (h.scope = 'Nacional' or h.state = shoprow.cfg->>'state' and (h.scope = 'Estadual' or lower(h.city) = lower(shoprow.cfg->>'city')))), '[]'),
      'timezone', coalesce(shoprow.cfg->>'timezone', 'America/Sao_Paulo'),
      'preferences', me.preferences,
      'week', coalesce(me.preferences->'week', shoprow.cfg->'week'),
      'services', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'duration', duration) order by name) from kroner_private.services where shop = me.shop and active), '[]')
    );
  end if;

  if action = 'preferences' then
    prefs := payload - 'holidayDecisions';
    if jsonb_typeof(prefs) <> 'object' or prefs - array['notice', 'buffer', 'week', 'durations', 'disabledServices'] <> '{}'::jsonb or not (prefs ?& array['buffer', 'week', 'durations', 'disabledServices']) or coalesce((prefs->>'notice')::int, 10) not between 0 and 10080 or (prefs->>'buffer')::int not between 0 and 180 or jsonb_array_length(prefs->'week') <> 7 then
      raise exception 'Confira intervalos e expediente.';
    end if;
    for week_day in select value from jsonb_array_elements(prefs->'week') loop
      if (week_day->>'enabled')::boolean and (nullif(week_day->>'open', '') is null or nullif(week_day->>'close', '') is null or (week_day->>'open')::time >= (week_day->>'close')::time or (nullif(week_day->>'lunchStart', '') is null) <> (nullif(week_day->>'lunchEnd', '') is null) or nullif(week_day->>'lunchStart', '')::time < (week_day->>'open')::time or nullif(week_day->>'lunchEnd', '')::time > (week_day->>'close')::time or nullif(week_day->>'lunchEnd', '')::time <= nullif(week_day->>'lunchStart', '')::time) then
        raise exception 'Revise os horários e as pausas.';
      end if;
    end loop;
    if exists(select 1 from jsonb_each_text(prefs->'durations') e where e.value::int not between 1 and 720 or not exists(select 1 from kroner_private.services z where z.shop = me.shop and z.id = e.key::uuid)) then
      raise exception 'Duração inválida.';
    end if;
    update kroner_private.professionals set preferences = preferences || prefs where id = me.id and shop = me.shop;
    return '{"ok":true}';
  end if;

  if action = 'holiday' then
    d := (payload->>'date')::date;
    if d is null or coalesce(payload->>'decision', '') not in ('open', 'closed') then raise exception 'Decisão inválida.'; end if;
    perform 1 from kroner_private.shops where id = me.shop for update;
    if payload->>'decision' = 'closed' and exists(select 1 from kroner_private.appointments where shop = me.shop and professional = me.id and status = 'booked' and (starts at time zone coalesce(shoprow.cfg->>'timezone', 'America/Sao_Paulo'))::date = d) then
      raise exception 'Transfira ou cancele primeiro as reservas deste dia.';
    end if;
    update kroner_private.professionals set preferences = preferences || jsonb_build_object('holidayDecisions', coalesce(preferences->'holidayDecisions', '{}') || jsonb_build_object(d::text, payload->>'decision')) where id = me.id and shop = me.shop;
    insert into kroner_private.audit(shop, actor, action, record_id) values(me.shop, uid, 'holiday_' || d::text || '_' || (payload->>'decision'), me.id);
    return '{"ok":true}';
  end if;

  if action = 'slots' then
    return kroner_private.chair_slots(me.shop, (payload->>'professional')::uuid, array(select value::uuid from jsonb_array_elements_text(payload->'services')), (payload->>'day')::date, payload->>'period', true);
  end if;

  if action = 'individual_finance' then
    if me.role = 'employee' and not me.finance then raise exception 'Financeiro individual desativado.'; end if;
    return coalesce((
      select jsonb_agg(jsonb_build_object('day', p.paid_on, 'amount', p.amount, 'fee', p.fee, 'method', p.method) order by p.paid_on desc)
      from kroner_private.payments p
      join kroner_private.charges c on c.id = p.charge
      join kroner_private.appointments a on a.id = c.appointment
      where a.shop = me.shop and a.professional = me.id
    ), '[]');
  end if;

  if action = 'list' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'role', role, 'status', status, 'finance', finance) order by name) from kroner_private.professionals where shop = me.shop and (me.role = 'owner' or status = 'active')), '[]');
  end if;

  if action = 'agenda' then
    return coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'professional', a.professional, 'name', c.name, 'starts', a.starts, 'ends', a.ends, 'status', a.status, 'client', a.client, 'serviceIds', (select jsonb_agg(v->>'id') from jsonb_array_elements(a.services) v), 'services', (select string_agg(v->>'name', ', ') from jsonb_array_elements(a.services) v)) order by a.starts)
      from kroner_private.appointments a
      join kroner_private.clients c on a.client = c.id
      join kroner_private.shops s on s.id = a.shop
      where a.shop = me.shop
        and (me.role <> 'employee' or a.professional = me.id)
        and (a.starts at time zone coalesce(s.cfg->>'timezone', 'America/Sao_Paulo'))::date = (payload->>'day')::date
    ), '[]');
  end if;

  if me.role <> 'owner' then raise exception 'Somente a conta principal gerencia a equipe.'; end if;

  if action = 'invite' then
    if selected_role is null or selected_role not in ('partner', 'employee') or coalesce(length(trim(payload->>'name')), 0) not between 2 and 100 or coalesce(payload->>'email', '') !~ '^[^ @]+@[^ @]+\.[^ @]+$' then
      raise exception 'Confira nome, e-mail e papel.';
    end if;
    select * into subrow from kroner_private.shop_subscriptions where shop = me.shop for update;
    if not kroner_private.shop_entitled(me.shop) then
      raise exception 'Ative ou regularize sua assinatura para convidar profissionais.';
    end if;
    select count(*) into seat_count
    from kroner_private.professionals
    where shop = me.shop
      and (status = 'active' or (status = 'invited' and email is distinct from lower(trim(payload->>'email'))));
    if subrow.shop is not null and seat_count >= subrow.seat_limit then
      raise exception 'Limite de cadeiras do plano atingido. Adicione cadeiras na assinatura.';
    end if;
    select count(*) into recent_invites
    from kroner_private.audit
    where shop = me.shop and action = 'team_invite' and created_at > now() - interval '24 hours';
    if recent_invites >= 20 then
      raise exception 'Limite diário de convites atingido. Tente novamente mais tarde.';
    end if;

    token := encode(extensions.gen_random_bytes(32), 'hex');
    insert into kroner_private.professionals(shop, name, role, status, email, invite_hash, expires)
      values(me.shop, trim(payload->>'name'), selected_role, 'invited', lower(trim(payload->>'email')), encode(extensions.digest(token, 'sha256'), 'hex'), now() + interval '7 days')
      on conflict(shop, email) where status = 'invited' do update set name = excluded.name, role = excluded.role, invite_hash = excluded.invite_hash, expires = excluded.expires
      returning * into target;
  elsif action in ('permissions', 'deactivate') then
    select * into target from kroner_private.professionals where id = (payload->>'id')::uuid and shop = me.shop and role <> 'owner' and status <> 'inactive' for update;
    if target.id is null then raise exception 'Profissional indisponível.'; end if;
    if action = 'permissions' then
      if selected_role is null or selected_role not in ('partner', 'employee') then raise exception 'Papel inválido.'; end if;
      update kroner_private.professionals set role = selected_role, finance = coalesce((payload->>'finance')::boolean, false) where id = target.id and shop = me.shop;
    else
      if exists(select 1 from kroner_private.appointments where shop = me.shop and professional = target.id and ends > now() and status = 'booked') then
        raise exception 'Transfira ou cancele os atendimentos futuros.';
      end if;
      update kroner_private.professionals set status = 'inactive', invite_hash = null where id = target.id and shop = me.shop;
    end if;
  else
    raise exception 'Operação desconhecida.';
  end if;

  insert into kroner_private.audit(shop, actor, action, record_id) values(me.shop, uid, 'team_' || action, target.id);
  return jsonb_build_object('ok', true, 'token', token);
end;
$$;
revoke all on function public.kroner_team(text, jsonb) from public, anon;
grant execute on function public.kroner_team(text, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- [ALTA-01, MÉDIA-01, MÉDIA-04, BAIXA-02] Hardened kroner_private.api()
-- ----------------------------------------------------------------------------
create or replace function kroner_private.api(action text, payload jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
<<ctx>>
declare
  actor_seat kroner_private.professionals;
  chair uuid;
  chair_role text;
  uid uuid := kroner_private.current_user_id();
  s kroner_private.shops;
  sid uuid; cid uuid; rid uuid; aid uuid; ch uuid;
  pr kroner_private.products;
  apt kroner_private.appointments;
  c kroner_private.charges;
  m kroner_private.memberships;
  r record;
  cfg jsonb; sv uuid[]; slots jsonb; slot jsonb;
  day date; dd date; period text; dur int; amount int; paid int; qty int; bps int; fee int;
  method text; result jsonb; w jsonb; op uuid; exists_result jsonb; month date; until_day date;
  upcoming_count int; recent_books int;
begin
  if octet_length(payload::text) > 65536 then raise exception 'Solicitação muito grande.'; end if;

  if action in ('public', 'slots') then
    select * into s from kroner_private.shops where slug = payload->>'slug' and active;
    if s.id is null then raise exception 'Barbearia indisponível ou link inválido.'; end if;
    select id, role into chair, chair_role
    from kroner_private.professionals
    where shop = s.id and status = 'active'
      and (case when coalesce(payload->>'professional', 'auto') = 'auto' then role = 'owner' else id = (payload->>'professional')::uuid end);
    if chair is null then raise exception 'Este profissional está indisponível. Acesse o link geral da barbearia.'; end if;

    if action = 'public' then
      return jsonb_build_object(
        'id', s.id,
        'slug', s.slug,
        'name', s.name,
        'professionals', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', p.id,
              'name', case when p.role = 'owner' then coalesce(nullif(s.cfg->>'professional', ''), p.name) else p.name end,
              'owner', p.role = 'owner'
            ) order by (p.role = 'owner') desc, p.name
          )
          from kroner_private.professionals p
          where p.shop = s.id and p.status = 'active'
        ), '[]'),
        'professional', chair,
        'cfg', jsonb_build_object(
          'address', s.cfg->'address',
          'timezone', s.cfg->'timezone',
          'week', s.cfg->'week',
          'maxDays', s.cfg->'maxDays',
          'grid', s.cfg->'grid',
          'notice', s.cfg->'notice',
          'cancelMinutes', s.cfg->'cancelMinutes',
          'city', s.cfg->'city',
          'state', s.cfg->'state',
          'professional', s.cfg->'professional',
          'holidayDecisions', s.cfg->'holidayDecisions'
        ),
        'services', coalesce((
          select jsonb_agg(
            to_jsonb(v) || jsonb_build_object('duration', coalesce((p.preferences->'durations'->>v.id::text)::int, v.duration))
          )
          from kroner_private.services v
          join kroner_private.professionals p on p.id = chair
          where v.shop = s.id and v.active
            and (coalesce(payload->>'professional', 'auto') = 'auto' or not (coalesce(p.preferences->'disabledServices', '[]') ? v.id::text))
        ), '[]')
      );
    end if;

    select array_agg(value::uuid) into sv from jsonb_array_elements_text(payload->'services');
    if coalesce(payload->>'professional', 'auto') = 'auto' then
      return coalesce((
        select jsonb_agg(item order by item->>'start')
        from (
          select distinct on (v->>'start')
            v || jsonb_build_object(
              'professional', p.id,
              'professionalName', case when p.role = 'owner' then coalesce(nullif(s.cfg->>'professional', ''), p.name) else p.name end
            ) as item
          from kroner_private.professionals p
          cross join lateral jsonb_array_elements(kroner_private.chair_slots(s.id, p.id, sv, (payload->>'day')::date, payload->>'period', false)) v
          where p.shop = s.id and p.status = 'active'
          order by v->>'start', (p.role = 'owner') desc, p.id
        ) options
      ), '[]');
    end if;
    return kroner_private.chair_slots(s.id, chair, sv, (payload->>'day')::date, payload->>'period', false);
  end if;

  if uid is null then raise exception 'Entre na sua conta para continuar.'; end if;

  if action = 'my_appointments' then
    return coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'starts', a.starts, 'ends', a.ends, 'services', a.services, 'price', a.price, 'status', a.status, 'shop_name', x.name, 'slug', x.slug, 'timezone', x.cfg->>'timezone'))
      from kroner_private.appointments a
      join kroner_private.clients cl on cl.id = a.client
      join kroner_private.shops x on x.id = a.shop
      where cl.user_id = uid and a.starts > now() - interval '1 year'
    ), '[]');
  end if;

  if action = 'book' then
    select * into s from kroner_private.shops where slug = payload->>'slug' and active for update;
    if s.id is null then raise exception 'Barbearia indisponível.'; end if;
  else
    select * into actor_seat from kroner_private.professionals where user_id = uid and status = 'active' for share;
    if actor_seat.id is not null then
      select * into s from kroner_private.shops where id = actor_seat.shop for update;
    else
      select * into s from kroner_private.shops where owner = uid for update;
    end if;

    if actor_seat.role = 'partner' and action not in ('workspace','manual_book','move','cancel','finish','pay','client','charge','product','stock','membership','monthly_generate','monthly_stop','generate_expenses','recurring','cancel_own') then
      raise exception 'Esta operação exige a conta principal.';
    end if;

    if actor_seat.role = 'employee' then
      if action not in ('manual_book','move','cancel','finish','pay','client','cancel_own') then
        raise exception 'Operação restrita para funcionário.';
      end if;
      if action in ('move','cancel','finish') and not exists(select 1 from kroner_private.appointments where id = (payload->>'id')::uuid and shop = s.id and professional = actor_seat.id) then
        raise exception 'Você só pode alterar os próprios atendimentos.';
      end if;
      if action = 'pay' and not exists(
        select 1 from kroner_private.charges chg
        join kroner_private.appointments a on a.id = chg.appointment
        where chg.id = (payload->>'charge')::uuid and chg.shop = s.id and a.professional = actor_seat.id
      ) then
        raise exception 'Recebimento de outro profissional.';
      end if;
    end if;
  end if;

  -- [MÉDIA-01] Only block if already an active/inactive non-owner team member (do NOT block on unsolicited pending invites)
  -- [MÉDIA-04] Default 15-day free trial grants up to 5 chairs so barbers can test team features (capped against abuse)
  if action = 'create_shop' then
    if exists(select 1 from kroner_private.professionals where user_id = uid and status in ('active', 'inactive') and role <> 'owner') then
      raise exception 'Acesse sua equipe pelo convite.';
    end if;
    insert into kroner_private.shops(owner) values(uid) on conflict(owner) do nothing;
    select * into s from kroner_private.shops where owner = uid;
    if s.id is not null then
      insert into kroner_private.professionals(shop, user_id, name, role, status, finance)
        values(s.id, uid, coalesce(nullif(s.cfg->>'professional', ''), s.name), 'owner', 'active', true)
        on conflict do nothing;
      insert into kroner_private.shop_subscriptions(shop, status, seat_limit, current_period_end)
        values(s.id, 'trialing', 5, now() + interval '15 days')
        on conflict(shop) do nothing;
    end if;
    return '{"ok":true}';
  end if;

  if action = 'workspace' then
    if s.id is null then return '{"onboarding":true}'; end if;
    return jsonb_build_object(
      'shop', to_jsonb(s),
      'professionals', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name)) from kroner_private.professionals where shop = s.id and status = 'active'), '[]'),
      'services', coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.services x where shop = s.id), '[]'),
      'clients', coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.clients x where shop = s.id), '[]'),
      'appointments', coalesce((select jsonb_agg(to_jsonb(x) order by starts) from kroner_private.appointments x where shop = s.id), '[]'),
      'charges', coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.charges x where shop = s.id), '[]'),
      'payments', coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.payments x where shop = s.id), '[]'),
      'products', coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.products x where shop = s.id), '[]'),
      'memberships', coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.memberships x where shop = s.id), '[]'),
      'blocks', coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.blocks x where shop = s.id), '[]'),
      'recurring', coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.recurring x where shop = s.id), '[]'),
      'movements', coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.movements x where shop = s.id), '[]')
    );
  end if;

  if action = 'cancel_own' then
    select a.* into apt from kroner_private.appointments a join kroner_private.clients cl on cl.id = a.client where a.id = (payload->>'id')::uuid and cl.user_id = uid for update of a;
    if apt.id is null then raise exception 'Reserva não encontrada.'; end if;
    select * into s from kroner_private.shops where id = apt.shop;
    if apt.status <> 'booked' or apt.starts < now() + make_interval(mins => coalesce((s.cfg->>'cancelMinutes')::int, 120)) then
      raise exception 'Prazo de cancelamento encerrado. Fale com a barbearia.';
    end if;
    update kroner_private.appointments set status = 'cancelled' where id = apt.id;
    insert into kroner_private.audit(shop, actor, action, record_id) values(apt.shop, uid, 'cancel_own', apt.id);
    return '{"ok":true}';
  end if;

  if s.id is null then raise exception 'Configure sua barbearia primeiro.'; end if;
  sid := s.id;

  if action = 'settings' then
    cfg := payload->'cfg';
    if cfg is null or jsonb_typeof(cfg) <> 'object' then raise exception 'Configuração inválida.'; end if;
    if coalesce(length(payload->>'name'), 0) < 2 then raise exception 'Informe o nome da barbearia.'; end if;
    if coalesce(cfg->>'phone', '') !~ '^\+55[1-9][0-9][0-9]{8,9}$' then raise exception 'Informe telefone com DDD.'; end if;
    if not cfg ?& array['phone','timezone','maxDays','grid','grace','notice','cancelMinutes','creditFee','debitFee','week','city','professional','state'] then raise exception 'Configurações essenciais ausentes.'; end if;
    if cfg->>'timezone' not in ('America/Sao_Paulo','America/Manaus','America/Rio_Branco','America/Noronha') then raise exception 'Fuso inválido.'; end if;
    if (cfg->>'maxDays')::int not between 1 and 90 or (cfg->>'grid')::int not between 5 and 60 or (cfg->>'grace')::int not between 0 and 90 or (cfg->>'notice')::int < 0 or (cfg->>'cancelMinutes')::int < 0 then raise exception 'Prazos inválidos.'; end if;
    if (cfg->>'creditFee')::int not between 0 and 10000 or (cfg->>'debitFee')::int not between 0 and 10000 then raise exception 'Taxa inválida.'; end if;
    if jsonb_array_length(cfg->'week') <> 7 then raise exception 'Configure os sete dias.'; end if;
    for w in select value from jsonb_array_elements(cfg->'week') loop
      if (w->>'enabled')::boolean then
        if (w->>'open')::time >= (w->>'close')::time then raise exception 'Abertura deve ser anterior ao encerramento.'; end if;
        if nullif(w->>'lunchStart', '') is not null and ((w->>'lunchStart')::time >= (w->>'lunchEnd')::time or (w->>'lunchStart')::time < (w->>'open')::time or (w->>'lunchEnd')::time > (w->>'close')::time) then raise exception 'Pausa fora do expediente.'; end if;
      end if;
    end loop;
    if coalesce((payload->>'activate')::boolean, false) then
      if not kroner_private.shop_entitled(sid) then raise exception 'Ative sua assinatura antes de publicar a barbearia.'; end if;
      if not exists(select 1 from kroner_private.services where shop = sid and active) or not exists(select 1 from jsonb_array_elements(cfg->'week') a where (a->>'enabled')::boolean) or length(cfg->>'city') < 2 or length(cfg->>'professional') < 2 then
        raise exception 'Preencha serviços, profissional, cidade e expediente.';
      end if;
    end if;
    update kroner_private.shops set name = left(payload->>'name', 100), cfg = ctx.cfg, active = active or coalesce((payload->>'activate')::boolean, false) where id = sid;
    update kroner_private.professionals set name = coalesce(nullif(ctx.cfg->>'professional', ''), left(payload->>'name', 100)) where shop = sid and role = 'owner';
    return '{"ok":true}';
  end if;

  if action = 'service' then
    if nullif(payload->>'id', '') is null then
      insert into kroner_private.services(shop, name, price, duration) values(sid, left(payload->>'name', 100), (payload->>'price')::int, (payload->>'duration')::int);
    else
      update kroner_private.services set name = left(payload->>'name', 100), price = (payload->>'price')::int, duration = (payload->>'duration')::int, active = coalesce((payload->>'active')::boolean, true) where id = (payload->>'id')::uuid and shop = sid;
    end if;
    return '{"ok":true}';
  end if;

  if not s.active then raise exception 'Conclua as configurações obrigatórias.'; end if;
  if not kroner_private.shop_entitled(sid) then raise exception 'Assinatura inativa. Regularize para continuar.'; end if;

  op := nullif(payload->>'request_id', '')::uuid;
  if op is not null and action not in ('book', 'manual_book') then
    select x.result into exists_result from kroner_private.requests x where x.id = op and actor = uid and x.action = api.action;
    if exists_result is not null then return exists_result; end if;
    insert into kroner_private.requests(id, actor, action) values(op, uid, action);
  end if;

  if action = 'client' then
    if length(payload->>'name') < 2 or payload->>'phone' !~ '^\+55[1-9][0-9][0-9]{8,9}$' then raise exception 'Nome ou telefone inválido.'; end if;
    insert into kroner_private.clients(shop, name, phone) values(sid, left(payload->>'name', 100), payload->>'phone') returning id into cid;
    result := jsonb_build_object('id', cid);
  elsif action in ('book', 'manual_book', 'move') then
    if action = 'book' then
      if length(payload->>'name') < 2 or payload->>'phone' !~ '^\+55[1-9][0-9][0-9]{8,9}$' then raise exception 'Nome e telefone com DDD são obrigatórios.'; end if;
      insert into kroner_private.clients(shop, user_id, name, phone) values(sid, uid, left(payload->>'name', 100), payload->>'phone') on conflict(shop, user_id) do update set name = excluded.name, phone = excluded.phone returning id into cid;
    elsif action = 'manual_book' and nullif(payload->>'client', '') is null then
      if length(coalesce(payload->>'name', '')) < 2 or coalesce(payload->>'phone', '') !~ '^\+55[1-9][0-9][0-9]{8,9}$' then raise exception 'Informe o nome e o telefone com DDD do cliente.'; end if;
      select id into cid from kroner_private.clients where shop = sid and phone = payload->>'phone' order by (user_id is not null) desc, created_at desc limit 1;
      if cid is null then
        insert into kroner_private.clients(shop, name, phone) values(sid, left(trim(payload->>'name'), 100), payload->>'phone') returning id into cid;
      else
        update kroner_private.clients set name = left(trim(payload->>'name'), 100) where id = cid and user_id is null;
      end if;
    else
      cid := (payload->>'client')::uuid;
      if not exists(select 1 from kroner_private.clients where id = cid and shop = sid) then raise exception 'Cliente inválido.'; end if;
    end if;

    if op is null then raise exception 'Identificador da solicitação obrigatório.'; end if;
    select id into aid from kroner_private.appointments where request_id = op and shop = sid and client = cid;
    if aid is not null then return jsonb_build_object('id', aid); end if;

    -- [ALTA-01] Prevent public calendar exhaustion DoS: cap upcoming bookings/shop and 24h bookings/user
    if action = 'book' then
      perform pg_advisory_xact_lock(hashtextextended('kroner:book:' || uid::text, 0));
      select count(*) into upcoming_count
      from kroner_private.appointments
      where shop = sid and client = cid and status = 'booked' and starts > now() and membership is null;
      if upcoming_count >= 3 then
        raise exception 'Você já atingiu o limite de 3 agendamentos futuros ativos nesta barbearia.';
      end if;

      select count(*) into recent_books
      from kroner_private.audit
      where actor = uid and action = 'book' and created_at > now() - interval '24 hours';
      if recent_books >= 10 then
        raise exception 'Limite diário de agendamentos atingido. Tente novamente amanhã.';
      end if;
    end if;

    select array_agg(value::uuid) into sv from jsonb_array_elements_text(payload->'services');
    day := (payload->>'day')::date;
    period := payload->>'period';

    if action = 'move' then
      select * into apt from kroner_private.appointments where id = (payload->>'id')::uuid and shop = sid for update;
      if apt.id is null or apt.status <> 'booked' then raise exception 'Somente reservas abertas podem ser remarcadas.'; end if;
      if cid <> apt.client or (select array_agg(x order by x) from unnest(sv) x) is distinct from (select array_agg((value->>'id')::uuid order by (value->>'id')::uuid) from jsonb_array_elements(apt.services)) then raise exception 'Remarque mantendo o cliente e os serviços originais.'; end if;
      update kroner_private.appointments set status = 'cancelled' where id = apt.id;
    end if;

    if action <> 'book' and actor_seat.id is not null and actor_seat.role = 'employee' then
      chair := actor_seat.id;
      slots := kroner_private.chair_slots(sid, chair, sv, day, period, true);
    elsif payload ? 'professional' and coalesce(payload->>'professional', 'auto') <> 'auto' then
      select id into chair from kroner_private.professionals where id = (payload->>'professional')::uuid and shop = sid and status = 'active';
      if chair is null then raise exception 'Profissional indisponível.'; end if;
      slots := kroner_private.chair_slots(sid, chair, sv, day, period, action <> 'book');
    else
      chair := null;
      slots := kroner_private.available(sid, sv, day, period);
    end if;

    select value into slot from jsonb_array_elements(slots) where (value->>'start')::timestamptz = (payload->>'start')::timestamptz;
    if slot is null then raise exception 'Horário indisponível. Atualize a agenda e escolha outro.'; end if;

    chair := coalesce(chair, nullif(slot->>'professional', '')::uuid, (select id from kroner_private.professionals where shop = sid and role = 'owner'));
    select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'duration', duration, 'price', price)) into result from kroner_private.services where shop = sid and id = any(sv) and active;

    if action = 'move' then
      update kroner_private.appointments set professional = chair, starts = (slot->>'start')::timestamptz, ends = (slot->>'end')::timestamptz, status = 'booked' where id = apt.id;
      aid := apt.id;
    else
      insert into kroner_private.appointments(shop, professional, client, starts, ends, services, price, request_id) values(sid, chair, cid, (slot->>'start')::timestamptz, (slot->>'end')::timestamptz, result, (slot->>'price')::int, op) returning id into aid;
    end if;
    result := jsonb_build_object('id', aid);
  elsif action = 'cancel' then
    update kroner_private.appointments set status = case when payload->>'status' = 'absent' then 'absent' else 'cancelled' end where id = (payload->>'id')::uuid and shop = sid and status = 'booked';
    result := '{"ok":true}';
  elsif action = 'finish' then
    select * into apt from kroner_private.appointments where id = (payload->>'id')::uuid and shop = sid for update;
    if apt.id is null or apt.status <> 'booked' then raise exception 'Atendimento não está aberto.'; end if;
    if payload->>'payment' = 'monthly' then
      if apt.membership is null then raise exception 'Este atendimento não está vinculado a uma mensalidade.'; end if;
    else
      insert into kroner_private.charges(shop, client, appointment, description, amount, due) values(sid, apt.client, apt.id, 'Atendimento', apt.price, (apt.starts at time zone coalesce(s.cfg->>'timezone', 'America/Sao_Paulo'))::date) returning id into ch;
      if payload->>'payment' in ('full', 'partial') then
        amount := case when payload->>'payment' = 'full' then apt.price else (payload->>'amount')::int end;
        perform kroner_private.api('pay', jsonb_build_object('charge', ch, 'amount', amount, 'method', payload->>'method', 'paid_on', payload->>'paid_on', 'settles_on', payload->>'settles_on', 'request_id', gen_random_uuid()));
      end if;
    end if;
    update kroner_private.appointments set status = 'done' where id = apt.id;
    result := '{"ok":true}';
  elsif action = 'charge' then
    -- [BAIXA-02] NULL-safe direction validation using IS DISTINCT FROM
    if (payload->>'category' = 'injection' and payload->>'direction' is distinct from 'in')
       or (payload->>'category' in ('withdrawal', 'expense') and payload->>'direction' is distinct from 'out') then
      raise exception 'Aporte é entrada; despesa e retirada são saídas.';
    end if;
    amount := (payload->>'amount')::int;
    if amount is null or amount <= 0 then raise exception 'Valor deve ser positivo.'; end if;
    insert into kroner_private.charges(shop, client, description, amount, direction, category, due)
      values(sid, nullif(payload->>'client', '')::uuid, left(payload->>'description', 200), amount, case when payload->>'direction' = 'out' then 'out' else 'in' end, case when payload->>'category' in ('expense', 'injection', 'withdrawal', 'sale') then payload->>'category' else 'other' end, (payload->>'due')::date) returning id into ch;
    if coalesce((payload->>'paid')::boolean, false) then
      perform kroner_private.api('pay', jsonb_build_object('charge', ch, 'amount', amount, 'method', payload->>'method', 'paid_on', payload->>'due', 'settles_on', payload->>'due', 'request_id', gen_random_uuid()));
    end if;
    result := jsonb_build_object('id', ch);
  elsif action = 'pay' then
    select * into c from kroner_private.charges where id = (payload->>'charge')::uuid and shop = sid for update;
    if c.id is null then raise exception 'Lançamento não encontrado.'; end if;
    select coalesce(sum(p.amount), 0) into paid from kroner_private.payments p where p.charge = c.id;
    amount := (payload->>'amount')::int;
    if amount is null or amount <= 0 or amount > c.amount - paid then raise exception 'Recebimento maior que o saldo ou valor inválido.'; end if;
    method := payload->>'method';
    bps := case when c.direction = 'out' then 0 when method = 'credit' then coalesce((s.cfg->>'creditFee')::int, 0) when method = 'debit' then coalesce((s.cfg->>'debitFee')::int, 0) else 0 end;
    fee := round(amount * bps / 10000.0);
    if (payload->>'settles_on')::date < (payload->>'paid_on')::date then raise exception 'Liquidação anterior ao pagamento.'; end if;
    insert into kroner_private.payments(shop, charge, amount, fee, method, paid_on, settles_on, request_id) values(sid, c.id, amount, fee, method, (payload->>'paid_on')::date, (payload->>'settles_on')::date, coalesce(op, gen_random_uuid()));
    result := '{"ok":true}';
  elsif action = 'product' then
    insert into kroner_private.products(shop, name, cost, price, minimum, expires) values(sid, left(payload->>'name', 100), (payload->>'cost')::int, (payload->>'price')::int, (payload->>'minimum')::int, nullif(payload->>'expires', '')::date) returning id into rid;
    result := jsonb_build_object('id', rid);
  elsif action = 'stock' then
    select * into pr from kroner_private.products where id = (payload->>'id')::uuid and shop = sid for update; if pr.id is null then raise exception 'Produto não encontrado.'; end if;
    qty := (payload->>'quantity')::int; if qty is null or qty <= 0 then raise exception 'Quantidade deve ser positiva.'; end if;
    if payload->>'kind' not in ('purchase', 'sale', 'loss', 'internal') then raise exception 'Movimento inválido.'; end if;
    if payload->>'kind' <> 'purchase' and qty > pr.quantity then raise exception 'Estoque insuficiente.'; end if;
    if payload->>'kind' in ('purchase', 'sale') then
      amount := qty * case when payload->>'kind' = 'purchase' then pr.cost else pr.price end;
      insert into kroner_private.charges(shop, description, amount, direction, category, due) values(sid, qty || ' × ' || pr.name, amount, case when payload->>'kind' = 'purchase' then 'out' else 'in' end, case when payload->>'kind' = 'purchase' then 'stock_purchase' else 'sale' end, (payload->>'due')::date) returning id into ch;
      if coalesce((payload->>'paid')::boolean, false) and amount > 0 then perform kroner_private.api('pay', jsonb_build_object('charge', ch, 'amount', amount, 'method', payload->>'method', 'paid_on', payload->>'due', 'settles_on', coalesce(payload->>'settles_on', payload->>'due'), 'request_id', gen_random_uuid())); end if;
    end if;
    update kroner_private.products set quantity = quantity + case when payload->>'kind' = 'purchase' then qty else -qty end, updated_at = now() where id = pr.id;
    insert into kroner_private.movements(shop, product, quantity, kind, unit_cost, charge, note) values(sid, pr.id, qty, payload->>'kind', pr.cost, ch, left(payload->>'note', 200));
    result := '{"ok":true}';
  elsif action = 'block' then
    if (payload->>'end')::timestamptz <= (payload->>'start')::timestamptz then raise exception 'Intervalo inválido.'; end if;
    if exists(select 1 from kroner_private.appointments where shop = sid and status = 'booked' and starts < (payload->>'end')::timestamptz and ends > (payload->>'start')::timestamptz) then raise exception 'Há reservas nesse intervalo. Remarque ou cancele antes de bloquear.'; end if;
    insert into kroner_private.blocks(shop, starts, ends, reason) values(sid, (payload->>'start')::timestamptz, (payload->>'end')::timestamptz, left(payload->>'reason', 200));
    result := '{"ok":true}';
  elsif action = 'unblock' then
    delete from kroner_private.blocks where id = (payload->>'id')::uuid and shop = sid;
    result := '{"ok":true}';
  elsif action = 'recurring' then
    insert into kroner_private.recurring(shop, name, amount, day, variable) values(sid, left(payload->>'name', 100), (payload->>'amount')::int, (payload->>'day')::int, (payload->>'variable')::boolean);
    result := '{"ok":true}';
  elsif action = 'generate_expenses' then
    month := date_trunc('month', (payload->>'month')::date)::date;
    for r in select * from kroner_private.recurring where shop = sid and active loop
      if not exists(select 1 from kroner_private.recurring_runs where recurring = r.id and recurring_runs.month = ctx.month) and not r.variable then
        insert into kroner_private.charges(shop, description, amount, direction, category, due) values(sid, r.name, r.amount, 'out', 'expense', month + r.day - 1) returning id into ch;
        insert into kroner_private.recurring_runs values(r.id, month, ch);
      end if;
    end loop;
    result := '{"ok":true}';
  elsif action = 'membership' then
    select array_agg(value::uuid) into sv from jsonb_array_elements_text(payload->'services');
    if not exists(select 1 from kroner_private.clients where shop = sid and id = (payload->>'client')::uuid) or cardinality(sv) = 0 or (select count(*) from kroner_private.services where shop = sid and id = any(sv) and active) <> cardinality(sv) then
      raise exception 'Cliente ou serviços inválidos.';
    end if;
    select id into chair from kroner_private.professionals where shop = sid and status = 'active' and id = coalesce(nullif(payload->>'professional', '')::uuid, actor_seat.id);
    if chair is null then raise exception 'Cadeira indisponível.'; end if;
    insert into kroner_private.memberships(shop, professional, client, service_ids, weekday, at_time, price, due_day)
      values(sid, chair, (payload->>'client')::uuid, sv, (payload->>'weekday')::int, (payload->>'time')::time, (payload->>'price')::int, (payload->>'due_day')::int);
    result := '{"ok":true}';
  elsif action = 'monthly_generate' then
    select * into m from kroner_private.memberships where id = (payload->>'id')::uuid and shop = sid and active;
    if m.id is null then raise exception 'Plano inválido.'; end if;
    month := date_trunc('month', (payload->>'month')::date)::date;
    until_day := (month + interval '1 month - 1 day')::date;
    dd := month;
    select jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'price', z.price, 'duration', coalesce((p.preferences->'durations'->>z.id::text)::int, z.duration)))
      into result
      from kroner_private.services z
      join kroner_private.professionals p on p.id = m.professional and p.shop = sid
      where z.shop = sid and z.id = any(m.service_ids) and z.active;
    day := null;
    while dd <= until_day loop
      if extract(dow from dd)::int = m.weekday then
        day := dd;
        if dd between (now() at time zone coalesce(s.cfg->>'timezone', 'America/Sao_Paulo'))::date and (now() at time zone coalesce(s.cfg->>'timezone', 'America/Sao_Paulo'))::date + coalesce((s.cfg->>'maxDays')::int, 21) then
          select v into slot
          from (values ('morning'), ('afternoon'), ('night')) k(period_name)
          cross join lateral jsonb_array_elements(kroner_private.chair_slots(sid, m.professional, m.service_ids, dd, k.period_name, true)) v
          where v->>'label' = to_char(m.at_time, 'HH24:MI')
          limit 1;
          if slot is not null then
            insert into kroner_private.appointments(shop, professional, client, starts, ends, services, price, membership, request_id)
              values(sid, m.professional, m.client, (slot->>'start')::timestamptz, (slot->>'end')::timestamptz, result, 0, m.id, gen_random_uuid());
          end if;
        end if;
      end if;
      dd := dd + 1;
    end loop;
    if not exists(select 1 from kroner_private.appointments where membership = m.id and starts >= (month::timestamp at time zone coalesce(s.cfg->>'timezone', 'America/Sao_Paulo')) and starts < ((month + interval '1 month') at time zone coalesce(s.cfg->>'timezone', 'America/Sao_Paulo'))) then
      raise exception 'Nenhum horário disponível na janela de agendamento deste mês.';
    end if;
    if not exists(select 1 from kroner_private.charges where membership = m.id and charges.month = ctx.month) then
      insert into kroner_private.charges(shop, client, membership, month, description, amount, due, category)
        values(sid, m.client, m.id, month, 'Mensalidade ' || to_char(month, 'MM/YYYY'), m.price, case when m.due_day = 0 then day else month + m.due_day - 1 end, 'monthly');
    end if;
    result := '{"ok":true}';
  elsif action = 'monthly_stop' then
    update kroner_private.memberships set active = false where id = (payload->>'id')::uuid and shop = sid;
    update kroner_private.appointments set status = 'cancelled' where membership = (payload->>'id')::uuid and shop = sid and status = 'booked' and starts > now();
    result := '{"ok":true}';
  else
    raise exception 'Operação desconhecida.';
  end if;

  insert into kroner_private.audit(shop, actor, action, record_id) values(sid, uid, action, coalesce(aid, ch, rid));
  if op is not null and action not in ('book', 'manual_book') then
    update kroner_private.requests set result = ctx.result where id = op and actor = uid;
  end if;
  return result;
exception when exclusion_violation then
  raise exception 'Já existe um atendimento nesse horário. Escolha outro.';
end $function$;

revoke all on function kroner_private.api(text, jsonb) from public, anon, authenticated;
