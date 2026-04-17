import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createClient } from '../src/api.ts';
import { saveConfig } from '../src/config.ts';
import { listMailboxes } from '../src/commands/list.ts';
import { readMessage } from '../src/commands/read.ts';
import { waitForMessage } from '../src/commands/wait.ts';

test('createClient loads the saved config and attaches bearer auth', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'freemail-cli-'));

  await saveConfig({
    baseUrl: 'https://freemail.test',
    accessToken: 'cli-token',
    username: 'alice',
    role: 'user',
    expiresAt: '2099-01-01T00:00:00.000Z',
    mailboxAddress: 'alice@freemail.test',
  }, { configDir });

  const requests: Array<{ url: string; headers: Headers }> = [];
  const client = createClient({
    configDir,
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        headers: new Headers(init?.headers),
      });
      return new Response(JSON.stringify({
        list: [{ address: 'one@freemail.test' }],
        total: 1,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const payload = await client.listMailboxes();

  assert.equal(payload.total, 1);
  assert.equal(payload.list[0].address, 'one@freemail.test');
  assert.equal(requests[0].url, 'https://freemail.test/api/mailboxes');
  assert.equal(requests[0].headers.get('authorization'), 'Bearer cli-token');
});

test('listMailboxes unwraps the { list, total } payload', async () => {
  const rows = await listMailboxes({
    listMailboxes: async () => ({
      list: [{ address: 'one@example.com' }, { address: 'two@example.com' }],
      total: 2,
    }),
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].address, 'one@example.com');
});

test('readMessage returns the Worker payload', async () => {
  const message = await readMessage({
    getMessage: async () => ({
      id: 42,
      sender: 'sender@example.com',
      subject: '验证码',
      verification_code: '123456',
      content: 'plain text body',
    }),
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
    },
  }, 'box@example.com', {
    timeoutSeconds: 5,
    intervalSeconds: 0,
    sleep: async () => {},
  });

  assert.equal(message?.id, 2);
  assert.equal(message?.subject, 'new message');
});

test('waitForMessage returns null on timeout instead of throwing', async () => {
  const message = await waitForMessage({
    listEmails: async () => [{ id: 1, subject: 'existing' }],
  }, 'box@example.com', {
    timeoutSeconds: 0,
    intervalSeconds: 0,
    sleep: async () => {},
  });

  assert.equal(message, null);
});
