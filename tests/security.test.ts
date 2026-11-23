import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePublicOrigin } from '../lib/server-origin';

test('resolvePublicOrigin enforces configured https origin and fails closed in production', () => {
  const prevOrigin = process.env.KRONER_PUBLIC_ORIGIN;
  const prevEnv = process.env.NODE_ENV;
  try {
    process.env.KRONER_PUBLIC_ORIGIN = 'https://kronner.vercel.app/extra';
    assert.equal(resolvePublicOrigin(new Request('https://evil.example/api/assinatura')), 'https://kronner.vercel.app');

    process.env.KRONER_PUBLIC_ORIGIN = 'http://evil.example';
    assert.equal(resolvePublicOrigin(new Request('https://kronner.vercel.app/api/assinatura')), null);

    process.env.KRONER_PUBLIC_ORIGIN = '';
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    assert.equal(resolvePublicOrigin(new Request('https://evil.example/api/assinatura')), null);

    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    assert.equal(resolvePublicOrigin(new Request('http://localhost:3000/api/assinatura')), 'http://localhost:3000');
  } finally {
    if (prevOrigin === undefined) delete process.env.KRONER_PUBLIC_ORIGIN;
    else process.env.KRONER_PUBLIC_ORIGIN = prevOrigin;
    (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;
  }
});
