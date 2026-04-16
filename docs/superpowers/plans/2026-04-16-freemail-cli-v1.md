# Freemail CLI V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe first-party `freemail` CLI with browser-assisted login plus `create`, `list`, `wait`, and `read` commands.

**Architecture:** Extend the Worker with a dedicated CLI auth flow backed by D1-stored one-time codes and revocable opaque CLI tokens, then add a new `packages/cli` package that talks to the existing mailbox and email APIs with bearer-token auth. Keep the web app changes minimal by adding one authorization page and reusing the current browser login flow.

**Tech Stack:** Cloudflare Workers, D1, static HTML/JS, Node.js, TypeScript, Commander, `tsx`, Node test runner

---

## File Structure

### Existing files to modify

- `package.json`
  Add root test runner scripts and the `tsx` dev dependency used by Worker-side tests.
- `d1-init.sql`
  Provision `cli_auth_codes` and `cli_tokens` for fresh deployments.
- `src/db/init.js`
  Ensure CLI auth tables and indexes exist for in-place upgrades.
- `src/db/index.js`
  Re-export the new CLI auth storage helpers.
- `src/api/index.js`
  Dispatch `/api/cli/*` requests before the existing mailbox, email, and user handlers.
- `src/middleware/auth.js`
  Accept CLI bearer tokens before falling back to root-admin override and browser cookies.
- `src/assets/manager.js`
  Allow and route the new CLI authorization page and script.
- `README.md`
  Link to the new CLI package once it exists.
- `docs/api.md`
  Document the new CLI auth endpoints.

### New Worker/server files

- `src/db/cliAuth.js`
  D1 helpers for pending auth states, one-time codes, CLI tokens, and revocation.
- `src/api/cliAuth.js`
  HTTP handlers for `start`, `issue-code`, `exchange`, `session`, and `logout`.
- `public/html/cli-auth.html`
  Browser page that issues and displays a one-time code after normal login.
- `public/js/cli-auth.js`
  Page logic for session checking, redirecting to login, issuing a code, and copy UX.

### New Worker tests

- `tests/worker/cli-auth-db.test.js`
  Verifies D1 helper behavior and token hashing.
- `tests/worker/cli-auth-http.test.js`
  Verifies CLI auth endpoint behavior and middleware integration.
- `tests/worker/asset-manager-cli-auth.test.js`
  Verifies the CLI auth page is routable and publicly reachable.

### New CLI package files

- `packages/cli/package.json`
  Package metadata, scripts, runtime dependencies, and `bin` entry.
- `packages/cli/tsconfig.json`
  Node-targeted TypeScript build output to `dist/`.
- `packages/cli/.gitignore`
  Ignore `dist/`.
- `packages/cli/README.md`
  CLI install and usage guide.
- `packages/cli/src/index.ts`
  Commander entry point registering subcommands.
- `packages/cli/src/api.ts`
  Authenticated HTTP client for `freemail`.
- `packages/cli/src/browser.ts`
  Cross-platform URL opener for the browser auth flow.
- `packages/cli/src/config.ts`
  Read/write config under `~/.freemail/config.json`.
- `packages/cli/src/output.ts`
  Human and JSON output helpers.
- `packages/cli/src/commands/auth.ts`
  `auth login`, `auth status`, `auth logout`.
- `packages/cli/src/commands/create.ts`
  `create` command implementation.
- `packages/cli/src/commands/list.ts`
  `list` command implementation.
- `packages/cli/src/commands/read.ts`
  `read` command implementation.
- `packages/cli/src/commands/wait.ts`
  `wait` command implementation.

### New CLI tests

- `packages/cli/tests/auth.test.ts`
  Config round-trip and auth-code exchange tests.
- `packages/cli/tests/mail-commands.test.ts`
  List, read, and wait behavior tests.
- `packages/cli/tests/create-command.test.ts`
  Create command request-shape tests.

---

### Task 1: Add CLI auth storage and Worker-side test harness

**Files:**
- Modify: `package.json`
- Modify: `d1-init.sql`
- Modify: `src/db/init.js`
- Modify: `src/db/index.js`
- Create: `src/db/cliAuth.js`
- Test: `tests/worker/cli-auth-db.test.js`

- [ ] **Step 1: Write the failing Worker storage test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCliAuthTables,
  findCliTokenByValue,
  revokeCliTokenByValue
} from '../../src/db/cliAuth.js';

function createDbStub(row = null) {
  const calls = [];
  return {
    calls,
    async exec(sql) {
      calls.push({ kind: 'exec', sql });
    },
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              calls.push({ kind: 'first', sql, args });
              return row;
            },
            async run() {
              calls.push({ kind: 'run', sql, args });
              return { meta: { changes: 1 } };
            }
          };
        }
      };
    }
  };
}

test('createCliAuthTables provisions both auth tables', async () => {
  const db = createDbStub();
  await createCliAuthTables(db);
  const ddl = db.calls.find(call => call.kind === 'exec')?.sql ?? '';
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS cli_auth_codes/);
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS cli_tokens/);
});

test('findCliTokenByValue hashes bearer tokens before lookup', async () => {
  const db = createDbStub({
    user_id: 7,
    role: 'mailbox',
    username: 'box@example.com',
    mailbox_id: 11,
    mailbox_address: 'box@example.com',
    expires_at: '2099-01-01T00:00:00.000Z',
    revoked_at: null
  });

  const payload = await findCliTokenByValue(db, 'raw-access-token');

  assert.equal(payload.username, 'box@example.com');
  assert.equal(payload.mailboxAddress, 'box@example.com');
  assert.match(String(db.calls.find(call => call.kind === 'first')?.args?.[0] ?? ''), /^[a-f0-9]{64}$/);
});

test('revokeCliTokenByValue hashes the raw token before update', async () => {
  const db = createDbStub();

  await revokeCliTokenByValue(db, 'raw-access-token');

  const updateCall = db.calls.find(call => call.kind === 'run');
  assert.match(String(updateCall?.args?.[0] ?? ''), /^[a-f0-9]{64}$/);
});
```

- [ ] **Step 2: Run the new Worker test and verify it fails**

Run: `npx tsx --test tests/worker/cli-auth-db.test.js`

Expected: FAIL with `Cannot find module '../../src/db/cliAuth.js'` or missing export errors.

- [ ] **Step 3: Add the CLI auth tables, exports, and D1 helper module**

`package.json`

```json
{
  "dependencies": {
    "postal-mime": "^2.7.4"
  },
  "devDependencies": {
    "tsx": "^4.20.3"
  },
  "scripts": {
    "test:worker": "tsx --test tests/worker/**/*.test.js"
  }
}
```

`d1-init.sql`

```sql
CREATE TABLE IF NOT EXISTS cli_auth_codes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  state_hash      TEXT    NOT NULL UNIQUE,
  code_hash       TEXT,
  user_id         INTEGER,
  role            TEXT,
  username        TEXT,
  mailbox_id      INTEGER,
  mailbox_address TEXT,
  created_at      TEXT    DEFAULT CURRENT_TIMESTAMP,
  expires_at      TEXT    NOT NULL,
  used_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_cli_auth_codes_expires ON cli_auth_codes(expires_at);

CREATE TABLE IF NOT EXISTS cli_tokens (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash      TEXT    NOT NULL UNIQUE,
  user_id         INTEGER,
  role            TEXT    NOT NULL,
  username        TEXT    NOT NULL,
  mailbox_id      INTEGER,
  mailbox_address TEXT,
  created_at      TEXT    DEFAULT CURRENT_TIMESTAMP,
  expires_at      TEXT    NOT NULL,
  last_used_at    TEXT,
  revoked_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_cli_tokens_expires ON cli_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_cli_tokens_user ON cli_tokens(username, role);
```

`src/db/init.js`

```js
import { clearExpiredCache } from '../utils/cache.js';
import { createCliAuthTables } from './cliAuth.js';

async function performFirstTimeSetup(db) {
  try {
    await db.prepare('SELECT 1 FROM mailboxes LIMIT 1').all();
    await db.prepare('SELECT 1 FROM messages LIMIT 1').all();
    await db.prepare('SELECT 1 FROM users LIMIT 1').all();
    await db.prepare('SELECT 1 FROM user_mailboxes LIMIT 1').all();
    await db.prepare('SELECT 1 FROM sent_emails LIMIT 1').all();
    await migrateMailboxesFields(db);
    await createCliAuthTables(db);
    return;
  } catch (e) {
    console.log('检测到数据库表不完整，开始初始化...');
  }

  // existing table creation...
  await createIndexes(db);
  await createCliAuthTables(db);
}

export async function setupDatabase(db) {
  await db.exec(`PRAGMA foreign_keys = ON;`);
  // existing table creation...
  await createIndexes(db);
  await createCliAuthTables(db);
}
```

`src/db/index.js`

```js
export {
  createCliAuthTables,
  createCliAuthState,
  attachCliAuthCodeToState,
  exchangeCliCodeForToken,
  findCliTokenByValue,
  revokeCliTokenByValue
} from './cliAuth.js';
```

`src/db/cliAuth.js`

```js
import { sha256Hex } from '../utils/common.js';

function nowIso() {
  return new Date().toISOString();
}

export async function createCliAuthTables(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS cli_auth_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state_hash TEXT NOT NULL UNIQUE,
      code_hash TEXT,
      user_id INTEGER,
      role TEXT,
      username TEXT,
      mailbox_id INTEGER,
      mailbox_address TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cli_auth_codes_expires ON cli_auth_codes(expires_at);
    CREATE TABLE IF NOT EXISTS cli_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER,
      role TEXT NOT NULL,
      username TEXT NOT NULL,
      mailbox_id INTEGER,
      mailbox_address TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cli_tokens_expires ON cli_tokens(expires_at);
    CREATE INDEX IF NOT EXISTS idx_cli_tokens_user ON cli_tokens(username, role);
  `);
}

export async function createCliAuthState(db, state, expiresAt) {
  const stateHash = await sha256Hex(state);
  await db.prepare(`
    INSERT INTO cli_auth_codes (state_hash, expires_at)
    VALUES (?, ?)
  `).bind(stateHash, expiresAt).run();
  return stateHash;
}

export async function attachCliAuthCodeToState(db, { state, code, principal, expiresAt }) {
  const stateHash = await sha256Hex(state);
  const codeHash = await sha256Hex(code);
  await db.prepare(`
    UPDATE cli_auth_codes
    SET code_hash = ?, user_id = ?, role = ?, username = ?, mailbox_id = ?, mailbox_address = ?, expires_at = ?, used_at = NULL
    WHERE state_hash = ? AND used_at IS NULL
  `).bind(
    codeHash,
    principal.userId ?? null,
    principal.role,
    principal.username,
    principal.mailboxId ?? null,
    principal.mailboxAddress ?? null,
    expiresAt,
    stateHash
  ).run();
}

export async function exchangeCliCodeForToken(db, { state, code, accessToken, tokenExpiresAt }) {
  const stateHash = await sha256Hex(state);
  const codeHash = await sha256Hex(code);
  const row = await db.prepare(`
    SELECT id, user_id, role, username, mailbox_id, mailbox_address, expires_at, used_at
    FROM cli_auth_codes
    WHERE state_hash = ? AND code_hash = ?
    LIMIT 1
  `).bind(stateHash, codeHash).first();

  if (!row || row.used_at || Date.parse(row.expires_at) <= Date.now()) {
    return null;
  }

  const tokenHash = await sha256Hex(accessToken);
  await db.prepare(`
    INSERT INTO cli_tokens (token_hash, user_id, role, username, mailbox_id, mailbox_address, expires_at, last_used_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tokenHash,
    row.user_id ?? null,
    row.role,
    row.username,
    row.mailbox_id ?? null,
    row.mailbox_address ?? null,
    tokenExpiresAt,
    nowIso()
  ).run();

  await db.prepare(`
    UPDATE cli_auth_codes
    SET used_at = ?
    WHERE id = ?
  `).bind(nowIso(), row.id).run();

  return {
    accessToken,
    expiresAt: tokenExpiresAt,
    payload: {
      userId: row.user_id ?? null,
      role: row.role,
      username: row.username,
      mailboxId: row.mailbox_id ?? null,
      mailboxAddress: row.mailbox_address ?? null
    }
  };
}

export async function findCliTokenByValue(db, rawToken) {
  if (!rawToken) return null;
  const tokenHash = await sha256Hex(rawToken);
  const row = await db.prepare(`
    SELECT user_id, role, username, mailbox_id, mailbox_address, expires_at, revoked_at
    FROM cli_tokens
    WHERE token_hash = ?
    LIMIT 1
  `).bind(tokenHash).first();

  if (!row || row.revoked_at || Date.parse(row.expires_at) <= Date.now()) {
    return null;
  }

  await db.prepare(`
    UPDATE cli_tokens
    SET last_used_at = ?
    WHERE token_hash = ?
  `).bind(nowIso(), tokenHash).run();

  return {
    userId: row.user_id ?? null,
    role: row.role,
    username: row.username,
    mailboxId: row.mailbox_id ?? null,
    mailboxAddress: row.mailbox_address ?? null,
    expiresAt: row.expires_at
  };
}

export async function revokeCliTokenByValue(db, rawToken) {
  const tokenHash = await sha256Hex(rawToken);
  await db.prepare(`
    UPDATE cli_tokens
    SET revoked_at = ?
    WHERE token_hash = ?
  `).bind(nowIso(), tokenHash).run();
}
```

- [ ] **Step 4: Run the Worker storage test again**

Run: `npx tsx --test tests/worker/cli-auth-db.test.js`

Expected: PASS with 3 passing tests.

- [ ] **Step 5: Commit the storage layer**

```bash
git add package.json package-lock.json d1-init.sql src/db/init.js src/db/index.js src/db/cliAuth.js tests/worker/cli-auth-db.test.js
git commit -m "feat: add cli auth storage layer"
```

### Task 2: Add CLI auth HTTP handlers and middleware support

**Files:**
- Modify: `src/api/index.js`
- Modify: `src/middleware/auth.js`
- Create: `src/api/cliAuth.js`
- Test: `tests/worker/cli-auth-http.test.js`

- [ ] **Step 1: Write the failing HTTP and middleware tests**

```js
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

test('authMiddleware accepts CLI bearer tokens before browser cookies', async () => {
  const context = {
    request: new Request('https://freemail.test/api/mailboxes', {
      headers: { Authorization: 'Bearer cli-token' }
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
```

- [ ] **Step 2: Run the HTTP test and verify it fails**

Run: `npx tsx --test tests/worker/cli-auth-http.test.js`

Expected: FAIL because `src/api/cliAuth.js` does not exist and `authMiddleware` does not accept CLI bearer tokens.

- [ ] **Step 3: Implement the new CLI auth API surface and token-aware middleware**

`src/api/cliAuth.js`

```js
import {
  createCliAuthState,
  attachCliAuthCodeToState,
  exchangeCliCodeForToken,
  revokeCliTokenByValue
} from '../db/cliAuth.js';
import { errorResponse, jsonResponse } from './helpers.js';
import { generateRandomId } from '../utils/common.js';

function addMinutes(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function addDays(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function buildPrincipal(authPayload) {
  return {
    userId: authPayload?.userId ?? null,
    role: authPayload?.role,
    username: authPayload?.username,
    mailboxId: authPayload?.mailboxId ?? null,
    mailboxAddress: authPayload?.mailboxAddress ?? null
  };
}

export function createCliAuthHandlers(deps = {}) {
  const randomId = deps.randomId ?? (() => globalThis.crypto?.randomUUID?.() ?? generateRandomId(24));
  const createState = deps.createCliAuthState ?? createCliAuthState;
  const attachCode = deps.attachCliAuthCodeToState ?? attachCliAuthCodeToState;
  const exchangeCode = deps.exchangeCliCodeForToken ?? exchangeCliCodeForToken;
  const revokeToken = deps.revokeCliTokenByValue ?? revokeCliTokenByValue;

  async function handleCliAuthApi(request, db, url, path, options = {}) {
    if (path === '/api/cli/auth/start' && request.method === 'POST') {
      const state = randomId();
      await createState(db, state, addMinutes(5));
      return jsonResponse({
        state,
        auth_url: `${url.origin}/html/cli-auth.html?state=${encodeURIComponent(state)}`
      });
    }

    if (path === '/api/cli/auth/issue-code' && request.method === 'POST') {
      if (!options.authPayload) return errorResponse('Unauthorized', 401);
      const body = await request.json();
      const state = String(body.state || '').trim();
      if (!state) return errorResponse('缺少 state 参数', 400);

      const code = randomId().replace(/-/g, '').slice(0, 8).toUpperCase();
      await attachCode(db, {
        state,
        code,
        principal: buildPrincipal(options.authPayload),
        expiresAt: addMinutes(5)
      });
      return jsonResponse({ code, expires_at: addMinutes(5) });
    }

    if (path === '/api/cli/auth/exchange' && request.method === 'POST') {
      const body = await request.json();
      const state = String(body.state || '').trim();
      const code = String(body.code || '').trim().toUpperCase();
      if (!state || !code) return errorResponse('缺少 state 或 code 参数', 400);

      const accessToken = randomId().replace(/-/g, '') + randomId().replace(/-/g, '');
      const result = await exchangeCode(db, {
        state,
        code,
        accessToken,
        tokenExpiresAt: addDays(30)
      });

      if (!result) return errorResponse('授权码无效或已过期', 401);

      return jsonResponse({
        access_token: result.accessToken,
        token_type: 'Bearer',
        expires_at: result.expiresAt,
        username: result.payload.username,
        role: result.payload.role,
        mailbox_address: result.payload.mailboxAddress ?? null
      });
    }

    if (path === '/api/cli/session' && request.method === 'GET') {
      if (!options.authPayload) return errorResponse('Unauthorized', 401);
      return jsonResponse({
        authenticated: true,
        username: options.authPayload.username,
        role: options.authPayload.role,
        mailbox_address: options.authPayload.mailboxAddress ?? null,
        expires_at: options.authPayload.expiresAt ?? null
      });
    }

    if (path === '/api/cli/logout' && request.method === 'POST') {
      const auth = request.headers.get('Authorization') || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (!token) return errorResponse('Unauthorized', 401);
      await revokeToken(db, token);
      return jsonResponse({ success: true });
    }

    return null;
  }

  return { handleCliAuthApi };
}

export const { handleCliAuthApi } = createCliAuthHandlers();
```

`src/api/index.js`

```js
import { handleCliAuthApi } from './cliAuth.js';

export async function handleApiRequest(request, db, mailDomains, options = {
  mockOnly: false,
  resendApiKey: '',
  adminName: '',
  r2: null,
  authPayload: null,
  mailboxOnly: false
}) {
  const url = new URL(request.url);
  const path = url.pathname;

  let response = await handleCliAuthApi(request, db, url, path, options);
  if (response) return response;

  // existing handlers follow...
}
```

`src/middleware/auth.js`

```js
import { findCliTokenByValue } from '../db/cliAuth.js';

export async function resolveCliBearerPayload(request, env, deps = {}) {
  const auth = request.headers.get('Authorization') || request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || !env?.TEMP_MAIL_DB) return null;
  const lookup = deps.findCliTokenByValue ?? findCliTokenByValue;
  return await lookup(env.TEMP_MAIL_DB, token);
}

export async function authMiddleware(context, deps = {}) {
  const { request, env } = context;
  const url = new URL(request.url);

  const publicPaths = new Set([
    '/api/login',
    '/api/logout',
    '/api/cli/auth/start',
    '/api/cli/auth/exchange'
  ]);

  if (publicPaths.has(url.pathname)) {
    return null;
  }

  const cliPayload = await resolveCliBearerPayload(request, env, deps);
  if (cliPayload) {
    context.authPayload = cliPayload;
    return null;
  }

  const JWT_TOKEN = env.JWT_TOKEN || env.JWT_SECRET || '';
  const root = checkRootAdminOverride(request, JWT_TOKEN);
  if (root) {
    context.authPayload = root;
    return null;
  }

  const payload = await verifyJwtWithCache(JWT_TOKEN, request.headers.get('Cookie') || '');
  if (!payload) {
    return new Response('Unauthorized', { status: 401 });
  }

  context.authPayload = payload;
  return null;
}
```

- [ ] **Step 4: Run the HTTP and middleware tests again**

Run: `npx tsx --test tests/worker/cli-auth-http.test.js`

Expected: PASS with 3 passing tests.

- [ ] **Step 5: Commit the Worker auth API**

```bash
git add src/api/index.js src/api/cliAuth.js src/middleware/auth.js tests/worker/cli-auth-http.test.js
git commit -m "feat: add cli auth api flow"
```

### Task 3: Add the browser authorization page and asset routing

**Files:**
- Modify: `src/assets/manager.js`
- Create: `public/html/cli-auth.html`
- Create: `public/js/cli-auth.js`
- Test: `tests/worker/asset-manager-cli-auth.test.js`

- [ ] **Step 1: Write the failing asset-manager test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssetManager } from '../../src/assets/index.js';

test('asset manager allows CLI auth assets and short route alias', () => {
  const manager = createAssetManager();

  assert.equal(manager.isPathAllowed('/html/cli-auth.html'), true);
  assert.equal(manager.isPathAllowed('/js/cli-auth.js'), true);

  const mapped = manager.handlePathMapping(
    new Request('https://freemail.test/cli-auth'),
    new URL('https://freemail.test/cli-auth')
  );

  assert.equal(new URL(mapped.url).pathname, '/html/cli-auth.html');
});
```

- [ ] **Step 2: Run the asset-manager test and verify it fails**

Run: `npx tsx --test tests/worker/asset-manager-cli-auth.test.js`

Expected: FAIL because the new page and alias are not yet whitelisted.

- [ ] **Step 3: Add the CLI auth page, its browser script, and the asset-manager allowlist**

`src/assets/manager.js`

```js
this.allowedPaths = new Set([
  '/',
  '/index.html',
  '/login',
  '/login.html',
  '/cli-auth',
  '/html/cli-auth.html',
  '/js/cli-auth.js',
  '/admin.html',
  '/html/mailboxes.html',
  '/mailboxes.html',
  '/mailbox.html',
  '/html/mailbox.html',
  '/templates/app.html',
  '/templates/footer.html',
  '/templates/loading.html',
  '/templates/loading-inline.html',
  '/templates/toast.html',
  '/app.js',
  '/app.css',
  '/admin.js',
  '/admin.css',
  '/login.js',
  '/login.css',
  '/mailbox.js',
  '/mock.js',
  '/favicon.svg',
  '/route-guard.js',
  '/app-router.js',
  '/app-mobile.js',
  '/app-mobile.css',
  '/mailbox.css',
  '/auth-guard.js',
  '/storage.js'
]);

if (url.pathname === '/cli-auth') {
  targetUrl = new URL('/html/cli-auth.html', url).toString();
}
```

`public/html/cli-auth.html`

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CLI 授权 - Freemail</title>
    <link rel="stylesheet" href="/css/login.css" />
  </head>
  <body>
    <div class="center">
      <div class="card">
        <h1>CLI 授权</h1>
        <p id="status" class="err" style="color:#64748b">正在检查登录状态…</p>
        <div id="code-block" style="display:none">
          <p>请把下面的一次性授权码粘贴回 CLI：</p>
          <pre id="code" style="font-size:28px;font-weight:700;letter-spacing:4px"></pre>
          <button id="copy" class="btn">复制授权码</button>
        </div>
      </div>
    </div>
    <script src="/js/cli-auth.js"></script>
  </body>
</html>
```

`public/js/cli-auth.js`

```js
const statusEl = document.getElementById('status');
const codeBlock = document.getElementById('code-block');
const codeEl = document.getElementById('code');
const copyBtn = document.getElementById('copy');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#dc2626' : '#64748b';
}

async function bootstrapCliAuth() {
  const url = new URL(location.href);
  const state = String(url.searchParams.get('state') || '').trim();

  if (!state) {
    setStatus('缺少 CLI 授权 state 参数', true);
    return;
  }

  const sessionResponse = await fetch('/api/session', { credentials: 'include' });
  if (!sessionResponse.ok) {
    const redirect = `/html/cli-auth.html?state=${encodeURIComponent(state)}`;
    location.replace(`/login.html?redirect=${encodeURIComponent(redirect)}`);
    return;
  }

  setStatus('正在生成授权码…');
  const codeResponse = await fetch('/api/cli/auth/issue-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ state })
  });

  if (!codeResponse.ok) {
    setStatus('授权码生成失败，请返回终端重试', true);
    return;
  }

  const body = await codeResponse.json();
  codeEl.textContent = body.code;
  codeBlock.style.display = 'block';
  setStatus('授权码已生成，有效期 5 分钟。');
}

copyBtn?.addEventListener('click', async () => {
  const code = codeEl.textContent || '';
  if (!code) return;
  await navigator.clipboard.writeText(code);
  setStatus('授权码已复制，可以返回终端继续。');
});

bootstrapCliAuth().catch(() => {
  setStatus('CLI 授权页加载失败，请刷新页面重试', true);
});
```

- [ ] **Step 4: Run the asset-manager test again**

Run: `npx tsx --test tests/worker/asset-manager-cli-auth.test.js`

Expected: PASS with 1 passing test.

- [ ] **Step 5: Commit the browser auth page**

```bash
git add src/assets/manager.js public/html/cli-auth.html public/js/cli-auth.js tests/worker/asset-manager-cli-auth.test.js
git commit -m "feat: add cli authorization page"
```

### Task 4: Scaffold the CLI package and implement auth commands

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/.gitignore`
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/api.ts`
- Create: `packages/cli/src/browser.ts`
- Create: `packages/cli/src/config.ts`
- Create: `packages/cli/src/output.ts`
- Create: `packages/cli/src/commands/auth.ts`
- Test: `packages/cli/tests/auth.test.ts`

- [ ] **Step 1: Write the failing CLI auth-package test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { loadConfig, saveConfig } from '../src/config.ts';
import { exchangeAuthCode, getSessionStatus } from '../src/commands/auth.ts';

test('saveConfig round-trips the persisted CLI session', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'freemail-cli-'));

  await saveConfig({
    baseUrl: 'https://freemail.test',
    accessToken: 'cli-token',
    username: 'alice',
    role: 'user',
    expiresAt: '2099-01-01T00:00:00.000Z'
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
        body: String(init?.body || '')
      });
      return new Response(JSON.stringify({
        access_token: 'cli-token',
        token_type: 'Bearer',
        expires_at: '2099-01-01T00:00:00.000Z',
        username: 'alice',
        role: 'user',
        mailbox_address: null
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
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
      expires_at: '2099-01-01T00:00:00.000Z'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  });

  assert.equal(status.username, 'alice');
  assert.equal(status.role, 'user');
});
```

- [ ] **Step 2: Run the CLI auth-package test and verify it fails**

Run: `npx tsx --test packages/cli/tests/auth.test.ts`

Expected: FAIL because `packages/cli` and its source files do not exist.

- [ ] **Step 3: Scaffold the package and implement auth login/status/logout**

`packages/cli/package.json`

```json
{
  "name": "@freemail/cli",
  "version": "0.1.0",
  "description": "Agent-friendly CLI for Freemail",
  "type": "module",
  "bin": {
    "freemail": "dist/index.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx src/index.ts",
    "test": "tsx --test tests/**/*.test.ts"
  },
  "files": [
    "dist"
  ],
  "license": "Apache-2.0",
  "dependencies": {
    "commander": "^12.1.0"
  },
  "devDependencies": {
    "tsx": "^4.20.3",
    "typescript": "^5.6.3"
  }
}
```

`packages/cli/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false
  },
  "include": ["src/**/*.ts"]
}
```

`packages/cli/.gitignore`

```gitignore
dist/
```

`packages/cli/src/config.ts`

```ts
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface CliConfig {
  baseUrl: string;
  accessToken: string;
  username: string;
  role: string;
  expiresAt: string;
  mailboxAddress?: string | null;
}

function resolveConfigPath(configDir?: string) {
  const dir = configDir ?? path.join(os.homedir(), '.freemail');
  return { dir, file: path.join(dir, 'config.json') };
}

export async function loadConfig(options: { configDir?: string } = {}): Promise<CliConfig> {
  const { file } = resolveConfigPath(options.configDir);
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw) as CliConfig;
}

export async function saveConfig(config: CliConfig, options: { configDir?: string } = {}): Promise<void> {
  const { dir, file } = resolveConfigPath(options.configDir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(config, null, 2), 'utf8');
}

export async function clearConfig(options: { configDir?: string } = {}): Promise<void> {
  const { file } = resolveConfigPath(options.configDir);
  await fs.rm(file, { force: true });
}
```

`packages/cli/src/api.ts`

```ts
export interface CliSessionResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_at: string;
  username: string;
  role: string;
  mailbox_address: string | null;
}

export async function requestJson<T>(url: string, init: RequestInit, fetchImpl: typeof fetch = fetch): Promise<T> {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}
```

`packages/cli/src/browser.ts`

```ts
import { spawn } from 'node:child_process';

export async function openUrl(url: string): Promise<void> {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true });
    return;
  }

  if (process.platform === 'darwin') {
    spawn('open', [url], { stdio: 'ignore', detached: true });
    return;
  }

  spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
}
```

`packages/cli/src/output.ts`

```ts
export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printLine(value: string): void {
  process.stdout.write(`${value}\n`);
}
```

`packages/cli/src/commands/auth.ts`

```ts
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { clearConfig, loadConfig, saveConfig } from '../config.js';
import { requestJson, type CliSessionResponse } from '../api.js';
import { openUrl } from '../browser.js';
import { printJson, printLine } from '../output.js';

export async function exchangeAuthCode({
  baseUrl,
  state,
  code,
  fetchImpl = fetch
}: {
  baseUrl: string;
  state: string;
  code: string;
  fetchImpl?: typeof fetch;
}) {
  const body = await requestJson<CliSessionResponse>(
    `${baseUrl}/api/cli/auth/exchange`,
    {
      method: 'POST',
      body: JSON.stringify({ state, code })
    },
    fetchImpl
  );

  return {
    baseUrl,
    accessToken: body.access_token,
    username: body.username,
    role: body.role,
    expiresAt: body.expires_at,
    mailboxAddress: body.mailbox_address
  };
}

export async function getSessionStatus({
  baseUrl,
  accessToken,
  fetchImpl = fetch
}: {
  baseUrl: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}) {
  return requestJson<{
    authenticated: boolean;
    username: string;
    role: string;
    expires_at?: string;
    mailbox_address?: string | null;
  }>(`${baseUrl}/api/cli/session`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  }, fetchImpl);
}

export async function loginAction(baseUrl: string): Promise<void> {
  const start = await requestJson<{ state: string; auth_url: string }>(`${baseUrl}/api/cli/auth/start`, {
    method: 'POST',
    body: JSON.stringify({})
  });

  await openUrl(start.auth_url);
  printLine(`已打开浏览器：${start.auth_url}`);

  const rl = createInterface({ input, output });
  const code = (await rl.question('请输入网页显示的一次性授权码: ')).trim().toUpperCase();
  rl.close();

  const session = await exchangeAuthCode({ baseUrl, state: start.state, code });
  await saveConfig(session);
  printLine(`登录成功：${session.username} (${session.role})`);
}

export async function statusAction(json = false): Promise<void> {
  const config = await loadConfig();
  const remote = await getSessionStatus({
    baseUrl: config.baseUrl,
    accessToken: config.accessToken
  });
  if (json) {
    printJson({
      ...config,
      authenticated: remote.authenticated,
      mailboxAddress: remote.mailbox_address ?? config.mailboxAddress ?? null
    });
    return;
  }
  printLine(`当前用户: ${remote.username}`);
  printLine(`角色: ${remote.role}`);
  printLine(`过期时间: ${remote.expires_at ?? config.expiresAt}`);
}

export async function logoutAction(): Promise<void> {
  const config = await loadConfig();
  await fetch(`${config.baseUrl}/api/cli/logout`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.accessToken}`
    }
  });
  await clearConfig();
  printLine('已退出 CLI 登录态');
}
```

`packages/cli/src/index.ts`

```ts
#!/usr/bin/env node
import { Command } from 'commander';
import { loginAction, logoutAction, statusAction } from './commands/auth.js';

const program = new Command();
program.name('freemail').description('Freemail CLI');

const auth = program.command('auth').description('CLI authentication commands');
auth.command('login')
  .requiredOption('--base-url <url>', 'Freemail deployment URL')
  .action(async ({ baseUrl }) => {
    await loginAction(baseUrl);
  });

auth.command('status')
  .option('--json', 'Print JSON session output')
  .action(async ({ json }) => {
    await statusAction(Boolean(json));
  });

auth.command('logout')
  .action(async () => {
    await logoutAction();
  });

await program.parseAsync(process.argv);
```

- [ ] **Step 4: Run the CLI auth-package test again**

Run: `npx tsx --test packages/cli/tests/auth.test.ts`

Expected: PASS with 3 passing tests.

- [ ] **Step 5: Commit the CLI scaffold and auth commands**

```bash
git add packages/cli
git commit -m "feat: scaffold freemail cli auth commands"
```

### Task 5: Implement `list`, `read`, and `wait`

**Files:**
- Modify: `packages/cli/src/api.ts`
- Modify: `packages/cli/src/index.ts`
- Create: `packages/cli/src/commands/list.ts`
- Create: `packages/cli/src/commands/read.ts`
- Create: `packages/cli/src/commands/wait.ts`
- Test: `packages/cli/tests/mail-commands.test.ts`

- [ ] **Step 1: Write the failing mailbox-command tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { listMailboxes } from '../src/commands/list.js';
import { readMessage } from '../src/commands/read.js';
import { waitForMessage } from '../src/commands/wait.js';

test('listMailboxes unwraps the { list, total } payload', async () => {
  const rows = await listMailboxes({
    listMailboxes: async () => ({
      list: [{ address: 'one@example.com' }, { address: 'two@example.com' }],
      total: 2
    })
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].address, 'one@example.com');
});

test('readMessage returns the HTML-safe payload from the Worker', async () => {
  const message = await readMessage({
    getMessage: async () => ({
      id: 42,
      sender: 'sender@example.com',
      subject: '验证码',
      verification_code: '123456',
      content: 'plain text body'
    })
  }, 42);

  assert.equal(message.id, 42);
  assert.equal(message.verification_code, '123456');
});

test('waitForMessage ignores existing messages and returns the first new one', async () => {
  let calls = 0;
  const message = await waitForMessage({
    listEmails: async () => {
      calls += 1;
      if (calls === 1) return [{ id: 1, subject: 'existing' }];
      return [{ id: 2, subject: 'new message' }, { id: 1, subject: 'existing' }];
    }
  }, 'box@example.com', {
    timeoutSeconds: 5,
    intervalSeconds: 0,
    sleep: async () => {}
  });

  assert.equal(message?.id, 2);
  assert.equal(message?.subject, 'new message');
});

test('waitForMessage returns null on timeout instead of throwing', async () => {
  const message = await waitForMessage({
    listEmails: async () => [{ id: 1, subject: 'existing' }]
  }, 'box@example.com', {
    timeoutSeconds: 0,
    intervalSeconds: 0,
    sleep: async () => {}
  });

  assert.equal(message, null);
});
```

- [ ] **Step 2: Run the mailbox-command tests and verify they fail**

Run: `npx tsx --test packages/cli/tests/mail-commands.test.ts`

Expected: FAIL because the command modules do not exist.

- [ ] **Step 3: Implement the authenticated API client and the three read-path commands**

`packages/cli/src/api.ts`

```ts
import { loadConfig } from './config.js';

export interface FreemailClient {
  listMailboxes(): Promise<{ list: Array<Record<string, unknown>>; total: number }>;
  listEmails(mailbox: string, limit?: number): Promise<Array<Record<string, any>>>;
  getMessage(id: number): Promise<Record<string, any>>;
  createRandomMailbox(length?: number, domainIndex?: number): Promise<Record<string, any>>;
}

export function createClient(fetchImpl: typeof fetch = fetch): FreemailClient {
  async function authedJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const config = await loadConfig();
    return requestJson<T>(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        ...(init.headers ?? {})
      }
    }, fetchImpl);
  }

  return {
    listMailboxes() {
      return authedJson('/api/mailboxes');
    },
    listEmails(mailbox: string, limit = 20) {
      const search = new URLSearchParams({ mailbox, limit: String(limit) });
      return authedJson(`/api/emails?${search.toString()}`);
    },
    getMessage(id: number) {
      return authedJson(`/api/email/${id}`);
    },
    createRandomMailbox(length?: number, domainIndex?: number) {
      const search = new URLSearchParams();
      if (length) search.set('length', String(length));
      if (domainIndex !== undefined) search.set('domainIndex', String(domainIndex));
      const suffix = search.toString();
      return authedJson(`/api/generate${suffix ? `?${suffix}` : ''}`);
    }
  };
}
```

`packages/cli/src/commands/list.ts`

```ts
import { createClient, type FreemailClient } from '../api.js';
import { printJson, printLine } from '../output.js';

export async function listMailboxes(client: Pick<FreemailClient, 'listMailboxes'> = createClient()) {
  const response = await client.listMailboxes();
  return response.list ?? [];
}

export async function listAction(json = false): Promise<void> {
  const rows = await listMailboxes();
  if (json) {
    printJson(rows);
    return;
  }
  for (const row of rows) {
    printLine(`${row.address}`);
  }
}
```

`packages/cli/src/commands/read.ts`

```ts
import { createClient, type FreemailClient } from '../api.js';
import { printJson, printLine } from '../output.js';

export async function readMessage(client: Pick<FreemailClient, 'getMessage'> = createClient(), id: number) {
  return client.getMessage(id);
}

export async function readAction(id: number, json = false): Promise<void> {
  const message = await readMessage(createClient(), id);
  if (json) {
    printJson(message);
    return;
  }
  printLine(`From: ${message.sender}`);
  printLine(`Subject: ${message.subject}`);
  printLine(`Verification Code: ${message.verification_code ?? ''}`);
  printLine('');
  printLine(String(message.content || message.html_content || ''));
}
```

`packages/cli/src/commands/wait.ts`

```ts
import { createClient, type FreemailClient } from '../api.js';
import { printJson, printLine } from '../output.js';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitForMessage(
  client: Pick<FreemailClient, 'listEmails'> = createClient(),
  mailbox: string,
  options: {
    timeoutSeconds: number;
    intervalSeconds: number;
    sleep?: (ms: number) => Promise<void>;
  }
) {
  const doSleep = options.sleep ?? sleep;
  const baseline = new Set((await client.listEmails(mailbox, 20)).map(row => Number(row.id)));
  const deadline = Date.now() + options.timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    await doSleep(options.intervalSeconds * 1000);
    const rows = await client.listEmails(mailbox, 20);
    const fresh = rows.find(row => !baseline.has(Number(row.id)));
    if (fresh) return fresh;
  }

  return null;
}

export async function waitAction(mailbox: string, timeoutSeconds: number, intervalSeconds: number, json = false): Promise<void> {
  const message = await waitForMessage(createClient(), mailbox, { timeoutSeconds, intervalSeconds });
  if (!message) {
    if (json) {
      printJson({ timeout: true, mailbox });
      return;
    }
    printLine(`No new message arrived for ${mailbox} before timeout`);
    return;
  }
  if (json) {
    printJson(message);
    return;
  }
  printLine(`${message.id} ${message.subject}`);
}
```

`packages/cli/src/index.ts`

```ts
import { listAction } from './commands/list.js';
import { readAction } from './commands/read.js';
import { waitAction } from './commands/wait.js';

program.command('list')
  .option('--json', 'Print JSON output')
  .action(async ({ json }) => {
    await listAction(Boolean(json));
  });

program.command('read')
  .requiredOption('--id <messageId>', 'Message ID')
  .option('--json', 'Print JSON output')
  .action(async ({ id, json }) => {
    await readAction(Number(id), Boolean(json));
  });

program.command('wait')
  .requiredOption('--mailbox <address>', 'Mailbox address to poll')
  .option('--timeout <seconds>', 'Timeout in seconds', '120')
  .option('--interval <seconds>', 'Polling interval in seconds', '3')
  .option('--json', 'Print JSON output')
  .action(async ({ mailbox, timeout, interval, json }) => {
    await waitAction(mailbox, Number(timeout), Number(interval), Boolean(json));
  });
```

- [ ] **Step 4: Run the mailbox-command tests again**

Run: `npx tsx --test packages/cli/tests/mail-commands.test.ts`

Expected: PASS with 4 passing tests.

- [ ] **Step 5: Commit the read-path commands**

```bash
git add packages/cli/src/api.ts packages/cli/src/index.ts packages/cli/src/commands/list.ts packages/cli/src/commands/read.ts packages/cli/src/commands/wait.ts packages/cli/tests/mail-commands.test.ts
git commit -m "feat: add freemail cli mailbox read commands"
```

### Task 6: Implement `create`, update docs, and verify the whole slice

**Files:**
- Modify: `packages/cli/src/index.ts`
- Create: `packages/cli/src/commands/create.ts`
- Modify: `packages/cli/README.md`
- Modify: `README.md`
- Modify: `docs/api.md`
- Test: `packages/cli/tests/create-command.test.ts`

- [ ] **Step 1: Write the failing `create` command test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMailbox } from '../src/commands/create.js';

test('createMailbox forwards length and domainIndex to the Worker', async () => {
  const calls: Array<{ length?: number; domainIndex?: number }> = [];

  const result = await createMailbox({
    createRandomMailbox: async (length?: number, domainIndex?: number) => {
      calls.push({ length, domainIndex });
      return { email: 'abc123@example.com', expires: 1700000000000 };
    }
  }, { length: 12, domainIndex: 1 });

  assert.equal(result.email, 'abc123@example.com');
  assert.deepEqual(calls[0], { length: 12, domainIndex: 1 });
});
```

- [ ] **Step 2: Run the `create` test and verify it fails**

Run: `npx tsx --test packages/cli/tests/create-command.test.ts`

Expected: FAIL because `packages/cli/src/commands/create.ts` does not exist.

- [ ] **Step 3: Implement `create`, finish CLI docs, and document the new auth endpoints**

`packages/cli/src/commands/create.ts`

```ts
import { createClient, type FreemailClient } from '../api.js';
import { printJson, printLine } from '../output.js';

export async function createMailbox(
  client: Pick<FreemailClient, 'createRandomMailbox'> = createClient(),
  options: { length?: number; domainIndex?: number } = {}
) {
  return client.createRandomMailbox(options.length, options.domainIndex);
}

export async function createAction(length?: number, domainIndex?: number, json = false): Promise<void> {
  const mailbox = await createMailbox(createClient(), { length, domainIndex });
  if (json) {
    printJson(mailbox);
    return;
  }
  printLine(`Email: ${mailbox.email}`);
  printLine(`Expires: ${new Date(mailbox.expires).toISOString()}`);
}
```

`packages/cli/src/index.ts`

```ts
import { createAction } from './commands/create.js';

program.command('create')
  .option('--length <count>', 'Random local-part length')
  .option('--domain-index <index>', 'MAIL_DOMAIN index to target')
  .option('--json', 'Print JSON output')
  .action(async ({ length, domainIndex, json }) => {
    await createAction(
      length ? Number(length) : undefined,
      domainIndex !== undefined ? Number(domainIndex) : undefined,
      Boolean(json)
    );
  });
```

`packages/cli/README.md`

````md
# Freemail CLI

Install:

```bash
npm install --prefix packages/cli
npm --prefix packages/cli run build
```

Authentication:

```bash
node packages/cli/dist/index.js auth login --base-url https://your.freemail.domain
node packages/cli/dist/index.js auth status
node packages/cli/dist/index.js auth logout
```

Mailbox commands:

```bash
node packages/cli/dist/index.js create --json
node packages/cli/dist/index.js list --json
node packages/cli/dist/index.js wait --mailbox box@example.com --timeout 120 --json
node packages/cli/dist/index.js read --id 42 --json
```
````

`README.md`

```md
📖 **[一键部署指南](docs/yijianbushu.md)** | 🤖 **[Github Action 部署指南](docs/action-deployment.md)** | 💻 **[CLI 用法](packages/cli/README.md)** | 📬 **[Resend 发件配置](docs/resend.md)** | 📚 **[API 文档](docs/api.md)**
```

`docs/api.md`

```md
## CLI 认证接口

### POST /api/cli/auth/start
创建 CLI 授权会话，返回浏览器授权页地址与 `state`。

### POST /api/cli/auth/issue-code
在浏览器用户已登录时为指定 `state` 生成一次性授权码。

### POST /api/cli/auth/exchange
使用 `state + code` 交换为 CLI bearer token。

### GET /api/cli/session
返回当前 CLI bearer token 对应的登录主体。

### POST /api/cli/logout
吊销当前 CLI bearer token。
```

- [ ] **Step 4: Run the package test suite, build the CLI, and do the final verification**

Run: `npx tsx --test packages/cli/tests/auth.test.ts packages/cli/tests/mail-commands.test.ts packages/cli/tests/create-command.test.ts`
Expected: PASS with 8 passing tests.

Run: `npm --prefix packages/cli run build`
Expected: PASS and emit `packages/cli/dist/index.js`.

Run: `npm run test:worker`
Expected: PASS with Worker-side CLI auth tests green.

Manual verification:

```bash
# 1. Start the Worker locally or point to a deployed environment.
# 2. Authenticate in the browser.
node packages/cli/dist/index.js auth login --base-url https://your.freemail.domain

# 3. Exercise the first command set.
node packages/cli/dist/index.js create --json
node packages/cli/dist/index.js list --json
node packages/cli/dist/index.js wait --mailbox your-box@example.com --timeout 30 --json
node packages/cli/dist/index.js read --id 1 --json
```

Expected:

- browser opens to the CLI auth page
- one-time code exchange succeeds
- CLI session is stored under `~/.freemail/config.json`
- create/list/read commands return Worker data
- wait times out cleanly when no new message arrives and returns the first fresh message when one does

- [ ] **Step 5: Commit the CLI V1 slice**

```bash
git add packages/cli README.md docs/api.md
git commit -m "feat: add freemail cli v1 commands"
```
