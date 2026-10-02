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

test('delayed image restoration finishes before state is applied or controls become interactive', async () => {
  const image = deferred();
  const saved = { version: 1, spec: { kind: 'robot' }, fold: 0.73, imageKey: 'picture', cameraMode: 'focus' };
  let interactive = true;
  let applied;
  let active = false;
  const session = createSessionController({
    storage: { getItem: () => JSON.stringify(saved) },
    restoreArtwork: (key) => {
      assert.equal(key, 'picture');
      return image.promise;
    },
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
    initialize() {},
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
  image.resolve();
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
    restoreArtwork: async () => {
      throw new Error('Image decode failed');
    },
    apply() {
      assert.fail('Failed restore must not apply camera and playback state');
    },
    reset: () => {
      resets++;
    },
    notify() {},
  });
  await session.restore();
  assert.equal(resets, 1);
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
