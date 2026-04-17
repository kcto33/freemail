import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssetManager } from '../../src/assets/index.js';

test('asset manager maps cli auth alias to the cli auth page', () => {
  const manager = createAssetManager();

  assert.equal(manager.isPathAllowed('/html/cli-auth.html'), true);
  assert.equal(manager.isPathAllowed('/js/cli-auth.js'), true);

  const mapped = manager.handlePathMapping(
    new Request('https://freemail.test/cli-auth'),
    new URL('https://freemail.test/cli-auth')
  );

  assert.equal(new URL(mapped.url).pathname, '/html/cli-auth.html');
});
