import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPaperModel } from './dist/fold-models.js';
import { stepReplayPlan, completedProjection, playbackLabel } from './dist/fold-guidance.js';
import { paperDepthUnits, paperSortCenters, stablePaperTransparency } from './dist/fold-render.js';

test('replaying one hinge preserves other joints and can repeat the same completed step', () => {
  for (const kind of ['cube', 'person', 'study-100']) {
    const { sequence } = buildPaperModel({ kind });
    for (const progress of [0, 0.58, 1]) {
      const plan = stepReplayPlan(sequence, progress);
      const step = sequence.steps[plan.index];
      assert.equal(step.kind, 'hinge');
      const before = sequence.sample(plan.from),
        after = sequence.sample(plan.to);
      before.hingeProgress.forEach((angle, index) => {
        assert.equal(after.hingeProgress[index] - angle, index === step.joint ? 1 : 0);
      });
      assert.deepEqual(stepReplayPlan(sequence, plan.to, plan.index), plan);
    }
  }
});

test('completed reference includes every real face inside its view box', () => {
  for (const kind of ['person', 'tetrahedron', 'study-077']) {
    const model = buildPaperModel({ kind });
    const {
      polygons,
      viewBox: [x, y, width, height],
    } = completedProjection(model);
    assert.equal(polygons.length, model.faces.length);
    assert.equal(new Set(polygons.map((p) => p.index)).size, model.faces.length);
    assert.ok(polygons.some((p) => p.facing) && polygons.some((p) => !p.facing));
    polygons.forEach((p) =>
      p.points.forEach(([px, py]) => {
        assert.ok(px > x && px < x + width && py > y && py < y + height);
      }),
    );
  }
});

test('status distinguishes camera travel, opening, endpoint rests and one-step replay', () => {
  const state = { playing: true, fold: 0.6, direction: 1, hold: 0 };
  assert.equal(playbackLabel(state), '組み立て中');
  assert.equal(playbackLabel({ ...state, direction: -1 }), 'ひらいています');
  assert.equal(playbackLabel({ ...state, fold: 1, hold: 2 }), '完成 · ひと休み');
  assert.equal(playbackLabel({ ...state, settling: true }), '視点を移動中');
  assert.equal(playbackLabel({ playing: false, animation: { kind: 'replay' } }), 'この折り目を再生中');
  assert.equal(playbackLabel({ playing: false }), '一時停止中');
});

test('overlapping paper layers keep the same depth and transparency order as the camera moves', () => {
  const model = buildPaperModel({ kind: 'study-077' });
  const matrices = model.matrices(0.8, { grounded: false });
  const centers = paperSortCenters(model.faces, matrices);
  // These two terrace faces overlap at this intermediate pose, not at completion.
  assert.equal(centers[77][0], centers[91][0]);
  assert.equal(centers[77][1], centers[91][1]);
  assert.notEqual(centers[77][0], centers[77][1]);
  assert.notEqual(paperDepthUnits(77), paperDepthUnits(91));
  assert.ok((paperDepthUnits(model.faces.length - 1) * 80) / (2 ** 24 - 1) < 0.012);
  for (const direction of [
    [6, 7, 10],
    [-6, 7, 10],
    [6, -7, -10],
  ]) {
    const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 80);
    camera.position.set(...direction);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const items = [77, 91].map((index) => ({
      id: index,
      groupOrder: 0,
      renderOrder: 0,
      object: { userData: { paperSortDepth: centers[index][0].clone().project(camera).z } },
    }));
    assert.ok(stablePaperTransparency(items[0], items[1]) < 0);
    assert.deepEqual(
      items
        .reverse()
        .sort(stablePaperTransparency)
        .map((item) => item.id),
      [77, 91],
    );
  }
  const closed = paperSortCenters(model.faces, model.matrices(1, { grounded: false }));
  assert.notEqual(closed[77][0], closed[91][0]);
});
