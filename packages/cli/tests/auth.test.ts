import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { loadConfig, saveConfig } from '../src/config.ts';
import { exchangeAuthCode, getSessionStatus } from '../src/commands/auth.ts';

test('saveConfig round-trips the persisted CLI session', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'freemail-cli-'));

  await saveConfig({
    baseUrl: 'https://freemail.test',
    accessToken: 'cli-token',
    username: 'alice',
    role: 'user',
    expiresAt: '2099-01-01T00:00:00.000Z',
  }, { configDir });

  const loaded = await loadConfig({ configDir });

  assert.equal(loaded.baseUrl, 'https://freemail.test');
  assert.equal(loaded.accessToken, 'cli-token');
  assert.equal(loaded.role, 'user');
});

test('exchangeAuthCode posts the state and code to the Worker', async () => {
  const requests: Array<{ url: string; method: string; body: string }> = [];

  const session = await exchangeAuthCode({
    baseUrl: 'https://freemail.test',
    state: 'state-123',
    code: 'ABCD1234',
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        method: String(init?.method || 'GET'),
        body: String(init?.body || ''),
      });
      return new Response(JSON.stringify({
        access_token: 'cli-token',
        token_type: 'Bearer',
        expires_at: '2099-01-01T00:00:00.000Z',
        username: 'alice',
        role: 'user',
        mailbox_address: null,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  assert.equal(session.accessToken, 'cli-token');
  assert.equal(requests[0].url, 'https://freemail.test/api/cli/auth/exchange');
  assert.equal(requests[0].method, 'POST');
  assert.match(requests[0].body, /"state":"state-123"/);
  assert.match(requests[0].body, /"code":"ABCD1234"/);
});

test('getSessionStatus validates the stored CLI token remotely', async () => {
  const status = await getSessionStatus({
    baseUrl: 'https://freemail.test',
    accessToken: 'cli-token',
    fetchImpl: async () => new Response(JSON.stringify({
      authenticated: true,
      username: 'alice',
      role: 'user',
      expires_at: '2099-01-01T00:00:00.000Z',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  });

  assert.equal(status.username, 'alice');
  assert.equal(status.role, 'user');
});

test('package metadata declares a buildable dist-based CLI entrypoint', async () => {
  const [packageJsonRaw, tsconfigRaw] = await Promise.all([
    fs.readFile(new URL('../package.json', import.meta.url), 'utf8'),
    fs.readFile(new URL('../tsconfig.json', import.meta.url), 'utf8'),
  ]);

  const packageJson = JSON.parse(packageJsonRaw) as {
    bin?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  const tsconfig = JSON.parse(tsconfigRaw) as {
    compilerOptions?: {
      noEmit?: boolean;
      outDir?: string;
      rootDir?: string;
    };
  };

  assert.equal(packageJson.bin?.freemail, 'dist/index.js');
  assert.equal(packageJson.scripts?.build, 'tsc -p tsconfig.json');
  assert.equal(packageJson.scripts?.test, 'tsx --test tests/auth.test.ts');
  assert.equal(tsconfig.compilerOptions?.noEmit, false);
  assert.equal(tsconfig.compilerOptions?.outDir, 'dist');
  assert.equal(tsconfig.compilerOptions?.rootDir, 'src');
});
