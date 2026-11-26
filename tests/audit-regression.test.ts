import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isAllowedPushEndpoint } from '../lib/server-push';
import { formatRpcError } from '../lib/supabase';
import { today } from '../lib/domain';

test('isAllowedPushEndpoint allows only official browser Web Push services and blocks SSRF', () => {
  // Valid official push endpoints
  assert.equal(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc123'), true);
  assert.equal(isAllowedPushEndpoint('https://web.push.apple.com/QABCD12345'), true);
  assert.equal(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/xyz'), true);
  assert.equal(isAllowedPushEndpoint('https://wns2-bl2p.notify.windows.com/w/?token=abc'), true);
  assert.equal(isAllowedPushEndpoint('https://use1.push.samsungosp.com/v1/push/abc'), true);

  // Blocked SSRF / invalid endpoints
  assert.equal(isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/abc'), false);
  assert.equal(isAllowedPushEndpoint('https://localhost/internal'), false);
  assert.equal(isAllowedPushEndpoint('https://127.0.0.1/admin'), false);
  assert.equal(isAllowedPushEndpoint('https://169.254.169.254/latest/meta-data/'), false);
  assert.equal(isAllowedPushEndpoint('https://evil.example/fcm/send/abc'), false);
  assert.equal(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.example/send/abc'), false);
  assert.equal(isAllowedPushEndpoint('https://fcm.googleapis.com:8443/fcm/send/abc'), false);
  assert.equal(isAllowedPushEndpoint('https://user:pass@fcm.googleapis.com/fcm/send/abc'), false);
  assert.equal(isAllowedPushEndpoint('https://fcm.googleapis.com/'), false);
  assert.equal(isAllowedPushEndpoint(''), false);
});

test('today(tz) returns valid YYYY-MM-DD for supported Brazilian timezones', () => {
  for (const tz of ['America/Sao_Paulo', 'America/Manaus', 'America/Rio_Branco', 'America/Noronha']) {
    assert.match(today(tz), /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('Round 4 SQL migration enforces PL/pgSQL ambiguity, IDOR, and search_path invariants', () => {
  const migrationPath = path.join(
    process.cwd(),
    'supabase/migrations/20261125040000_audit_round4_hardening.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf8');

  // Guard against known PL/pgSQL ambiguous column regressions
  assert.equal(sql.includes('to_jsonb(ch)'), false, 'Found ambiguous to_jsonb(ch) in SQL');
  assert.equal(
    /where[^\n]*\band action\s*=/i.test(sql),
    false,
    'Found unqualified "and action =" in WHERE clause'
  );

  // Guard against unverified phone auto-linking IDOR in public booking
  assert.equal(
    sql.includes("where shop = sid and user_id is null and phone = payload->>'phone'"),
    false,
    'Unverified phone auto-linking must stay removed from public booking'
  );

  // Guard against untyped record crash in kroner_client_profile
  const profileMatch = sql.match(
    /create or replace function public\.kroner_client_profile[\s\S]*?grant execute on function public\.kroner_client_profile/
  );
  assert.ok(profileMatch, 'kroner_client_profile must exist in Round 4 migration');
  assert.equal(
    profileMatch[0].includes('rec record;'),
    false,
    'kroner_client_profile must use typed variables, not untyped record'
  );

  // Verify every SECURITY DEFINER function pins search_path = ''
  const fnDecls = sql.match(/create or replace function[\s\S]*?as \$/gi) || [];
  assert.ok(fnDecls.length >= 10, 'Expected hardened functions in Round 4 migration');
  for (const decl of fnDecls) {
    if (/security definer/i.test(decl)) {
      assert.match(decl, /set search_path\s*(=|to)\s*''/i, `Missing search_path='' in: ${decl.slice(0, 80)}`);
    }
  }
});

test('Service worker blocks protocol-relative URLs and enforces same-origin navigation', () => {
  const sw = fs.readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8');
  assert.ok(sw.includes("startsWith('//')"), 'sw.js must reject protocol-relative URLs');
  assert.ok(sw.includes('resolved.origin === origin'), 'sw.js must verify same-origin before navigating');
});

test('Buffer release SQL migration enforces search_path, lock order, and access grants', () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20261125050000_buffer_release.sql'),
    'utf8'
  );
  assert.ok(sql.includes('buffer_released'), 'Must add and check buffer_released');
  assert.ok(
    sql.includes('security definer set search_path = \'\''),
    'kroner_release_buffer must pin search_path'
  );
  assert.ok(
    sql.includes('revoke all on function public.kroner_release_buffer(uuid) from public, anon'),
    'kroner_release_buffer must revoke public and anon access'
  );
  assert.ok(
    sql.indexOf('from kroner_private.shops where id = v_shop for update') <
      sql.indexOf('from kroner_private.appointments\n  where id = p_appointment'),
    'Must lock shops before appointments'
  );
});

test('Overtime slots SQL migration respects overtimeMinutes and preserves buffer_released', () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20261125060000_overtime_slots.sql'),
    'utf8'
  );
  assert.ok(sql.includes('overtimeMinutes'), 'chair_slots must read cfg.overtimeMinutes');
  assert.ok(sql.includes('overtime_minutes'), 'chair_slots must apply overtime_minutes');
  assert.ok(sql.includes('buffer_released'), 'chair_slots must preserve buffer_released support');
  assert.ok(sql.includes("set search_path = ''"), 'chair_slots must pin search_path');
  assert.ok(
    sql.includes('while cursor_t < period_hi'),
    'chair_slots must prevent bookings starting at or after closing/period_hi'
  );
});

test('formatRpcError allows safe P0001 business messages and masks raw Postgres errors', () => {
  assert.equal(
    formatRpcError({ code: 'P0001', message: 'Já existe um atendimento nesse horário. Escolha outro.' }).message,
    'Já existe um atendimento nesse horário. Escolha outro.'
  );
  assert.equal(
    formatRpcError({ code: '22P02', message: 'invalid input syntax for type uuid: "abc"' }).message,
    'Não foi possível concluir a operação. Revise os dados e tente novamente.'
  );
  assert.equal(
    formatRpcError({
      code: '23514',
      message: 'new row for relation "services" violates check constraint "services_duration_check"',
    }).message,
    'Não foi possível concluir a operação. Revise os dados e tente novamente.'
  );
  assert.equal(
    formatRpcError({ code: '42883', message: 'operator does not exist: uuid = text' }).message,
    'Não foi possível concluir a operação. Revise os dados e tente novamente.'
  );
  assert.equal(
    formatRpcError({ code: 'P0001', message: 'error in kroner_private.shops relation "shops"' }).message,
    'Não foi possível concluir a operação. Revise os dados e tente novamente.'
  );
});

test('13-Point Security Audit SQL & API routes enforce all critical hardening invariants', () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20261125070000_security_audit_13points.sql'),
    'utf8'
  );

  // Point 8A (HIGH): active chairs <= seat_limit + fail-closed NULL + no grace on trialing
  assert.ok(sql.includes('sub.current_period_end is not null'), 'shop_entitled must fail closed on NULL');
  assert.match(sql, /sub\.status = 'trialing'\s+and sub\.current_period_end > now\(\)/, 'trialing must not have 3d grace');
  assert.ok(sql.includes('<= sub.seat_limit'), 'shop_entitled must enforce active chairs <= seat_limit');

  // Point 9A: no DECLARE-section payload casts in kroner_management / kroner_pos
  assert.equal(sql.includes("op uuid := nullif(payload->>'request_id'"), false, 'DECLARE cast escapes EXCEPTION block');
  assert.equal(sql.includes("discount int := coalesce(nullif(payload->>'discount'"), false, 'DECLARE cast escapes EXCEPTION block');

  // Point 10 (MEDIUM): trial_claims phone ledger + RLS + REVOKE
  assert.ok(sql.includes('create table if not exists kroner_private.trial_claims'), 'trial_claims table missing');
  assert.ok(sql.includes('alter table kroner_private.trial_claims enable row level security'), 'trial_claims RLS missing');
  assert.ok(sql.includes('revoke all on kroner_private.shop_subscriptions from public, anon, authenticated'), 'shop_subscriptions REVOKE missing');

  // Point 4.1 (MEDIUM): employee workspace strips owner, fees, client user_id, and other prices
  assert.ok(sql.includes("(to_jsonb(s) - 'owner')"), 'employee workspace must omit shop owner');
  assert.ok(sql.includes("to_jsonb(x) - 'user_id'"), 'employee workspace must omit client user_id');
  assert.ok(sql.includes("sv_item - 'price'"), 'employee workspace must strip non-finance appointment service prices');

  // Point 4.2 + 9A: kroner_release_buffer uses uid uuid & authorizes before shop lock
  const rb = sql.slice(sql.indexOf('create or replace function public.kroner_release_buffer'));
  assert.ok(rb.includes('uid uuid := kroner_private.current_user_id();'), 'kroner_release_buffer must declare uid uuid');
  assert.ok(
    rb.indexOf('from kroner_private.professionals') < rb.indexOf('from kroner_private.shops where id = me.shop for update'),
    'kroner_release_buffer must authorize caller before locking shops'
  );

  // Point 4.3: partner cannot assign partner role
  assert.ok(sql.includes("if selected_role = 'partner' and me.role <> 'owner'"), 'partner promotion guard missing');

  // Point 6.1 & 6.2: soft-deleted/inactive data & push cleanup
  assert.ok(sql.includes("set status = 'inactive', invite_hash = null, email = null"), 'decline must clear email PII');
  assert.ok(sql.includes('delete from kroner_private.push_subscriptions'), 'deactivate must purge push_subscriptions');
  assert.ok(sql.includes("and pr.status = 'active'"), 'kroner_claim_appointment_pushes must verify active professional');

  // No ambiguous SQL regressions & every SECURITY DEFINER pins search_path
  assert.equal(sql.includes('to_jsonb(ch)'), false, 'ambiguous to_jsonb(ch) regression');
  assert.equal(/where[^\n]*\band action\s*=/i.test(sql), false, 'unqualified action = regression');
  const fnDecls = sql.match(/create or replace function[\s\S]*?as \$/gi) || [];
  assert.ok(fnDecls.length >= 8, 'expected hardened functions in 13-point migration');
  for (const decl of fnDecls) {
    if (/security definer/i.test(decl)) {
      assert.match(decl, /set search_path\s*(=|to)\s*''/i, `Missing search_path in: ${decl.slice(0, 80)}`);
    }
  }

  // Point 8A + 10 + 11B in API routes
  const billingRoute = fs.readFileSync(path.join(process.cwd(), 'app/api/assinatura/route.ts'), 'utf8');
  assert.ok(billingRoute.includes('if (count < extraChairsInShop)'), 'cadeiras must reject count < extraChairsInShop');
  assert.equal(billingRoute.includes('trial_period_days: 15'), false, 'must not grant unconditional fresh 15d Stripe trial');
  assert.ok(billingRoute.includes('trial_end: remainingTrialEndUnix'), 'must cap Stripe trial to remaining local trial');

  const webhookRoute = fs.readFileSync(path.join(process.cwd(), 'app/api/stripe/webhook/route.ts'), 'utf8');
  assert.ok(webhookRoute.includes("case 'charge.refunded':"), 'webhook must handle charge.refunded');
  assert.ok(webhookRoute.includes("case 'charge.dispute.created':"), 'webhook must handle charge.dispute.created');
});
