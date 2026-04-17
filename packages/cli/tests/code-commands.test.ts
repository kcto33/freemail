import test from 'node:test';
import assert from 'node:assert/strict';

import { extractVerificationCode, getLatestCode, waitForCode } from '../src/commands/code.ts';

test('extractVerificationCode prefers Worker-provided verification_code', async () => {
  assert.equal(extractVerificationCode({
    verification_code: '123456',
    content: 'fallback 999999',
  }), '123456');
});

test('extractVerificationCode falls back to body parsing', async () => {
  assert.equal(extractVerificationCode({
    content: 'Your verification code is 654321.',
  }), '654321');
});

test('getLatestCode returns the latest message code', async () => {
  const result = await getLatestCode({
    listEmails: async () => [{ id: 9 }],
    getMessage: async () => ({ id: 9, content: 'Code 112233' }),
  }, {
    mailbox: 'box@example.com',
  });

  assert.equal(result?.code, '112233');
  assert.equal(result?.message.id, 9);
});

test('waitForCode returns the first waited-for matching code', async () => {
  let callCount = 0;
  const result = await waitForCode({
    listEmails: async () => {
      callCount += 1;
      if (callCount === 1) return [{ id: 1 }];
      return [{ id: 1 }, { id: 2 }];
    },
    getMessage: async (id: number) => ({ id, content: id === 2 ? 'Code 445566' : 'No code here' }),
  }, {
    mailbox: 'box@example.com',
    timeoutSeconds: 5,
    intervalSeconds: 0,
    sleep: async () => {},
  });

  assert.equal(result?.code, '445566');
});
