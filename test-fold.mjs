import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { faceVertices, faceUVs, projectedUV, FACE_CORNERS, VIEW_DIRECTION } from './dist/fold-geometry.js';

test('flat net has six non-overlapping squares with five common hinges', () => {
  const faces = faceVertices(0);
  const centers = faces.map((face) =>
    face.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(0.25),
  );
  assert.equal(
    new Set(
      centers.map((p) =>
        p
          .toArray()
          .map((x) => x.toFixed(4))
          .join(','),
      ),
    ).size,
    6,
  );
  for (const face of faces) for (const point of face) assert.ok(Math.abs(point.y - 2.04) < 1e-10);
  const connections = [
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [1, 5],
  ];
  for (let step = 0; step <= 100; step++) {
    const current = faceVertices(step / 100);
    for (const [a, b] of connections) {
      assert.equal(
        current[a].filter((p) => current[b].some((q) => p.distanceTo(q) < 1e-9)).length,
        2,
        `hinge ${a}-${b} at ${step}`,
      );
    }
    for (const face of current) {
      for (let i = 0; i < 4; i++) assert.ok(Math.abs(face[i].distanceTo(face[(i + 1) % 4]) - 2) < 1e-9);
      for (const point of face) assert.ok(point.y >= 0.039999999, `paper penetrates floor at ${step}`);
    }
  }
});

test('closed cube has eight vertices, twelve paired edges and continuous artwork at every seam', () => {
  const faces = faceVertices(1),
    uvs = faceUVs();
  const points = new Map(),
    edges = new Map();
  const key = (p) =>
    p
      .toArray()
      .map((v) => v.toFixed(6))
      .join(',');
  faces.forEach((face, f) =>
    face.forEach((p, v) => {
      const id = key(p);
      if (!points.has(id)) points.set(id, []);
      points.get(id).push(uvs[f][v]);
      const edge = [id, key(face[(v + 1) % 4])].sort().join('|');
      edges.set(edge, (edges.get(edge) || 0) + 1);
    }),
  );
  assert.equal(points.size, 8);
  assert.equal(edges.size, 12);
  for (const count of edges.values()) assert.equal(count, 2);
  for (const entries of points.values()) {
    assert.equal(entries.length, 3);
    for (const uv of entries)
      for (let axis = 0; axis < 2; axis++) assert.ok(Math.abs(uv[axis] - entries[0][axis]) < 1e-10);
  }
});

test('UV projection stays within artwork and maps the viewing direction to the same pixel', () => {
  const vertices = faceVertices(1);
  for (const point of vertices.flat()) {
    const uv = projectedUV(point);
    assert.ok(uv.every((v) => v >= 0 && v <= 1));
    const alongRay = projectedUV(point.clone().addScaledVector(VIEW_DIRECTION, 3));
    assert.ok(uv.every((v, i) => Math.abs(v - alongRay[i]) < 1e-10));
  }
  assert.equal(FACE_CORNERS.length, 4);
});
