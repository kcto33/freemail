import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createClient } from '../src/api.ts';
import { saveConfig } from '../src/config.ts';
import { downloadMessageToFile, getLatestEmail, listEmailsForMailbox } from '../src/commands/email.ts';
import { main } from '../src/index.ts';
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

test('waitForMessage filters by sender and subject using list payloads first', async () => {
  let callCount = 0;

  const row = await waitForMessage({
    listEmails: async () => {
      callCount += 1;
      if (callCount === 1) return [{ id: 1, sender: 'old@example.com', subject: 'old' }];
      return [
        { id: 2, sender: 'alerts@example.com', subject: 'System notice' },
        { id: 3, sender: 'no-reply@github.com', subject: 'Verify your device' },
        { id: 1, sender: 'old@example.com', subject: 'old' },
      ];
    },
    getMessage: async () => ({ id: 3, content: 'device code 123456' }),
  }, 'box@example.com', {
    timeoutSeconds: 5,
    intervalSeconds: 0,
    from: 'github.com',
    subject: 'verify',
    sleep: async () => {},
  });

  assert.equal(row?.id, 3);
});

test('waitForMessage uses message detail when contains filter is present', async () => {
  let callCount = 0;

  const row = await waitForMessage({
    listEmails: async () => {
      callCount += 1;
      if (callCount === 1) return [];
      return [
        { id: 5, sender: 'bot@example.com', subject: 'hello' },
        { id: 6, sender: 'bot@example.com', subject: 'hello again' },
      ];
    },
    getMessage: async (id: number) => ({
      id,
      content: id === 6 ? 'your code is 654321' : 'plain newsletter',
      html_content: '',
    }),
  }, 'box@example.com', {
    timeoutSeconds: 5,
    intervalSeconds: 0,
    contains: '654321',
    sleep: async () => {},
  });

  assert.equal(row?.id, 6);
});

test('listEmailsForMailbox returns the mailbox rows from the Worker', async () => {
  const rows = await listEmailsForMailbox({
    listEmails: async () => ([
      { id: 2, subject: 'Newest' },
      { id: 1, subject: 'Oldest' },
    ]),
  }, {
    mailbox: 'box@example.com',
    limit: 10,
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 2);
});

test('getLatestEmail returns the first message from the mailbox list', async () => {
  const row = await getLatestEmail({
    listEmails: async () => ([
      { id: 8, subject: 'latest' },
      { id: 3, subject: 'older' },
    ]),
  }, {
    mailbox: 'box@example.com',
  });

  assert.equal(row?.id, 8);
});

test('downloadMessageToFile uses the response filename when no output path is given', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'freemail-download-'));
  const result = await downloadMessageToFile({
    downloadMessage: async () => new Response('raw-eml', {
      headers: {
        'Content-Disposition': 'attachment; filename=\"message-9.eml\"',
      },
    }),
  }, {
    id: 9,
    cwd: tempDir,
  });

  assert.match(result.filePath, /message-9\.eml$/);
  assert.equal(await fs.readFile(result.filePath, 'utf8'), 'raw-eml');
});

test('downloadMessageToFile rejects overwriting without force', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'freemail-download-'));
  const target = path.join(tempDir, 'existing.eml');
  await fs.writeFile(target, 'before', 'utf8');

  await assert.rejects(() => downloadMessageToFile({
    downloadMessage: async () => new Response('after'),
  }, {
    id: 10,
    output: target,
    force: false,
    cwd: tempDir,
  }), /已存在/);
});

test('email read routes through grouped command handling', async () => {
  const calls: Array<{ id: number; json: boolean }> = [];

  await main(['email', 'read', '--id', '42', '--json'], {
    emailReadAction: async (options) => {
      calls.push(options);
    },
  });

  assert.deepEqual(calls, [{ id: 42, json: true }]);
});

test('top-level read remains a compatibility alias', async () => {
  const calls: number[] = [];

  await main(['read', '--id', '7'], {
    emailReadAction: async (options) => {
      calls.push(options.id);
    },
  });

  assert.deepEqual(calls, [7]);
});

test('top-level wait remains a compatibility alias', async () => {
  const calls: string[] = [];

  await main(['wait', '--mailbox', 'box@example.com'], {
    emailWaitAction: async (options) => {
      calls.push(options.mailbox);
    },
  });

  assert.deepEqual(calls, ['box@example.com']);
});
