import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPaperModel, polygonsOverlap } from './dist/fold-models.js';

test('new proportions search a connected net that can be saved and restored without changing folding', () => {
  for (const kind of ['cube', 'tetrahedron', 'octahedron']) {
    const spec = { kind, stature: 1.11 };
    const searched = buildPaperModel(spec);
    const part = searched.parts[0];
    const net = { root: part.root, tree: part.tree.map(({ parent, child }) => [parent, child]) };
    const reached = new Set([net.root]);
    for (const [parent, child] of net.tree) {
      assert.ok(reached.has(parent));
      assert.ok(!reached.has(child));
      reached.add(child);
    }
    assert.equal(reached.size, searched.faces.length);
    const flat = searched.vertices(0);
    assert.ok(flat.flat().every((point) => Math.abs(point.y - 0.04) < 1e-8));
    const polygons = flat.map((face) => face.map((point) => new THREE.Vector2(point.x, point.z)));
    for (let a = 0; a < polygons.length; a++)
      for (let b = a + 1; b < polygons.length; b++)
        assert.equal(polygonsOverlap(polygons[a], polygons[b]), false);
    const restored = buildPaperModel(spec, net);
    assert.deepEqual(restored.faces, searched.faces);
    assert.deepEqual(restored.uvs, searched.uvs);
    for (const progress of [0, 0.17, 0.5, 0.83, 1]) {
      assert.deepEqual(restored.matrices(progress), searched.matrices(progress));
      assert.deepEqual(
        restored.matrices(progress, { grounded: false }),
        searched.matrices(progress, { grounded: false }),
      );
    }
  }
});

test('net overlap excludes shared edges and corners but detects interior crossings', () => {
  const polygon = (points) => points.map(([x, y]) => new THREE.Vector2(x, y));
  const square = polygon([
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
  ]);
  const touchingEdge = polygon([
    [2, 0],
    [3, 0],
    [3, 1],
    [2, 1],
  ]);
  const touchingCorner = polygon([
    [2, 2],
    [3, 2],
    [3, 3],
    [2, 3],
  ]);
  const crossing = polygon([
    [1, -1],
    [3, 1],
    [1, 3],
    [-1, 1],
  ]);
  const separated = polygon([
    [1.8, 3],
    [3, 1.8],
    [3, 3],
  ]);
  for (const [other, overlaps] of [
    [touchingEdge, false],
    [touchingCorner, false],
    [crossing, true],
    [separated, false],
  ]) {
    assert.equal(polygonsOverlap(square, other), overlaps);
    assert.equal(polygonsOverlap(other, square), overlaps);
  }
});
