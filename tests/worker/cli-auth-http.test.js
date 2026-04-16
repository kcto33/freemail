import test from 'node:test';
import assert from 'node:assert/strict';
import { createCliAuthHandlers } from '../../src/api/cliAuth.js';
import { authMiddleware } from '../../src/middleware/auth.js';

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
