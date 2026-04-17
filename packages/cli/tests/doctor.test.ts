import test from 'node:test';
import assert from 'node:assert/strict';

import { runDoctor } from '../src/commands/doctor.ts';

test('runDoctor reports config, session, and domains checks', async () => {
  const report = await runDoctor({
    loadConfig: async () => ({
      baseUrl: 'https://example.com',
      accessToken: 'token',
      username: 'alice',
      role: 'user',
      expiresAt: '2099-01-01T00:00:00.000Z',
      mailboxAddress: null,
    }),
    fetchImpl: async (url: string) => {
      if (String(url).endsWith('/api/cli/session')) {
        return new Response(JSON.stringify({ authenticated: true, username: 'alice', role: 'user' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify(['example.com']), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  assert.equal(report.config.ok, true);
  assert.equal(report.session.ok, true);
  assert.equal(report.domains.ok, true);
});

test('runDoctor captures config read failures cleanly', async () => {
  const report = await runDoctor({
    loadConfig: async () => {
      throw new Error('missing config');
    },
    fetchImpl: async () => {
      throw new Error('should not run');
    },
  });

  assert.equal(report.config.ok, false);
  assert.match(String(report.config.message), /missing config/);
});
