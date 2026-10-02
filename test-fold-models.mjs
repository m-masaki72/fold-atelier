import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  buildPaperModel,
  MODEL_PRESETS,
  COLLECTION,
  parseModelPrompt,
  polygonsOverlap,
  recipe,
  convexFaces,
} from './dist/fold-models.js';

const key = (p) =>
  p
    .toArray()
    .map((v) => (Math.abs(v) < 1e-7 ? '0.000000' : v.toFixed(6)))
    .join(',');
for (const preset of MODEL_PRESETS) {
  test(`${preset.id}: a single rigid, connected, non-overlapping net closes into one watertight surface`, () => {
    const model = buildPaperModel({ kind: preset.id });
    assert.equal(model.parts.length, 1);
    assert.equal(model.sheetCount, 1);
    assert.equal(model.parts[0].tree.length, model.faces.length - 1);
    const closed = model.vertices(1),
      flat = model.vertices(0);
    const y = flat[0][0].y;
    for (const face of flat)
      for (const point of face) assert.ok(Math.abs(point.y - y) < 1e-8, 'net is planar');
    for (let a = 0; a < flat.length; a++)
      for (let b = a + 1; b < flat.length; b++) {
        const project = (face) => face.map((p) => new THREE.Vector2(p.x, p.z));
        assert.equal(
          polygonsOverlap(project(flat[a]), project(flat[b])),
          false,
          `flat panels ${a} and ${b} overlap`,
        );
      }
    for (let step = 0; step <= 100; step++) {
      const current = model.vertices(step / 100);
      let offset = 0;
      for (const part of model.parts) {
        for (const joint of part.tree) {
          const a = current[offset + joint.parent],
            b = current[offset + joint.child];
          assert.ok(
            a.filter((p) => b.some((q) => p.distanceTo(q) < 1e-8)).length >= 2,
            `hinge detached at ${step}`,
          );
        }
        offset += part.faces.length;
      }
      current.forEach((face, f) =>
        face.forEach((p, i) => {
          assert.ok(p.y >= 0.03999999, 'no floor penetration');
          for (let j = i + 1; j < face.length; j++)
            assert.ok(
              Math.abs(p.distanceTo(face[j]) - closed[f][i].distanceTo(closed[f][j])) < 1e-8,
              'rigid face',
            );
        }),
      );
    }
    let offset = 0;
    for (const part of model.parts) {
      const edges = new Map(),
        vertexUV = new Map();
      for (let f = 0; f < part.faces.length; f++) {
        const face = closed[offset + f];
        face.forEach((point, i) => {
          const edge = [key(point), key(face[(i + 1) % face.length])].sort().join('|');
          edges.set(edge, (edges.get(edge) || 0) + 1);
          const uv = model.uvs[offset + f][i];
          assert.ok(
            uv.every((x) => x >= 0 && x <= 1),
            'UV in artwork',
          );
          const old = vertexUV.get(key(point));
          if (old)
            assert.ok(
              uv.every((x, axis) => Math.abs(x - old[axis]) < 1e-8),
              'continuous artwork',
            );
          else vertexUV.set(key(point), uv);
        });
      }
      for (const count of edges.values()) assert.equal(count, 2, 'every edge is closed');
      assert.equal(vertexUV.size - edges.size + part.faces.length, 2, 'Euler characteristic');
      offset += part.faces.length;
    }
  });
}

test('mock prompt preserves the requested motif, supported color and stature', () => {
  assert.deepEqual(parseModelPrompt('赤い、背の高いロボット'), {
    kind: 'robot',
    color: '#b8503e',
    colorName: '赤',
    stature: 1.3,
  });
  assert.equal(parseModelPrompt('マイクラの人').kind, 'person');
  assert.equal(parseModelPrompt('青い十二面体').kind, 'dodecahedron');
  assert.equal(parseModelPrompt('空飛ぶドラゴン'), null);
  const heights = [1, 1.3].map((stature) => {
    const model = buildPaperModel({ kind: 'robot', stature });
    const points = model.vertices(1).flat();
    return Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y));
  });
  assert.ok(Math.abs(heights[1] / heights[0] - 1.3) < 1e-9);
});

test('100 distinct complex models: one sheet, no overlap, closed surfaces and attached hinges throughout folding', () => {
  assert.equal(COLLECTION.length, 100);
  const signatures = new Set();
  for (const entry of COLLECTION) {
    const model = buildPaperModel({ kind: entry.id });
    assert.equal(model.sheetCount, 1);
    assert.equal(model.faces.length, entry.faces);
    assert.ok(model.faces.length >= 40, `${entry.id}: complex surface`);
    const part = model.parts[0];
    assert.equal(part.tree.length, model.faces.length - 1);
    const reached = new Set([part.root]);
    for (const joint of part.tree) {
      assert.ok(reached.has(joint.parent));
      assert.ok(!reached.has(joint.child));
      reached.add(joint.child);
    }
    assert.equal(reached.size, model.faces.length);
    const flat = model.vertices(0),
      y = flat[0][0].y;
    const projected = flat.map((face) => face.map((p) => new THREE.Vector2(p.x, p.z)));
    assert.ok(flat.flat().every((p) => Math.abs(p.y - y) < 1e-7));
    for (let a = 0; a < flat.length; a++)
      for (let b = a + 1; b < flat.length; b++)
        assert.equal(polygonsOverlap(projected[a], projected[b]), false, `${entry.id}: panels ${a}/${b}`);
    const closed = model.vertices(1),
      edges = new Map(),
      vertexSet = new Set();
    for (const face of closed)
      face.forEach((p, i) => {
        vertexSet.add(key(p));
        const edge = [key(p), key(face[(i + 1) % face.length])].sort().join('|');
        edges.set(edge, (edges.get(edge) || 0) + 1);
      });
    assert.ok(
      [...edges.values()].every((n) => n === 2),
      `${entry.id}: watertight`,
    );
    assert.equal(vertexSet.size - edges.size + closed.length, 2);
    signatures.add([...vertexSet].sort().join('|'));
    for (const fold of [0, 0.17, 0.38, 0.62, 0.85, 1]) {
      const current = model.vertices(fold);
      for (const joint of part.tree) {
        const shared = part.faces[joint.parent].ids.filter((id) => part.faces[joint.child].ids.includes(id));
        for (const id of shared) {
          const a = current[joint.parent][part.faces[joint.parent].ids.indexOf(id)],
            b = current[joint.child][part.faces[joint.child].ids.indexOf(id)];
          assert.ok(a.distanceTo(b) < 1e-7, `${entry.id}: hinge at ${fold}`);
        }
      }
      current.forEach((face, f) =>
        face.forEach((p, i) => {
          assert.ok(p.y >= 0.0399999);
          assert.ok(
            Math.abs(
              p.distanceTo(face[(i + 1) % face.length]) -
                closed[f][i].distanceTo(closed[f][(i + 1) % face.length]),
            ) < 1e-7,
          );
        }),
      );
    }
  }
  assert.equal(signatures.size, 100, 'geometry differs, not only color');
});

test('joined characters have only exterior faces; hidden joining caps are removed', () => {
  for (const { id } of MODEL_PRESETS.slice(0, 6)) {
    const model = buildPaperModel({ kind: id });
    const solids = recipe({ kind: id }).map((part) => {
      const vertices = part.vertices.map((p) =>
        new THREE.Vector3(...p).add(new THREE.Vector3(...part.position)),
      );
      return convexFaces(vertices).map((f) => ({ normal: f.normal, d: f.normal.dot(vertices[f.ids[0]]) }));
    });
    const inside = (p) => solids.some((planes) => planes.every(({ normal, d }) => normal.dot(p) - d <= 1e-8));
    for (const face of model.parts[0].faces) {
      const center = face.corners
        .reduce((sum, p) => sum.add(p), new THREE.Vector3())
        .divideScalar(face.corners.length)
        .applyMatrix4(face.frame);
      assert.equal(inside(center.clone().addScaledVector(face.normal, 1e-5)), false, `${id}: outward is air`);
      assert.equal(
        inside(center.clone().addScaledVector(face.normal, -1e-5)),
        true,
        `${id}: inward is solid`,
      );
    }
  }
});
