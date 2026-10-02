import test from 'node:test';
import assert from 'node:assert/strict';
import { FoldAudio } from '../dist/js/fold-audio.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture(t) {
  const audio = new FoldAudio();
  const resumes = [];
  const levels = [];
  audio.context = {
    state: 'suspended',
    currentTime: 0,
    resume() {
      const pending = deferred();
      resumes.push(pending);
      return pending.promise;
    },
  };
  audio.master = {
    gain: {
      cancelScheduledValues() {},
      setTargetAtTime(level) {
        levels.push(level);
      },
    },
  };
  audio.tick = () => {};
  t.after(() => clearInterval(audio.timer));
  return { audio, resumes, levels };
}

test('an older enable failure cannot undo the latest enable or report a stale error', async (t) => {
  const { audio, resumes, levels } = fixture(t);
  const older = audio.setEnabled(true);
  await audio.setEnabled(false);
  const latest = audio.setEnabled(true);
  audio.context.state = 'running';
  resumes[1].resolve();
  await latest;
  resumes[0].reject(new Error('Older resume failed'));
  await assert.doesNotReject(older);
  assert.equal(audio.enabled, true);
  assert.equal(levels.at(-1), 0.85);
  assert.ok(audio.timer);
});

test('an older enable completion after disabling does not report suspended audio as a failure', async (t) => {
  const { audio, resumes, levels } = fixture(t);
  const enabling = audio.setEnabled(true);
  await audio.setEnabled(false);
  resumes[0].resolve();
  await assert.doesNotReject(enabling);
  assert.equal(audio.enabled, false);
  assert.equal(levels.at(-1), 0);
  assert.equal(audio.timer, null);
});

test('a current resume failure is reported and stops existing playback', async (t) => {
  const { audio, resumes, levels } = fixture(t);
  const initial = audio.setEnabled(true);
  audio.context.state = 'running';
  resumes[0].resolve();
  await initial;
  const stops = [];
  audio.voices.add({ stop: (time) => stops.push(time) });
  audio.context.state = 'suspended';
  const retry = audio.setEnabled(true);
  const error = new Error('Current resume failed');
  resumes[1].reject(error);
  await assert.rejects(retry, (value) => value === error);
  assert.equal(audio.enabled, false);
  assert.equal(levels.at(-1), 0);
  assert.equal(audio.timer, null);
  assert.deepEqual(stops, [0.3]);
});

test('a current completion must actually start audio', async (t) => {
  const { audio, resumes, levels } = fixture(t);
  const enabling = audio.setEnabled(true);
  resumes[0].resolve();
  await assert.rejects(enabling, /Audio did not start/);
  assert.equal(audio.enabled, false);
  assert.equal(levels.at(-1), 0);
  assert.equal(audio.timer, null);
});

test('enabling that completes in a hidden tab stays muted until the tab returns', async (t) => {
  const { audio, resumes, levels } = fixture(t);
  const enabling = audio.setEnabled(true);
  audio.setVisible(false);
  audio.context.state = 'running';
  resumes[0].resolve();
  await enabling;
  assert.equal(audio.enabled, true);
  assert.equal(levels.at(-1), 0);
  assert.equal(audio.timer, null);
  audio.setVisible(true);
  assert.equal(levels.at(-1), 0.85);
  assert.ok(audio.timer);
});
