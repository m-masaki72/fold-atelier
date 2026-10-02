import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { OrbitControls } from '../dist/vendor/addons/controls/OrbitControls.js';
import { FoldView } from '../dist/js/fold-view.js';
import { buildPaperModel } from '../dist/js/fold-models.js';
import { fixedCameraPoints } from '../dist/js/fold-camera.js';
import { VIEW_DIRECTION } from '../dist/js/fold-geometry.js';

const previousMatchMedia = globalThis.matchMedia;
after(() => {
  if (previousMatchMedia === undefined) delete globalThis.matchMedia;
  else globalThis.matchMedia = previousMatchMedia;
});

function fixture(t, kind = 'cube') {
  const motion = { reduced: false };
  globalThis.matchMedia = () => ({ matches: motion.reduced });
  const root = new EventTarget();
  const canvas = Object.assign(new EventTarget(), {
    clientWidth: 1000,
    clientHeight: 600,
    style: {},
    getRootNode: () => root,
    setPointerCapture() {},
    releasePointerCapture() {},
  });
  // WebGL and paper drawing are omitted; camera and OrbitControls are the real implementations.
  const view = Object.assign(Object.create(FoldView.prototype), {
    host: { clientWidth: 1000, clientHeight: 600 },
    camera: new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 80),
    model: buildPaperModel({ kind }),
    renderer: { render() {}, setSize() {} },
    paperMesh: { setFold() {}, bounds: new THREE.Box3(), movingFaceCount: 0 },
    paper: 'washi',
    focused: false,
    manualCamera: false,
    cameraMode: 'fixed',
    fold: 0,
    reviewStep: null,
    frameHalf: 3,
    frameShift: 0.15,
    focusCache: new Map(),
    renderCount: 0,
  });
  view.controls = new OrbitControls(view.camera, canvas);
  view.controls.enableDamping = true;
  view.controls.enablePan = false;
  view.controls.minZoom = 0.65;
  view.controls.maxZoom = 4;
  view.controls.minPolarAngle = 0.015;
  view.controls.maxPolarAngle = Math.PI - 0.015;
  view.controls.addEventListener('start', () => {
    view.manualCamera = true;
    view.frameGoal = null;
  });
  view.controls.addEventListener('change', () => {
    view.needsRender = true;
  });
  t.after(() => view.controls.dispose());
  view.fixedPoints = fixedCameraPoints(view.model);
  view.home();
  view.setFold(0.5 / view.model.sequence.count);
  return { view, canvas, motion };
}

function renderFrames(view, count = 240) {
  for (let frame = 0; frame < count; frame++) view.render(1 / 60);
}

function direction(view) {
  return view.camera.position.clone().sub(view.controls.target).normalize();
}

function assertDirection(view, expected, context) {
  const angle = direction(view).angleTo(expected);
  assert.ok(angle < 0.001, `${context}: camera differs by ${THREE.MathUtils.radToDeg(angle)} degrees`);
}

function drag({ canvas, view }, x = 100, y = 0) {
  const pointer = (type, clientX, clientY) => {
    const event = Object.assign(new Event(type), {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX,
      clientY,
    });
    canvas.dispatchEvent(event);
  };
  pointer('pointerdown', 0, 0);
  pointer('pointermove', x, y);
  pointer('pointerup', x, y);
  renderFrames(view, 6);
}

test('smooth focus resume returns to the selected crease after manual rotation', (t) => {
  const f = fixture(t);
  f.view.setCameraMode('focus');
  renderFrames(f.view);
  const expected = f.view.focusCache.get(f.view.frameKey).direction.clone();
  drag(f);
  assert.equal(f.view.manualCamera, true);
  assert.equal(f.view.frameGoal, null);
  f.view.setCameraMode('focus');
  assert.equal(f.view.manualCamera, false);
  assert.equal(f.view.camera.zoom, 1);
  renderFrames(f.view);
  assertDirection(f.view, expected, 'resumed focus');
  assert.equal(f.view.cameraSettling, false);
});

for (const mode of ['fixed', 'focus']) {
  test(`${mode} home cancels drag inertia`, (t) => {
    const f = fixture(t);
    f.view.setCameraMode(mode);
    renderFrames(f.view);
    const expected = mode === 'focus' ? f.view.focusCache.get(f.view.frameKey).direction : VIEW_DIRECTION;
    drag(f);
    f.view.home();
    renderFrames(f.view);
    assertDirection(f.view, expected, `${mode} home`);
    assert.equal(f.view.manualCamera, false);
  });
}

test('reduced-motion focus resume does not keep rotating after its immediate move', (t) => {
  const f = fixture(t);
  f.view.setCameraMode('focus');
  renderFrames(f.view);
  const expected = f.view.focusCache.get(f.view.frameKey).direction.clone();
  drag(f);
  f.motion.reduced = true;
  f.view.setCameraMode('focus');
  renderFrames(f.view);
  assertDirection(f.view, expected, 'reduced-motion focus');
});

test('top view stays overhead after a drag with horizontal and vertical inertia', (t) => {
  const f = fixture(t);
  f.view.top();
  const expected = direction(f.view);
  drag(f, 100, 40);
  f.view.top();
  renderFrames(f.view);
  assertDirection(f.view, expected, 'top view');
  assert.equal(f.view.manualCamera, true);
  assert.equal(f.view.controls.enableDamping, true);
});

test('restoring a saved camera clears drag inertia and preserves position, target and zoom', (t) => {
  const f = fixture(t);
  f.view.setCameraMode('focus');
  renderFrames(f.view);
  f.view.camera.zoom = 1.7;
  f.view.updateFrustum();
  const saved = f.view.cameraState();
  drag(f, 100, 40);
  f.view.restoreCamera(saved);
  renderFrames(f.view);
  assert.ok(f.view.camera.position.distanceTo(new THREE.Vector3(...saved.position)) < 1e-8);
  assert.ok(f.view.controls.target.distanceTo(new THREE.Vector3(...saved.target)) < 1e-8);
  assert.equal(f.view.camera.zoom, saved.zoom);
  assert.equal(f.view.frameHalf, saved.half);
  assert.equal(f.view.manualCamera, true);
  assert.equal(f.view.controls.enableDamping, true);
});

for (const mode of ['focus', 'fixed']) {
  test(`resizing during a ${mode} transition preserves its requested viewpoint`, (t) => {
    const { view } = fixture(t);
    if (mode === 'fixed') {
      view.setCameraMode('focus');
      renderFrames(view);
    }
    view.setCameraMode(mode);
    const expected = view.frameGoal.direction.clone();
    renderFrames(view, 1);
    view.host.clientWidth = 600;
    view.resize();
    renderFrames(view);
    assertDirection(view, expected, `resized ${mode}`);
    assert.equal(view.cameraSettling, false);
  });
}

test('settled focus frames survive real controls and contain moving faces across consecutive steps', (t) => {
  for (const kind of ['cube', 'person', 'study-077']) {
    const { view } = fixture(t, kind);
    view.setCameraMode('focus');
    for (const [index, step] of view.model.sequence.steps.entries()) {
      view.setFold((index + 0.5) / view.model.sequence.count);
      renderFrames(view);
      const frame = view.focusCache.get(view.frameKey);
      assertDirection(view, frame.direction, `${kind} step ${index + 1}`);
      view.camera.updateMatrixWorld();
      const indices =
        step.kind === 'hinge' ? [...step.movingFaces, step.parent] : view.model.faces.map((_, i) => i);
      for (const phase of [0, 0.5, 1]) {
        const matrices = view.model.matrices((index + phase) / view.model.sequence.count, {
          grounded: false,
        });
        for (const face of indices) {
          for (const corner of view.model.faces[face].corners) {
            const ndc = new THREE.Vector3(...corner).applyMatrix4(matrices[face]).project(view.camera);
            assert.ok(
              [ndc.x, ndc.y, ndc.z].every((value) => Math.abs(value) < 1),
              `${kind} step ${index + 1}, phase ${phase}, face ${face} lies outside the camera: ${ndc.toArray()}`,
            );
          }
        }
      }
    }
  }
});
