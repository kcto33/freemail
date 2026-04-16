import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attachCliAuthCodeToState,
  createCliAuthState,
  exchangeCliCodeForToken,
  findCliTokenByValue,
  revokeCliTokenByValue,
} from '../../src/db/cliAuth.js';
import { initDatabase, setupDatabase } from '../../src/db/init.js';
import { sha256Hex } from '../../src/utils/common.js';

function createMockDb() {
  const tables = new Set();
  const rows = {
    cli_auth_states: [],
    cli_auth_codes: [],
    cli_tokens: [],
  };
  const execCalls = [];

  return {
    tables,
    rows,
    execCalls,
    prepare(sql) {
      const bindings = [];
      return {
        bind(...args) {
          bindings.splice(0, bindings.length, ...args);
          return this;
        },
        async all() {
          if (/PRAGMA table_info\(mailboxes\)/i.test(sql)) {
            return { results: [{ name: 'id' }, { name: 'address' }, { name: 'local_part' }, { name: 'domain' }, { name: 'password_hash' }, { name: 'created_at' }, { name: 'last_accessed_at' }, { name: 'expires_at' }, { name: 'is_pinned' }, { name: 'can_login' }, { name: 'forward_to' }, { name: 'is_favorite' }] };
          }
          if (/SELECT 1 FROM mailboxes LIMIT 1/i.test(sql)) {
            if (!tables.has('mailboxes')) throw new Error('no such table: mailboxes');
            return { results: [{ 1: 1 }] };
          }
          if (/SELECT 1 FROM messages LIMIT 1/i.test(sql)) {
            if (!tables.has('messages')) throw new Error('no such table: messages');
            return { results: [{ 1: 1 }] };
          }
          if (/SELECT 1 FROM users LIMIT 1/i.test(sql)) {
            if (!tables.has('users')) throw new Error('no such table: users');
            return { results: [{ 1: 1 }] };
          }
          if (/SELECT 1 FROM user_mailboxes LIMIT 1/i.test(sql)) {
            if (!tables.has('user_mailboxes')) throw new Error('no such table: user_mailboxes');
            return { results: [{ 1: 1 }] };
          }
          if (/SELECT 1 FROM sent_emails LIMIT 1/i.test(sql)) {
            if (!tables.has('sent_emails')) throw new Error('no such table: sent_emails');
            return { results: [{ 1: 1 }] };
          }
          if (/FROM cli_auth_states WHERE state_hash = \?/i.test(sql)) {
            const [stateHash] = bindings;
            const row = rows.cli_auth_states.find((entry) => entry.state_hash === stateHash);
            return { results: row ? [row] : [] };
          }
          if (/FROM cli_auth_codes WHERE code_hash = \?/i.test(sql)) {
            const [codeHash] = bindings;
            const row = rows.cli_auth_codes.find((entry) => entry.code_hash === codeHash);
            return { results: row ? [row] : [] };
          }
          if (/FROM cli_tokens WHERE token_hash = \?/i.test(sql)) {
            const [tokenHash] = bindings;
            const row = rows.cli_tokens.find((entry) => entry.token_hash === tokenHash);
            return { results: row ? [row] : [] };
          }
          return { results: [] };
        },
        async get() {
          const result = await this.all();
          return result.results[0] || null;
        },
        async run() {
          if (/INSERT INTO cli_auth_states/i.test(sql)) {
            rows.cli_auth_states.push({
              state_hash: bindings[0],
              user_id: bindings[1],
              created_at: bindings[2],
              expires_at: bindings[3],
            });
          }
          if (/UPDATE cli_auth_states SET code_hash = \?/i.test(sql)) {
            const row = rows.cli_auth_states.find((entry) => entry.state_hash === bindings[1]);
            if (row) {
              row.code_hash = bindings[0];
              row.code_created_at = bindings[2];
              row.code_expires_at = bindings[3];
            }
          }
          if (/UPDATE cli_auth_codes SET consumed_at = \?, token_hash = \?/i.test(sql)) {
            const row = rows.cli_auth_codes.find((entry) => entry.code_hash === bindings[2]);
            if (row) {
              row.consumed_at = bindings[0];
              row.token_hash = bindings[1];
            }
          }
          if (/INSERT INTO cli_auth_codes/i.test(sql)) {
            rows.cli_auth_codes.push({
              code_hash: bindings[0],
              state_hash: bindings[1],
              user_id: bindings[2],
              created_at: bindings[3],
              expires_at: bindings[4],
            });
          }
          if (/INSERT INTO cli_tokens/i.test(sql)) {
            rows.cli_tokens.push({
              token_hash: bindings[0],
              user_id: bindings[1],
              created_at: bindings[2],
              expires_at: bindings[3],
              revoked_at: null,
            });
          }
          if (/UPDATE cli_tokens SET revoked_at = CURRENT_TIMESTAMP/i.test(sql)) {
            const row = rows.cli_tokens.find((entry) => entry.token_hash === bindings[0]);
            if (row) row.revoked_at = 'now';
          }
          return { success: true };
        },
      };
    },
    async exec(sql) {
      execCalls.push(sql);
      if (/CREATE TABLE IF NOT EXISTS cli_auth_states/i.test(sql)) tables.add('cli_auth_states');
      if (/CREATE TABLE IF NOT EXISTS cli_auth_codes/i.test(sql)) tables.add('cli_auth_codes');
      if (/CREATE TABLE IF NOT EXISTS cli_tokens/i.test(sql)) tables.add('cli_tokens');
      if (/CREATE TABLE IF NOT EXISTS mailboxes/i.test(sql)) tables.add('mailboxes');
      if (/CREATE TABLE IF NOT EXISTS messages/i.test(sql)) tables.add('messages');
      if (/CREATE TABLE IF NOT EXISTS users/i.test(sql)) tables.add('users');
      if (/CREATE TABLE IF NOT EXISTS user_mailboxes/i.test(sql)) tables.add('user_mailboxes');
      if (/CREATE TABLE IF NOT EXISTS sent_emails/i.test(sql)) tables.add('sent_emails');
      return { success: true };
    },
  };
}

function setRowExpiresAt(rows, table, hashField, hashValue, expiresAt) {
  const row = rows[table].find((entry) => entry[hashField] === hashValue);
  if (row) {
    row.expires_at = expiresAt;
  }
}

test('creates, exchanges, looks up, and revokes CLI auth records', async () => {
  const db = createMockDb();

  const state = await createCliAuthState(db, { userId: 7, expiresInSeconds: 600 });
  assert.match(state.state, /^[a-zA-Z0-9_-]+$/);
  assert.match(state.rawState, /^[a-zA-Z0-9_-]+$/);
  assert.equal(db.rows.cli_auth_states[0].state_hash, await sha256Hex(state.state));

  const attached = await attachCliAuthCodeToState(db, state.state, { userId: 7, code: 'cli-code-1', expiresInSeconds: 600 });
  assert.equal(attached.userId, 7);
  assert.match(attached.code, /^[a-zA-Z0-9_-]+$/);
  assert.match(attached.rawCode, /^[a-zA-Z0-9_-]+$/);
  assert.equal(db.rows.cli_auth_codes[0].code_hash, await sha256Hex(attached.code));

  const token = await exchangeCliCodeForToken(db, attached.rawCode, { userId: 7, tokenValue: 'cli-token-1', expiresInSeconds: 3600 });
  assert.equal(token.userId, 7);
  assert.match(token.token, /^[a-zA-Z0-9_-]+$/);
  assert.match(token.rawToken, /^[a-zA-Z0-9_-]+$/);
  assert.equal(db.rows.cli_tokens[0].token_hash, await sha256Hex(token.token));

  const found = await findCliTokenByValue(db, token.rawToken);
  assert.equal(found.userId, 7);
  assert.equal(found.revokedAt, null);

  await revokeCliTokenByValue(db, token.rawToken);
  const revoked = await findCliTokenByValue(db, token.rawToken);
  assert.equal(revoked, null);
});

test('rejects expired state, expired code, code replay, and expired token', async () => {
  const db = createMockDb();
  const expired = '2000-01-01T00:00:00.000Z';

  const state = await createCliAuthState(db, { userId: 7, expiresInSeconds: 600 });
  setRowExpiresAt(db.rows, 'cli_auth_states', 'state_hash', await sha256Hex(state.state), expired);
  await assert.rejects(
    () => attachCliAuthCodeToState(db, state.state, { userId: 7, code: 'cli-code-expired' }),
    /expired|过期/i
  );

  const freshState = await createCliAuthState(db, { userId: 7, expiresInSeconds: 600 });
  const attached = await attachCliAuthCodeToState(db, freshState.state, { userId: 7, code: 'cli-code-2', expiresInSeconds: 600 });
  setRowExpiresAt(db.rows, 'cli_auth_codes', 'code_hash', await sha256Hex(attached.code), expired);
  await assert.rejects(
    () => exchangeCliCodeForToken(db, attached.rawCode, { userId: 7, tokenValue: 'cli-token-expired' }),
    /expired|过期/i
  );

  const replayState = await createCliAuthState(db, { userId: 7, expiresInSeconds: 600 });
  const replayAttached = await attachCliAuthCodeToState(db, replayState.state, { userId: 7, code: 'cli-code-replay', expiresInSeconds: 600 });
  await exchangeCliCodeForToken(db, replayAttached.rawCode, { userId: 7, tokenValue: 'cli-token-replay' });
  await assert.rejects(
    () => exchangeCliCodeForToken(db, replayAttached.rawCode, { userId: 7, tokenValue: 'cli-token-replay-2' }),
    /used|consumed|replay|已使用|过期/i
  );

  const tokenState = await createCliAuthState(db, { userId: 7, expiresInSeconds: 600 });
  const tokenAttached = await attachCliAuthCodeToState(db, tokenState.state, { userId: 7, code: 'cli-code-token', expiresInSeconds: 600 });
  const token = await exchangeCliCodeForToken(db, tokenAttached.rawCode, { userId: 7, tokenValue: 'cli-token-expiry', expiresInSeconds: 3600 });
  setRowExpiresAt(db.rows, 'cli_tokens', 'token_hash', await sha256Hex(token.token), expired);
  assert.equal(await findCliTokenByValue(db, token.rawToken), null);
});

test('adds CLI auth tables during database initialization and setup', async () => {
  const db = createMockDb();
  await initDatabase(db);
  await setupDatabase(db);

  const ddl = db.execCalls.join('\n');
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS cli_auth_states/i);
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS cli_auth_codes/i);
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS cli_tokens/i);
  assert.match(ddl, /CREATE INDEX IF NOT EXISTS idx_cli_auth_codes_state_hash/i);
  assert.match(ddl, /CREATE INDEX IF NOT EXISTS idx_cli_tokens_token_hash/i);
});
