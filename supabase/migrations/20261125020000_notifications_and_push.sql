-- ============================================================================
-- Kronner Persistent Notifications, Client Reschedule & Web Push (2026-11-25)
-- Adds:
--   - kroner_private.push_subscriptions (per-device Web Push tokens)
--   - kroner_private.notifications (persisted bell + push notification center)
--   - kroner_private.morning_summary_runs (daily idempotency guard)
--   - Automatic triggers for public bookings & client cancellations
--   - public.kroner_client_reschedule (atomic client self-reschedule + notice)
--   - public.kroner_notifications (authenticated barber bell & push RPC)
--   - Service-role-only push delivery & morning summary RPCs
-- Idempotent: safe to run repeatedly.
-- ============================================================================

-- 1. Push subscriptions (per user + endpoint, isolated in kroner_private)
create table if not exists kroner_private.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  shop uuid not null references kroner_private.shops(id) on delete cascade,
  user_id uuid not null references kroner_private.app_users(id) on delete cascade,
  professional_id uuid references kroner_private.professionals(id) on delete set null,
  endpoint text not null check (endpoint ~ '^https://' and length(endpoint) <= 2048),
  p256dh text not null check (length(p256dh) between 16 and 512),
  auth text not null check (length(auth) between 8 and 256),
  platform text not null default 'web' check (platform in ('ios', 'android', 'desktop', 'web')),
  standalone boolean not null default false,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists idx_push_subscriptions_shop_user
  on kroner_private.push_subscriptions (shop, user_id);

create index if not exists idx_push_subscriptions_user
  on kroner_private.push_subscriptions (user_id);

-- 2. Persisted notifications (for both the in-app bell and Web Push delivery)
create table if not exists kroner_private.notifications (
  id uuid primary key default gen_random_uuid(),
  shop uuid not null references kroner_private.shops(id) on delete cascade,
  recipient_user_id uuid not null references kroner_private.app_users(id) on delete cascade,
  recipient_professional_id uuid references kroner_private.professionals(id) on delete set null,
  kind text not null check (kind in ('booking_created', 'booking_cancelled', 'booking_rescheduled', 'morning_summary')),
  title text not null check (length(title) between 1 and 180),
  body text not null check (length(body) between 1 and 500),
  tab text not null default 'agenda' check (tab in ('overview', 'agenda', 'clients', 'finance', 'notices', 'settings')),
  appointment_id uuid references kroner_private.appointments(id) on delete set null,
  dedupe_key text,
  meta jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  push_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_notifications_recipient_dedupe
  on kroner_private.notifications (recipient_user_id, dedupe_key)
  where dedupe_key is not null;

create index if not exists idx_notifications_recipient_created
  on kroner_private.notifications (shop, recipient_user_id, created_at desc);

create index if not exists idx_notifications_unread
  on kroner_private.notifications (recipient_user_id)
  where read_at is null;

create index if not exists idx_notifications_appointment_unsent
  on kroner_private.notifications (appointment_id)
  where push_sent_at is null;

-- 3. Daily morning summary idempotency ledger
create table if not exists kroner_private.morning_summary_runs (
  shop uuid not null references kroner_private.shops(id) on delete cascade,
  run_day date not null,
  execution_id text,
  created_at timestamptz not null default now(),
  primary key (shop, run_day)
);

-- Ensure direct access to private tables stays locked down (RLS + REVOKE)
alter table kroner_private.push_subscriptions enable row level security;
alter table kroner_private.notifications enable row level security;
alter table kroner_private.morning_summary_runs enable row level security;
revoke all on kroner_private.push_subscriptions from public, anon, authenticated;
revoke all on kroner_private.notifications from public, anon, authenticated;
revoke all on kroner_private.morning_summary_runs from public, anon, authenticated;

-- 4. Formatting & enqueue helper (internal only)
create or replace function kroner_private.format_apt_when(p_starts timestamptz, p_tz text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  tz text := coalesce(nullif(p_tz, ''), 'America/Sao_Paulo');
  local_ts timestamp := p_starts at time zone tz;
  today_d date := (now() at time zone tz)::date;
  apt_d date := local_ts::date;
  hm text := to_char(local_ts, 'HH24:MI');
begin
  if apt_d = today_d then
    return 'hoje às ' || hm;
  elsif apt_d = today_d + 1 then
    return 'amanhã às ' || hm;
  else
    return to_char(local_ts, 'DD/MM') || ' às ' || hm;
  end if;
end;
$$;
revoke all on function kroner_private.format_apt_when(timestamptz, text) from public, anon, authenticated;

create or replace function kroner_private.enqueue_appointment_notice(
  p_appointment_id uuid,
  p_kind text,
  p_dedupe_key text,
  p_old_starts timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  apt kroner_private.appointments;
  sh kroner_private.shops;
  cl kroner_private.clients;
  pr kroner_private.professionals;
  tz text;
  svc_names text;
  when_txt text;
  old_when_txt text;
  prof_label text;
  v_title text;
  v_body text;
  rec record;
begin
  select * into apt from kroner_private.appointments where id = p_appointment_id;
  if apt.id is null then return; end if;

  select * into sh from kroner_private.shops where id = apt.shop;
  if sh.id is null then return; end if;

  select * into cl from kroner_private.clients where id = apt.client;
  select * into pr from kroner_private.professionals where id = apt.professional;

  tz := coalesce(nullif(sh.cfg->>'timezone', ''), 'America/Sao_Paulo');
  when_txt := kroner_private.format_apt_when(apt.starts, tz);
  select string_agg(elem->>'name', ' + ')
    into svc_names
    from jsonb_array_elements(coalesce(apt.services, '[]'::jsonb)) as elem;
  svc_names := coalesce(nullif(svc_names, ''), 'Atendimento');

  prof_label := case
    when pr.role = 'owner' then coalesce(nullif(sh.cfg->>'professional', ''), pr.name, sh.name)
    else coalesce(pr.name, sh.name)
  end;

  if p_kind = 'booking_created' then
    v_title := 'Novo agendamento pelo link';
    v_body := left(coalesce(cl.name, 'Cliente') || ' · ' || svc_names || ' · ' || when_txt, 480);
  elsif p_kind = 'booking_cancelled' then
    v_title := 'Agendamento cancelado pelo cliente';
    v_body := left(coalesce(cl.name, 'Cliente') || ' cancelou ' || svc_names || ' (' || when_txt || ')', 480);
  elsif p_kind = 'booking_rescheduled' then
    v_title := 'Horário remarcado pelo cliente';
    if p_old_starts is not null then
      old_when_txt := kroner_private.format_apt_when(p_old_starts, tz);
      v_body := left(coalesce(cl.name, 'Cliente') || ' remarcou ' || svc_names || ' de ' || old_when_txt || ' para ' || when_txt, 480);
    else
      v_body := left(coalesce(cl.name, 'Cliente') || ' remarcou ' || svc_names || ' para ' || when_txt, 480);
    end if;
  else
    return;
  end if;

  -- Notify the assigned barber AND the shop owner (deduplicated per recipient_user_id)
  for rec in
    select distinct user_id, prof_id, is_assigned
    from (
      select pr.user_id as user_id, pr.id as prof_id, true as is_assigned
      where pr.id is not null and pr.user_id is not null and pr.status = 'active'
      union all
      select p_own.user_id as user_id, p_own.id as prof_id, (p_own.id = pr.id) as is_assigned
      from kroner_private.professionals p_own
      where p_own.shop = sh.id and p_own.role = 'owner' and p_own.status = 'active' and p_own.user_id is not null
    ) targets
    where user_id is not null
  loop
    insert into kroner_private.notifications (
      shop,
      recipient_user_id,
      recipient_professional_id,
      kind,
      title,
      body,
      tab,
      appointment_id,
      dedupe_key,
      meta
    ) values (
      sh.id,
      rec.user_id,
      rec.prof_id,
      p_kind,
      v_title,
      case
        when not rec.is_assigned and prof_label <> '' then left(v_body || ' · Cadeira: ' || prof_label, 480)
        else v_body
      end,
      'agenda',
      apt.id,
      p_dedupe_key,
      jsonb_build_object(
        'clientName', coalesce(cl.name, 'Cliente'),
        'services', svc_names,
        'starts', apt.starts,
        'professional', prof_label
      )
    )
    on conflict (recipient_user_id, dedupe_key) where dedupe_key is not null do nothing;
  end loop;
end;
$$;
revoke all on function kroner_private.enqueue_appointment_notice(uuid, text, text, timestamptz) from public, anon, authenticated;

-- 5. Triggers for automatic bell notification persistence on public booking & client cancel
create or replace function kroner_private.trg_notify_public_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_uid uuid;
  is_client_booking boolean := false;
begin
  if new.status <> 'booked' then return new; end if;
  begin
    actor_uid := kroner_private.current_user_id();
  exception when others then
    return new;
  end;
  if actor_uid is null then return new; end if;

  -- Fire automatically when the booking actor is the client themselves (not an active shop barber doing manual_book)
  select exists(
    select 1
    from kroner_private.clients cl
    where cl.id = new.client
      and cl.user_id = actor_uid
  ) and not exists(
    select 1
    from kroner_private.professionals p
    where p.shop = new.shop
      and p.user_id = actor_uid
      and p.status = 'active'
  ) into is_client_booking;

  if is_client_booking then
    perform kroner_private.enqueue_appointment_notice(
      new.id,
      'booking_created',
      'booking_created:' || new.id::text,
      null
    );
  end if;
  return new;
end;
$$;
revoke all on function kroner_private.trg_notify_public_booking() from public, anon, authenticated;

drop trigger if exists trg_appointments_notify_public_booking on kroner_private.appointments;
create trigger trg_appointments_notify_public_booking
  after insert on kroner_private.appointments
  for each row execute function kroner_private.trg_notify_public_booking();

create or replace function kroner_private.trg_notify_client_cancel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.action = 'cancel_own' and new.record_id is not null then
    perform kroner_private.enqueue_appointment_notice(
      new.record_id,
      'booking_cancelled',
      'booking_cancelled:' || new.record_id::text,
      null
    );
  end if;
  return new;
end;
$$;
revoke all on function kroner_private.trg_notify_client_cancel() from public, anon, authenticated;

drop trigger if exists trg_audit_notify_client_cancel on kroner_private.audit;
create trigger trg_audit_notify_client_cancel
  after insert on kroner_private.audit
  for each row execute function kroner_private.trg_notify_client_cancel();

-- 6. Client self-reschedule RPC (atomic + notifies assigned barber & owner)
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
as $$
declare
  uid uuid := kroner_private.current_user_id();
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
begin
  if uid is null then raise exception 'Entre na sua conta para remarcar.'; end if;
  if p_appointment is null or p_day is null or p_start is null or p_period not in ('morning', 'afternoon', 'night') then
    raise exception 'Dados de remarcação inválidos.';
  end if;

  select a.* into apt
  from kroner_private.appointments a
  join kroner_private.clients cl on cl.id = a.client
  where a.id = p_appointment and cl.user_id = uid
  for update of a;

  if apt.id is null then raise exception 'Reserva não encontrada.'; end if;

  select * into s from kroner_private.shops where id = apt.shop for update;
  if s.id is null or not s.active then raise exception 'Barbearia indisponível.'; end if;
  if not kroner_private.shop_entitled(s.id) then raise exception 'Agendamento indisponível nesta barbearia.'; end if;

  if apt.status <> 'booked' or apt.starts < now() + make_interval(mins => coalesce((s.cfg->>'cancelMinutes')::int, 120)) then
    raise exception 'Prazo de remarcação encerrado. Fale com a barbearia.';
  end if;

  old_starts := apt.starts;
  select array_agg((value->>'id')::uuid)
    into sv
    from jsonb_array_elements(coalesce(apt.services, '[]'::jsonb));

  if sv is null or array_length(sv, 1) is null then
    raise exception 'Serviços do agendamento inválidos.';
  end if;

  -- Temporarily release old slot inside this transaction so rebooking nearby works cleanly
  update kroner_private.appointments set status = 'cancelled' where id = apt.id;

  select count(*) into active_profs from kroner_private.professionals where shop = s.id and status = 'active';

  if coalesce(p_professional, 'auto') <> 'auto' and active_profs > 1 then
    select id into chair
    from kroner_private.professionals
    where id = p_professional::uuid and shop = s.id and status = 'active';
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

  update kroner_private.appointments
  set professional = chair,
      starts = new_start,
      ends = new_end,
      status = 'booked'
  where id = apt.id;

  insert into kroner_private.audit(shop, actor, action, record_id)
  values (s.id, uid, 'reschedule_own', apt.id);

  perform kroner_private.enqueue_appointment_notice(
    apt.id,
    'booking_rescheduled',
    'booking_rescheduled:' || apt.id::text || ':' || extract(epoch from new_start)::bigint::text,
    old_starts
  );

  return jsonb_build_object(
    'ok', true,
    'id', apt.id,
    'starts', new_start,
    'ends', new_end
  );
end;
$$;
revoke all on function public.kroner_client_reschedule(uuid, date, text, timestamptz, text) from public, anon;
grant execute on function public.kroner_client_reschedule(uuid, date, text, timestamptz, text) to authenticated;

-- 7. Authenticated Barber Notification Center & Push Subscription RPC
create or replace function public.kroner_notifications(action text, payload jsonb default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := kroner_private.current_user_id();
  me kroner_private.professionals;
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
            'id', n.id,
            'kind', n.kind,
            'title', n.title,
            'body', n.body,
            'tab', n.tab,
            'appointmentId', n.appointment_id,
            'meta', n.meta,
            'readAt', n.read_at,
            'createdAt', n.created_at
          ) order by n.created_at desc
        )
        from (
          select *
          from kroner_private.notifications
          where shop = me.shop and recipient_user_id = uid
          order by created_at desc
          limit 40
        ) n
      ), '[]'::jsonb),
      'deviceCount', (
        select count(*)::int
        from kroner_private.push_subscriptions
        where shop = me.shop and user_id = uid
      )
    );
  end if;

  if action = 'mark_read' then
    if nullif(payload->>'id', '') is null then raise exception 'Identificador obrigatório.'; end if;
    update kroner_private.notifications
    set read_at = coalesce(read_at, now())
    where id = (payload->>'id')::uuid
      and shop = me.shop
      and recipient_user_id = uid;
    return '{"ok":true}'::jsonb;
  end if;

  if action = 'mark_all_read' then
    update kroner_private.notifications
    set read_at = now()
    where shop = me.shop
      and recipient_user_id = uid
      and read_at is null;
    return '{"ok":true}'::jsonb;
  end if;

  if action = 'save_subscription' then
    v_endpoint := trim(coalesce(payload->>'endpoint', ''));
    v_p256dh := trim(coalesce(payload->>'p256dh', ''));
    v_auth := trim(coalesce(payload->>'auth', ''));
    v_platform := lower(trim(coalesce(payload->>'platform', 'web')));
    v_standalone := coalesce((payload->>'standalone')::boolean, false);
    v_ua := left(trim(coalesce(payload->>'userAgent', '')), 260);

    if v_endpoint !~ '^https://' or length(v_endpoint) > 2048 then
      raise exception 'Endpoint de notificação inválido.';
    end if;
    if length(v_p256dh) < 16 or length(v_p256dh) > 512 or length(v_auth) < 8 or length(v_auth) > 256 then
      raise exception 'Chaves de criptografia push inválidas.';
    end if;
    if v_platform not in ('ios', 'android', 'desktop', 'web') then
      v_platform := 'web';
    end if;

    -- Cap stored devices per user to 15 (prune oldest if exceeded)
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
      delete from kroner_private.push_subscriptions
      where user_id = uid and endpoint = v_endpoint;
    end if;
    return '{"ok":true}'::jsonb;
  end if;

  if action = 'has_subscription' then
    v_endpoint := trim(coalesce(payload->>'endpoint', ''));
    return jsonb_build_object(
      'registered', exists(
        select 1 from kroner_private.push_subscriptions
        where user_id = uid and shop = me.shop and endpoint = v_endpoint
      )
    );
  end if;

  raise exception 'Operação inválida.';
end;
$$;
revoke all on function public.kroner_notifications(text, jsonb) from public, anon;
grant execute on function public.kroner_notifications(text, jsonb) to authenticated;

-- 8. Authenticated helper to validate caller's appointment ownership for push dispatch
create or replace function public.kroner_verify_client_appointment(p_appointment uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  -- Ensure public booking notice exists even when a shop owner tests their own /b/[slug] link
  if p_kind = 'booking_created' and apt.status = 'booked' and apt.created_at > now() - interval '15 minutes' then
    perform kroner_private.enqueue_appointment_notice(
      apt.id,
      'booking_created',
      'booking_created:' || apt.id::text,
      null
    );
  elsif p_kind = 'booking_cancelled' and apt.status = 'cancelled' then
    perform kroner_private.enqueue_appointment_notice(
      apt.id,
      'booking_cancelled',
      'booking_cancelled:' || apt.id::text,
      null
    );
  end if;

  return jsonb_build_object('ok', true, 'appointmentId', apt.id, 'actorUserId', uid);
end;
$$;
revoke all on function public.kroner_verify_client_appointment(uuid, text) from public, anon;
grant execute on function public.kroner_verify_client_appointment(uuid, text) to authenticated;

-- 9. Service-role-only push delivery RPCs
create or replace function public.kroner_claim_appointment_pushes(p_appointment uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
    returning n.id, n.recipient_user_id, n.kind, n.title, n.body, n.tab, n.appointment_id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', u.id,
      'kind', u.kind,
      'title', u.title,
      'body', u.body,
      'tab', u.tab,
      'appointmentId', u.appointment_id,
      'subscriptions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'endpoint', ps.endpoint,
          'p256dh', ps.p256dh,
          'auth', ps.auth
        ))
        from kroner_private.push_subscriptions ps
        where ps.user_id = u.recipient_user_id
      ), '[]'::jsonb)
    )
  ), '[]'::jsonb)
  into claimed
  from updated u;

  return claimed;
end;
$$;
revoke all on function public.kroner_claim_appointment_pushes(uuid) from public, anon, authenticated;
grant execute on function public.kroner_claim_appointment_pushes(uuid) to service_role;

create or replace function public.kroner_delete_stale_push_endpoints(p_endpoints text[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed int;
begin
  if p_endpoints is null or array_length(p_endpoints, 1) is null then return 0; end if;
  delete from kroner_private.push_subscriptions where endpoint = any(p_endpoints);
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.kroner_delete_stale_push_endpoints(text[]) from public, anon, authenticated;
grant execute on function public.kroner_delete_stale_push_endpoints(text[]) to service_role;

-- 10. Service-role-only Morning Summary Collector & Writer
create or replace function public.kroner_collect_morning_summary(p_execution_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

    if inserted_day is null then
      continue;
    end if;

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
        from kroner_private.charges ch
        where ch.shop = sh.id
          and ch.direction = 'in'
          and ch.due + make_interval(days => coalesce((sh.cfg->>'grace')::int, 3)) < local_day
          and ch.amount > coalesce((
            select sum(pay.amount) from kroner_private.payments pay where pay.charge = ch.id
          ), 0)
      ),
      'variableDueToday', coalesce((
        select jsonb_agg(r.name)
        from kroner_private.recurring r
        where r.shop = sh.id
          and r.active
          and r.variable
          and r.day = extract(day from local_day)::int
      ), '[]'::jsonb),
      'professionals', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id,
          'userId', p.user_id,
          'role', p.role,
          'name', case when p.role = 'owner' then coalesce(nullif(sh.cfg->>'professional', ''), p.name) else p.name end,
          'todayCount', (
            select count(*)::int
            from kroner_private.appointments a
            where a.shop = sh.id
              and a.status = 'booked'
              and (a.starts at time zone tz)::date = local_day
              and (p.role in ('owner', 'partner') or a.professional = p.id)
          ),
          'firstTime', (
            select to_char(min(a.starts at time zone tz), 'HH24:MI')
            from kroner_private.appointments a
            where a.shop = sh.id
              and a.status = 'booked'
              and (a.starts at time zone tz)::date = local_day
              and (p.role in ('owner', 'partner') or a.professional = p.id)
          ),
          'subscriptions', coalesce((
            select jsonb_agg(jsonb_build_object(
              'endpoint', ps.endpoint,
              'p256dh', ps.p256dh,
              'auth', ps.auth
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
$$;
revoke all on function public.kroner_collect_morning_summary(text) from public, anon, authenticated;
grant execute on function public.kroner_collect_morning_summary(text) to service_role;

create or replace function public.kroner_record_morning_notice(
  p_shop uuid,
  p_recipient_user_id uuid,
  p_professional_id uuid,
  p_day date,
  p_title text,
  p_body text,
  p_push_sent boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into kroner_private.notifications (
    shop,
    recipient_user_id,
    recipient_professional_id,
    kind,
    title,
    body,
    tab,
    dedupe_key,
    push_sent_at
  ) values (
    p_shop,
    p_recipient_user_id,
    p_professional_id,
    'morning_summary',
    left(p_title, 180),
    left(p_body, 500),
    'agenda',
    'morning_summary:' || p_day::text,
    case when p_push_sent then now() else null end
  )
  on conflict (recipient_user_id, dedupe_key) where dedupe_key is not null do nothing;
end;
$$;
revoke all on function public.kroner_record_morning_notice(uuid, uuid, uuid, date, text, text, boolean) from public, anon, authenticated;
grant execute on function public.kroner_record_morning_notice(uuid, uuid, uuid, date, text, text, boolean) to service_role;
