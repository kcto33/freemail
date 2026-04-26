import assert from 'node:assert/strict';
import test from 'node:test';

function createStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
    key(index) {
      return Array.from(data.keys())[index] || null;
    },
    get length() {
      return data.size;
    }
  };
}

test('copyMailboxAddress falls back when Clipboard API writeText rejects', async () => {
  const copiedValues = [];
  let execCommandName = '';

  globalThis.window = {};
  globalThis.localStorage = createStorage();
  globalThis.sessionStorage = createStorage();
  globalThis.document = {
    createElement() {
      return {
        value: '',
        style: {},
        select() {
          copiedValues.push(this.value);
        }
      };
    },
    body: {
      appendChild() {},
      removeChild() {}
    },
    execCommand(command) {
      execCommandName = command;
      return command === 'copy';
    },
    addEventListener() {}
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      clipboard: {
        async writeText() {
          throw new Error('clipboard denied');
        }
      }
    }
  });

  const mailboxState = await import('../../public/js/modules/app/mailbox-state.js');
  const mailboxActions = await import('../../public/js/modules/app/mailbox-actions.js');
  const toastMessages = [];

  mailboxState.setCurrentMailbox('fallback@example.com');
  await mailboxActions.copyMailboxAddress((message, type) => {
    toastMessages.push({ message, type });
  });

  assert.deepEqual(copiedValues, ['fallback@example.com']);
  assert.equal(execCommandName, 'copy');
  assert.deepEqual(toastMessages, [
    { message: '已复制：fallback@example.com', type: 'success' }
  ]);
});
