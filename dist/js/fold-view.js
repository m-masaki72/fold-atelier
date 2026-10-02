import * as THREE from 'three';
import { OrbitControls } from '../vendor/addons/controls/OrbitControls.js';
import { VIEW_DIRECTION } from './fold-geometry.js';
import { buildPaperModel } from './fold-models.js';
import { FoldPaperMesh } from './fold-paper-mesh.js';
import { foldFramePoints, fitPaperFrame } from './fold-display.js';
import { fixedCameraPoints, focusCameraFrame } from './fold-camera.js';
import { stablePaperTransparency } from './fold-render.js';

export class FoldView {
  constructor(host) {
    this.host = host;
    this.fold = 1;
    this.paper = 'washi';
    this.artMode = false;
    this.needsRender = true;
    this.renderCount = 0;
    this.frameHalf = 3;
    this.frameShift = 0.15;
    this.manualCamera = false;
    this.focused = false;
    this.cameraMode = 'fixed';
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor('#efece4', 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.setTransparentSort(stablePaperTransparency);
    host.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 80);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minZoom = 0.65;
    this.controls.maxZoom = 4;
    this.controls.minPolarAngle = 0.015;
    this.controls.maxPolarAngle = Math.PI - 0.015;
    this.controls.target.set(0, 1.4, -0.5);
    this.camera.position.copy(this.controls.target).addScaledVector(VIEW_DIRECTION, 18);
    this.scene.add(new THREE.HemisphereLight('#fffdf5', '#d5deea', 2.6));
    this.keyLight = new THREE.DirectionalLight('#fff8eb', 1.8);
    this.keyLight.position.set(-4, 9, 6);
    this.scene.add(this.keyLight);
    const fill = new THREE.DirectionalLight('#edf3ff', 1.4);
    fill.position.set(5, 4, -4);
    this.scene.add(fill);
    this.paperMesh = new FoldPaperMesh();
    this.scene.add(this.paperMesh);
    this.setModel({ kind: 'person' });
    this.home();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.controls.addEventListener('start', () => {
      this.manualCamera = true;
      this.frameGoal = null;
      this.onCameraChange?.();
    });
    this.controls.addEventListener('change', () => {
      this.needsRender = true;
    });
    this.resize();
  }

  setModel(spec) {
    const model = buildPaperModel(spec);
    this.paperMesh.setModel(model);
    this.model = model;
    this.reviewStep = null;
    this.frameKey = null;
    this.framePoints = null;
    this.manualCamera = false;
    this.fixedPoints = fixedCameraPoints(model);
    this.focusCache = new Map();
    this.frameReady = false;
    this.setPaper(this.paper);
    this.setFold(this.fold);
  }

  async setImage(source, isCurrent = () => true) {
    const ticket = (this.imageTicket = (this.imageTicket || 0) + 1);
    const texture = await new THREE.TextureLoader().loadAsync(source);
    if (ticket !== this.imageTicket || !isCurrent()) {
      texture.dispose();
      return false;
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.paperMesh.setImage(texture);
    this.needsRender = true;
    return true;
  }

  setFold(value) {
    this.fold = Math.max(0, Math.min(1, value));
    const current = this.currentStep;
    this.paperMesh.setFold(this.fold, current.active);
    this.bounds = this.paperMesh.bounds;
    this.movingFaceCount = this.paperMesh.movingFaceCount;
    const key =
      this.reviewStep !== null
        ? `review-${this.reviewStep}`
        : this.fold === 0
          ? 'flat'
          : this.fold === 1
            ? 'closed'
            : current.index;
    if (key !== this.frameKey) {
      this.frameKey = key;
      if (this.focused && !this.manualCamera) this.followStep(!this.frameReady);
      else if (!this.frameReady) {
        this.framePoints = this.fixedPoints;
        this.fitFrame(true);
      }
    }
    this.needsRender = true;
  }

  get currentStep() {
    return this.reviewStep === null
      ? this.model.sequence.sample(this.fold)
      : {
          index: this.reviewStep,
          active: this.model.sequence.steps[this.reviewStep],
        };
  }

  setReviewStep(index) {
    if (this.reviewStep === index) return;
    this.reviewStep = index;
    this.setFold(this.fold);
  }

  setArtMode(enabled) {
    this.artMode = enabled;
    this.paperMesh.setArtMode(enabled);
    this.needsRender = true;
  }

  setPaper(kind) {
    this.paper = kind;
    this.paperMesh.setPaper(kind);
    this.needsRender = true;
  }

  fitFrame(
    immediate = false,
    direction = this.camera.position.clone().sub(this.controls.target).normalize(),
  ) {
    if (!this.framePoints) return;
    const frame = fitPaperFrame(
      this.framePoints,
      direction,
      this.host.clientWidth / Math.max(1, this.host.clientHeight),
      { top: 0.06, bottom: 0.06 },
    );
    frame.direction = direction;
    this.frameShift = frame.shift;
    this.frameGoal = frame;
    if (immediate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.camera.position.copy(frame.target).addScaledVector(direction, 18);
      this.controls.target.copy(frame.target);
      this.frameHalf = frame.half;
      this.frameGoal = null;
    }
    this.frameReady = true;
    this.updateFrustum();
  }

  updateFrustum() {
    const aspect = this.host.clientWidth / Math.max(1, this.host.clientHeight);
    const half = this.frameHalf;
    this.camera.left = -half * aspect;
    this.camera.right = half * aspect;
    this.camera.top = half * (1 - this.frameShift);
    this.camera.bottom = -half * (1 + this.frameShift);
    this.camera.far = Math.max(80, (this.bounds?.getSize(new THREE.Vector3()).length() || 3) * 6);
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  resize() {
    this.renderer.setSize(this.host.clientWidth, this.host.clientHeight);
    if (this.manualCamera) this.updateFrustum();
    else if (this.focused) this.followStep(true);
    else this.fitFrame(true, this.frameGoal?.direction);
  }

  cancelCameraMotion() {
    // OrbitControls clears its pending rotation and pan when damping is disabled.
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = damping;
  }

  home() {
    this.cancelCameraMotion();
    this.manualCamera = false;
    this.camera.position.copy(this.controls.target).addScaledVector(VIEW_DIRECTION, 18);
    this.camera.zoom = 1;
    if (this.focused) this.followStep(true);
    else {
      this.framePoints = this.fixedPoints;
      this.fitFrame(true);
    }
    this.controls.update();
    this.onCameraChange?.();
  }

  top() {
    this.cancelCameraMotion();
    this.manualCamera = true;
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3(0, 18, 0.01));
    this.camera.zoom = 1;
    this.framePoints = this.focused ? foldFramePoints(this.model, this.fold) : this.fixedPoints;
    this.fitFrame(true);
    this.controls.update();
    this.onCameraChange?.();
  }

  adjustCamera(action) {
    if (!['left', 'right', 'up', 'down', 'zoom-in', 'zoom-out'].includes(action)) return;
    this.cancelCameraMotion();
    this.manualCamera = true;
    this.frameGoal = null;
    if (action.startsWith('zoom-')) {
      this.camera.zoom = THREE.MathUtils.clamp(
        this.camera.zoom * (action === 'zoom-in' ? 1.2 : 1 / 1.2),
        this.controls.minZoom,
        this.controls.maxZoom,
      );
    } else {
      const offset = this.camera.position.clone().sub(this.controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      const angle = Math.PI / 12;
      if (action === 'left') spherical.theta -= angle;
      if (action === 'right') spherical.theta += angle;
      if (action === 'up') spherical.phi -= angle;
      if (action === 'down') spherical.phi += angle;
      spherical.phi = THREE.MathUtils.clamp(
        spherical.phi,
        this.controls.minPolarAngle,
        this.controls.maxPolarAngle,
      );
      this.camera.position.copy(this.controls.target).add(offset.setFromSpherical(spherical));
    }
    this.updateFrustum();
    this.controls.update();
    this.onCameraChange?.();
  }

  setCameraMode(mode) {
    this.cancelCameraMotion();
    this.cameraMode = mode;
    this.focused = mode === 'focus';
    this.manualCamera = false;
    this.camera.zoom = 1;
    if (this.focused) this.followStep();
    else {
      this.framePoints = this.fixedPoints;
      this.fitFrame(false, VIEW_DIRECTION.clone());
    }
    this.onCameraChange?.();
  }

  followStep(immediate = false) {
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    const progress =
      this.reviewStep === null ? this.fold : (this.reviewStep + 0.5) / this.model.sequence.count;
    if (!this.focusCache.has(this.frameKey))
      this.focusCache.set(this.frameKey, focusCameraFrame(this.model, progress, direction));
    const frame = this.focusCache.get(this.frameKey);
    this.framePoints = frame.points;
    this.fitFrame(immediate, frame.direction);
  }

  cameraState() {
    return {
      position: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      half: this.frameHalf,
      zoom: this.camera.zoom,
      manual: this.manualCamera,
    };
  }

  restoreCamera(saved) {
    this.cancelCameraMotion();
    this.camera.position.fromArray(saved.position);
    this.controls.target.fromArray(saved.target);
    this.camera.zoom = saved.zoom;
    this.frameHalf = saved.half;
    this.manualCamera = true;
    this.frameGoal = null;
    this.updateFrustum();
    this.controls.update();
  }

  get cameraSettling() {
    if (!this.focused || this.manualCamera || !this.frameGoal) return false;
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    return (
      direction.angleTo(this.frameGoal.direction) > 0.08 ||
      this.controls.target.distanceTo(this.frameGoal.target) > this.frameGoal.half * 0.08 ||
      Math.abs(this.frameHalf - this.frameGoal.half) > this.frameGoal.half * 0.08
    );
  }

  render(dt = 1 / 60, force = false) {
    if (this.frameGoal) {
      const blend = 1 - Math.exp(-dt * 5.5);
      const target = this.controls.target.clone().lerp(this.frameGoal.target, blend);
      const direction = this.camera.position.clone().sub(this.controls.target).normalize();
      const rotation = new THREE.Quaternion().setFromUnitVectors(direction, this.frameGoal.direction);
      direction.applyQuaternion(new THREE.Quaternion().slerp(rotation, blend));
      this.camera.position.copy(target).addScaledVector(direction, 18);
      this.controls.target.copy(target);
      this.frameHalf += (this.frameGoal.half - this.frameHalf) * blend;
      if (
        this.controls.target.distanceTo(this.frameGoal.target) < 1e-4 &&
        Math.abs(this.frameHalf - this.frameGoal.half) < 1e-4 &&
        direction.angleTo(this.frameGoal.direction) < 1e-4
      )
        this.frameGoal = null;
      this.updateFrustum();
    }
    this.controls.update();
    if (this.needsRender || force) {
      if (this.paper === 'tracing') this.paperMesh.updateSortDepth(this.camera);
      this.renderer.render(this.scene, this.camera);
      this.renderCount++;
      this.needsRender = false;
    }
  }

  capture() {
    this.render(0, true);
    const source = this.renderer.domElement;
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#efece4';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  dispose() {
    this.imageTicket = (this.imageTicket || 0) + 1;
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.paperMesh.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
