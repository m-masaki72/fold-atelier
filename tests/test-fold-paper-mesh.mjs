import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FoldPaperMesh } from '../dist/js/fold-paper-mesh.js';
import { buildPaperModel } from '../dist/js/fold-models.js';

const previousDocument = globalThis.document;
before(() => {
  // Canvas drawing is browser-owned; these tests exercise real Three resources and transforms.
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({
        fillRect() {},
        beginPath() {},
        arc() {},
        fill() {},
        createRadialGradient: () => ({ addColorStop() {} }),
      }),
    }),
  };
});
after(() => {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
});

function observeDisposal(resources) {
  const counts = new Map();
  for (const resource of new Set(resources.filter(Boolean))) {
    counts.set(resource, 0);
    resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1));
  }
  return counts;
}

function modelResources(paper) {
  return paper.faces.flatMap(({ front, walls, outline, creases, paint }) => [
    front.geometry,
    walls.geometry,
    outline.geometry,
    creases.geometry,
    outline.material,
    creases.material,
    paint,
    paint.map,
  ]);
}

test('paper mesh keeps shared face geometry, crease endpoints and bounds aligned with every pose', () => {
  const paper = new FoldPaperMesh();
  for (const kind of ['person', 'cube', 'study-077']) {
    const model = buildPaperModel({ kind });
    paper.setModel(model);
    assert.equal(paper.faces.length, model.faces.length);
    assert.equal(paper.children.length, model.faces.length + 3);
    for (const [index, { group, front, back, walls, outline, creases }] of paper.faces.entries()) {
      assert.equal(front.geometry, back.geometry);
      assert.equal(front.parent, group);
      assert.equal(back.parent, group);
      assert.equal(
        walls.geometry.getAttribute('position').count,
        model.faces[index].foldEdges.filter((connected) => !connected).length * 6,
      );
      assert.equal(
        outline.geometry.instanceCount,
        model.faces[index].foldEdges.filter((connected) => !connected).length * 2,
      );
      assert.equal(creases.geometry.instanceCount, model.faces[index].creaseEdges.filter(Boolean).length * 2);
    }
    for (const progress of [0, 0.23, 0.58, 0.8, 1]) {
      const { active } = model.sequence.sample(progress);
      paper.setFold(progress, active);
      const matrices = model.matrices(progress, { grounded: false });
      const expectedBounds = new THREE.Box3();
      for (const [index, face] of paper.faces.entries()) {
        assert.deepEqual(face.group.matrix.elements, matrices[index].elements);
        for (const corner of model.faces[index].corners)
          expectedBounds.expandByPoint(new THREE.Vector3(...corner).applyMatrix4(matrices[index]));
        const expectedHighlight = active?.movingFaces.includes(index)
          ? index === active.child
            ? 0.42
            : 0.2
          : 0;
        assert.ok(
          face.front.geometry
            .getAttribute('foldHighlight')
            .array.every((value) => value === Math.fround(expectedHighlight)),
        );
      }
      assert.deepEqual(paper.bounds, expectedBounds);
      assert.equal(paper.groundShadow.visible, progress > 0.01);
      assert.equal(paper.activeCrease.visible, active?.kind === 'hinge');
      if (active?.kind === 'hinge') {
        const joint = model.parts[0].tree[active.joint];
        const start = joint.origin.clone().applyMatrix4(matrices[joint.parent]);
        const end = joint.origin
          .clone()
          .addScaledVector(joint.axis, joint.length)
          .applyMatrix4(matrices[joint.parent]);
        const attributes = paper.activeCrease.geometry.attributes;
        assert.ok(
          new THREE.Vector3().fromBufferAttribute(attributes.instanceStart, 0).distanceTo(start) < 1e-5,
        );
        assert.ok(new THREE.Vector3().fromBufferAttribute(attributes.instanceEnd, 0).distanceTo(end) < 1e-5);
        assert.ok(Math.abs(attributes.instanceDistanceEnd.getX(0) - start.distanceTo(end)) < 1e-5);
      }
    }
  }
  paper.dispose();
});

test('colored paper retains front patterns and plain back surfaces when child order changes', () => {
  const paper = new FoldPaperMesh();
  paper.setModel(buildPaperModel({ kind: 'person' }));
  for (const face of paper.faces) face.group.children.reverse();
  paper.setPaper('tracing');
  for (const face of paper.faces) {
    assert.equal(face.front.material, face.paint);
    assert.equal(face.back.material, paper.backMaterial);
    assert.equal(face.back.material.map, null);
    assert.equal(face.front.geometry.getAttribute('uv'), undefined);
    assert.equal(
      face.front.geometry.getAttribute('uv1').count,
      face.front.geometry.getAttribute('position').count,
    );
    if (face.paint.map) assert.equal(face.paint.map.channel, 1);
    assert.equal(face.front.material.opacity, 0.62);
    assert.equal(face.back.material.depthWrite, false);
    assert.equal(face.outline.material.opacity, 0.5);
    assert.equal(face.creases.material.opacity, 0.3);
  }
  paper.setPaper('washi');
  for (const face of paper.faces) {
    assert.equal(face.front.material, face.paint);
    assert.equal(face.back.material.map, null);
    assert.equal(face.front.material.transparent, false);
    assert.equal(face.back.material.depthWrite, true);
    assert.equal(face.outline.material.opacity, 1);
    assert.equal(face.creases.material.opacity, 0.85);
  }
  paper.dispose();
});

test('translucent coplanar surfaces receive stable shared depths from the active camera', () => {
  const paper = new FoldPaperMesh();
  const model = buildPaperModel({ kind: 'study-077' });
  paper.setModel(model);
  paper.setFold(0.8, model.sequence.sample(0.8).active);
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 80);
  for (const position of [
    [6, 7, 10],
    [-6, 7, 10],
    [6, -7, -10],
  ]) {
    camera.position.set(...position);
    camera.lookAt(0, 0, 0);
    paper.updateSortDepth(camera);
    for (const side of ['front', 'back']) {
      assert.equal(
        paper.faces[77][side].userData.paperSortDepth,
        paper.faces[91][side].userData.paperSortDepth,
      );
      assert.ok(Number.isFinite(paper.faces[77][side].userData.paperSortDepth));
    }
    assert.notEqual(
      paper.faces[77].front.userData.paperSortDepth,
      paper.faces[77].back.userData.paperSortDepth,
    );
  }
  paper.dispose();
});

test('changing models frees only model-owned resources and final disposal releases shared resources once', () => {
  const paper = new FoldPaperMesh();
  paper.setModel(buildPaperModel({ kind: 'person' }));
  const shared = observeDisposal([
    paper.backMaterial,
    paper.edgeMaterial,
    paper.activeCrease.geometry,
    paper.activeCrease.material,
    paper.hiddenCrease.material,
    paper.groundShadow.geometry,
    paper.groundShadow.material,
    paper.groundShadow.material.map,
  ]);
  const oldFaces = paper.faces;
  const replaced = observeDisposal(modelResources(paper));
  paper.setModel(buildPaperModel({ kind: 'cube' }));
  assert.ok([...replaced.values()].every((count) => count === 1));
  assert.ok([...shared.values()].every((count) => count === 0));
  assert.ok(oldFaces.every((face) => face.group.parent === null));
  assert.ok(paper.faces.every((face) => face.front.material === face.paint));
  const finalModel = observeDisposal(modelResources(paper));
  paper.dispose();
  assert.ok([...finalModel.values()].every((count) => count === 1));
  assert.ok([...shared.values()].every((count) => count === 1));
  assert.equal(paper.faces.length, 0);
});
