import * as THREE from 'three';
import { OrbitControls } from './vendor/addons/controls/OrbitControls.js';
import { LineSegments2 } from './vendor/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from './vendor/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from './vendor/addons/lines/LineMaterial.js';
import { VIEW_DIRECTION } from './fold-geometry.js';
import { buildPaperModel } from './fold-models.js';
import { createPaperSurface } from './fold-surfaces.js';
import { paperWallPositions, foldFramePoints, fitPaperFrame } from './fold-display.js';
import { fixedCameraPoints, focusCameraFrame } from './fold-camera.js';
import {
  decoratePaperMaterial,
  paperDepthUnits,
  paperSortCenters,
  stablePaperTransparency,
} from './fold-render.js';

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
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = shadowCanvas.height = 128;
    const shadowContext = shadowCanvas.getContext('2d');
    const gradient = shadowContext.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.35, '#ffffff88');
    gradient.addColorStop(1, '#ffffff00');
    shadowContext.fillStyle = gradient;
    shadowContext.fillRect(0, 0, 128, 128);
    this.groundShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: '#516259',
        map: new THREE.CanvasTexture(shadowCanvas),
        transparent: true,
        opacity: 0.085,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.groundShadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.groundShadow);
    this.frontMaterial = new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      roughness: 0.87,
      metalness: 0,
      side: THREE.FrontSide,
    });
    this.backMaterial = new THREE.MeshPhysicalMaterial({
      color: '#d4deec',
      roughness: 0.95,
      side: THREE.BackSide,
    });
    decoratePaperMaterial(this.frontMaterial);
    decoratePaperMaterial(this.backMaterial);
    this.edgeMaterial = new THREE.MeshStandardMaterial({ color: '#8f9b9c', roughness: 1 });
    const creaseGeometry = new LineSegmentsGeometry().setPositions([0, 0, 0, 0, 1, 0]);
    this.activeCrease = new LineSegments2(
      creaseGeometry,
      new LineMaterial({
        color: '#a43e20',
        linewidth: 3,
        toneMapped: false,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    this.hiddenCrease = new LineSegments2(
      creaseGeometry,
      new LineMaterial({
        color: '#a43e20',
        linewidth: 1.3,
        transparent: true,
        opacity: 0.45,
        dashed: true,
        dashSize: 0.07,
        gapSize: 0.055,
        depthFunc: THREE.GreaterDepth,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.hiddenCrease.renderOrder = 5;
    this.hiddenCrease.computeLineDistances();
    this.activeCrease.renderOrder = 6;
    this.scene.add(this.activeCrease, this.hiddenCrease);
    this.faces = [];
    this.paintMaterials = new Map();
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
    for (const face of this.faces) {
      this.scene.remove(face);
      const geometries = new Set(face.children.map((child) => child.geometry));
      for (const geometry of geometries) geometry.dispose();
      for (const child of face.children.slice(3)) child.material.dispose();
    }
    for (const material of this.paintMaterials.values()) {
      material.map?.dispose();
      material.dispose();
    }
    this.paintMaterials.clear();
    this.model = model;
    this.reviewStep = null;
    this.frameKey = null;
    this.framePoints = null;
    this.manualCamera = false;
    this.fixedPoints = fixedCameraPoints(model);
    this.focusCache = new Map();
    this.frameReady = false;
    this.faces = model.faces.map((face, index) => {
      const uvs = model.uvs[index],
        corners = face.corners;
      const group = new THREE.Group();
      group.matrixAutoUpdate = false;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners.flat(), 3));
      geometry.setAttribute(
        'foldHighlight',
        new THREE.Float32BufferAttribute(new Float32Array(corners.length), 1),
      );
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs.flat(), 2));
      const minX = Math.min(...corners.map((p) => p[0])),
        maxX = Math.max(...corners.map((p) => p[0]));
      const minY = Math.min(...corners.map((p) => p[1])),
        maxY = Math.max(...corners.map((p) => p[1]));
      geometry.setAttribute(
        'uv1',
        new THREE.Float32BufferAttribute(
          face.paintUVs?.flat() ||
            corners.flatMap((p) => [(p[0] - minX) / (maxX - minX), (p[1] - minY) / (maxY - minY)]),
          2,
        ),
      );
      const indices = [];
      for (let i = 1; i < corners.length - 1; i++) indices.push(0, i, i + 1);
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const key = `${face.color}:${face.pattern || ''}`;
      if (!this.paintMaterials.has(key))
        this.paintMaterials.set(key, decoratePaperMaterial(createPaperSurface(face.color, face.pattern)));
      const paint = this.paintMaterials.get(key);
      const front = new THREE.Mesh(geometry, this.artMode ? this.frontMaterial : paint);
      front.userData.paint = paint;
      const back = new THREE.Mesh(geometry, this.backMaterial);
      back.position.z = -0.012;
      for (const surface of [front, back])
        surface.onBeforeRender = (_renderer, _scene, _camera, _geometry, material) => {
          material.polygonOffsetUnits = paperDepthUnits(index);
        };
      const wallPositions = paperWallPositions(corners, face.foldEdges);
      const wallGeometry = new THREE.BufferGeometry();
      wallGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wallPositions, 3));
      wallGeometry.computeVertexNormals();
      const walls = new THREE.Mesh(wallGeometry, this.edgeMaterial);
      walls.visible = wallPositions.length > 0;
      const cuts = [],
        folds = [];
      corners.forEach((p, i) => {
        if (face.foldEdges[i] && !face.creaseEdges[i]) return;
        const next = corners[(i + 1) % corners.length];
        for (const z of [0.004, -0.016])
          (face.foldEdges[i] ? folds : cuts).push(p[0], p[1], z, next[0], next[1], z);
      });
      const outline = new LineSegments2(
        new LineSegmentsGeometry().setPositions(cuts),
        new LineMaterial({
          color: '#344b55',
          linewidth: 1.5,
          transparent: true,
          toneMapped: false,
          depthWrite: false,
        }),
      );
      const creases = new LineSegments2(
        new LineSegmentsGeometry().setPositions(folds),
        new LineMaterial({
          color: '#675341',
          linewidth: 1.25,
          dashed: true,
          transparent: true,
          dashSize: 0.08,
          gapSize: 0.055,
          toneMapped: false,
          depthWrite: false,
        }),
      );
      outline.visible = cuts.length > 0;
      creases.visible = folds.length > 0;
      creases.computeLineDistances();
      group.add(front, back, walls, outline, creases);
      this.scene.add(group);
      return group;
    });
    this.setPaper(this.paper);
    this.setFold(this.fold);
  }

  async setImage(source) {
    const ticket = (this.imageTicket = (this.imageTicket || 0) + 1);
    const texture = await new THREE.TextureLoader().loadAsync(source);
    if (ticket !== this.imageTicket) {
      texture.dispose();
      return false;
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.texture?.dispose();
    this.texture = texture;
    this.frontMaterial.map = texture;
    this.frontMaterial.needsUpdate = true;
    this.backMaterial.map = this.artMode ? texture : null;
    this.backMaterial.needsUpdate = true;
    this.needsRender = true;
    return true;
  }

  setFold(value) {
    this.fold = Math.max(0, Math.min(1, value));
    const bounds = new THREE.Box3();
    const matrices = this.model.matrices(this.fold, { grounded: false });
    this.paperSortCenters = paperSortCenters(this.model.faces, matrices);
    matrices.forEach((matrix, i) => {
      this.faces[i].matrix.copy(matrix);
      this.faces[i].matrixWorldNeedsUpdate = true;
      for (const point of this.model.faces[i].corners)
        bounds.expandByPoint(new THREE.Vector3(...point).applyMatrix4(matrix));
    });
    const current = this.currentStep,
      step = current.active;
    this.activeCrease.visible = this.hiddenCrease.visible = step?.kind === 'hinge';
    const moving = new Set(step?.movingFaces || []);
    this.movingFaceCount = moving.size;
    this.faces.forEach((face, index) => {
      const highlight = moving.has(index) ? (index === step?.child ? 0.42 : 0.2) : 0;
      const attribute = face.children[0].geometry.getAttribute('foldHighlight');
      if (attribute.array[0] !== Math.fround(highlight)) {
        attribute.array.fill(highlight);
        attribute.needsUpdate = true;
      }
    });
    if (this.activeCrease.visible) {
      const joint = this.model.parts[0].tree[step.joint],
        frame = matrices[joint.parent];
      const a = joint.origin.clone().applyMatrix4(frame);
      const b = joint.origin.clone().addScaledVector(joint.axis, joint.length).applyMatrix4(frame);
      const geometry = this.activeCrease.geometry;
      geometry.attributes.instanceStart.data.array.set([...a.toArray(), ...b.toArray()]);
      geometry.attributes.instanceStart.data.needsUpdate = true;
      geometry.attributes.instanceDistanceStart.data.array.set([0, a.distanceTo(b)]);
      geometry.attributes.instanceDistanceStart.data.needsUpdate = true;
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    }
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    this.groundShadow.position.set(center.x, bounds.min.y - 0.12, center.z);
    this.groundShadow.scale.set(Math.max(1, size.x * 1.12), Math.max(1, size.z * 1.12), 1);
    this.groundShadow.visible = this.fold > 0.01;
    this.bounds = bounds;
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
    for (const face of this.faces)
      face.children[0].material = enabled ? this.frontMaterial : face.children[0].userData.paint;
    this.backMaterial.map = enabled ? this.texture : null;
    this.backMaterial.needsUpdate = true;
    this.needsRender = true;
  }

  setPaper(kind) {
    this.paper = kind;
    const tracing = kind === 'tracing';
    for (const material of [this.frontMaterial, this.backMaterial, ...this.paintMaterials.values()]) {
      material.transparent = tracing;
      material.opacity = tracing ? 0.62 : 1;
      material.depthWrite = !tracing;
      material.needsUpdate = true;
    }
    this.backMaterial.color.set(tracing ? '#e4edf6' : '#d4deec');
    this.groundShadow.material.opacity = tracing ? 0.04 : 0.085;
    this.edgeMaterial.transparent = tracing;
    this.edgeMaterial.opacity = tracing ? 0.22 : 1;
    this.edgeMaterial.depthWrite = !tracing;
    this.edgeMaterial.needsUpdate = true;
    for (const face of this.faces) {
      face.children[3].material.opacity = tracing ? 0.5 : 1;
      face.children[4].material.opacity = tracing ? 0.3 : 0.85;
    }
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
    else this.fitFrame(true);
  }

  home() {
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
    this.manualCamera = true;
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3(0, 18, 0.01));
    this.camera.zoom = 1;
    this.framePoints = this.focused ? foldFramePoints(this.model, this.fold) : this.fixedPoints;
    this.fitFrame(true);
    this.controls.update();
    this.onCameraChange?.();
  }

  setCameraMode(mode) {
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
      if (this.paper === 'tracing') {
        this.camera.updateMatrixWorld();
        const projected = new Map();
        this.faces.forEach((face, index) => {
          this.paperSortCenters[index].forEach((center, side) => {
            if (!projected.has(center)) projected.set(center, center.clone().project(this.camera).z);
            face.children[side].userData.paperSortDepth = projected.get(center);
          });
        });
      }
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
}
