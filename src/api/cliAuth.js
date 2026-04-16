/**
 * CLI auth HTTP handlers
 * @module api/cliAuth
 */

import {
  createCliAuthState,
  attachCliAuthCodeToState,
  exchangeCliCodeForToken,
  findCliTokenByValue,
  revokeCliTokenByValue
} from '../db/cliAuth.js';
import { errorResponse, jsonResponse, sha256Hex } from './helpers.js';
import { generateRandomId } from '../utils/common.js';

const START_STATE_TTL_SECONDS = 10 * 60;
const ISSUE_CODE_TTL_SECONDS = 10 * 60;
const ACCESS_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

function addSecondsIso(seconds) {
  return new Date(Date.now() + Math.max(0, Number(seconds) || 0) * 1000).toISOString();
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getRequestBody(request) {
  return request.json().catch(() => ({}));
}

function getBearerToken(request) {
  const auth = request.headers.get('Authorization') || request.headers.get('authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

function getDbBinding(env) {
  return env?.TEMP_MAIL_DB || env?.DB || env?.D1 || null;
}

function toStoredUserId(authPayload) {
  if (!isObject(authPayload)) return 0;
  if (String(authPayload.role || '') === 'mailbox') {
    const mailboxId = Number(authPayload.mailboxId || authPayload.mailbox_id || 0);
    return mailboxId ? -Math.abs(mailboxId) : 0;
  }
  const userId = Number(authPayload.userId || authPayload.user_id || 0);
  return Number.isFinite(userId) ? userId : 0;
}

async function resolvePrincipalByStoredUserId(db, storedUserId) {
  const numericId = Number(storedUserId || 0);
  if (!db || !numericId) return null;

  if (numericId > 0) {
    const user = await db.prepare(
      'SELECT id, username, role FROM users WHERE id = ? LIMIT 1'
    ).bind(numericId).first();

    if (user) {
      const role = String(user.role || '').toLowerCase() === 'admin' ? 'admin' : 'user';
      return {
        userId: Number(user.id),
        role,
        username: String(user.username || ''),
        mailboxId: null,
        mailboxAddress: null
      };
    }
  }

  const mailboxId = Math.abs(numericId);
  const mailbox = await db.prepare(
    'SELECT id, address FROM mailboxes WHERE id = ? LIMIT 1'
  ).bind(mailboxId).first();

  if (mailbox) {
    return {
      userId: -Math.abs(Number(mailbox.id)),
      role: 'mailbox',
      username: String(mailbox.address || ''),
      mailboxId: Number(mailbox.id),
      mailboxAddress: String(mailbox.address || '')
    };
  }

  return null;
}

async function resolveCliSessionPayload(db, storedUserId) {
  const principal = await resolvePrincipalByStoredUserId(db, storedUserId);
  if (!principal) return null;
  return {
    authenticated: true,
    role: principal.role,
    username: principal.username,
    userId: principal.userId,
    mailboxId: principal.mailboxId,
    mailboxAddress: principal.mailboxAddress,
    strictAdmin: principal.role === 'admin' && principal.username === '__root__'
  };
}

export function createCliAuthHandlers(deps = {}) {
  const randomId = deps.randomId ?? ((length = 16) => generateRandomId(length));
  const createState = deps.createCliAuthState ?? createCliAuthState;
  const attachCode = deps.attachCliAuthCodeToState ?? attachCliAuthCodeToState;
  const exchangeCode = deps.exchangeCliCodeForToken ?? exchangeCliCodeForToken;
  const revokeToken = deps.revokeCliTokenByValue ?? revokeCliTokenByValue;

  async function handleCliAuthApi(request, db, url, path, options = {}) {
    if (path === '/api/cli/auth/start' && request.method === 'POST') {
      const state = String(randomId(16) || '').trim();
      if (!state) return errorResponse('无法生成 state', 500);

      if (createState.length >= 3) {
        await createState(db, state, addSecondsIso(START_STATE_TTL_SECONDS));
      } else {
        await createState(db, {
          userId: 0,
          expiresInSeconds: START_STATE_TTL_SECONDS,
          stateValue: state
        });
      }

      return jsonResponse({
        state,
        auth_url: `${url.origin}/html/cli-auth.html?state=${encodeURIComponent(state)}`,
        expires_at: addSecondsIso(START_STATE_TTL_SECONDS)
      });
    }

    if (path === '/api/cli/auth/issue-code' && request.method === 'POST') {
      if (!options.authPayload) return errorResponse('Unauthorized', 401);

      const body = await getRequestBody(request);
      const state = String(body?.state || '').trim();
      if (!state) return errorResponse('缺少 state 参数', 400);

      const storedUserId = toStoredUserId(options.authPayload);
      if (!storedUserId) return errorResponse('无法识别当前用户', 400);

      const stateHash = await sha256Hex(state);
      if (db?.prepare) {
        await db.prepare(
          'UPDATE cli_auth_states SET user_id = ? WHERE state_hash = ?'
        ).bind(storedUserId, stateHash).run();
      }

      const code = String(randomId(8) || '').toUpperCase();
      if (!code) return errorResponse('无法生成授权码', 500);

      await attachCode(db, state, {
        userId: storedUserId,
        expiresInSeconds: ISSUE_CODE_TTL_SECONDS,
        code
      });

      return jsonResponse({
        code,
        token_type: 'Bearer',
        expires_at: addSecondsIso(ISSUE_CODE_TTL_SECONDS),
        role: options.authPayload.role || null,
        username: options.authPayload.username || null,
        mailbox_address: options.authPayload.mailboxAddress ?? null
      });
    }

    if (path === '/api/cli/auth/exchange' && request.method === 'POST') {
      const body = await getRequestBody(request);
      const state = String(body?.state || '').trim();
      const code = String(body?.code || '').trim().toUpperCase();
      if (!state || !code) return errorResponse('缺少 state 或 code 参数', 400);

      const stateHash = await sha256Hex(state);
      const codeHash = await sha256Hex(code);
      let storedUserId = 0;
      if (db?.prepare) {
        const codeRow = await db.prepare(
          'SELECT user_id FROM cli_auth_codes WHERE state_hash = ? AND code_hash = ? LIMIT 1'
        ).bind(stateHash, codeHash).first();
        if (!codeRow) return errorResponse('授权码无效', 401);
        storedUserId = Number(codeRow.user_id || 0);
      }

      const accessToken = `${randomId(24)}${randomId(24)}`.replace(/\s+/g, '');
      const result = await exchangeCode(db, code, {
        userId: storedUserId,
        expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
        tokenValue: accessToken
      });

      const principal = result?.payload || await resolveCliSessionPayload(db, result?.userId ?? storedUserId);
      if (!principal) return errorResponse('无法识别 CLI 会话主体', 500);

      return jsonResponse({
        access_token: result?.rawToken || result?.token || result?.accessToken || accessToken,
        token_type: 'Bearer',
        expires_at: result?.expiresAt || addSecondsIso(ACCESS_TOKEN_TTL_SECONDS),
        username: principal.username,
        role: principal.role,
        mailbox_address: principal.mailboxAddress ?? null
      });
    }

    if (path === '/api/cli/session' && request.method === 'GET') {
      if (!options.authPayload) return errorResponse('Unauthorized', 401);
      return jsonResponse({
        authenticated: true,
        role: options.authPayload.role || 'user',
        username: options.authPayload.username || '',
        mailbox_address: options.authPayload.mailboxAddress ?? null
      });
    }

    if (path === '/api/cli/logout' && request.method === 'POST') {
      const token = getBearerToken(request);
      if (!token) return errorResponse('Unauthorized', 401);
      await revokeToken(db, token);
      return jsonResponse({ success: true });
    }

    return null;
  }

  return {
    handleCliAuthApi
  };
}

const defaultHandlers = createCliAuthHandlers();

export const handleCliAuthApi = defaultHandlers.handleCliAuthApi;
export {
  resolveCliSessionPayload,
  getBearerToken as extractCliBearerToken
};

export async function resolveCliBearerPayload(request, env, deps = {}) {
  const token = getBearerToken(request);
  if (!token) return null;

  const db = getDbBinding(env);
  if (!db) return null;

  const lookup = deps.findCliTokenByValue ?? findCliTokenByValue;
  const tokenRow = await lookup(db, token);
  if (!tokenRow) return null;

  if (isObject(tokenRow) && (tokenRow.role || tokenRow.username || tokenRow.mailboxAddress || tokenRow.mailbox_address)) {
    return {
      authenticated: true,
      role: tokenRow.role || 'user',
      username: tokenRow.username || '',
      userId: tokenRow.userId ?? tokenRow.user_id ?? null,
      mailboxId: tokenRow.mailboxId ?? tokenRow.mailbox_id ?? null,
      mailboxAddress: tokenRow.mailboxAddress ?? tokenRow.mailbox_address ?? null,
      strictAdmin: Boolean(tokenRow.strictAdmin)
    };
  }

  return await resolveCliSessionPayload(db, tokenRow.userId ?? tokenRow.user_id ?? null);
}
