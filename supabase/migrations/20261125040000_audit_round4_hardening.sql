-- ============================================================================
-- Kronner Security & Functional Audit Round 4 Hardening (2026-11-25)
-- Fixes ALL confirmed findings from 3-Agent Security & Integrity Audit:
--   - CRITICAL: Fix ambiguous "ch" alias in employee workspace (to_jsonb(chg))
--   - HIGH: Fix unassigned record crash in kroner_client_profile(null)
--   - HIGH (Security): Remove unverified phone auto-linking IDOR in book
--   - HIGH (Security): Enforce Web Push host allowlist (anti-SSRF) in DB
--   - MEDIUM-HIGH (Security): Verify audit trail in kroner_verify_client_appointment
--     + rate-limit & reject no-op in kroner_client_reschedule
--   - MEDIUM: Fix AB-BA deadlock lock order in kroner_client_reschedule
--   - MEDIUM: Fix shop_owner_chair() finance=true + backfill owners
--   - MEDIUM: Deep-merge holidayDecisions for owner/partner + trigger columns
--   - MEDIUM (Security): Prevent partner self-escalation in team & management
--   - MEDIUM: Null-safe casts across api, team, pos, management, chair_slots
--   - LOW: Exclude expired invites from seat_limit & Stripe extraChairs
--   - LOW: Guard trg_notify_client_cancel, scope pushes by shop, fix tz/grace
-- Idempotent: safe to run repeatedly in Supabase SQL Editor.
-- ============================================================================

-- 1. Fix shop_owner_chair() so every new owner starts with finance = true + backfill
create or replace function kroner_private.shop_owner_chair()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into kroner_private.professionals(shop, user_id, name, role, status, finance)
  values(new.id, new.owner, coalesce(nullif(new.cfg->>'professional', ''), new.name), 'owner', 'active', true)
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function kroner_private.shop_owner_chair() from public, authenticated, anon;

update kroner_private.professionals
set finance = true
where role = 'owner' and not finance;

-- 2. Harden push_subscriptions endpoint CHECK constraint against SSRF
do $$
declare
  con record;
begin
  if to_regclass('kroner_private.push_subscriptions') is not null then
    for con in
      select conname from pg_constraint
      where conrelid = 'kroner_private.push_subscriptions'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%endpoint%'
    loop
      execute format('alter table kroner_private.push_subscriptions drop constraint %I', con.conname);
    end loop;

    delete from kroner_private.push_subscriptions
    where endpoint !~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)?push\.apple\.com|([a-z0-9-]+\.)?notify\.windows\.com|([a-z0-9-]+\.)?push\.samsungosp\.com)/';

    alter table kroner_private.push_subscriptions
      add constraint push_subscriptions_endpoint_allowlist
      check (
        length(endpoint) <= 2048
        and endpoint ~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)?push\.apple\.com|([a-z0-9-]+\.)?notify\.windows\.com|([a-z0-9-]+\.)?push\.samsungosp\.com)/'
      );
  end if;
end $$;

-- 3. Deep-merge holidayDecisions in chair_slots & check_holiday_booking + deterministic available()
create or replace function kroner_private.chair_slots(sid uuid, chair uuid, svc uuid[], day date, period text, manual boolean default false)
returns jsonb language plpgsql set search_path = '' as $$
declare
  professional_row kroner_private.professionals;
  buffer_minutes integer;
  s kroner_private.shops;
  merged_holidays jsonb;
  w jsonb; dur integer; price integer; n integer;
  lo time; hi time; lunch1 time; lunch2 time;
  a timestamptz; b timestamptz; cursor_t time; z text;
  result jsonb := '[]'; step integer;
begin
  select * into s from kroner_private.shops where id = sid and active;
  if s.id is null then return result; end if;
  select * into professional_row from kroner_private.professionals where id = chair and shop = sid and status = 'active';
  if professional_row.id is null then return result; end if;

  if exists(
    select 1 from jsonb_array_elements(coalesce(professional_row.vacations, '[]'::jsonb)) v
    where day between (v->>'start')::date and (v->>'end')::date
  ) then
    return result;
  end if;

  -- Deep-merge holiday decisions BEFORE merging top-level preferences
  merged_holidays := case
    when professional_row.role in ('owner', 'partner') then
      coalesce(s.cfg->'holidayDecisions', '{}'::jsonb) || coalesce(professional_row.preferences->'holidayDecisions', '{}'::jsonb)
    else
      coalesce(professional_row.preferences->'holidayDecisions', '{}'::jsonb)
  end;

  s.cfg := s.cfg || coalesce(professional_row.preferences, '{}'::jsonb);

  if (kroner_private.local_holiday(sid, day) or to_char(day, 'MM-DD') in ('01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-25'))
     and coalesce(merged_holidays->>day::text, '') <> 'open' then
    return result;
  end if;

  buffer_minutes := coalesce(nullif(s.cfg->>'buffer', '')::integer, 10);
  select sum(coalesce(nullif(professional_row.preferences->'durations'->>id::text, '')::int, duration)), sum(services.price), count(*)
    into dur, price, n
    from kroner_private.services
    where shop = sid and active and id = any(svc)
      and not (coalesce(professional_row.preferences->'disabledServices', '[]') ? id::text);
  if n = 0 or n <> coalesce(cardinality(svc), 0) or dur is null or dur >= 1440 then return result; end if;

  z := coalesce(nullif(s.cfg->>'timezone', ''), 'America/Sao_Paulo');
  if day < (now() at time zone z)::date or day > (now() at time zone z)::date + coalesce(nullif(s.cfg->>'maxDays', '')::int, 21) then
    return result;
  end if;

  w := s.cfg->'week'->extract(dow from day)::int;
  if not coalesce((w->>'enabled')::boolean, false) then return result; end if;
  lo := nullif(w->>'open', '')::time;
  hi := nullif(w->>'close', '')::time;
  if lo is null or hi is null or lo >= hi then return result; end if;
  lunch1 := nullif(w->>'lunchStart', '')::time;
  lunch2 := nullif(w->>'lunchEnd', '')::time;

  if period = 'morning' then hi := least(hi, coalesce(lunch1, '11:00'::time));
  elsif period = 'afternoon' then lo := greatest(lo, coalesce(lunch2, '11:00'::time)); hi := least(hi, '18:00'::time);
  elsif period = 'night' then lo := greatest(lo, '18:00'::time);
  else raise exception 'Período inválido.'; end if;

  step := greatest(5, coalesce(nullif(s.cfg->>'grid', '')::integer, 15));
  cursor_t := lo;
  while day + cursor_t + make_interval(mins => dur) <= day + hi and cursor_t < hi loop
    a := (day + cursor_t) at time zone z;
    b := a + make_interval(mins => dur);
    if a >= now() + make_interval(mins => case when manual then 0 else coalesce(nullif(s.cfg->>'notice', '')::int, 10) end)
       and (lunch1 is null or lunch2 is null or not (cursor_t < lunch2 and day + cursor_t + make_interval(mins => dur) > day + lunch1))
       and not exists(select 1 from kroner_private.appointments x where x.shop = sid and x.professional = chair and x.status in ('booked', 'done') and x.starts < b + make_interval(mins => buffer_minutes) and x.ends + make_interval(mins => buffer_minutes) > a)
       and not exists(select 1 from kroner_private.blocks x where x.shop = sid and x.starts < b and x.ends > a)
    then
      result := result || jsonb_build_object('start', a, 'end', b, 'label', to_char(cursor_t, 'HH24:MI'), 'duration', dur, 'price', price);
    end if;
    exit when cursor_t + make_interval(mins => step) <= cursor_t;
    cursor_t := cursor_t + make_interval(mins => step);
  end loop;
  return result;
end;
$$;
revoke all on function kroner_private.chair_slots(uuid, uuid, uuid[], date, text, boolean) from public, anon, authenticated;

create or replace function kroner_private.available(sid uuid, svc uuid[], day date, period text, manual boolean default false)
returns jsonb language sql set search_path = '' as $$
  select coalesce(jsonb_agg(item order by item->>'start'), '[]'::jsonb)
  from (
    select distinct on (v->>'start')
      v || jsonb_build_object('professional', p.id) as item
    from kroner_private.professionals p
    cross join lateral jsonb_array_elements(kroner_private.chair_slots(sid, p.id, svc, day, period, manual)) v
    where p.shop = sid and p.status = 'active'
    order by v->>'start', (p.role = 'owner') desc, p.id
  ) options;
$$;
revoke all on function kroner_private.available(uuid, uuid[], date, text, boolean) from public, anon, authenticated;

create or replace function kroner_private.check_holiday_booking()
returns trigger language plpgsql set search_path = '' as $$
declare
  local_day date;
  decisions jsonb;
begin
  if new.status <> 'booked' then return new; end if;
  if tg_op = 'UPDATE' and old.starts = new.starts and old.professional = new.professional and old.status = new.status then
    return new;
  end if;
  select (new.starts at time zone coalesce(nullif(s.cfg->>'timezone', ''), 'America/Sao_Paulo'))::date,
    case
      when p.id is null or p.role in ('owner', 'partner') then
        coalesce(s.cfg->'holidayDecisions', '{}'::jsonb) || coalesce(p.preferences->'holidayDecisions', '{}'::jsonb)
      else
        coalesce(p.preferences->'holidayDecisions', '{}'::jsonb)
    end
  into local_day, decisions
  from kroner_private.shops s
  left join kroner_private.professionals p on p.id = new.professional
  where s.id = new.shop;

  if (kroner_private.local_holiday(new.shop, local_day) or to_char(local_day, 'MM-DD') in ('01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-25'))
     and coalesce(decisions->>local_day::text, '') <> 'open' then
    raise exception 'Agenda fechada neste feriado.';
  end if;
  return new;
end;
$$;
revoke all on function kroner_private.check_holiday_booking() from public, anon, authenticated;

drop trigger if exists check_holiday_booking on kroner_private.appointments;
create trigger check_holiday_booking
  before insert or update of starts, shop, professional, status
  on kroner_private.appointments
  for each row execute function kroner_private.check_holiday_booking();

-- 4. Fix kroner_billing_context() so expired invites don't inflate Stripe extraChairs
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
      where p.shop = s.id
        and (p.status = 'active' or (p.status = 'invited' and p.expires > now()))
    ))
  )
  from kroner_private.shops s
  left join kroner_private.shop_subscriptions sub on sub.shop = s.id
  where s.owner = kroner_private.current_user_id()
  limit 1;
$$;
revoke all on function public.kroner_billing_context() from public, anon;
grant execute on function public.kroner_billing_context() to authenticated;

create or replace function public.kroner_team(action text, payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := kroner_private.current_user_id();
  me kroner_private.professionals;
  target kroner_private.professionals;
  token text;
  mail text := lower(trim(auth.jwt()->>'email'));
  selected_role text := payload->>'role';
  week_day jsonb;
  d date; d_start date; d_end date;
  prefs jsonb;
  shoprow kroner_private.shops;
  subrow kroner_private.shop_subscriptions;
  seat_count int;
  recent_invites int;
  conflicts int;
  new_comm_bps int;
  vac_id text;
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
      where id = nullif(payload->>'id', '')::uuid
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
      'name', me.name,
      'finance', coalesce(me.finance, false),
      'commission_enabled', coalesce(me.commission_enabled, false),
      'commission_bps', coalesce(me.commission_bps, 0),
      'can_manage_memberships', coalesce(me.can_manage_memberships, false),
      'can_register_payment', coalesce(me.can_register_payment, true),
      'can_share_link', coalesce(me.can_share_link, true),
      'revoked', exists(select 1 from kroner_private.professionals where user_id = uid and status = 'inactive')
    );
  end if;

  if me.id is null then raise exception 'Sem vínculo ativo com a equipe.'; end if;
  select * into shoprow from kroner_private.shops where id = me.shop;

  if action = 'calendar_event' then
    if me.role not in ('owner', 'partner') or nullif(trim(coalesce(payload->>'date', '')), '') is null or coalesce(length(trim(payload->>'name')), 0) < 2 or coalesce(payload->>'source', '') !~ '^https?://[^ ]+$' or coalesce(shoprow.cfg->>'city', '') = '' or coalesce(shoprow.cfg->>'state', '') = '' then
      raise exception 'Informe o feriado, a data, a localidade e o link da fonte oficial.';
    end if;
    insert into kroner_private.calendar_events(shop, day, name, scope, source, state, city, actor)
      values(me.shop, (payload->>'date')::date, trim(payload->>'name'), coalesce(nullif(payload->>'scope', ''), 'Municipal'), payload->>'source', shoprow.cfg->>'state', shoprow.cfg->>'city', uid)
      on conflict(shop, day, scope, state, city) do update set name = excluded.name, source = excluded.source, actor = uid, updated_at = now();
    insert into kroner_private.audit(shop, actor, action, record_id) values(me.shop, uid, 'calendar_event_' || (payload->>'date'), me.id);
    return '{"ok":true}';
  end if;

  -- Whole shop client base (registered + manual, deduplicated)
  if action = 'clients' then
    return coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'phone', c.phone,
          'registered', c.user_id is not null,
          'last', x.last,
          'lastService', x.last_service,
          'lastProfessional', x.last_prof,
          'monthly', exists(select 1 from kroner_private.memberships m where m.client = c.id and m.shop = me.shop and m.active),
          'receivable', case when me.role = 'employee' and not me.finance then false else coalesce(b.pending, false) end,
          'debt', case when me.role = 'employee' and not me.finance then false else coalesce(b.overdue, false) end
        ) order by c.name
      )
      from kroner_private.clients c
      left join lateral (
        select
          (a.starts at time zone coalesce(shoprow.cfg->>'timezone', 'America/Sao_Paulo'))::date as last,
          (select string_agg(v->>'name', ', ') from jsonb_array_elements(a.services) v) as last_service,
          pr.name as last_prof
        from kroner_private.appointments a
        left join kroner_private.professionals pr on pr.id = a.professional and pr.shop = me.shop
        where a.client = c.id and a.shop = me.shop and a.status = 'done'
        order by a.starts desc limit 1
      ) x on true
      left join lateral (
        select bool_or(ch.due is null or ch.due >= (now() at time zone coalesce(nullif(shoprow.cfg->>'timezone', ''), 'America/Sao_Paulo'))::date - coalesce(nullif(shoprow.cfg->>'grace', '')::int, 5)) pending,
               bool_or(ch.due < (now() at time zone coalesce(nullif(shoprow.cfg->>'timezone', ''), 'America/Sao_Paulo'))::date - coalesce(nullif(shoprow.cfg->>'grace', '')::int, 5)) overdue
        from kroner_private.charges ch
        where ch.client = c.id and ch.shop = me.shop and ch.direction = 'in'
          and ch.amount > coalesce((select sum(pay.amount) from kroner_private.payments pay where pay.charge = ch.id), 0)
      ) b on true
      where c.shop = me.shop
    ), '[]');
  end if;

  if action = 'profile' then
    return jsonb_build_object(
      'id', me.id,
      'slug', shoprow.slug,
      'role', me.role,
      'finance', me.finance,
      'commission_enabled', me.commission_enabled,
      'commission_bps', me.commission_bps,
      'can_manage_memberships', me.can_manage_memberships,
      'can_register_payment', me.can_register_payment,
      'can_share_link', me.can_share_link,
      'vacations', coalesce(me.vacations, '[]'::jsonb),
      'calendar', coalesce((select jsonb_agg(jsonb_build_object('date', h.day, 'name', h.name, 'scope', h.scope, 'source', h.source)) from kroner_private.calendar_events h where h.shop = me.shop and h.day >= current_date - 1 and h.day <= current_date + 370 and (h.scope = 'Nacional' or h.state = shoprow.cfg->>'state' and (h.scope = 'Estadual' or lower(h.city) = lower(shoprow.cfg->>'city')))), '[]'),
      'timezone', coalesce(shoprow.cfg->>'timezone', 'America/Sao_Paulo'),
      'preferences', me.preferences,
      'week', coalesce(me.preferences->'week', shoprow.cfg->'week'),
      'services', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'duration', duration) order by name) from kroner_private.services where shop = me.shop and active), '[]')
    );
  end if;

  if action = 'preferences' then
    -- Owner/partner may edit any member's preferences via payload->>'professional'; employee edits own only
    if me.role in ('owner', 'partner') and nullif(payload->>'professional', '') is not null then
      select * into target from kroner_private.professionals where id = (payload->>'professional')::uuid and shop = me.shop and status = 'active' for update;
      if target.id is null then raise exception 'Profissional indisponível.'; end if;
    else
      target := me;
    end if;

    prefs := payload - 'holidayDecisions' - 'professional';
    if jsonb_typeof(prefs) <> 'object' or prefs - array['notice', 'buffer', 'week', 'durations', 'disabledServices'] <> '{}'::jsonb or not (prefs ?& array['buffer', 'week', 'durations', 'disabledServices']) or coalesce(nullif(prefs->>'notice', '')::int, 10) not between 0 and 10080 or nullif(prefs->>'buffer', '') is null or (prefs->>'buffer')::int not between 0 and 180 or jsonb_typeof(prefs->'week') <> 'array' or jsonb_array_length(prefs->'week') <> 7 then
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
    update kroner_private.professionals set preferences = preferences || prefs where id = target.id and shop = me.shop;
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
    return coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', id,
          'name', name,
          'role', role,
          'status', status,
          'email', case when me.role in ('owner', 'partner') then email else null end,
          'finance', finance,
          'commission_enabled', commission_enabled,
          'commission_bps', case when me.role in ('owner', 'partner') or id = me.id then commission_bps else 0 end,
          'can_manage_memberships', can_manage_memberships,
          'can_register_payment', can_register_payment,
          'can_share_link', can_share_link,
          'preferences', case when me.role in ('owner', 'partner') or id = me.id then preferences else '{}'::jsonb end,
          'vacations', coalesce(vacations, '[]'::jsonb)
        ) order by (role = 'owner') desc, name
      )
      from kroner_private.professionals
      where shop = me.shop and (me.role in ('owner', 'partner') or status = 'active')
    ), '[]');
  end if;

  -- All roles can view all agendas in the barbershop
  if action = 'agenda' then
    return coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'professional', a.professional, 'name', c.name, 'starts', a.starts, 'ends', a.ends, 'status', a.status, 'client', a.client, 'serviceIds', (select jsonb_agg(v->>'id') from jsonb_array_elements(a.services) v), 'services', (select string_agg(v->>'name', ', ') from jsonb_array_elements(a.services) v)) order by a.starts)
      from kroner_private.appointments a
      join kroner_private.clients c on a.client = c.id
      join kroner_private.shops s on s.id = a.shop
      where a.shop = me.shop
        and (a.starts at time zone coalesce(s.cfg->>'timezone', 'America/Sao_Paulo'))::date = (payload->>'day')::date
    ), '[]');
  end if;

  -- Management actions: Owner AND Partner
  if me.role not in ('owner', 'partner') then
    raise exception 'Somente o proprietário ou sócio gerencia a equipe.';
  end if;

  if action = 'add_vacation' then
    perform 1 from kroner_private.shops where id = me.shop for update;
    select * into target from kroner_private.professionals
    where id = coalesce(nullif(payload->>'professional', '')::uuid, me.id)
      and shop = me.shop and status = 'active' for update;
    if target.id is null then raise exception 'Profissional indisponível.'; end if;
    d_start := nullif(payload->>'start', '')::date;
    d_end := coalesce(nullif(payload->>'end', '')::date, d_start);
    if d_start is null or d_end < d_start or d_end > d_start + 90 then
      raise exception 'Informe um período válido (até 90 dias).';
    end if;
    select count(*) into conflicts
    from kroner_private.appointments a
    where a.shop = me.shop and a.professional = target.id and a.status = 'booked'
      and (a.starts at time zone coalesce(shoprow.cfg->>'timezone', 'America/Sao_Paulo'))::date between d_start and d_end;
    if conflicts > 0 then
      raise exception 'Existem % agendamento(s) confirmado(s) nesse período. Transfira ou cancele antes de confirmar a folga/férias.', conflicts;
    end if;
    vac_id := gen_random_uuid()::text;
    update kroner_private.professionals
    set vacations = coalesce(vacations, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'id', vac_id,
      'start', d_start::text,
      'end', d_end::text,
      'reason', left(coalesce(trim(payload->>'reason'), 'Folga / Férias'), 120)
    ))
    where id = target.id and shop = me.shop;
    insert into kroner_private.audit(shop, actor, action, record_id) values(me.shop, uid, 'team_add_vacation', target.id);
    return jsonb_build_object('ok', true, 'id', vac_id);
  end if;

  if action = 'remove_vacation' then
    select * into target from kroner_private.professionals
    where id = coalesce(nullif(payload->>'professional', '')::uuid, me.id)
      and shop = me.shop and status = 'active' for update;
    if target.id is null then raise exception 'Profissional indisponível.'; end if;
    update kroner_private.professionals
    set vacations = coalesce((
      select jsonb_agg(v) from jsonb_array_elements(coalesce(vacations, '[]'::jsonb)) v
      where v->>'id' is distinct from payload->>'id'
    ), '[]'::jsonb)
    where id = target.id and shop = me.shop;
    insert into kroner_private.audit(shop, actor, action, record_id) values(me.shop, uid, 'team_remove_vacation', target.id);
    return '{"ok":true}';
  end if;

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
      and (status = 'active' or (status = 'invited' and expires > now() and email is distinct from lower(trim(payload->>'email'))));
    if subrow.shop is not null and seat_count >= subrow.seat_limit then
      raise exception 'Limite de cadeiras do plano atingido. Adicione cadeiras na assinatura.';
    end if;
    select count(*) into recent_invites
    from kroner_private.audit au
    where au.shop = me.shop and au.action = 'team_invite' and au.created_at > now() - interval '24 hours';
    if recent_invites >= 20 then
      raise exception 'Limite diário de convites atingido. Tente novamente mais tarde.';
    end if;

    new_comm_bps := greatest(0, least(10000, coalesce((payload->>'commission_bps')::int, 0)));
    token := encode(extensions.gen_random_bytes(32), 'hex');
    insert into kroner_private.professionals(
      shop, name, role, status, email, invite_hash, expires,
      finance, commission_enabled, commission_bps,
      can_manage_memberships, can_register_payment, can_share_link
    )
    values(
      me.shop, trim(payload->>'name'), selected_role, 'invited', lower(trim(payload->>'email')),
      encode(extensions.digest(token, 'sha256'), 'hex'), now() + interval '7 days',
      coalesce((payload->>'finance')::boolean, false),
      coalesce((payload->>'commission_enabled')::boolean, false),
      new_comm_bps,
      coalesce((payload->>'can_manage_memberships')::boolean, false),
      coalesce((payload->>'can_register_payment')::boolean, true),
      coalesce((payload->>'can_share_link')::boolean, true)
    )
    on conflict(shop, email) where status = 'invited' do update set
      name = excluded.name,
      role = excluded.role,
      invite_hash = excluded.invite_hash,
      expires = excluded.expires,
      finance = excluded.finance,
      commission_enabled = excluded.commission_enabled,
      commission_bps = excluded.commission_bps,
      can_manage_memberships = excluded.can_manage_memberships,
      can_register_payment = excluded.can_register_payment,
      can_share_link = excluded.can_share_link
    returning * into target;
  elsif action in ('permissions', 'deactivate') then
    if nullif(payload->>'id', '') is null then raise exception 'Profissional inválido.'; end if;
    select * into target from kroner_private.professionals
    where id = (payload->>'id')::uuid and shop = me.shop and role <> 'owner' and status <> 'inactive' for update;
    if target.id is null then raise exception 'Profissional indisponível.'; end if;
    if me.role = 'partner' and (target.id = me.id or target.role = 'partner') then
      raise exception 'Somente o proprietário pode alterar sócios ou as próprias permissões.';
    end if;
    if action = 'permissions' then
      if selected_role is null or selected_role not in ('partner', 'employee') then raise exception 'Papel inválido.'; end if;
      new_comm_bps := case
        when payload ? 'commission_bps' then nullif(payload->>'commission_bps', '')::int
        else target.commission_bps
      end;
      if new_comm_bps is null or new_comm_bps not between 0 and 10000 then
        raise exception 'Percentual de comissão inválido (0%% a 100%%).';
      end if;
      update kroner_private.professionals set
        name = coalesce(nullif(left(trim(payload->>'name'), 100), ''), name),
        role = selected_role,
        finance = coalesce((payload->>'finance')::boolean, finance),
        commission_enabled = coalesce((payload->>'commission_enabled')::boolean, commission_enabled),
        commission_bps = new_comm_bps,
        can_manage_memberships = coalesce((payload->>'can_manage_memberships')::boolean, can_manage_memberships),
        can_register_payment = coalesce((payload->>'can_register_payment')::boolean, can_register_payment),
        can_share_link = coalesce((payload->>'can_share_link')::boolean, can_share_link)
      where id = target.id and shop = me.shop;
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
  upcoming_count int; recent_books int; active_profs int;
begin
  if octet_length(payload::text) > 65536 then raise exception 'Solicitação muito grande.'; end if;

  if action in ('public', 'slots') then
    select * into s from kroner_private.shops where slug = payload->>'slug' and active;
    if s.id is null then raise exception 'Barbearia indisponível ou link inválido.'; end if;

    select count(*) into active_profs from kroner_private.professionals where shop = s.id and status = 'active';

    select id, role into chair, chair_role
    from kroner_private.professionals
    where shop = s.id and status = 'active'
      and (case when coalesce(nullif(payload->>'professional', ''), 'auto') = 'auto' or active_profs <= 1 then role = 'owner' else id = (payload->>'professional')::uuid end);
    if chair is null and active_profs = 1 then
      select id, role into chair, chair_role from kroner_private.professionals where shop = s.id and status = 'active' limit 1;
    end if;
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
          'week', coalesce((select coalesce(p.preferences->'week', s.cfg->'week') from kroner_private.professionals p where p.id = chair), s.cfg->'week'),
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

    -- Partner has full operational parity with Owner (except billing/subscription handled in /api/assinatura)
    if actor_seat.role = 'partner' and action not in (
      'workspace','settings','service','block','unblock','manual_book','move','cancel','finish','pay',
      'client','charge','product','stock','membership','monthly_generate','monthly_stop',
      'generate_expenses','recurring','cancel_own'
    ) then
      raise exception 'Esta operação exige a conta principal.';
    end if;

    -- Employee granular operational permissions
    if actor_seat.role = 'employee' then
      if action not in ('workspace','manual_book','move','cancel','finish','pay','client','cancel_own','membership','monthly_generate','monthly_stop') then
        raise exception 'Operação restrita para colaborador.';
      end if;
      if action in ('membership','monthly_generate','monthly_stop') then
        if not coalesce(actor_seat.can_manage_memberships, false) then
          raise exception 'Acesso a mensalistas não autorizado.';
        end if;
        if action in ('monthly_generate','monthly_stop') and not exists(
          select 1 from kroner_private.memberships mm
          where mm.id = (payload->>'id')::uuid and mm.shop = s.id and mm.professional = actor_seat.id
        ) then
          raise exception 'Você só pode gerenciar seus próprios mensalistas.';
        end if;
      end if;
      if action in ('move','cancel','finish') and not exists(
        select 1 from kroner_private.appointments
        where id = (payload->>'id')::uuid and shop = s.id and professional = actor_seat.id
      ) then
        raise exception 'Você só pode alterar os próprios atendimentos.';
      end if;
      if action = 'finish' and payload->>'payment' in ('full', 'partial') and not coalesce(actor_seat.can_register_payment, true) then
        raise exception 'Registro de pagamentos não autorizado para este perfil.';
      end if;
      if action = 'pay' then
        if not coalesce(actor_seat.can_register_payment, true) then
          raise exception 'Registro de pagamentos não autorizado para este perfil.';
        end if;
        if not exists(
          select 1 from kroner_private.charges chg
          left join kroner_private.appointments a on a.id = chg.appointment and a.shop = s.id
          left join kroner_private.memberships mm on mm.id = chg.membership and mm.shop = s.id
          where chg.id = (payload->>'charge')::uuid
            and chg.shop = s.id
            and (
              a.professional = actor_seat.id
              or (coalesce(actor_seat.can_manage_memberships, false) and mm.professional = actor_seat.id)
            )
        ) then
          raise exception 'Recebimento de outro profissional.';
        end if;
      end if;
    end if;
  end if;

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

  -- Unified adaptive workspace: returns strictly permission-scoped data for employee
  if action = 'workspace' then
    if s.id is null then return '{"onboarding":true}'; end if;
    if actor_seat.id is not null and actor_seat.role = 'employee' then
      return jsonb_build_object(
        'shop', to_jsonb(s),
        'professionals', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', case when role = 'owner' then coalesce(nullif(s.cfg->>'professional', ''), name) else name end, 'role', role, 'status', status) order by (role = 'owner') desc, name) from kroner_private.professionals where shop = s.id and status = 'active'), '[]'),
        'services', coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.services x where shop = s.id), '[]'),
        'clients', coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.clients x where shop = s.id), '[]'),
        'appointments', coalesce((select jsonb_agg(to_jsonb(x) order by starts) from kroner_private.appointments x where shop = s.id), '[]'),
        'charges', case when coalesce(actor_seat.finance, false) then coalesce((
          select jsonb_agg(to_jsonb(chg)) from kroner_private.charges chg
          left join kroner_private.appointments a on a.id = chg.appointment and a.shop = s.id
          left join kroner_private.memberships mm on mm.id = chg.membership and mm.shop = s.id
          where chg.shop = s.id and (a.professional = actor_seat.id or mm.professional = actor_seat.id)
        ), '[]') else '[]'::jsonb end,
        'payments', case when coalesce(actor_seat.finance, false) then coalesce((
          select jsonb_agg(to_jsonb(p)) from kroner_private.payments p
          join kroner_private.charges chg on chg.id = p.charge and chg.shop = s.id
          left join kroner_private.appointments a on a.id = chg.appointment and a.shop = s.id
          left join kroner_private.memberships mm on mm.id = chg.membership and mm.shop = s.id
          where p.shop = s.id and (a.professional = actor_seat.id or mm.professional = actor_seat.id)
        ), '[]') else '[]'::jsonb end,
        'products', '[]'::jsonb,
        'memberships', case when coalesce(actor_seat.can_manage_memberships, false) then coalesce((
          select jsonb_agg(to_jsonb(x)) from kroner_private.memberships x where shop = s.id and professional = actor_seat.id
        ), '[]') else '[]'::jsonb end,
        'blocks', coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.blocks x where shop = s.id), '[]'),
        'recurring', '[]'::jsonb,
        'movements', '[]'::jsonb,
        'calendar', coalesce((select jsonb_agg(jsonb_build_object('day', ce.day, 'name', ce.name, 'scope', ce.scope)) from kroner_private.calendar_events ce where ce.shop = s.id and ce.day >= current_date - 1), '[]'),
        'myHolidayDecisions', coalesce(actor_seat.preferences->'holidayDecisions', '{}'::jsonb)
      );
    end if;

    return jsonb_build_object(
      'shop', to_jsonb(s),
      'professionals', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', case when role = 'owner' then coalesce(nullif(s.cfg->>'professional', ''), name) else name end, 'role', role, 'status', status, 'finance', finance, 'commission_enabled', commission_enabled, 'commission_bps', commission_bps, 'can_manage_memberships', can_manage_memberships, 'can_register_payment', can_register_payment, 'can_share_link', can_share_link) order by (role = 'owner') desc, name) from kroner_private.professionals where shop = s.id and status = 'active'), '[]'),
      'services', coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.services x where shop = s.id), '[]'),
      'clients', coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.clients x where shop = s.id), '[]'),
      'appointments', coalesce((select jsonb_agg(to_jsonb(x) order by starts) from kroner_private.appointments x where shop = s.id), '[]'),
      'charges', coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.charges x where shop = s.id), '[]'),
      'payments', coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.payments x where shop = s.id), '[]'),
      'products', coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.products x where shop = s.id), '[]'),
      'memberships', coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.memberships x where shop = s.id), '[]'),
      'blocks', coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.blocks x where shop = s.id), '[]'),
      'recurring', coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.recurring x where shop = s.id), '[]'),
      'movements', coalesce((select jsonb_agg(to_jsonb(x)) from kroner_private.movements x where shop = s.id), '[]'),
      'calendar', coalesce((select jsonb_agg(jsonb_build_object('day', ce.day, 'name', ce.name, 'scope', ce.scope)) from kroner_private.calendar_events ce where ce.shop = s.id and ce.day >= current_date - 1), '[]'),
      'myHolidayDecisions', case when actor_seat.role = 'partner' then coalesce(actor_seat.preferences->'holidayDecisions', '{}'::jsonb) else coalesce(s.cfg->'holidayDecisions', '{}'::jsonb) || coalesce(actor_seat.preferences->'holidayDecisions', '{}'::jsonb) end
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
    if nullif(cfg->>'maxDays', '') is null or (cfg->>'maxDays')::int not between 1 and 90
       or nullif(cfg->>'grid', '') is null or (cfg->>'grid')::int not between 5 and 60
       or nullif(cfg->>'grace', '') is null or (cfg->>'grace')::int not between 0 and 90
       or nullif(cfg->>'notice', '') is null or (cfg->>'notice')::int < 0
       or nullif(cfg->>'cancelMinutes', '') is null or (cfg->>'cancelMinutes')::int < 0 then raise exception 'Prazos inválidos.'; end if;
    if nullif(cfg->>'creditFee', '') is null or (cfg->>'creditFee')::int not between 0 and 10000
       or nullif(cfg->>'debitFee', '') is null or (cfg->>'debitFee')::int not between 0 and 10000 then raise exception 'Taxa inválida.'; end if;
    if jsonb_typeof(cfg->'week') <> 'array' or jsonb_array_length(cfg->'week') <> 7 then raise exception 'Configure os sete dias.'; end if;
    for w in select value from jsonb_array_elements(cfg->'week') loop
      if coalesce((w->>'enabled')::boolean, false) then
        if nullif(w->>'open', '') is null or nullif(w->>'close', '') is null or (w->>'open')::time >= (w->>'close')::time then raise exception 'Abertura deve ser anterior ao encerramento.'; end if;
        if (nullif(w->>'lunchStart', '') is null) <> (nullif(w->>'lunchEnd', '') is null) then raise exception 'Informe o início e o fim da pausa ou deixe ambos vazios.'; end if;
        if nullif(w->>'lunchStart', '') is not null and ((w->>'lunchStart')::time >= (w->>'lunchEnd')::time or (w->>'lunchStart')::time < (w->>'open')::time or (w->>'lunchEnd')::time > (w->>'close')::time) then raise exception 'Pausa fora do expediente.'; end if;
      end if;
    end loop;
    if coalesce((payload->>'activate')::boolean, false) then
      if not kroner_private.shop_entitled(sid) then raise exception 'Ative sua assinatura antes de publicar a barbearia.'; end if;
      if not exists(select 1 from kroner_private.services where shop = sid and active) or not exists(select 1 from jsonb_array_elements(cfg->'week') a where coalesce((a->>'enabled')::boolean, false)) or coalesce(length(trim(cfg->>'city')), 0) < 2 or coalesce(length(trim(cfg->>'professional')), 0) < 2 then
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
    if coalesce(length(trim(payload->>'name')), 0) < 2 or coalesce(payload->>'phone', '') !~ '^\+55[1-9][0-9][0-9]{8,9}$' then raise exception 'Nome ou telefone inválido.'; end if;
    insert into kroner_private.clients(shop, name, phone) values(sid, left(trim(payload->>'name'), 100), payload->>'phone') returning id into cid;
    result := jsonb_build_object('id', cid);
  elsif action in ('book', 'manual_book', 'move') then
    if action = 'book' then
      if coalesce(length(trim(payload->>'name')), 0) < 2 or coalesce(payload->>'phone', '') !~ '^\+55[1-9][0-9][0-9]{8,9}$' then raise exception 'Nome e telefone com DDD são obrigatórios.'; end if;
      -- Always scope strictly to the caller's own (shop, user_id) client row to prevent phone-based account takeover
      insert into kroner_private.clients(shop, user_id, name, phone)
      values(sid, uid, left(trim(payload->>'name'), 100), payload->>'phone')
      on conflict(shop, user_id) do update
        set name = excluded.name,
            phone = excluded.phone
      returning id into cid;
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

    if action = 'book' then
      perform pg_advisory_xact_lock(hashtextextended('kroner:book:' || uid::text, 0));
      select count(*) into upcoming_count
      from kroner_private.appointments
      where shop = sid and client = cid and status = 'booked' and starts > now() and membership is null;
      if upcoming_count >= 3 then
        raise exception 'Você já atingiu o limite de 3 agendamentos futuros ativos nesta barbearia.';
      end if;

      select count(*) into recent_books
      from kroner_private.audit au
      where au.actor = uid and au.action = 'book' and au.created_at > now() - interval '24 hours';
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

    -- Employee: manual_book is locked to own chair; move (already validated apt.professional = actor_seat.id) CAN transfer to another active barber!
    if action = 'manual_book' and actor_seat.id is not null and actor_seat.role = 'employee' then
      chair := actor_seat.id;
      slots := kroner_private.chair_slots(sid, chair, sv, day, period, true);
    elsif payload ? 'professional' and coalesce(nullif(payload->>'professional', ''), 'auto') <> 'auto' then
      select id into chair from kroner_private.professionals where id = (payload->>'professional')::uuid and shop = sid and status = 'active';
      if chair is null then raise exception 'Profissional indisponível.'; end if;
      slots := kroner_private.chair_slots(sid, chair, sv, day, period, action <> 'book');
    else
      chair := null;
      slots := kroner_private.available(sid, sv, day, period, action <> 'book');
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
    insert into kroner_private.blocks(shop, starts, ends, reason) values(sid, (payload->>'start')::timestamptz, (payload->>'end')::timestamptz, coalesce(nullif(left(trim(payload->>'reason'), 200), ''), 'Bloqueio'));
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
    if nullif(payload->>'client', '') is null or not exists(select 1 from kroner_private.clients where shop = sid and id = (payload->>'client')::uuid) or coalesce(cardinality(sv), 0) = 0 or (select count(*) from kroner_private.services where shop = sid and id = any(sv) and active) <> coalesce(cardinality(sv), 0) then
      raise exception 'Cliente ou serviços inválidos.';
    end if;
    if actor_seat.id is not null and actor_seat.role = 'employee' then
      chair := actor_seat.id;
    else
      select id into chair from kroner_private.professionals where shop = sid and status = 'active' and id = coalesce(nullif(payload->>'professional', '')::uuid, actor_seat.id);
    end if;
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

-- 5. Fix public.kroner_client_profile() typed variables (no unassigned record crash)
create or replace function public.kroner_client_profile(p_slug text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := kroner_private.current_user_id();
  v_name text;
  v_phone text;
begin
  if uid is null then
    return jsonb_build_object('found', false, 'name', null, 'phone', null);
  end if;

  if nullif(trim(coalesce(p_slug, '')), '') is not null then
    select c.name, c.phone
      into v_name, v_phone
      from kroner_private.clients c
      join kroner_private.shops s on s.id = c.shop
     where c.user_id = uid
       and s.slug = trim(p_slug)
     limit 1;
  end if;

  if v_name is null then
    select c.name, c.phone
      into v_name, v_phone
      from kroner_private.clients c
     where c.user_id = uid
     order by c.created_at desc
     limit 1;
  end if;

  if v_name is null then
    return jsonb_build_object('found', false, 'name', null, 'phone', null);
  end if;

  return jsonb_build_object('found', true, 'name', v_name, 'phone', v_phone);
end;
$$;
revoke all on function public.kroner_client_profile(text) from public, anon;
grant execute on function public.kroner_client_profile(text) to authenticated;

-- 6. Harden public.kroner_management(): partner self-escalation guard, null-safe casts & local tz
create or replace function public.kroner_management(action text, payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := kroner_private.current_user_id();
  me kroner_private.professionals;
  target kroner_private.professionals;
  sh kroner_private.shops;
  shop_tz text;
  p kroner_private.products;
  delta int;
  op uuid := nullif(payload->>'request_id', '')::uuid;
  filter_prof uuid := nullif(payload->>'professional', '')::uuid;
  d_from date := nullif(payload->>'from', '')::date;
  d_to date := nullif(payload->>'to', '')::date;
  pay_amount int;
  payout_id uuid;
  existing_res jsonb;
  v_rate int;
  v_svc uuid;
begin
  select * into me from kroner_private.professionals where user_id = uid and status = 'active';
  if me.id is null then raise exception 'Sem vínculo ativo.'; end if;
  select * into sh from kroner_private.shops where id = me.shop;
  shop_tz := coalesce(nullif(sh.cfg->>'timezone', ''), 'America/Sao_Paulo');

  if action = 'earnings' then
    if me.role = 'employee' then
      if not coalesce(me.commission_enabled, false) then
        raise exception 'Comissão não habilitada para este perfil.';
      end if;
      filter_prof := me.id;
    end if;
    return jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', x.appointment,
            'professional', x.professional,
            'name', pr.name,
            'appointment', x.appointment,
            'starts', a.starts,
            'basis', x.basis,
            'commission', x.amount,
            'day', x.created_at,
            'rules', x.rules,
            'paid', coalesce((
              select sum(pay.amount)
              from kroner_private.charges chg
              join kroner_private.payments pay on pay.charge = chg.id
              where chg.appointment = x.appointment and chg.shop = me.shop
            ), 0)
          ) order by coalesce(a.starts, x.created_at) desc
        )
        from kroner_private.service_earnings x
        join kroner_private.professionals pr on pr.id = x.professional and pr.shop = x.shop
        left join kroner_private.appointments a on a.id = x.appointment and a.shop = x.shop
        where x.shop = me.shop
          and (filter_prof is null or x.professional = filter_prof)
          and (d_from is null or (coalesce(a.starts, x.created_at) at time zone shop_tz)::date >= d_from)
          and (d_to is null or (coalesce(a.starts, x.created_at) at time zone shop_tz)::date <= d_to)
      ), '[]'::jsonb),
      'payouts', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', cp.id,
            'professional', cp.professional,
            'name', pr.name,
            'amount', cp.amount,
            'paid_on', cp.paid_on,
            'note', cp.note,
            'created_at', cp.created_at
          ) order by cp.paid_on desc, cp.created_at desc
        )
        from kroner_private.commission_payouts cp
        join kroner_private.professionals pr on pr.id = cp.professional and pr.shop = cp.shop
        where cp.shop = me.shop
          and (filter_prof is null or cp.professional = filter_prof)
          and (d_from is null or cp.paid_on >= d_from)
          and (d_to is null or cp.paid_on <= d_to)
      ), '[]'::jsonb)
    );
  end if;

  if me.role not in ('owner', 'partner') then raise exception 'Operação exclusiva da gestão.'; end if;
  if not kroner_private.shop_entitled(me.shop) then raise exception 'Assinatura inativa. Regularize para continuar.'; end if;

  if action = 'commission_payout' then
    perform 1 from kroner_private.shops where id = me.shop for update;
    if op is null then raise exception 'Identificador obrigatório.'; end if;
    select r.result into existing_res
    from kroner_private.requests r
    where r.id = op and r.actor = uid and r.action = 'commission_payout';
    if existing_res is not null then return existing_res; end if;

    pay_amount := nullif(payload->>'amount', '')::int;
    if filter_prof is null or pay_amount is null or pay_amount <= 0 then
      raise exception 'Informe o profissional e um valor positivo.';
    end if;
    select * into target from kroner_private.professionals where id = filter_prof and shop = me.shop;
    if target.id is null then raise exception 'Profissional inválido.'; end if;
    if me.role = 'partner' and (target.id = me.id or target.role in ('owner', 'partner')) then
      raise exception 'Somente o proprietário registra repasses para sócios ou para si mesmo.';
    end if;

    insert into kroner_private.commission_payouts(shop, professional, amount, paid_on, note, actor)
      values(me.shop, filter_prof, pay_amount, coalesce(nullif(payload->>'paid_on', '')::date, (now() at time zone shop_tz)::date), left(coalesce(trim(payload->>'note'), ''), 200), uid)
      returning id into payout_id;
    insert into kroner_private.requests values(op, uid, 'commission_payout', jsonb_build_object('ok', true, 'id', payout_id), now());
    insert into kroner_private.audit(shop, actor, action, record_id) values(me.shop, uid, 'commission_payout', payout_id);
    return jsonb_build_object('ok', true, 'id', payout_id);
  end if;

  if action = 'service_rate' then
    v_rate := nullif(payload->>'rate', '')::int;
    v_svc := nullif(payload->>'service', '')::uuid;
    if v_rate is null or v_rate not between 0 and 10000 or v_svc is null or filter_prof is null then
      raise exception 'Percentual, profissional ou serviço inválido.';
    end if;
    select * into target from kroner_private.professionals where id = filter_prof and shop = me.shop;
    if target.id is null or not exists(select 1 from kroner_private.services where shop = me.shop and id = v_svc) then
      raise exception 'Percentual, profissional ou serviço inválido.';
    end if;
    if me.role = 'partner' and (target.id = me.id or target.role in ('owner', 'partner')) then
      raise exception 'Somente o proprietário altera comissões de sócios.';
    end if;
    update kroner_private.professionals
    set service_rates = service_rates || jsonb_build_object(v_svc::text, v_rate)
    where shop = me.shop and id = filter_prof;
    return '{"ok":true}';
  end if;

  if action = 'inventory' then
    perform 1 from kroner_private.shops where id = me.shop for update;
    if op is null then raise exception 'Identificador obrigatório.'; end if;
    if exists(select 1 from kroner_private.requests r where r.id = op and r.actor = uid and r.action = 'inventory') then return '{"ok":true}'; end if;
    insert into kroner_private.requests values(op, uid, 'inventory', '{"ok":true}', now());
    if nullif(payload->>'id', '') is null then raise exception 'Produto inválido.'; end if;
    select * into p from kroner_private.products where id = (payload->>'id')::uuid and shop = me.shop for update;
    if p.id is null or coalesce(length(trim(payload->>'reason')), 0) < 3 or coalesce(nullif(payload->>'count', '')::int, -1) < 0 or coalesce(length(trim(payload->>'unit')), 0) not between 1 and 30 then
      raise exception 'Revise a contagem, a unidade e o motivo.';
    end if;
    delta := (payload->>'count')::int - p.quantity;
    update kroner_private.products
    set quantity = quantity + delta,
        unit = trim(payload->>'unit'),
        active = coalesce((payload->>'active')::boolean, active),
        updated_at = now()
    where id = p.id;
    insert into kroner_private.movements(shop, product, quantity, kind, unit_cost, note) values(me.shop, p.id, delta, 'adjustment', p.cost, payload->>'reason');
    insert into kroner_private.audit(shop, actor, action, record_id) values(me.shop, uid, 'inventory', p.id);
    return '{"ok":true}';
  end if;

  raise exception 'Operação inválida.';
end;
$$;
revoke all on function public.kroner_management(text, jsonb) from public, anon;
grant execute on function public.kroner_management(text, jsonb) to authenticated;

-- 7. Harden public.kroner_pos(): null-safe casts & array guards
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
  op uuid := nullif(payload->>'request_id', '')::uuid;
  ch uuid; goods int := 0; svc int := 0;
  discount int := coalesce(nullif(payload->>'discount', '')::int, 0);
  qty int; amount int; refundable int; expected int; received int := 0;
  day date; counted int; opening int; new_rate int;
  net_total int; remaining_after int;
begin
  select * into me from kroner_private.professionals where user_id = uid and status = 'active';
  if me.role is null or me.role not in ('owner', 'partner') then raise exception 'Acesso restrito à gestão.'; end if;
  select * into s from kroner_private.shops where id = me.shop for update;
  day := (now() at time zone coalesce(nullif(s.cfg->>'timezone', ''), 'America/Sao_Paulo'))::date;

  if action = 'list' then
    return jsonb_build_object(
      'sales', coalesce((select jsonb_agg(to_jsonb(sa) order by sa.created_at desc) from kroner_private.sales sa where sa.shop = s.id), '[]'),
      'rates', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'rate', p.commission_bps)) from kroner_private.professionals p where p.shop = s.id and p.status = 'active'), '[]'),
      'closings', coalesce((select jsonb_agg(to_jsonb(rc) order by rc.day desc) from kroner_private.register_closings rc where rc.shop = s.id), '[]')
    );
  end if;

  if not kroner_private.shop_entitled(s.id) then raise exception 'Assinatura inativa. Regularize para operar o PDV.'; end if;

  if action = 'rate' then
    if me.role <> 'owner' then raise exception 'Somente o titular altera comissões.'; end if;
    new_rate := nullif(payload->>'rate', '')::int;
    if new_rate is null or new_rate not between 0 and 10000 or nullif(payload->>'id', '') is null then
      raise exception 'Percentual de comissão inválido (0%% a 100%%).';
    end if;
    update kroner_private.professionals set commission_bps = new_rate where id = (payload->>'id')::uuid and shop = s.id;
    return '{"ok":true}';
  end if;

  if op is null then raise exception 'Identificador obrigatório.'; end if;
  if exists(select 1 from kroner_private.requests r where r.id = op and r.actor = uid and r.action = 'pos_' || kroner_pos.action) then return '{"ok":true}'; end if;
  insert into kroner_private.requests values(op, uid, 'pos_' || kroner_pos.action, '{"ok":true}', now());

  if action = 'close' then
    day := nullif(payload->>'day', '')::date;
    opening := nullif(payload->>'opening', '')::int;
    counted := nullif(payload->>'counted', '')::int;
    if day is null or opening is null or counted is null or day > (now() at time zone coalesce(nullif(s.cfg->>'timezone', ''), 'America/Sao_Paulo'))::date or least(opening, counted) < 0 then
      raise exception 'Conferência inválida.';
    end if;
    select coalesce(jsonb_object_agg(method, net), '{}') into totals
    from (select p.method, sum(case when c.direction = 'in' then p.amount else -p.amount end) net from kroner_private.payments p join kroner_private.charges c on p.charge = c.id where p.shop = s.id and p.paid_on = day group by p.method) x;
    expected := opening + coalesce((totals->>'cash')::int, 0);
    insert into kroner_private.register_closings values(s.id, day, uid, opening, counted, expected, totals, now());
    return '{"ok":true}';
  end if;

  if action = 'sale' then
    select * into person from kroner_private.professionals where shop = s.id and id = coalesce(nullif(payload->>'professional', '')::uuid, me.id) and status = 'active';
    if person.id is null then raise exception 'Profissional inválido.'; end if;
    if nullif(payload->>'appointment', '') is not null then
      select * into apt from kroner_private.appointments where shop = s.id and id = (payload->>'appointment')::uuid and status = 'booked' and membership is null for update;
      if apt.id is null then raise exception 'Atendimento indisponível.'; end if;
      select * into person from kroner_private.professionals where id = apt.professional and shop = s.id;
      svc := apt.price;
    end if;
    for line in
      select value from jsonb_array_elements(case when jsonb_typeof(payload->'items') = 'array' then payload->'items' else '[]'::jsonb end)
    loop
      qty := nullif(line->>'quantity', '')::int;
      if nullif(line->>'id', '') is null then raise exception 'Produto inválido.'; end if;
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
    for line in
      select value from jsonb_array_elements(case when jsonb_typeof(payload->'payments') = 'array' then payload->'payments' else '[]'::jsonb end)
    loop
      amount := nullif(line->>'amount', '')::int;
      if amount is null or amount <= 0 then raise exception 'Pagamento inválido.'; end if;
      perform kroner_private.api('pay', jsonb_build_object('charge', ch, 'amount', amount, 'method', line->>'method', 'paid_on', day, 'settles_on', day, 'request_id', gen_random_uuid()));
    end loop;
    if apt.id is not null then update kroner_private.appointments set status = 'done' where id = apt.id; end if;
    insert into kroner_private.sales(id, shop, actor, professional, appointment, charge, items, service_total, product_total, discount, commission, rate)
      values(op, s.id, uid, person.id, apt.id, ch, lines, svc, goods, discount, round(svc::numeric * (svc + goods - discount) / (svc + goods) * person.commission_bps / 10000), person.commission_bps);
  elsif action = 'refund' then
    if nullif(payload->>'sale', '') is null then raise exception 'Venda inválida.'; end if;
    select * into sale from kroner_private.sales where shop = s.id and id = (payload->>'sale')::uuid for update;
    select coalesce(sum(p.amount), 0) into received from kroner_private.payments p where p.charge = sale.charge;
    amount := nullif(payload->>'amount', '')::int;
    refundable := received - sale.refunded;
    if sale.id is null or amount is null or amount <= 0 or amount > refundable or coalesce(length(trim(payload->>'reason')), 0) < 3 then
      raise exception 'Revise o motivo e o saldo disponível para estorno.';
    end if;
    insert into kroner_private.charges(shop, description, direction, amount, due, category)
      values(s.id, 'Estorno PDV ' || sale.id || ' · ' || left(payload->>'reason', 150), 'out', amount, day, 'refund') returning id into ch;
    perform kroner_private.api('pay', jsonb_build_object('charge', ch, 'amount', amount, 'method', payload->>'method', 'paid_on', day, 'settles_on', day, 'request_id', gen_random_uuid()));
    update kroner_private.sales set refunded = refunded + amount where id = sale.id;

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
          values(s.id, (line->>'id')::uuid, (line->>'quantity')::int, 'adjustment', (line->>'unit_cost')::int, ch, 'Devolução PDV ' || sale.id);
      end loop;
    end if;
  else
    raise exception 'Operação inválida.';
  end if;

  insert into kroner_private.audit(shop, actor, action, record_id) values(s.id, uid, 'pos_' || kroner_pos.action, coalesce(ch, op));
  return '{"ok":true}';
end;
$$;
revoke all on function public.kroner_pos(text, jsonb) from public, anon;
grant execute on function public.kroner_pos(text, jsonb) to authenticated;

-- 8. Harden notifications, push anti-SSRF, reschedule lock order/rate-limit & cancel trigger guard
do $$
begin
  if to_regclass('kroner_private.notifications') is not null then
    execute $q$
      create or replace function kroner_private.trg_notify_client_cancel()
      returns trigger
      language plpgsql
      security definer
      set search_path = ''
      as $b$
      begin
        if new.action = 'cancel_own' and new.record_id is not null then
          begin
            perform kroner_private.enqueue_appointment_notice(
              new.record_id,
              'booking_cancelled',
              'booking_cancelled:' || new.record_id::text,
              null
            );
          exception when others then
            null;
          end;
        end if;
        return new;
      end;
      $b$;
    $q$;

    execute $q$
      create or replace function public.kroner_client_reschedule(
        p_appointment uuid,
        p_day date,
        p_period text,
        p_start timestamptz,
        p_professional text default 'auto'
      )
      returns jsonb
      language plpgsql
      security definer
      set search_path = ''
      as $b$
      declare
        uid uuid := kroner_private.current_user_id();
        v_shop uuid;
        apt kroner_private.appointments;
        s kroner_private.shops;
        old_starts timestamptz;
        sv uuid[];
        chair uuid;
        slots jsonb;
        slot jsonb;
        new_start timestamptz;
        new_end timestamptz;
        active_profs int;
        recent_reschedules int;
        clean_prof text := coalesce(nullif(trim(coalesce(p_professional, '')), ''), 'auto');
      begin
        if uid is null then raise exception 'Entre na sua conta para remarcar.'; end if;
        if p_appointment is null or p_day is null or p_start is null or p_period not in ('morning', 'afternoon', 'night') then
          raise exception 'Dados de remarcação inválidos.';
        end if;

        -- Rate-limit reschedules per user to prevent push/bell spam
        perform pg_advisory_xact_lock(hashtextextended('kroner:reschedule:' || uid::text, 0));
        select count(*) into recent_reschedules
        from kroner_private.audit au
        where au.actor = uid and au.action = 'reschedule_own' and au.created_at > now() - interval '24 hours';
        if recent_reschedules >= 10 then
          raise exception 'Limite diário de remarcações atingido. Fale com a barbearia.';
        end if;

        -- Lock shops BEFORE appointments (matches kroner_private.api lock order to prevent AB-BA deadlocks)
        select a.shop into v_shop
        from kroner_private.appointments a
        join kroner_private.clients cl on cl.id = a.client
        where a.id = p_appointment and cl.user_id = uid;
        if v_shop is null then raise exception 'Reserva não encontrada.'; end if;

        select * into s from kroner_private.shops where id = v_shop for update;
        if s.id is null or not s.active then raise exception 'Barbearia indisponível.'; end if;
        if not kroner_private.shop_entitled(s.id) then raise exception 'Agendamento indisponível nesta barbearia.'; end if;

        select a.* into apt
        from kroner_private.appointments a
        join kroner_private.clients cl on cl.id = a.client
        where a.id = p_appointment and a.shop = s.id and cl.user_id = uid
        for update of a;
        if apt.id is null then raise exception 'Reserva não encontrada.'; end if;

        if apt.status <> 'booked' or apt.starts < now() + make_interval(mins => coalesce(nullif(s.cfg->>'cancelMinutes', '')::int, 120)) then
          raise exception 'Prazo de remarcação encerrado. Fale com a barbearia.';
        end if;

        old_starts := apt.starts;
        select array_agg((value->>'id')::uuid) into sv
        from jsonb_array_elements(coalesce(apt.services, '[]'::jsonb));
        if sv is null or coalesce(cardinality(sv), 0) = 0 then
          raise exception 'Serviços do agendamento inválidos.';
        end if;

        update kroner_private.appointments set status = 'cancelled' where id = apt.id;

        select count(*) into active_profs from kroner_private.professionals where shop = s.id and status = 'active';
        if clean_prof <> 'auto' and active_profs > 1 then
          select id into chair from kroner_private.professionals where id = clean_prof::uuid and shop = s.id and status = 'active';
          if chair is null then raise exception 'Profissional indisponível.'; end if;
          slots := kroner_private.chair_slots(s.id, chair, sv, p_day, p_period, false);
        elsif active_profs > 1 then
          select coalesce(jsonb_agg(item order by item->>'start'), '[]'::jsonb) into slots
          from (
            select distinct on (v->>'start')
              v || jsonb_build_object('professional', p.id) as item
            from kroner_private.professionals p
            cross join lateral jsonb_array_elements(kroner_private.chair_slots(s.id, p.id, sv, p_day, p_period, false)) v
            where p.shop = s.id and p.status = 'active'
            order by v->>'start', (p.id = apt.professional) desc, (p.role = 'owner') desc, p.id
          ) options;
        else
          select id into chair from kroner_private.professionals where shop = s.id and status = 'active' order by (role = 'owner') desc limit 1;
          slots := kroner_private.chair_slots(s.id, chair, sv, p_day, p_period, false);
        end if;

        select value into slot
        from jsonb_array_elements(coalesce(slots, '[]'::jsonb))
        where (value->>'start')::timestamptz = p_start
        limit 1;
        if slot is null then
          raise exception 'Horário indisponível. Atualize e escolha outro horário.';
        end if;

        chair := coalesce(chair, nullif(slot->>'professional', '')::uuid, apt.professional);
        new_start := (slot->>'start')::timestamptz;
        new_end := (slot->>'end')::timestamptz;

        if new_start = old_starts and chair = apt.professional then
          raise exception 'Escolha um horário diferente do atual.';
        end if;

        update kroner_private.appointments
        set professional = chair, starts = new_start, ends = new_end, status = 'booked'
        where id = apt.id;

        insert into kroner_private.audit(shop, actor, action, record_id)
        values (s.id, uid, 'reschedule_own', apt.id);

        begin
          perform kroner_private.enqueue_appointment_notice(
            apt.id,
            'booking_rescheduled',
            'booking_rescheduled:' || apt.id::text || ':' || extract(epoch from new_start)::bigint::text,
            old_starts
          );
        exception when others then
          null;
        end;

        return jsonb_build_object('ok', true, 'id', apt.id, 'starts', new_start, 'ends', new_end);
      exception when exclusion_violation then
        raise exception 'Já existe um atendimento nesse horário. Escolha outro.';
      end;
      $b$;
    $q$;

    execute $q$
      create or replace function public.kroner_notifications(action text, payload jsonb default '{}')
      returns jsonb
      language plpgsql
      security definer
      set search_path = ''
      as $b$
      declare
        uid uuid := kroner_private.current_user_id();
        me kroner_private.professionals;
        sub_row kroner_private.push_subscriptions;
        v_endpoint text;
        v_p256dh text;
        v_auth text;
        v_platform text;
        v_standalone boolean;
        v_ua text;
        v_count int;
      begin
        if uid is null then raise exception 'Entre na sua conta.'; end if;
        if octet_length(payload::text) > 16384 then raise exception 'Solicitação muito grande.'; end if;

        select * into me from kroner_private.professionals where user_id = uid and status = 'active' limit 1;
        if me.id is null then raise exception 'Sem vínculo ativo com barbearia.'; end if;

        if action = 'list' then
          return jsonb_build_object(
            'items', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body,
                  'tab', n.tab, 'appointmentId', n.appointment_id, 'meta', n.meta,
                  'readAt', n.read_at, 'createdAt', n.created_at
                ) order by n.created_at desc
              )
              from (
                select * from kroner_private.notifications
                where shop = me.shop and recipient_user_id = uid
                order by created_at desc limit 40
              ) n
            ), '[]'::jsonb),
            'deviceCount', (
              select count(*)::int from kroner_private.push_subscriptions
              where shop = me.shop and user_id = uid
            )
          );
        end if;

        if action = 'mark_read' then
          if nullif(payload->>'id', '') is null then raise exception 'Identificador obrigatório.'; end if;
          update kroner_private.notifications
          set read_at = coalesce(read_at, now())
          where id = (payload->>'id')::uuid and shop = me.shop and recipient_user_id = uid;
          return '{"ok":true}'::jsonb;
        end if;

        if action = 'mark_all_read' then
          update kroner_private.notifications
          set read_at = now()
          where shop = me.shop and recipient_user_id = uid and read_at is null;
          return '{"ok":true}'::jsonb;
        end if;

        if action = 'save_subscription' then
          v_endpoint := trim(coalesce(payload->>'endpoint', ''));
          v_p256dh := trim(coalesce(payload->>'p256dh', ''));
          v_auth := trim(coalesce(payload->>'auth', ''));
          v_platform := lower(trim(coalesce(payload->>'platform', 'web')));
          v_standalone := coalesce((payload->>'standalone')::boolean, false);
          v_ua := left(trim(coalesce(payload->>'userAgent', '')), 260);

          if length(v_endpoint) > 2048
             or v_endpoint !~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)?push\.apple\.com|([a-z0-9-]+\.)?notify\.windows\.com|([a-z0-9-]+\.)?push\.samsungosp\.com)/' then
            raise exception 'Servidor de notificação push não autorizado.';
          end if;
          if length(v_p256dh) < 16 or length(v_p256dh) > 512 or length(v_auth) < 8 or length(v_auth) > 256 then
            raise exception 'Chaves de criptografia push inválidas.';
          end if;
          if v_platform not in ('ios', 'android', 'desktop', 'web') then
            v_platform := 'web';
          end if;

          select count(*) into v_count from kroner_private.push_subscriptions where user_id = uid;
          if v_count >= 15 then
            delete from kroner_private.push_subscriptions
            where id in (
              select id from kroner_private.push_subscriptions
              where user_id = uid and endpoint <> v_endpoint
              order by updated_at asc
              limit (v_count - 14)
            );
          end if;

          insert into kroner_private.push_subscriptions (
            shop, user_id, professional_id, endpoint, p256dh, auth, platform, standalone, user_agent, updated_at
          ) values (
            me.shop, uid, me.id, v_endpoint, v_p256dh, v_auth, v_platform, v_standalone, v_ua, now()
          )
          on conflict (user_id, endpoint) do update set
            shop = excluded.shop,
            professional_id = excluded.professional_id,
            p256dh = excluded.p256dh,
            auth = excluded.auth,
            platform = excluded.platform,
            standalone = excluded.standalone,
            user_agent = excluded.user_agent,
            updated_at = now();

          return '{"ok":true}'::jsonb;
        end if;

        if action = 'remove_subscription' then
          v_endpoint := trim(coalesce(payload->>'endpoint', ''));
          if v_endpoint <> '' then
            delete from kroner_private.push_subscriptions where user_id = uid and endpoint = v_endpoint;
          end if;
          return '{"ok":true}'::jsonb;
        end if;

        if action = 'has_subscription' then
          v_endpoint := trim(coalesce(payload->>'endpoint', ''));
          select * into sub_row
          from kroner_private.push_subscriptions
          where user_id = uid and shop = me.shop and endpoint = v_endpoint
          limit 1;
          if sub_row.id is null then
            return jsonb_build_object('registered', false);
          end if;
          return jsonb_build_object(
            'registered', true,
            'userId', uid,
            'shop', me.shop,
            'endpoint', sub_row.endpoint,
            'p256dh', sub_row.p256dh,
            'auth', sub_row.auth
          );
        end if;

        raise exception 'Operação inválida.';
      end;
      $b$;
    $q$;

    execute $q$
      create or replace function public.kroner_verify_client_appointment(p_appointment uuid, p_kind text)
      returns jsonb
      language plpgsql
      security definer
      set search_path = ''
      as $b$
      declare
        uid uuid := kroner_private.current_user_id();
        apt kroner_private.appointments;
      begin
        if uid is null then raise exception 'Entre na sua conta.'; end if;
        if p_appointment is null or p_kind not in ('booking_created', 'booking_cancelled', 'booking_rescheduled') then
          raise exception 'Evento inválido.';
        end if;

        select a.* into apt
        from kroner_private.appointments a
        join kroner_private.clients cl on cl.id = a.client
        where a.id = p_appointment and cl.user_id = uid;
        if apt.id is null then raise exception 'Reserva não encontrada.'; end if;

        if p_kind = 'booking_created'
           and apt.status = 'booked'
           and apt.created_at > now() - interval '15 minutes'
           and exists(
             select 1 from kroner_private.audit au
             where au.record_id = apt.id and au.actor = uid and au.action = 'book'
               and au.created_at > now() - interval '15 minutes'
           ) then
          perform kroner_private.enqueue_appointment_notice(
            apt.id, 'booking_created', 'booking_created:' || apt.id::text, null
          );
        elsif p_kind = 'booking_cancelled'
           and apt.status = 'cancelled'
           and exists(
             select 1 from kroner_private.audit au
             where au.record_id = apt.id and au.actor = uid and au.action = 'cancel_own'
               and au.created_at > now() - interval '15 minutes'
           ) then
          perform kroner_private.enqueue_appointment_notice(
            apt.id, 'booking_cancelled', 'booking_cancelled:' || apt.id::text, null
          );
        elsif p_kind = 'booking_rescheduled'
           and exists(
             select 1 from kroner_private.audit au
             where au.record_id = apt.id and au.actor = uid and au.action = 'reschedule_own'
               and au.created_at > now() - interval '15 minutes'
           ) then
          null;
        else
          raise exception 'Evento não autorizado ou expirado.';
        end if;

        return jsonb_build_object('ok', true, 'appointmentId', apt.id, 'actorUserId', uid);
      end;
      $b$;
    $q$;

    execute $q$
      create or replace function public.kroner_claim_appointment_pushes(p_appointment uuid)
      returns jsonb
      language plpgsql
      security definer
      set search_path = ''
      as $b$
      declare
        claimed jsonb;
      begin
        with locked as (
          select n.id
          from kroner_private.notifications n
          where n.appointment_id = p_appointment
            and n.push_sent_at is null
          for update skip locked
        ),
        updated as (
          update kroner_private.notifications n
          set push_sent_at = now()
          from locked
          where n.id = locked.id
          returning n.id, n.shop, n.recipient_user_id, n.kind, n.title, n.body, n.tab, n.appointment_id
        )
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'id', u.id, 'kind', u.kind, 'title', u.title, 'body', u.body,
            'tab', u.tab, 'appointmentId', u.appointment_id,
            'subscriptions', coalesce((
              select jsonb_agg(jsonb_build_object(
                'endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth
              ))
              from kroner_private.push_subscriptions ps
              where ps.user_id = u.recipient_user_id and ps.shop = u.shop
            ), '[]'::jsonb)
          )
        ), '[]'::jsonb)
        into claimed
        from updated u;
        return claimed;
      end;
      $b$;
    $q$;

    execute $q$
      create or replace function public.kroner_collect_morning_summary(p_execution_id text default null)
      returns jsonb
      language plpgsql
      security definer
      set search_path = ''
      as $b$
      declare
        sh record;
        tz text;
        local_day date;
        inserted_day date;
        out_items jsonb := '[]'::jsonb;
        shop_payload jsonb;
      begin
        for sh in
          select s.id, s.name, s.cfg
          from kroner_private.shops s
          where s.active
            and kroner_private.shop_entitled(s.id)
            and exists(
              select 1 from kroner_private.professionals p
              where p.shop = s.id and p.status = 'active' and p.user_id is not null
            )
        loop
          tz := coalesce(nullif(sh.cfg->>'timezone', ''), 'America/Sao_Paulo');
          local_day := (now() at time zone tz)::date;

          insert into kroner_private.morning_summary_runs (shop, run_day, execution_id)
          values (sh.id, local_day, left(coalesce(p_execution_id, ''), 120))
          on conflict (shop, run_day) do nothing
          returning run_day into inserted_day;

          if inserted_day is null then continue; end if;

          select jsonb_build_object(
            'shopId', sh.id,
            'shopName', sh.name,
            'day', local_day,
            'timezone', tz,
            'state', coalesce(sh.cfg->>'state', ''),
            'holidayDecisions', coalesce(sh.cfg->'holidayDecisions', '{}'::jsonb),
            'calendar', coalesce((
              select jsonb_agg(jsonb_build_object('date', ce.day, 'name', ce.name, 'scope', ce.scope))
              from kroner_private.calendar_events ce
              where ce.shop = sh.id and ce.day between local_day and local_day + 30
            ), '[]'::jsonb),
            'overdueCount', (
              select count(*)::int
              from kroner_private.charges chg
              where chg.shop = sh.id
                and chg.direction = 'in'
                and chg.due + make_interval(days => coalesce(nullif(sh.cfg->>'grace', '')::int, 5)) < local_day
                and chg.amount > coalesce((
                  select sum(pay.amount) from kroner_private.payments pay where pay.charge = chg.id
                ), 0)
            ),
            'variableDueToday', coalesce((
              select jsonb_agg(r.name)
              from kroner_private.recurring r
              where r.shop = sh.id and r.active and r.variable and r.day = extract(day from local_day)::int
            ), '[]'::jsonb),
            'professionals', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', p.id,
                'userId', p.user_id,
                'role', p.role,
                'name', case when p.role = 'owner' then coalesce(nullif(sh.cfg->>'professional', ''), p.name) else p.name end,
                'holidayDecisions', case
                  when p.role in ('owner', 'partner') then
                    coalesce(sh.cfg->'holidayDecisions', '{}'::jsonb) || coalesce(p.preferences->'holidayDecisions', '{}'::jsonb)
                  else
                    coalesce(p.preferences->'holidayDecisions', '{}'::jsonb)
                end,
                'todayCount', (
                  select count(*)::int
                  from kroner_private.appointments a
                  where a.shop = sh.id and a.status = 'booked'
                    and (a.starts at time zone tz)::date = local_day
                    and (p.role in ('owner', 'partner') or a.professional = p.id)
                ),
                'firstTime', (
                  select to_char(min(a.starts at time zone tz), 'HH24:MI')
                  from kroner_private.appointments a
                  where a.shop = sh.id and a.status = 'booked'
                    and (a.starts at time zone tz)::date = local_day
                    and (p.role in ('owner', 'partner') or a.professional = p.id)
                ),
                'subscriptions', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth
                  ))
                  from kroner_private.push_subscriptions ps
                  where ps.user_id = p.user_id and ps.shop = sh.id
                ), '[]'::jsonb)
              ))
              from kroner_private.professionals p
              where p.shop = sh.id and p.status = 'active' and p.user_id is not null
            ), '[]'::jsonb)
          ) into shop_payload;

          out_items := out_items || jsonb_build_array(shop_payload);
        end loop;
        return out_items;
      end;
      $b$;
    $q$;
  end if;
end $$;
