import test from 'node:test';
import assert from 'node:assert/strict';

import { createMailbox } from '../src/commands/create.js';

test('createMailbox forwards length and domainIndex to the Worker', async () => {
  const calls: Array<{ length?: number; domainIndex?: number }> = [];

  const result = await createMailbox({
    createRandomMailbox: async (length?: number, domainIndex?: number) => {
      calls.push({ length, domainIndex });
      return { email: 'abc123@example.com', expires: 1700000000000 };
    },
  }, { length: 12, domainIndex: 1 });

  assert.equal(result.email, 'abc123@example.com');
  assert.deepEqual(calls[0], { length: 12, domainIndex: 1 });
});
