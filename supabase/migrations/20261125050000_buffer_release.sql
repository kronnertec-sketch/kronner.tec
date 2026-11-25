-- Kronner — Safety Buffer Release in Agenda
-- Adds `buffer_released` to `kroner_private.appointments`, updates `kroner_private.chair_slots`
-- to free the safety buffer minutes when released, and exposes `public.kroner_release_buffer(uuid)`
-- so barbers/managers can delete the safety buffer directly from the Agenda if they finish early.
-- Idempotent: safe to run repeatedly in Supabase SQL Editor.

-- 1. Column on appointments (automatically exposed by workspace's to_jsonb(x))
alter table kroner_private.appointments
  add column if not exists buffer_released boolean not null default false;

-- 2. Update chair_slots to respect buffer_released on existing appointments
create or replace function kroner_private.chair_slots(
  sid uuid,
  chair uuid,
  svc uuid[],
  day date,
  period text,
  manual boolean default false
)
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
       and not exists(
         select 1
         from kroner_private.appointments x
         where x.shop = sid
           and x.professional = chair
           and x.status in ('booked', 'done')
           and x.starts < b + make_interval(mins => buffer_minutes)
           and x.ends + make_interval(mins => case when coalesce(x.buffer_released, false) then 0 else buffer_minutes end) > a
       )
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

-- 3. RPC to release an appointment's safety buffer early
create or replace function public.kroner_release_buffer(p_appointment uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid text := kroner_private.current_user_id();
  v_shop uuid;
  me kroner_private.professionals;
  apt kroner_private.appointments;
begin
  if uid is null then raise exception 'Entre na sua conta para continuar.'; end if;
  if p_appointment is null then raise exception 'Atendimento inválido.'; end if;

  select a.shop into v_shop
  from kroner_private.appointments a
  where a.id = p_appointment;

  if v_shop is null then raise exception 'Atendimento não encontrado.'; end if;

  -- Lock shop before appointment to maintain consistent lock order
  perform 1 from kroner_private.shops where id = v_shop for update;

  select * into me
  from kroner_private.professionals
  where shop = v_shop and user_id = uid and status = 'active'
  limit 1;

  if me.id is null then
    raise exception 'Sem permissão para alterar a agenda desta barbearia.';
  end if;

  if not kroner_private.shop_entitled(v_shop) then
    raise exception 'Assinatura inativa para alterar a agenda.';
  end if;

  select * into apt
  from kroner_private.appointments
  where id = p_appointment and shop = v_shop
  for update;

  if apt.id is null then raise exception 'Atendimento não encontrado.'; end if;

  if me.role not in ('owner', 'partner') and apt.professional <> me.id then
    raise exception 'Você só pode liberar intervalos da sua própria cadeira.';
  end if;

  if apt.status not in ('booked', 'done') then
    raise exception 'Este atendimento não possui intervalo de segurança ativo.';
  end if;

  update kroner_private.appointments
  set buffer_released = true
  where id = apt.id;

  insert into kroner_private.audit(shop, actor, action, record_id)
  values(v_shop, uid, 'release_buffer', apt.id);

  return '{"ok":true}'::jsonb;
end;
$$;
revoke all on function public.kroner_release_buffer(uuid) from public, anon;
grant execute on function public.kroner_release_buffer(uuid) to authenticated;
