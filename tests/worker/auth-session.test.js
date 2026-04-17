import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function loadAuthSession() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const filePath = path.resolve(currentDir, '../../public/js/auth-session.js');
  const source = readFileSync(filePath, 'utf8');
  const context = {
    console,
    setTimeout,
    clearTimeout,
    AbortController,
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: filePath });
  return context.AuthSession;
}

test('fetchSession requests /api/session with credentials and returns parsed session data', async () => {
  const AuthSession = loadAuthSession();
  const calls = [];

  const session = await AuthSession.fetchSession({
    timeoutMs: 0,
    createAbortController: () => null,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return { authenticated: true, role: 'admin', username: 'admin' };
        }
      };
    }
  });

  assert.deepEqual(session, { authenticated: true, role: 'admin', username: 'admin' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/session');
  assert.equal(calls[0].options.credentials, 'include');
  assert.equal(calls[0].options.headers['Cache-Control'], 'no-cache');
});

test('waitForSessionReady keeps polling until the authenticated session becomes available', async () => {
  const AuthSession = loadAuthSession();
  let attempts = 0;

  const session = await AuthSession.waitForSessionReady({
    timeoutMs: 1000,
    intervalMs: 0,
    nowImpl: (() => {
      let now = 0;
      return () => now++;
    })(),
    sleepImpl: async () => {},
    createAbortController: () => null,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) {
        return { ok: false, async json() { return null; } };
      }
      return {
        ok: true,
        async json() {
          return { authenticated: true, role: 'user', username: 'alice' };
        }
      };
    }
  });

  assert.equal(attempts, 3);
  assert.deepEqual(session, { authenticated: true, role: 'user', username: 'alice' });
});

test('waitForSessionReady returns null after timing out without a valid session', async () => {
  const AuthSession = loadAuthSession();
  let attempts = 0;
  let now = 0;

  const session = await AuthSession.waitForSessionReady({
    timeoutMs: 2,
    intervalMs: 0,
    nowImpl: () => now++,
    sleepImpl: async () => {},
    createAbortController: () => null,
    fetchImpl: async () => {
      attempts += 1;
      return { ok: false, async json() { return null; } };
    }
  });

  assert.equal(session, null);
  assert.equal(attempts, 3);
});
