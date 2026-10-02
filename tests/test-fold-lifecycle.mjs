import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionController, startApp } from '../dist/js/fold-lifecycle.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('initialization finishes before state is applied or controls become interactive', async () => {
  const initialized = deferred();
  const saved = { version: 1, spec: { kind: 'robot' }, fold: 0.73, cameraMode: 'focus' };
  let interactive = true;
  let applied;
  let active = false;
  const session = createSessionController({
    storage: { getItem: () => JSON.stringify(saved) },
    apply: (value) => {
      applied = value;
    },
    notify() {},
    reset() {
      assert.fail('Valid saved state must restore');
    },
  });
  const starting = startApp({
    setInteractive: (value) => {
      interactive = value;
    },
    initialize: () => initialized.promise,
    restore: session.restore,
    activate: () => {
      active = true;
    },
    onError: assert.fail,
  });
  await Promise.resolve();
  assert.equal(interactive, false);
  assert.equal(active, false);
  assert.equal(applied, undefined);
  initialized.resolve();
  await starting;
  assert.equal(applied.spec.kind, 'robot');
  assert.equal(applied.fold, 0.73);
  assert.equal(applied.cameraMode, 'focus');
  assert.equal(interactive, true);
  assert.equal(active, true);
});

test('a failed restore resets the work and allows startup to finish', async () => {
  let resets = 0;
  const session = createSessionController({
    storage: { getItem: () => JSON.stringify({ version: 1, spec: { kind: 'cat' } }) },
    apply() {
      throw new Error('Saved model could not be built');
    },
    reset: () => {
      resets++;
    },
    notify() {},
  });
  await session.restore();
  assert.equal(resets, 1);
});

test('old picture and prompt settings are discarded while restoring the work and folding state', () => {
  let applied, notification;
  const session = createSessionController({
    storage: {
      getItem: () =>
        JSON.stringify({
          version: 1,
          spec: { kind: 'cat' },
          fold: 0.4,
          cameraMode: 'focus',
          imageKey: 'old-picture',
          artMode: true,
          prompt: '赤いロボット',
        }),
    },
    apply: (value) => {
      applied = value;
    },
    reset() {
      assert.fail('Old picture settings must not discard the saved model');
    },
    notify: (value) => {
      notification = value;
    },
  });
  session.restore();
  assert.equal(applied.spec.kind, 'cat');
  assert.equal(applied.fold, 0.4);
  assert.equal(applied.cameraMode, 'focus');
  assert.equal(Object.hasOwn(applied, 'imageKey'), false);
  assert.equal(Object.hasOwn(applied, 'artMode'), false);
  assert.equal(Object.hasOwn(applied, 'prompt'), false);
  assert.equal(notification, '前回の作品と折り具合を再開しました。');
});

test('initialization failure unlocks the page and never starts playback or restores state', async () => {
  let interactive = true;
  let reported;
  const error = new Error('WebGL unavailable');
  await startApp({
    setInteractive: (value) => {
      interactive = value;
    },
    initialize: async () => {
      throw error;
    },
    restore() {
      assert.fail('Initialization failed');
    },
    activate() {
      assert.fail('Initialization failed');
    },
    onError: (value) => {
      reported = value;
    },
  });
  assert.equal(reported, error);
  assert.equal(interactive, true);
});

test('saving skips unready and unchanged states but retries failed storage writes', () => {
  let value = null;
  let writes = 0;
  let blocked = true;
  const status = [];
  const session = createSessionController({
    storage: {
      getItem: () => null,
      setItem: () => {
        writes++;
        if (blocked) throw new Error('Quota');
      },
    },
    snapshot: () => value,
    onSave: (success) => status.push(success),
  });
  session.save();
  assert.equal(writes, 0);
  value = { spec: { kind: 'cube' }, fold: 0.5 };
  session.save();
  blocked = false;
  session.save();
  session.save();
  assert.equal(writes, 2);
  assert.deepEqual(status, [false, true]);
});
