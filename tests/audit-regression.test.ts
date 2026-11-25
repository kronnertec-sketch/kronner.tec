import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isAllowedPushEndpoint } from '../lib/server-push';
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
