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
