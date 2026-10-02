import test from 'node:test';
import assert from 'node:assert/strict';
import { imageStore, clearSavedData, SESSION_KEY } from '../dist/js/fold-session.js';

function databaseFixture(t, records = new Map()) {
  const previous = globalThis.indexedDB;
  const controls = { clearing: null, clearError: null, openError: null, closed: 0 };
  globalThis.indexedDB = {
    open() {
      const request = {
        result: {
          close() {
            controls.closed++;
          },
          transaction() {
            let pending = 0;
            const transaction = {
              objectStore() {
                const execute = (action, clearing = false) => {
                  pending++;
                  const operation = {};
                  const complete = () => {
                    if (clearing && controls.clearError) {
                      transaction.error = controls.clearError;
                      transaction.onerror();
                      return;
                    }
                    operation.result = action();
                    operation.onsuccess?.();
                    if (--pending === 0) queueMicrotask(() => transaction.oncomplete());
                  };
                  if (clearing) controls.clearing = () => queueMicrotask(complete);
                  else queueMicrotask(complete);
                  return operation;
                };
                return {
                  clear: () => execute(() => records.clear(), true),
                  get: (key) => execute(() => records.get(key)),
                  put: (record, key) =>
                    execute(() => {
                      records.set(key, record);
                      return key;
                    }),
                };
              },
            };
            return transaction;
          },
        },
      };
      queueMicrotask(() => {
        if (controls.openError) {
          request.error = controls.openError;
          request.onerror();
        } else request.onsuccess();
      });
      return request;
    },
  };
  t.after(() => {
    globalThis.indexedDB = previous;
  });
  return { controls, records };
}

async function untilClearing(controls) {
  for (let i = 0; i < 10 && !controls.clearing; i++) await Promise.resolve();
  assert.ok(controls.clearing);
}

test('images from separate tabs remain retrievable by their independent keys', async (t) => {
  const { controls } = databaseFixture(t);
  const first = { key: 'first-tab', blob: new Blob(['first']) };
  const second = { key: 'second-tab', blob: new Blob(['second']) };
  await imageStore(first);
  await imageStore(second);
  assert.equal(await imageStore(undefined, first.key), first);
  assert.equal(await imageStore(undefined, second.key), second);
  assert.equal(controls.closed, 4);
});

test('old current-slot images restore only when their saved key matches', async (t) => {
  const legacy = { key: 'image-123', blob: new Blob(['old image']) };
  databaseFixture(t, new Map([['current', legacy]]));
  assert.equal(await imageStore(undefined, legacy.key), legacy);
  assert.equal(await imageStore(undefined, 'unavailable'), undefined);
  assert.equal(await imageStore(), legacy);
});

test('clearing saved data waits for image deletion and removes only app-owned local keys', async (t) => {
  const { controls, records } = databaseFixture(t, new Map([['picture', { key: 'picture' }]]));
  const values = new Map([
    [SESSION_KEY, 'session'],
    ['fold-audio-volume', 'audio'],
    ['other-app', 'keep'],
  ]);
  let finished = false;
  const clearing = clearSavedData({ removeItem: (key) => values.delete(key) }).then(() => {
    finished = true;
  });
  await untilClearing(controls);
  assert.equal(finished, false);
  assert.equal(values.size, 3);
  controls.clearing();
  await clearing;
  assert.equal(records.size, 0);
  assert.equal(controls.closed, 1);
  assert.deepEqual([...values], [['other-app', 'keep']]);
});

test('failed image clearing reports failure, preserves data, and closes its database', async (t) => {
  const { controls, records } = databaseFixture(t, new Map([['picture', { key: 'picture' }]]));
  const storage = { removeItem: () => assert.fail('Deletion failed') };
  const failed = clearSavedData(storage);
  await untilClearing(controls);
  controls.clearError = new Error('Deletion failed');
  controls.clearing();
  await assert.rejects(failed, /Deletion failed/);
  assert.equal(records.size, 1);
  assert.equal(controls.closed, 1);
});

test('an unavailable image database reports failure without clearing local state', async (t) => {
  const { controls } = databaseFixture(t);
  controls.openError = new Error('Database denied');
  await assert.rejects(
    clearSavedData({ removeItem: () => assert.fail('Database unavailable') }),
    /Database denied/,
  );
});

test('localStorage deletion failures are reported rather than declaring success', async (t) => {
  const { controls } = databaseFixture(t);
  const clearing = clearSavedData({
    removeItem() {
      throw new Error('Storage denied');
    },
  });
  await untilClearing(controls);
  controls.clearing();
  await assert.rejects(clearing, /Storage denied/);
});
