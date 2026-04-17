import test from 'node:test';
import assert from 'node:assert/strict';

import { handleApiRequest } from '../../src/api/index.js';

function createAnnouncementDbStub(initialRow = null) {
  const state = {
    row: initialRow ? { ...initialRow } : null,
    lastInsert: null,
  };

  return {
    state,
    prepare(sql) {
      const bindings = [];
      return {
        bind(...args) {
          bindings.splice(0, bindings.length, ...args);
          return this;
        },
        async first() {
          if (/FROM site_announcements/i.test(sql)) {
            return state.row ? { ...state.row } : null;
          }
          return null;
        },
        async run() {
          if (/INSERT INTO site_announcements/i.test(sql)) {
            state.lastInsert = {
              id: bindings[0],
              content: bindings[1],
              is_active: bindings[2],
              updated_by_user_id: bindings[3],
            };
            state.row = {
              id: bindings[0],
              content: bindings[1],
              is_active: bindings[2],
              updated_at: '2026-04-17 14:00:00',
              updated_by_user_id: bindings[3],
            };
          }
          return { success: true, meta: { changes: 1 } };
        },
      };
    },
  };
}

function createAuthOptions(overrides = {}) {
  return {
    mockOnly: false,
    resendApiKey: '',
    adminName: 'admin',
    r2: null,
    mailboxOnly: false,
    authPayload: {
      role: 'user',
      username: 'alice',
      userId: 11,
    },
    ...overrides,
  };
}

function createJwtCookie(payload) {
  const encoded = Buffer.from(JSON.stringify(payload))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `iding-session=header.${encoded}.signature`;
}

test('GET /api/announcement returns inactive when no row exists', async () => {
  const db = createAnnouncementDbStub();
  const request = new Request('https://freemail.test/api/announcement');

  const response = await handleApiRequest(request, db, ['example.com'], createAuthOptions());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    active: false,
    content: '',
    updated_at: null,
    updated_by_user_id: null,
  });
});

test('GET /api/announcement returns inactive for guest mode', async () => {
  const db = {
    prepare() {
      throw new Error('guest mode should not query the database');
    },
  };
  const request = new Request('https://freemail.test/api/announcement');

  const response = await handleApiRequest(request, db, ['example.com'], createAuthOptions({
    authPayload: {
      role: 'guest',
      username: 'guest',
      userId: null,
    },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    active: false,
    content: '',
    updated_at: null,
    updated_by_user_id: null,
  });
});

test('GET /api/announcement allows mailbox-only authenticated callers', async () => {
  const db = createAnnouncementDbStub({
    id: 1,
    content: 'Mailbox banner',
    is_active: 1,
    updated_at: '2026-04-17 14:00:00',
    updated_by_user_id: 42,
  });
  const request = new Request('https://freemail.test/api/announcement');

  const response = await handleApiRequest(request, db, ['example.com'], createAuthOptions({
    mailboxOnly: true,
    authPayload: {
      role: 'user',
      username: 'mailbox-user',
      userId: 12,
      mailboxId: 'mbx-1',
      mailboxAddress: 'mailbox@example.com',
    },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    active: true,
    content: 'Mailbox banner',
    updated_at: '2026-04-17 14:00:00',
    updated_by_user_id: 42,
  });
});

test('PUT /api/announcement rejects non-strict-admin callers', async () => {
  const db = {
    prepare() {
      throw new Error('non-admin caller should not reach the database');
    },
  };
  const request = new Request('https://freemail.test/api/announcement', {
    method: 'PUT',
    body: JSON.stringify({ content: 'ignored', is_active: true }),
  });

  const response = await handleApiRequest(request, db, ['example.com'], createAuthOptions({
    authPayload: {
      role: 'user',
      username: 'alice',
      userId: 11,
    },
  }));

  assert.equal(response.status, 403);
});

test('PUT /api/announcement saves normalized content for strict admin', async () => {
  const db = createAnnouncementDbStub();
  const request = new Request('https://freemail.test/api/announcement', {
    method: 'PUT',
    body: JSON.stringify({ content: '  Site maintenance at 10 PM  ', is_active: true }),
  });

  const response = await handleApiRequest(request, db, ['example.com'], createAuthOptions({
    authPayload: {
      role: 'admin',
      username: 'admin',
      userId: 42,
    },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    active: true,
    content: 'Site maintenance at 10 PM',
    updated_at: '2026-04-17 14:00:00',
    updated_by_user_id: 42,
  });
  assert.deepEqual(db.state.lastInsert, {
    id: 1,
    content: 'Site maintenance at 10 PM',
    is_active: 1,
    updated_by_user_id: 42,
  });
});

test('PUT /api/announcement returns 400 for malformed JSON', async () => {
  const db = createAnnouncementDbStub();
  const request = new Request('https://freemail.test/api/announcement', {
    method: 'PUT',
    headers: {
      Cookie: createJwtCookie({
        role: 'admin',
        username: 'admin',
        userId: 42,
      }),
    },
    body: '{"content":',
  });

  const response = await handleApiRequest(request, db, ['example.com'], createAuthOptions({
    authPayload: null,
  }));

  assert.equal(response.status, 400);
});

test('PUT /api/announcement records request-derived admin user id', async () => {
  const db = createAnnouncementDbStub();
  const request = new Request('https://freemail.test/api/announcement', {
    method: 'PUT',
    headers: {
      Cookie: createJwtCookie({
        role: 'admin',
        username: 'admin',
        userId: 77,
      }),
    },
    body: JSON.stringify({ content: 'Announcement from cookie auth', is_active: true }),
  });

  const response = await handleApiRequest(request, db, ['example.com'], createAuthOptions({
    authPayload: null,
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    active: true,
    content: 'Announcement from cookie auth',
    updated_at: '2026-04-17 14:00:00',
    updated_by_user_id: 77,
  });
  assert.deepEqual(db.state.lastInsert, {
    id: 1,
    content: 'Announcement from cookie auth',
    is_active: 1,
    updated_by_user_id: 77,
  });
});
