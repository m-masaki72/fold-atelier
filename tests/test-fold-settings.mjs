import test from 'node:test';
import assert from 'node:assert/strict';
import { clearSavedData, SESSION_KEY } from '../dist/js/fold-session.js';

function setDatabase(t, value) {
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = value;
  t.after(() => {
    globalThis.indexedDB = previous;
  });
}

test('clearing settings removes session and audio preferences without touching another app', async () => {
  const values = new Map([
    [SESSION_KEY, 'session'],
    ['fold-audio-volume', 'audio'],
    ['other-app', 'keep'],
  ]);
  await clearSavedData({ removeItem: (key) => values.delete(key) });
  assert.deepEqual([...values], [['other-app', 'keep']]);
});

test('clearing settings reports storage denial rather than declaring success', async () => {
  await assert.rejects(
    clearSavedData({
      removeItem() {
        throw new Error('Storage denied');
      },
    }),
    /Storage denied/,
  );
});

test('explicit clearing erases previously uploaded images and closes the legacy database', async (t) => {
  const records = new Map([['picture', new Blob(['personal image'])]]);
  const events = [];
  setDatabase(t, {
    databases: async () => [{ name: 'fold-atelier-images' }, { name: 'other-app' }],
    open(name) {
      assert.equal(name, 'fold-atelier-images');
      events.push('open');
      const request = {
        result: {
          objectStoreNames: { contains: (name) => name === 'images' },
          transaction(name, mode) {
            assert.equal(name, 'images');
            assert.equal(mode, 'readwrite');
            const transaction = {
              objectStore: () => ({
                clear() {
                  queueMicrotask(() => {
                    records.clear();
                    events.push('clear');
                    transaction.oncomplete();
                  });
                },
              }),
            };
            return transaction;
          },
          close() {
            events.push('close');
          },
        },
      };
      queueMicrotask(() => request.onsuccess());
      return request;
    },
  });
  await clearSavedData({ removeItem: (key) => events.push(key) });
  assert.equal(records.size, 0);
  assert.deepEqual(events, ['open', 'clear', 'close', SESSION_KEY, 'fold-audio-volume']);
});

test('clearing a browser without legacy images never opens or creates an image database', async (t) => {
  setDatabase(t, {
    databases: async () => [{ name: 'other-app' }],
    open() {
      assert.fail('No legacy image database exists');
    },
  });
  const removed = [];
  await clearSavedData({ removeItem: (key) => removed.push(key) });
  assert.deepEqual(removed, [SESSION_KEY, 'fold-audio-volume']);
});

test('older browsers abort creation when checking for an absent legacy database', async (t) => {
  let aborted = false;
  setDatabase(t, {
    open() {
      const request = {
        transaction: {
          abort() {
            aborted = true;
            queueMicrotask(() => request.onerror());
          },
        },
        error: new Error('Creation aborted'),
      };
      queueMicrotask(() => request.onupgradeneeded());
      return request;
    },
  });
  const removed = [];
  await clearSavedData({ removeItem: (key) => removed.push(key) });
  assert.equal(aborted, true);
  assert.deepEqual(removed, [SESSION_KEY, 'fold-audio-volume']);
});

test('legacy database access errors prevent a false successful clear', async (t) => {
  setDatabase(t, {
    databases: async () => {
      throw new Error('Legacy images inaccessible');
    },
  });
  await assert.rejects(
    clearSavedData({ removeItem: () => assert.fail('Image cleanup failed') }),
    /Legacy images inaccessible/,
  );
});
