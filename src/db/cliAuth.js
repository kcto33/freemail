/**
 * CLI auth 数据库操作模块
 * @module db/cliAuth
 */

import { sha256Hex } from '../utils/common.js';

function nowIso() {
  return new Date().toISOString();
}

function addSecondsIso(seconds) {
  const value = Number(seconds || 0);
  return new Date(Date.now() + Math.max(0, value) * 1000).toISOString();
}

function isExpired(expiresAt) {
  if (!expiresAt) return true;
  const ts = Date.parse(expiresAt);
  if (Number.isNaN(ts)) return true;
  return ts <= Date.now();
}

function randomTokenValue(prefix = 'cli') {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) {
    out += String.fromCharCode(byte);
  }
  const base64 = btoa(out).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `${prefix}_${base64}`;
}

async function insertRow(db, sql, values) {
  return await db.prepare(sql).bind(...values).run();
}

async function fetchOne(db, sql, values) {
  const result = await db.prepare(sql).bind(...values).all();
  return result?.results?.[0] || null;
}

/**
 * 创建 CLI auth 相关表和索引
 * @param {object} db - 数据库连接对象
 * @returns {Promise<void>}
 */
export async function createCliAuthTables(db) {
  const statements = [
    'CREATE TABLE IF NOT EXISTS cli_auth_states (id INTEGER PRIMARY KEY AUTOINCREMENT, state_hash TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL, code_hash TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL, code_created_at TEXT, code_expires_at TEXT, code_used_at TEXT)',
    'CREATE TABLE IF NOT EXISTS cli_auth_codes (id INTEGER PRIMARY KEY AUTOINCREMENT, code_hash TEXT NOT NULL UNIQUE, state_hash TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL, consumed_at TEXT, token_hash TEXT)',
    'CREATE TABLE IF NOT EXISTS cli_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, token_hash TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL, revoked_at TEXT)',
    'CREATE INDEX IF NOT EXISTS idx_cli_auth_states_user_id ON cli_auth_states(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_cli_auth_states_expires_at ON cli_auth_states(expires_at)',
    'CREATE INDEX IF NOT EXISTS idx_cli_auth_codes_state_hash ON cli_auth_codes(state_hash)',
    'CREATE INDEX IF NOT EXISTS idx_cli_auth_codes_code_hash ON cli_auth_codes(code_hash)',
    'CREATE INDEX IF NOT EXISTS idx_cli_tokens_user_id ON cli_tokens(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_cli_tokens_token_hash ON cli_tokens(token_hash)',
  ];

  for (const statement of statements) {
    await db.exec(`${statement};`);
  }
}

/**
 * 创建 CLI auth state
 * @param {object} db - 数据库连接对象
 * @param {object} params - 参数对象
 * @param {number} params.userId - 用户 ID
 * @param {number} params.expiresInSeconds - 过期秒数
 * @param {string} params.stateValue - 可选的明文 state
 * @returns {Promise<object>}
 */
export async function createCliAuthState(db, { userId, expiresInSeconds = 600, stateValue = null } = {}) {
  const rawState = String(stateValue || randomTokenValue('state'));
  const stateHash = await sha256Hex(rawState);
  const createdAt = nowIso();
  const expiresAt = addSecondsIso(expiresInSeconds);

  await insertRow(
    db,
    'INSERT INTO cli_auth_states (state_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    [stateHash, userId, createdAt, expiresAt]
  );

  return {
    state: rawState,
    rawState,
    stateHash,
    userId,
    createdAt,
    expiresAt,
  };
}

/**
 * 为 state 绑定 CLI code
 * @param {object} db - 数据库连接对象
 * @param {string} stateValue - 明文 state
 * @param {object} params - 参数对象
 * @param {number} params.userId - 用户 ID
 * @param {number} params.expiresInSeconds - 过期秒数
 * @param {string} params.code - 可选的明文 code
 * @returns {Promise<object>}
 */
export async function attachCliAuthCodeToState(db, stateValue, { userId, expiresInSeconds = 600, code = null } = {}) {
  const stateHash = await sha256Hex(stateValue);
  const stateRow = await fetchOne(
    db,
    'SELECT id, user_id, expires_at FROM cli_auth_states WHERE state_hash = ? LIMIT 1',
    [stateHash]
  );

  if (!stateRow) {
    throw new Error('CLI state 不存在');
  }
  if (Number(stateRow.user_id) !== Number(userId)) {
    throw new Error('CLI state 不匹配');
  }
  if (isExpired(stateRow.expires_at)) {
    throw new Error('CLI state 已过期');
  }

  const rawCode = String(code || randomTokenValue('code'));
  const codeHash = await sha256Hex(rawCode);
  const createdAt = nowIso();
  const expiresAt = addSecondsIso(expiresInSeconds);

  await insertRow(
    db,
    'INSERT INTO cli_auth_codes (code_hash, state_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    [codeHash, stateHash, userId, createdAt, expiresAt]
  );

  await db.prepare(
    'UPDATE cli_auth_states SET code_hash = ?, code_created_at = ?, code_expires_at = ? WHERE state_hash = ?'
  ).bind(codeHash, createdAt, expiresAt, stateHash).run();

  return {
    code: rawCode,
    rawCode,
    codeHash,
    stateHash,
    userId,
    createdAt,
    expiresAt,
  };
}

/**
 * 使用 CLI code 兑换 token
 * @param {object} db - 数据库连接对象
 * @param {string} codeValue - 明文 code
 * @param {object} params - 参数对象
 * @param {number} params.userId - 用户 ID
 * @param {number} params.expiresInSeconds - 过期秒数
 * @param {string} params.tokenValue - 可选的明文 token
 * @returns {Promise<object>}
 */
export async function exchangeCliCodeForToken(db, codeValue, { userId, expiresInSeconds = 3600, tokenValue = null } = {}) {
  const codeHash = await sha256Hex(codeValue);
  const codeRow = await fetchOne(
    db,
    'SELECT id, state_hash, user_id, expires_at, consumed_at FROM cli_auth_codes WHERE code_hash = ? LIMIT 1',
    [codeHash]
  );

  if (!codeRow) {
    throw new Error('CLI code 不存在');
  }
  if (Number(codeRow.user_id) !== Number(userId)) {
    throw new Error('CLI code 不匹配');
  }
  if (isExpired(codeRow.expires_at)) {
    throw new Error('CLI code 已过期');
  }
  if (codeRow.consumed_at) {
    throw new Error('CLI code 已使用');
  }

  const rawToken = String(tokenValue || randomTokenValue('token'));
  const tokenHash = await sha256Hex(rawToken);
  const createdAt = nowIso();
  const expiresAt = addSecondsIso(expiresInSeconds);

  await insertRow(
    db,
    'INSERT INTO cli_tokens (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    [tokenHash, userId, createdAt, expiresAt]
  );

  await db.prepare(
    'UPDATE cli_auth_codes SET consumed_at = ?, token_hash = ? WHERE code_hash = ?'
  ).bind(createdAt, tokenHash, codeHash).run();

  await db.prepare(
    'UPDATE cli_auth_states SET code_used_at = ? WHERE state_hash = ?'
  ).bind(createdAt, codeRow.state_hash).run();

  return {
    token: rawToken,
    rawToken,
    tokenHash,
    userId,
    createdAt,
    expiresAt,
  };
}

/**
 * 根据 token 明文查找 token 记录
 * @param {object} db - 数据库连接对象
 * @param {string} tokenValue - 明文 token
 * @returns {Promise<object|null>}
 */
export async function findCliTokenByValue(db, tokenValue) {
  const tokenHash = await sha256Hex(tokenValue);
  const tokenRow = await fetchOne(
    db,
    'SELECT id, token_hash, user_id, created_at, expires_at, revoked_at FROM cli_tokens WHERE token_hash = ? LIMIT 1',
    [tokenHash]
  );

  if (!tokenRow || tokenRow.revoked_at || isExpired(tokenRow.expires_at)) {
    return null;
  }

  return {
    id: tokenRow.id,
    tokenHash: tokenRow.token_hash,
    userId: tokenRow.user_id,
    createdAt: tokenRow.created_at,
    expiresAt: tokenRow.expires_at,
    revokedAt: tokenRow.revoked_at || null,
  };
}

/**
 * 按明文 token 撤销 token
 * @param {object} db - 数据库连接对象
 * @param {string} tokenValue - 明文 token
 * @returns {Promise<boolean>}
 */
export async function revokeCliTokenByValue(db, tokenValue) {
  const tokenHash = await sha256Hex(tokenValue);
  await db.prepare(
    'UPDATE cli_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND revoked_at IS NULL'
  ).bind(tokenHash).run();
  return true;
}
