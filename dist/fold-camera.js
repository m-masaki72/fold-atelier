import * as THREE from 'three';
import { VIEW_DIRECTION } from './fold-geometry.js';
import { foldFramePoints } from './fold-display.js';

// One envelope for the entire assembly: the fixed camera never follows a step.
export function fixedCameraPoints(model) {
  const bounds = new THREE.Box3();
  for (let tick = 0; tick <= model.sequence.count * 4; tick++) {
    const matrices = model.matrices(tick / (model.sequence.count * 4), { grounded: false });
    model.faces.forEach((face, index) => {
      for (const corner of face.corners)
        bounds.expandByPoint(new THREE.Vector3(...corner).applyMatrix4(matrices[index]));
    });
  }
  return [0, 1, 2, 3, 4, 5, 6, 7].map(
    (i) =>
      new THREE.Vector3(
        i & 1 ? bounds.max.x : bounds.min.x,
        i & 2 ? bounds.max.y : bounds.min.y,
        i & 4 ? bounds.max.z : bounds.min.z,
      ),
  );
}

function geometryAt(model, progress, step) {
  const matrices = model.matrices(progress, { grounded: false });
  const polygons = model.faces.map((face, i) =>
    face.corners.map((p) => new THREE.Vector3(...p).applyMatrix4(matrices[i])),
  );
  const joint = model.parts[0].tree[step.joint];
  const a = joint.origin.clone().applyMatrix4(matrices[joint.parent]);
  const b = joint.origin
    .clone()
    .addScaledVector(joint.axis, joint.length)
    .applyMatrix4(matrices[joint.parent]);
  const targets = [step.parent, step.child].flatMap((face) => {
    const center = polygons[face]
      .reduce((sum, p) => sum.add(p), new THREE.Vector3())
      .divideScalar(polygons[face].length);
    return [
      center,
      a.clone().lerp(b, 0.25).lerp(center, 0.16),
      a.clone().lerp(b, 0.75).lerp(center, 0.16),
    ].map((point) => ({ face, point }));
  });
  const triangles = polygons.flatMap((p, face) =>
    p.slice(2).map((_, i) => ({ face, a: p[0], b: p[i + 1], c: p[i + 2] })),
  );
  return {
    normals: [step.parent, step.child].map((face) =>
      new THREE.Vector3(0, 0, 1).transformDirection(matrices[face]),
    ),
    axis: b.clone().sub(a).normalize(),
    targets,
    triangles,
  };
}

// Test several sides of the hinge at the start, middle and end of its motion.
// Keep both sides oblique before comparing visibility and camera travel.
export function focusCameraFrame(model, progress, previousDirection = VIEW_DIRECTION) {
  const sample = model.sequence.sample(progress),
    step = sample.active;
  if (step?.kind !== 'hinge')
    return { points: foldFramePoints(model, progress), direction: VIEW_DIRECTION.clone() };
  const geometry = [0.18, 0.5, 0.82].map((t) =>
    geometryAt(model, (sample.index + t) / model.sequence.count, step),
  );
  const previous = previousDirection.clone().normalize();
  const candidates = [previous, VIEW_DIRECTION.clone()];
  const { axis, normals } = geometry[1];
  for (let i = 0; i < 16; i++) {
    const across = normals[1].clone().applyAxisAngle(axis, (i * Math.PI) / 8);
    for (const along of [-0.7, -0.45, 0.45, 0.7])
      candidates.push(across.clone().addScaledVector(axis, along).normalize());
  }
  const oblique = candidates.filter((direction) => {
    const along = Math.abs(axis.dot(direction));
    return (
      along >= 0.25 &&
      along <= 0.62 &&
      Math.abs(direction.y) < 0.96 &&
      geometry.every(({ normals }) => {
        const facing = normals.map((normal) => normal.dot(direction));
        return (
          facing[0] * facing[1] > 0 &&
          facing.every((value) => Math.abs(value) >= 0.22 && Math.abs(value) <= 0.94)
        );
      })
    );
  });
  const ray = new THREE.Ray(),
    hit = new THREE.Vector3();
  const motion = geometry[2].targets[3].point.clone().sub(geometry[0].targets[3].point).normalize();
  let best = candidates[0],
    bestScore = -Infinity;
  for (const direction of oblique.length ? oblique : candidates) {
    let score = 0;
    for (const { normals, targets, triangles } of geometry) {
      score += 2 * Math.min(...normals.map((normal) => 1 - Math.abs(Math.abs(normal.dot(direction)) - 0.65)));
      for (const { face, point } of targets) {
        ray.set(point.clone().addScaledVector(direction, 0.003), direction);
        const occluded = triangles.some(
          (t) => t.face !== face && ray.intersectTriangle(t.a, t.b, t.c, false, hit),
        );
        score += occluded ? 0 : 0.9;
      }
    }
    score += 1.2 * direction.dot(previous);
    score += Math.sqrt(Math.max(0, 1 - motion.dot(direction) ** 2));
    score += direction.y >= 0 ? 0.25 : 0;
    if (score > bestScore) {
      bestScore = score;
      best = direction;
    }
  }
  // Keep the attached parent in shot, so the fold retains its spatial context.
  const points = foldFramePoints(model, (sample.index + 0.5) / model.sequence.count, true);
  const matrices = model.matrices((sample.index + 0.5) / model.sequence.count, { grounded: false });
  for (const corner of model.faces[step.parent].corners)
    points.push(new THREE.Vector3(...corner).applyMatrix4(matrices[step.parent]));
  return { points, direction: best.clone().normalize() };
}
