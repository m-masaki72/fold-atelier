import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPaperModel, MODEL_PRESETS } from '../dist/js/fold-models.js';
import { focusCameraFrame } from '../dist/js/fold-camera.js';
import { VIEW_DIRECTION } from '../dist/js/fold-geometry.js';

test('focus keeps both hinge faces oblique throughout convex and concave folds', () => {
  const angles = new Set();
  let hinges = 0;
  for (const kind of [...MODEL_PRESETS.map((model) => model.id), 'study-077', 'study-100']) {
    const model = buildPaperModel({ kind });
    let previous = VIEW_DIRECTION;
    model.sequence.steps.forEach((step, index) => {
      if (step.kind !== 'hinge') return;
      const direction = focusCameraFrame(model, (index + 0.5) / model.sequence.count, previous).direction;
      previous = direction;
      assert.ok(Math.abs(direction.length() - 1) < 1e-8);
      const joint = model.parts[0].tree[step.joint];
      angles.add(Math.sign(joint.angle));
      hinges++;
      for (let tick = 0; tick <= 8; tick++) {
        const matrices = model.matrices((index + tick / 8) / model.sequence.count, { grounded: false });
        const facing = [step.parent, step.child].map((face) =>
          new THREE.Vector3(0, 0, 1).transformDirection(matrices[face]).dot(direction),
        );
        const context = `${kind}, hinge ${index + 1}, phase ${tick}/8`;
        assert.ok(facing[0] * facing[1] > 0, `${context}: the moving face must not flip edge-on`);
        for (const value of facing) {
          const angle = THREE.MathUtils.radToDeg(Math.acos(Math.abs(value)));
          assert.ok(angle > 20 && angle < 78, `${context}: face normal angle ${angle}`);
        }
        const axis = joint.axis.clone().transformDirection(matrices[step.parent]);
        const projectedLength = Math.sqrt(Math.max(0, 1 - axis.dot(direction) ** 2));
        assert.ok(projectedLength > 0.75, `${context}: the hinge must not be foreshortened`);
      }
    });
  }
  assert.ok(hinges > 450);
  assert.deepEqual([...angles].sort(), [-1, 1]);
});

test('a previous face-on or edge-on camera cannot override a readable fold angle', () => {
  for (const kind of ['cube', 'house', 'study-100']) {
    const model = buildPaperModel({ kind });
    const index = model.sequence.steps.findIndex((step) => step.kind === 'hinge');
    const step = model.sequence.steps[index];
    const matrices = model.matrices((index + 0.5) / model.sequence.count, { grounded: false });
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(matrices[step.child]);
    const axis = model.parts[0].tree[step.joint].axis.clone().transformDirection(matrices[step.parent]);
    for (const previous of [normal, axis]) {
      const start = focusCameraFrame(model, (index + 0.01) / model.sequence.count, previous);
      const end = focusCameraFrame(model, (index + 0.99) / model.sequence.count, previous);
      assert.ok(Math.abs(start.direction.dot(normal)) < Math.cos(THREE.MathUtils.degToRad(20)));
      assert.ok(Math.abs(start.direction.dot(axis)) < 0.65);
      assert.ok(start.direction.distanceTo(end.direction) < 1e-8, 'one fold uses one stable camera angle');
    }
  }
});

test('focus exposes both sides beside the active crease on simple solids and the block person', () => {
  for (const kind of ['cube', 'tetrahedron', 'person']) {
    const model = buildPaperModel({ kind });
    model.sequence.steps.forEach((step, index) => {
      if (step.kind !== 'hinge') return;
      const progress = (index + 0.5) / model.sequence.count;
      const { direction } = focusCameraFrame(model, progress);
      const matrices = model.matrices(progress, { grounded: false });
      const polygons = model.faces.map((face, i) =>
        face.corners.map((corner) => new THREE.Vector3(...corner).applyMatrix4(matrices[i])),
      );
      const joint = model.parts[0].tree[step.joint];
      const midpoint = joint.origin
        .clone()
        .addScaledVector(joint.axis, joint.length / 2)
        .applyMatrix4(matrices[step.parent]);
      for (const face of [step.parent, step.child]) {
        const center = polygons[face]
          .reduce((sum, point) => sum.add(point), new THREE.Vector3())
          .divideScalar(polygons[face].length);
        const point = midpoint.clone().lerp(center, 0.12);
        const ray = new THREE.Ray(point.addScaledVector(direction, 0.003), direction);
        const hit = new THREE.Vector3();
        const occluded = polygons.some(
          (polygon, i) =>
            i !== face &&
            polygon
              .slice(2)
              .some((_, j) => ray.intersectTriangle(polygon[0], polygon[j + 1], polygon[j + 2], false, hit)),
        );
        assert.equal(occluded, false, `${kind}, hinge ${index + 1}, face ${face} should be visible`);
      }
    });
  }
});
