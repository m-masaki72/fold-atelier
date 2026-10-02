import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPaperModel } from './dist/fold-models.js';
import { artworkProjection, VIEW_DIRECTION } from './dist/fold-geometry.js';

test('flat net has six non-overlapping squares with five common hinges', () => {
  const model = buildPaperModel({ kind: 'cube' });
  const faces = model.vertices(0);
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
  for (const face of faces) for (const point of face) assert.ok(Math.abs(point.y - 0.04) < 1e-10);
  const connections = model.parts[0].tree.map(({ parent, child }) => [parent, child]);
  assert.equal(connections.length, 5);
  for (let step = 0; step <= 100; step++) {
    const current = model.vertices(step / 100);
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
  const model = buildPaperModel({ kind: 'cube' });
  const faces = model.vertices(1),
    uvs = model.uvs;
  const points = new Map(),
    edges = new Map();
  const key = (p) =>
    p
      .toArray()
      .map((v) => (Math.abs(v) < 1e-7 ? '0.000000' : v.toFixed(6)))
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
  for (const kind of ['cube', 'person', 'study-077']) {
    const model = buildPaperModel({ kind });
    const vertices = model.vertices(1);
    const project = artworkProjection(vertices.flat());
    vertices.forEach((face, index) =>
      face.forEach((point, corner) => {
        const uv = project(point);
        assert.deepEqual(uv, model.uvs[index][corner]);
        assert.ok(uv.every((value) => value >= 0 && value <= 1));
        const alongRay = project(point.clone().addScaledVector(VIEW_DIRECTION, 3));
        assert.ok(uv.every((value, axis) => Math.abs(value - alongRay[axis]) < 1e-10));
      }),
    );
  }
});
