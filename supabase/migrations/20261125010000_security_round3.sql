-- ============================================================================
-- Kronner Security Round 3 Hardening Migration (2026-11-25)
-- Fixes findings from Post-Restructure 3-Agent Security Audit:
--   - M-02: Lock shop FOR UPDATE and require request_id in commission_payout
--           so retries cannot double-record payouts or race on requests PK
--   - L-02: Reject NULL/empty rate in kroner_management('service_rate')
-- Idempotent: safe to run directly in Supabase SQL Editor.
-- ============================================================================

create or replace function public.kroner_management(action text, payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := kroner_private.current_user_id();
  me kroner_private.professionals;
  p kroner_private.products;
  delta int;
  op uuid := nullif(payload->>'request_id', '')::uuid;
  filter_prof uuid := nullif(payload->>'professional', '')::uuid;
  d_from date := nullif(payload->>'from', '')::date;
  d_to date := nullif(payload->>'to', '')::date;
  pay_amount int;
  payout_id uuid;
  existing_res jsonb;
begin
  select * into me from kroner_private.professionals where user_id = uid and status = 'active';
  if me.id is null then raise exception 'Sem vínculo ativo.'; end if;

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
              from kroner_private.charges ch
              join kroner_private.payments pay on pay.charge = ch.id
              where ch.appointment = x.appointment and ch.shop = me.shop
            ), 0)
          ) order by coalesce(a.starts, x.created_at) desc
        )
        from kroner_private.service_earnings x
        join kroner_private.professionals pr on pr.id = x.professional and pr.shop = x.shop
        left join kroner_private.appointments a on a.id = x.appointment and a.shop = x.shop
        where x.shop = me.shop
          and (filter_prof is null or x.professional = filter_prof)
          and (d_from is null or coalesce(a.starts, x.created_at)::date >= d_from)
          and (d_to is null or coalesce(a.starts, x.created_at)::date <= d_to)
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
    if existing_res is not null then
      return existing_res;
    end if;

    pay_amount := (payload->>'amount')::int;
    if filter_prof is null or pay_amount is null or pay_amount <= 0 then
      raise exception 'Informe o profissional e um valor positivo.';
    end if;
    if not exists(select 1 from kroner_private.professionals where id = filter_prof and shop = me.shop) then
      raise exception 'Profissional inválido.';
    end if;

    insert into kroner_private.commission_payouts(shop, professional, amount, paid_on, note, actor)
      values(me.shop, filter_prof, pay_amount, coalesce(nullif(payload->>'paid_on', '')::date, current_date), left(coalesce(trim(payload->>'note'), ''), 200), uid)
      returning id into payout_id;
    insert into kroner_private.requests values(op, uid, 'commission_payout', jsonb_build_object('ok', true, 'id', payout_id), now());
    insert into kroner_private.audit(shop, actor, action, record_id) values(me.shop, uid, 'commission_payout', payout_id);
    return jsonb_build_object('ok', true, 'id', payout_id);
  end if;

  if action = 'service_rate' then
    if nullif(payload->>'rate', '') is null
      or (payload->>'rate')::int not between 0 and 10000
      or not exists(select 1 from kroner_private.services where shop = me.shop and id = (payload->>'service')::uuid)
      or not exists(select 1 from kroner_private.professionals where shop = me.shop and id = (payload->>'professional')::uuid) then
      raise exception 'Percentual, profissional ou serviço inválido.';
    end if;
    update kroner_private.professionals
    set service_rates = service_rates || jsonb_build_object(payload->>'service', (payload->>'rate')::int)
    where shop = me.shop and id = (payload->>'professional')::uuid;
    return '{"ok":true}';
  end if;

  if action = 'inventory' then
    perform 1 from kroner_private.shops where id = me.shop for update;
    if op is null then raise exception 'Identificador obrigatório.'; end if;
    if exists(select 1 from kroner_private.requests r where r.id = op and r.actor = uid and r.action = 'inventory') then return '{"ok":true}'; end if;
    insert into kroner_private.requests values(op, uid, 'inventory', '{"ok":true}', now());
    select * into p from kroner_private.products where id = (payload->>'id')::uuid and shop = me.shop for update;
    if p.id is null or coalesce(length(trim(payload->>'reason')), 0) < 3 or coalesce((payload->>'count')::int, -1) < 0 or coalesce(length(trim(payload->>'unit')), 0) not between 1 and 30 then raise exception 'Revise a contagem, a unidade e o motivo.'; end if;
    delta := (payload->>'count')::int - p.quantity;
    update kroner_private.products set quantity = quantity + delta, unit = trim(payload->>'unit'), active = (payload->>'active')::boolean, updated_at = now() where id = p.id;
    insert into kroner_private.movements(shop, product, quantity, kind, unit_cost, note) values(me.shop, p.id, delta, 'adjustment', p.cost, payload->>'reason');
    insert into kroner_private.audit(shop, actor, action, record_id) values(me.shop, uid, 'inventory', p.id);
    return '{"ok":true}';
  end if;

  raise exception 'Operação inválida.';
end;
$$;
revoke all on function public.kroner_management(text, jsonb) from public, anon;
grant execute on function public.kroner_management(text, jsonb) to authenticated;
