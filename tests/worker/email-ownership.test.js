import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApiRequest } from '../../src/api/index.js';

function createEmailOwnershipDbStub() {
  const mailboxes = [
    { id: 101, address: 'owned@example.com' },
    { id: 202, address: 'other@example.com' },
  ];
  const userMailboxes = [
    { user_id: 11, mailbox_id: 101 },
  ];
  const messages = [
    {
      id: 1,
      mailbox_id: 101,
      sender: 'sender-owned@example.com',
      to_addrs: 'owned@example.com',
      subject: 'Owned message',
      verification_code: null,
      preview: 'Owned preview',
      r2_bucket: 'mail-eml',
      r2_object_key: 'owned-message.eml',
      received_at: '2026-04-17 10:00:00',
      is_read: 0,
      content: 'Owned content',
      html_content: '<p>Owned content</p>',
    },
    {
      id: 2,
      mailbox_id: 202,
      sender: 'sender-other@example.com',
      to_addrs: 'other@example.com',
      subject: 'Other message',
      verification_code: null,
      preview: 'Other preview',
      r2_bucket: 'mail-eml',
      r2_object_key: 'other-message.eml',
      received_at: '2026-04-17 10:05:00',
      is_read: 0,
      content: 'Other content',
      html_content: '<p>Other content</p>',
    },
  ];

  return {
    messages,
    prepare(sql) {
      const bindings = [];
      return {
        bind(...args) {
          bindings.splice(0, bindings.length, ...args);
          return this;
        },
        async all() {
          if (/SELECT id FROM mailboxes WHERE address = \? LIMIT 1/i.test(sql)) {
            const [address] = bindings;
            const row = mailboxes.find((entry) => entry.address === String(address).toLowerCase());
            return { results: row ? [{ id: row.id }] : [] };
          }

          if (/SELECT id FROM user_mailboxes WHERE user_id = \? AND mailbox_id = \? LIMIT 1/i.test(sql)) {
            const [userId, mailboxId] = bindings.map(Number);
            const row = userMailboxes.find((entry) => entry.user_id === userId && entry.mailbox_id === mailboxId);
            return { results: row ? [{ id: 1 }] : [] };
          }

          if (/SELECT mailbox_id FROM messages WHERE id = \? LIMIT 1/i.test(sql)) {
            const [messageId] = bindings.map(Number);
            const row = messages.find((entry) => entry.id === messageId);
            return { results: row ? [{ mailbox_id: row.mailbox_id }] : [] };
          }

          if (/SELECT id, sender, to_addrs, subject, received_at, is_read, preview, verification_code\s+FROM messages\s+WHERE mailbox_id = \?/i.test(sql)) {
            const [mailboxId] = bindings.map(Number);
            const rows = messages
              .filter((entry) => entry.mailbox_id === mailboxId)
              .map(({ id, sender, to_addrs, subject, received_at, is_read, preview, verification_code }) => ({
                id,
                sender,
                to_addrs,
                subject,
                received_at,
                is_read,
                preview,
                verification_code,
              }));
            return { results: rows };
          }

          if (/SELECT r2_bucket, r2_object_key FROM messages WHERE id = \?/i.test(sql)) {
            const [messageId] = bindings.map(Number);
            const row = messages.find((entry) => entry.id === messageId);
            return {
              results: row ? [{
                r2_bucket: row.r2_bucket,
                r2_object_key: row.r2_object_key,
              }] : [],
            };
          }

          if (/SELECT id, sender, to_addrs, subject, verification_code, preview, r2_bucket, r2_object_key, received_at, is_read\s+FROM messages WHERE id = \?/i.test(sql)) {
            const [messageId] = bindings.map(Number);
            const row = messages.find((entry) => entry.id === messageId);
            return {
              results: row ? [{
                id: row.id,
                sender: row.sender,
                to_addrs: row.to_addrs,
                subject: row.subject,
                verification_code: row.verification_code,
                preview: row.preview,
                r2_bucket: row.r2_bucket,
                r2_object_key: row.r2_object_key,
                received_at: row.received_at,
                is_read: row.is_read,
              }] : [],
            };
          }

          if (/SELECT content, html_content FROM messages WHERE id = \?/i.test(sql)) {
            const [messageId] = bindings.map(Number);
            const row = messages.find((entry) => entry.id === messageId);
            return {
              results: row ? [{
                content: row.content,
                html_content: row.html_content,
              }] : [],
            };
          }

          if (/SELECT r2_object_key FROM messages WHERE mailbox_id = \? AND r2_object_key IS NOT NULL/i.test(sql)) {
            const [mailboxId] = bindings.map(Number);
            return {
              results: messages
                .filter((entry) => entry.mailbox_id === mailboxId && entry.r2_object_key)
                .map((entry) => ({ r2_object_key: entry.r2_object_key })),
            };
          }

          return { results: [] };
        },
        async first() {
          if (/SELECT r2_object_key FROM messages WHERE id = \?/i.test(sql)) {
            const [messageId] = bindings.map(Number);
            const row = messages.find((entry) => entry.id === messageId);
            return row ? { r2_object_key: row.r2_object_key } : null;
          }

          const result = await this.all();
          return result.results[0] || null;
        },
        async run() {
          if (/UPDATE messages SET is_read = 1 WHERE id = \?/i.test(sql)) {
            const [messageId] = bindings.map(Number);
            const row = messages.find((entry) => entry.id === messageId);
            if (row) row.is_read = 1;
            return { success: true, meta: { changes: row ? 1 : 0 } };
          }

          if (/DELETE FROM messages WHERE id = \?/i.test(sql)) {
            const [messageId] = bindings.map(Number);
            const index = messages.findIndex((entry) => entry.id === messageId);
            if (index >= 0) {
              messages.splice(index, 1);
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }

          if (/DELETE FROM messages WHERE mailbox_id = \?/i.test(sql)) {
            const [mailboxId] = bindings.map(Number);
            const before = messages.length;
            for (let i = messages.length - 1; i >= 0; i -= 1) {
              if (messages[i].mailbox_id === mailboxId) {
                messages.splice(i, 1);
              }
            }
            return { success: true, meta: { changes: before - messages.length } };
          }

          return { success: true, meta: { changes: 0 } };
        },
      };
    },
  };
}

function createUserOptions(overrides = {}) {
  return {
    mockOnly: false,
    resendApiKey: '',
    adminName: 'admin',
    r2: null,
    authPayload: {
      role: 'user',
      username: 'alice',
      userId: 11,
    },
    ...overrides,
  };
}

test('user can list emails for an owned mailbox', async () => {
  const db = createEmailOwnershipDbStub();
  const request = new Request('https://freemail.test/api/emails?mailbox=owned@example.com');

  const response = await handleApiRequest(request, db, ['example.com'], createUserOptions());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [{
    id: 1,
    sender: 'sender-owned@example.com',
    to_addrs: 'owned@example.com',
    subject: 'Owned message',
    received_at: '2026-04-17 10:00:00',
    is_read: 0,
    preview: 'Owned preview',
    verification_code: null,
  }]);
});

test('user cannot list emails for a mailbox they do not own', async () => {
  const db = createEmailOwnershipDbStub();
  const request = new Request('https://freemail.test/api/emails?mailbox=other@example.com');

  const response = await handleApiRequest(request, db, ['example.com'], createUserOptions());

  assert.equal(response.status, 403);
});

test('user cannot read a message from a mailbox they do not own', async () => {
  const db = createEmailOwnershipDbStub();
  const request = new Request('https://freemail.test/api/email/2');

  const response = await handleApiRequest(request, db, ['example.com'], createUserOptions());

  assert.equal(response.status, 403);
});

test('user cannot download a message from a mailbox they do not own', async () => {
  const db = createEmailOwnershipDbStub();
  const request = new Request('https://freemail.test/api/email/2/download');
  const r2 = {
    async get(key) {
      return { body: `raw:${key}` };
    },
  };

  const response = await handleApiRequest(request, db, ['example.com'], createUserOptions({ r2 }));

  assert.equal(response.status, 403);
});

test('user cannot delete messages from mailboxes they do not own', async () => {
  const db = createEmailOwnershipDbStub();
  const singleDeleteRequest = new Request('https://freemail.test/api/email/2', { method: 'DELETE' });
  const clearMailboxRequest = new Request('https://freemail.test/api/emails?mailbox=other@example.com', { method: 'DELETE' });

  const singleDeleteResponse = await handleApiRequest(singleDeleteRequest, db, ['example.com'], createUserOptions());
  const clearMailboxResponse = await handleApiRequest(clearMailboxRequest, db, ['example.com'], createUserOptions());

  assert.equal(singleDeleteResponse.status, 403);
  assert.equal(clearMailboxResponse.status, 403);
  assert.equal(db.messages.length, 2);
});
