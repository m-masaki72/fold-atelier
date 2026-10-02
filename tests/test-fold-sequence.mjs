import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaperModel } from '../dist/js/fold-models.js';
import { advancePlayback, END_HOLD_SECONDS } from '../dist/js/fold-sequence.js';
import * as THREE from 'three';
import { paperWallPositions, foldFramePoints, fitPaperFrame } from '../dist/js/fold-display.js';
import { VIEW_DIRECTION } from '../dist/js/fold-geometry.js';

for (const kind of ['cube', 'person', 'cat', 'study-077']) {
  test(`${kind}: exactly one physical hinge rotates at a time, from leaves toward the root`, () => {
    const model = buildPaperModel({ kind }),
      { sequence } = model,
      part = model.parts[0];
    const positions = new Map(sequence.steps.map((step, i) => [step.joint, i]));
    assert.equal(
      sequence.steps.filter((s) => s.kind === 'hinge').length,
      part.tree.filter((j) => Math.abs(j.angle) > 1e-7).length,
    );
    for (let i = 0; i < sequence.count; i++) {
      const step = sequence.steps[i];
      const before = model.matrices((i + 0.2) / sequence.count),
        after = model.matrices((i + 0.8) / sequence.count);
      const changed = [];
      part.tree.forEach((joint, index) => {
        const a = before[joint.parent].clone().invert().multiply(before[joint.child]);
        const b = after[joint.parent].clone().invert().multiply(after[joint.child]);
        if (a.elements.some((n, k) => Math.abs(n - b.elements[k]) > 1e-7)) changed.push(index);
        if (positions.has(index)) {
          part.tree.forEach((child, c) => {
            if (child.parent === joint.child && positions.has(c))
              assert.ok(positions.get(c) < positions.get(index));
          });
        }
      });
      assert.deepEqual(changed, step.kind === 'hinge' ? [step.joint] : []);
      if (step.kind === 'hinge') {
        const start = model.matrices((i + 0.2) / sequence.count, { grounded: false });
        const end = model.matrices((i + 0.8) / sequence.count, { grounded: false });
        const moving = start.flatMap((frame, f) =>
          frame.elements.some((value, k) => Math.abs(value - end[f].elements[k]) > 1e-7) ? [f] : [],
        );
        assert.deepEqual(
          [...step.movingFaces].sort((a, b) => a - b),
          moving,
        );
      }
    }
    assert.ok(
      sequence
        .sample(0)
        .hingeProgress.every((value, i) => value === (Math.abs(part.tree[i].angle) > 1e-7 ? 0 : 1)),
    );
    assert.ok(sequence.sample(1).hingeProgress.every((value) => value === 1));
    assert.equal(sequence.sample(1).active, null);
    for (let i = 1; i < sequence.count; i++) {
      assert.ok(Math.abs(sequence.target(i / sequence.count, -1) - (i - 1) / sequence.count) < 1e-10);
      assert.ok(Math.abs(sequence.target(i / sequence.count, 1) - (i + 1) / sequence.count) < 1e-10);
      assert.ok(Math.abs(sequence.target((i + 0.3) / sequence.count, -1) - i / sequence.count) < 1e-10);
    }
  });
}

test('slow playback holds endpoints, reverses continuously, and a tour waits for assembly', () => {
  const sequence = buildPaperModel({ kind: 'person' }).sequence;
  let state = { progress: 0, direction: 1, hold: 1 };
  state = advancePlayback(state, 0.5, sequence);
  assert.equal(state.progress, 0);
  state = advancePlayback(state, 0.5, sequence);
  const start = state;
  state = advancePlayback(state, sequence.duration / 2, sequence, true);
  assert.ok(Math.abs(state.progress - 0.5) < 1e-9);
  assert.equal(state.nextModel, false);
  state = advancePlayback(state, sequence.duration / 2, sequence, true);
  assert.equal(state.progress, 1);
  assert.equal(state.nextModel, false);
  state = advancePlayback(state, END_HOLD_SECONDS - 0.1, sequence, true);
  assert.equal(state.nextModel, false);
  state = advancePlayback(state, 0.11, sequence, true);
  assert.equal(state.nextModel, true);
  let loop = advancePlayback(start, sequence.duration, sequence);
  loop = advancePlayback(loop, END_HOLD_SECONDS, sequence);
  loop = advancePlayback(loop, sequence.duration / 2, sequence);
  assert.equal(loop.nextModel, false);
  assert.ok(Math.abs(loop.progress - 0.5) < 1e-9);
});

test('paper thickness faces outward and never inserts a wall across a connected hinge', () => {
  for (const kind of ['cube', 'person', 'study-009', 'study-077']) {
    const model = buildPaperModel({ kind });
    assert.equal(
      model.faces.flatMap((f) => f.creaseEdges).filter(Boolean).length,
      2 * model.sequence.steps.filter((s) => s.kind === 'hinge').length,
    );
    for (const face of model.faces) {
      const positions = paperWallPositions(face.corners, face.foldEdges);
      assert.equal(positions.length, face.foldEdges.filter((v) => !v).length * 18);
      let offset = 0;
      face.corners.forEach((point, i) => {
        assert.ok(!face.creaseEdges[i] || face.foldEdges[i]);
        if (face.foldEdges[i]) return;
        const a = new THREE.Vector3(...point),
          b = new THREE.Vector3(...face.corners[(i + 1) % face.corners.length]);
        const outward = new THREE.Vector3(b.y - a.y, a.x - b.x, 0).normalize();
        for (let t = 0; t < 2; t++) {
          const p = new THREE.Vector3().fromArray(positions, offset);
          const q = new THREE.Vector3().fromArray(positions, offset + 3);
          const r = new THREE.Vector3().fromArray(positions, offset + 6);
          assert.ok(q.sub(p).cross(r.sub(p)).normalize().dot(outward) > 0.999);
          offset += 9;
        }
      });
    }
  }
});

test('one stable camera envelope contains the full step at desktop and phone aspect ratios', () => {
  const direction = VIEW_DIRECTION.clone().normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
  const up = new THREE.Vector3().crossVectors(direction, right).normalize();
  for (const kind of ['cube', 'person', 'study-077']) {
    const model = buildPaperModel({ kind });
    for (const index of [0, Math.floor(model.sequence.count * 0.58), model.sequence.count - 1]) {
      const progress = (index + 0.5) / model.sequence.count;
      for (const focus of [false, true]) {
        const points = foldFramePoints(model, progress, focus);
        for (const aspect of [390 / 360, 1.8]) {
          const frame = fitPaperFrame(points, direction, aspect);
          const ids = (focus && model.sequence.steps[index].movingFaces) || model.faces.map((_, i) => i);
          for (let tick = 0; tick <= 20; tick++) {
            const matrices = model.matrices((index + tick / 20) / model.sequence.count, { grounded: false });
            for (const id of ids)
              for (const corner of model.faces[id].corners) {
                const p = new THREE.Vector3(...corner).applyMatrix4(matrices[id]).sub(frame.target);
                assert.ok(Math.abs(p.dot(right)) < frame.half * aspect);
                assert.ok(
                  p.dot(up) < frame.half * (1 - frame.shift) && p.dot(up) > -frame.half * (1 + frame.shift),
                );
              }
          }
        }
      }
    }
  }
});
