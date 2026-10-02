import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPaperModel } from './dist/fold-models.js';
import { VIEW_DIRECTION } from './dist/fold-geometry.js';
import { fixedCameraPoints, focusCameraFrame } from './dist/fold-camera.js';
import { fitPaperFrame } from './dist/fold-display.js';
import { paperTone, paperRustle, audibleFold } from './dist/fold-audio.js';
import { validateSession, writeSession, readSession } from './dist/fold-session.js';

test('a fixed camera contains every assembly stage without moving or changing its zoom', () => {
  const direction = VIEW_DIRECTION.clone().normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
  const up = new THREE.Vector3().crossVectors(direction, right).normalize();
  for (const kind of ['cube', 'person', 'study-077']) {
    const model = buildPaperModel({ kind }),
      points = fixedCameraPoints(model);
    for (const aspect of [0.8, 1.8]) {
      const frame = fitPaperFrame(points, direction, aspect, { top: 0.06, bottom: 0.06 });
      for (let tick = 0; tick <= 150; tick++) {
        const matrices = model.matrices(tick / 150, { grounded: false });
        model.faces.forEach((face, i) =>
          face.corners.forEach((corner) => {
            const p = new THREE.Vector3(...corner).applyMatrix4(matrices[i]).sub(frame.target);
            assert.ok(Math.abs(p.dot(right)) < frame.half * aspect);
            assert.ok(Math.abs(p.dot(up)) < frame.half);
          }),
        );
      }
    }
  }
});

test('focus angles change with the hinge and keep the moving branch and parent in frame', () => {
  const model = buildPaperModel({ kind: 'study-077' });
  const directions = [];
  for (const progress of [0, 0.23, 0.58, 0.8, 0.93, 1]) {
    const focus = focusCameraFrame(model, progress);
    assert.ok(Math.abs(focus.direction.length() - 1) < 1e-8);
    const frame = fitPaperFrame(focus.points, focus.direction, 0.8, { top: 0.06, bottom: 0.06 });
    assert.ok(frame.half > 0 && Number.isFinite(frame.half));
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), focus.direction).normalize();
    const up = new THREE.Vector3().crossVectors(focus.direction, right).normalize();
    for (const point of focus.points) {
      const p = point.clone().sub(frame.target);
      assert.ok(Math.abs(p.dot(right)) < frame.half * 0.8);
      assert.ok(Math.abs(p.dot(up)) < frame.half);
    }
    directions.push(focus.direction);
  }
  assert.ok(directions.some((d) => d.angleTo(directions[0]) > 0.3));
});

test('paper sound triggers once per moving hinge in both directions and skips the final pose', () => {
  const { sequence } = buildPaperModel({ kind: 'person' });
  for (const direction of [1, -1]) {
    const heard = [];
    for (let i = 0; i < sequence.count * 100; i++) {
      const a = i / (sequence.count * 100),
        b = (i + 1) / (sequence.count * 100);
      const index = audibleFold(sequence, direction > 0 ? a : 1 - a, direction > 0 ? b : 1 - b);
      if (index !== null) heard.push(index);
    }
    const expected = sequence.steps.flatMap((step, i) => (step.kind === 'hinge' ? [i] : []));
    assert.deepEqual(heard, direction > 0 ? expected : expected.reverse());
  }
});

test('synthesized music and paper sounds are finite, bounded, and start and end quietly', () => {
  for (const samples of [paperTone(41), paperTone(74), paperRustle(32)]) {
    assert.ok(samples.every((sample) => Number.isFinite(sample) && Math.abs(sample) < 0.5));
    const rms = Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length);
    assert.ok(rms > 0.005 && rms < 0.2);
    assert.ok(Math.abs(samples[0]) < 0.001);
    assert.ok(Math.abs(samples.at(-1)) < 0.001);
  }
  assert.notDeepEqual(paperRustle(31), paperRustle(32));
});

test('resume persists selected geometry, progress and camera; bad or blocked storage falls back safely', () => {
  const storage = {
    value: null,
    getItem() {
      return this.value;
    },
    setItem(_, value) {
      this.value = value;
    },
  };
  const session = {
    spec: { kind: 'robot', color: '#b8503e', stature: 1.3 },
    fold: 0.58,
    cameraMode: 'focus',
    paper: 'tracing',
    playing: false,
    camera: { position: [4, 3, 6], target: [0, 1, 0], zoom: 1.5, half: 4, manual: true },
    visited: ['study-077'],
    history: ['study-077'],
    historyIndex: 0,
  };
  assert.equal(writeSession(session, storage), true);
  const saved = readSession(storage);
  for (const key of Object.keys(session)) assert.deepEqual(saved[key], session[key]);
  assert.equal(validateSession({ version: 1, spec: { kind: 'missing' } }), null);
  assert.equal(validateSession({ version: 2, spec: { kind: 'person' } }), null);
  storage.value = '{broken';
  assert.equal(readSession(storage), null);
  const blocked = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('full');
    },
  };
  assert.equal(readSession(blocked), null);
  assert.equal(writeSession(session, blocked), false);
});
