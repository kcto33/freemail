import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../../src/routes/index.js';
import { createCliAuthHandlers } from '../../src/api/cliAuth.js';
import { authMiddleware, createJwt } from '../../src/middleware/auth.js';
import { sha256Hex } from '../../src/api/helpers.js';

function createCliAuthDbStub() {
  const stateRows = [];
  const codeRows = [];
  const tokenRows = [];
  const userRows = [{ id: 1, username: 'admin', role: 'admin' }];

  return {
    stateRows,
    codeRows,
    tokenRows,
    prepare(sql) {
      const bindings = [];
      return {
        bind(...args) {
          bindings.splice(0, bindings.length, ...args);
          return this;
        },
        async all() {
          if (/SELECT 1/i.test(sql)) {
            return { results: [{ 1: 1 }] };
          }
          if (/SELECT user_id FROM cli_auth_codes/i.test(sql)) {
            const [stateHash, codeHash] = bindings;
            const row = codeRows.find((entry) => entry.state_hash === stateHash && entry.code_hash === codeHash);
            return { results: row ? [row] : [] };
          }
          if (/SELECT id, username, role FROM users WHERE id = \?/i.test(sql)) {
            const [id] = bindings;
            const row = userRows.find((entry) => Number(entry.id) === Number(id));
            return { results: row ? [row] : [] };
          }
          if (/FROM cli_auth_states WHERE state_hash = \?/i.test(sql)) {
            const [stateHash] = bindings;
            const row = stateRows.find((entry) => entry.state_hash === stateHash);
            return { results: row ? [row] : [] };
          }
          if (/FROM cli_auth_codes WHERE code_hash = \?/i.test(sql)) {
            const [codeHash] = bindings;
            const row = codeRows.find((entry) => entry.code_hash === codeHash);
            return { results: row ? [row] : [] };
          }
          if (/FROM cli_tokens WHERE token_hash = \?/i.test(sql)) {
            const [tokenHash] = bindings;
            const row = tokenRows.find((entry) => entry.token_hash === tokenHash);
            return { results: row ? [row] : [] };
          }
          return { results: [] };
        },
        async first() {
          const result = await this.all();
          return result.results[0] || null;
        },
        async run() {
          if (/INSERT INTO cli_auth_states/i.test(sql)) {
            stateRows.push({
              state_hash: bindings[0],
              user_id: bindings[1],
              created_at: bindings[2],
              expires_at: bindings[3]
            });
          }
          if (/UPDATE cli_auth_states SET user_id = \?/i.test(sql)) {
            const row = stateRows.find((entry) => entry.state_hash === bindings[1]);
            if (row) row.user_id = bindings[0];
          }
          if (/INSERT INTO cli_auth_codes/i.test(sql)) {
            codeRows.push({
              code_hash: bindings[0],
              state_hash: bindings[1],
              user_id: bindings[2],
              created_at: bindings[3],
              expires_at: bindings[4]
            });
          }
          if (/UPDATE cli_auth_codes SET consumed_at = \?, token_hash = \?/i.test(sql)) {
            const row = codeRows.find((entry) => entry.code_hash === bindings[2]);
            if (row) {
              row.consumed_at = bindings[0];
              row.token_hash = bindings[1];
            }
          }
          if (/INSERT INTO cli_tokens/i.test(sql)) {
            tokenRows.push({
              token_hash: bindings[0],
              user_id: bindings[1],
              created_at: bindings[2],
              expires_at: bindings[3],
              revoked_at: null
            });
          }
          if (/UPDATE cli_tokens SET revoked_at = CURRENT_TIMESTAMP/i.test(sql)) {
            const row = tokenRows.find((entry) => entry.token_hash === bindings[0]);
            if (row) row.revoked_at = 'now';
          }
          if (/UPDATE cli_auth_states SET code_used_at = \?/i.test(sql)) {
            const row = stateRows.find((entry) => entry.state_hash === bindings[1]);
            if (row) row.code_used_at = bindings[0];
          }
          return { success: true };
        }
      };
    },
    async exec(sql) {
      if (/CREATE TABLE IF NOT EXISTS cli_auth_states/i.test(sql)) {
        return { success: true };
      }
      if (/CREATE TABLE IF NOT EXISTS cli_auth_codes/i.test(sql)) {
        return { success: true };
      }
      if (/CREATE TABLE IF NOT EXISTS cli_tokens/i.test(sql)) {
        return { success: true };
      }
      return { success: true };
    }
  };
}

test('start returns a browser URL that points to the CLI auth page', async () => {
  const calls = [];
  const { handleCliAuthApi } = createCliAuthHandlers({
    randomId: () => 'state-123',
    createCliAuthState: async (_db, state, expiresAt) => {
      calls.push({ state, expiresAt });
    }
  });

  const request = new Request('https://freemail.test/api/cli/auth/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  const response = await handleCliAuthApi(request, {}, new URL(request.url), '/api/cli/auth/start', { authPayload: null });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.state, 'state-123');
  assert.equal(body.auth_url, 'https://freemail.test/html/cli-auth.html?state=state-123');
  assert.equal(calls.length, 1);
});

test('issue-code returns a one-time code for an authenticated browser session', async () => {
  const calls = [];
  const { handleCliAuthApi } = createCliAuthHandlers({
    randomId: () => 'code-1234',
    attachCliAuthCodeToState: async (...args) => {
      calls.push(args);
    }
  });

  const request = new Request('https://freemail.test/api/cli/auth/issue-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'state-123' })
  });

  const response = await handleCliAuthApi(request, {}, new URL(request.url), '/api/cli/auth/issue-code', {
    authPayload: { role: 'admin', username: 'admin', userId: 1 }
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.code, 'CODE-1234');
  assert.equal(body.token_type, 'Bearer');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 'state-123');
  assert.equal(calls[0][2].userId, 1);
  assert.equal(calls[0][2].code, 'CODE-1234');
});

test('exchange returns a bearer token payload', async () => {
  const { handleCliAuthApi } = createCliAuthHandlers({
    exchangeCliCodeForToken: async () => ({
      accessToken: 'cli-token',
      expiresAt: '2099-01-01T00:00:00.000Z',
      payload: {
        role: 'user',
        username: 'alice',
        mailboxAddress: null
      }
    })
  });

  const request = new Request('https://freemail.test/api/cli/auth/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'state-123', code: 'ABCD1234' })
  });

  const response = await handleCliAuthApi(request, {}, new URL(request.url), '/api/cli/auth/exchange', { authPayload: null });

  assert.deepEqual(await response.json(), {
    access_token: 'cli-token',
    token_type: 'Bearer',
    expires_at: '2099-01-01T00:00:00.000Z',
    username: 'alice',
    role: 'user',
    mailbox_address: null
  });
});

test('session returns the active CLI auth payload', async () => {
  const { handleCliAuthApi } = createCliAuthHandlers();
  const request = new Request('https://freemail.test/api/cli/session');
  const response = await handleCliAuthApi(request, {}, new URL(request.url), '/api/cli/session', {
    authPayload: { role: 'mailbox', username: 'box@example.com', mailboxAddress: 'box@example.com' }
  });

  assert.deepEqual(await response.json(), {
    authenticated: true,
    role: 'mailbox',
    username: 'box@example.com',
    mailbox_address: 'box@example.com'
  });
});

test('logout revokes the current CLI token', async () => {
  const calls = [];
  const { handleCliAuthApi } = createCliAuthHandlers({
    revokeCliTokenByValue: async (_db, token) => {
      calls.push(token);
    }
  });

  const request = new Request('https://freemail.test/api/cli/logout', {
    method: 'POST',
    headers: { Authorization: 'Bearer cli-token' }
  });

  const response = await handleCliAuthApi(request, {}, new URL(request.url), '/api/cli/logout', {
    authPayload: { role: 'admin', username: 'admin' }
  });

  assert.equal(response.status, 200);
  assert.equal(calls[0], 'cli-token');
});

test('authMiddleware accepts CLI bearer tokens before browser cookies', async () => {
  const context = {
    request: new Request('https://freemail.test/api/mailboxes', {
      headers: {
        Authorization: 'Bearer cli-token',
        Cookie: 'iding-session=browser-cookie'
      }
    }),
    env: {
      JWT_TOKEN: 'root-secret',
      TEMP_MAIL_DB: {}
    }
  };

  const response = await authMiddleware(context, {
    findCliTokenByValue: async (_db, rawToken) => rawToken === 'cli-token'
      ? { role: 'mailbox', username: 'box@example.com', mailboxId: 9, mailboxAddress: 'box@example.com' }
      : null
  });

  assert.equal(response, null);
  assert.equal(context.authPayload.mailboxAddress, 'box@example.com');
});

test('authMiddleware keeps root admin override behavior intact', async () => {
  const context = {
    request: new Request('https://freemail.test/api/mailboxes', {
      headers: {
        'X-Admin-Token': 'root-secret'
      }
    }),
    env: {
      JWT_TOKEN: 'root-secret',
      TEMP_MAIL_DB: {}
    }
  };

  const response = await authMiddleware(context);

  assert.equal(response, null);
  assert.equal(context.authPayload.role, 'admin');
  assert.equal(context.authPayload.username, '__root__');
});

test('authMiddleware falls back to cookie auth when bearer auth is invalid', async () => {
  const cookieToken = await createJwt('cookie-secret', {
    role: 'admin',
    username: 'cookie-user',
    userId: 7
  });

  const context = {
    request: new Request('https://freemail.test/api/mailboxes', {
      headers: {
        Authorization: 'Bearer bad-token',
        Cookie: `iding-session=${cookieToken}`
      }
    }),
    env: {
      JWT_TOKEN: 'cookie-secret',
      TEMP_MAIL_DB: {}
    }
  };

  const response = await authMiddleware(context, {
    findCliTokenByValue: async () => null
  });

  assert.equal(response, null);
  assert.equal(context.authPayload.username, 'cookie-user');
});

test('public CLI auth routes reach the router without authPayload', async () => {
  const router = createRouter();
  const db = createCliAuthDbStub();

  const response = await router.handle(
    new Request('https://freemail.test/api/cli/auth/start', { method: 'POST' }),
    { env: { TEMP_MAIL_DB: db } }
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.state.length > 0, true);
  assert.equal(body.auth_url.startsWith('https://freemail.test/html/cli-auth.html?state='), true);
});

test('public CLI exchange route can run through the router without authPayload', async () => {
  const router = createRouter();
  const db = createCliAuthDbStub();
  const state = 'state-123';
  const code = 'CODE-1234';
  const stateHash = await sha256Hex(state);
  const codeHash = await sha256Hex(code);

  db.codeRows.push({
    code_hash: codeHash,
    state_hash: stateHash,
    user_id: 1,
    expires_at: '2099-01-01T00:00:00.000Z',
    consumed_at: null
  });

  const response = await router.handle(
    new Request('https://freemail.test/api/cli/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, code: 'code-1234' })
    }),
    { env: { TEMP_MAIL_DB: db } }
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.token_type, 'Bearer');
  assert.equal(body.username, 'admin');
  assert.equal(body.role, 'admin');
});
