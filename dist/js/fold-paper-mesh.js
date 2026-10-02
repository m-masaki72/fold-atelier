import * as THREE from 'three';
import { LineSegments2 } from '../vendor/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from '../vendor/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from '../vendor/addons/lines/LineMaterial.js';
import { createPaperSurface, createGroundShadow } from './fold-surfaces.js';
import { paperWallPositions } from './fold-display.js';
import { decoratePaperMaterial, paperDepthUnits, paperSortCenters } from './fold-render.js';

function createPaperLine(positions, options) {
  const line = new LineSegments2(
    new LineSegmentsGeometry().setPositions(positions),
    new LineMaterial({ transparent: true, toneMapped: false, depthWrite: false, ...options }),
  );
  line.visible = positions.length > 0;
  if (options.dashed) line.computeLineDistances();
  return line;
}

function createPaperFace(face, index, materials) {
  const corners = face.corners;
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners.flat(), 3));
  geometry.setAttribute(
    'foldHighlight',
    new THREE.Float32BufferAttribute(new Float32Array(corners.length), 1),
  );
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
  if (!materials.paint.has(key))
    materials.paint.set(key, decoratePaperMaterial(createPaperSurface(face.color, face.pattern)));
  const paint = materials.paint.get(key);
  const front = new THREE.Mesh(geometry, paint);
  const back = new THREE.Mesh(geometry, materials.back);
  back.position.z = -0.012;
  for (const surface of [front, back])
    surface.onBeforeRender = (_renderer, _scene, _camera, _geometry, material) => {
      material.polygonOffsetUnits = paperDepthUnits(index);
    };
  const wallPositions = paperWallPositions(corners, face.foldEdges);
  const wallGeometry = new THREE.BufferGeometry();
  wallGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wallPositions, 3));
  wallGeometry.computeVertexNormals();
  const walls = new THREE.Mesh(wallGeometry, materials.edge);
  walls.visible = wallPositions.length > 0;
  const cuts = [],
    folds = [];
  corners.forEach((p, i) => {
    if (face.foldEdges[i] && !face.creaseEdges[i]) return;
    const next = corners[(i + 1) % corners.length];
    for (const z of [0.004, -0.016])
      (face.foldEdges[i] ? folds : cuts).push(p[0], p[1], z, next[0], next[1], z);
  });
  const outline = createPaperLine(cuts, { color: '#344b55', linewidth: 1.5 });
  const creases = createPaperLine(folds, {
    color: '#675341',
    linewidth: 1.25,
    dashed: true,
    dashSize: 0.08,
    gapSize: 0.055,
  });
  group.add(front, back, walls, outline, creases);
  return { group, front, back, walls, outline, creases, paint };
}

export class FoldPaperMesh extends THREE.Group {
  constructor() {
    super();
    this.groundShadow = createGroundShadow();
    this.add(this.groundShadow);
    this.backMaterial = new THREE.MeshPhysicalMaterial({
      color: '#d4deec',
      roughness: 0.95,
      side: THREE.BackSide,
    });
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
    this.add(this.activeCrease, this.hiddenCrease);
    this.faces = [];
    this.paintMaterials = new Map();
  }

  setModel(model) {
    this.clearModel();
    this.model = model;
    const materials = {
      back: this.backMaterial,
      edge: this.edgeMaterial,
      paint: this.paintMaterials,
    };
    this.faces = model.faces.map((face, index) => {
      const surface = createPaperFace(face, index, materials);
      this.add(surface.group);
      return surface;
    });
  }

  clearModel() {
    for (const { group, front, walls, outline, creases } of this.faces) {
      this.remove(group);
      // The front and back share geometry; their materials belong to the whole paper.
      for (const geometry of [front.geometry, walls.geometry, outline.geometry, creases.geometry])
        geometry.dispose();
      outline.material.dispose();
      creases.material.dispose();
    }
    this.faces = [];
    for (const material of this.paintMaterials.values()) {
      material.map?.dispose();
      material.dispose();
    }
    this.paintMaterials.clear();
  }

  setFold(value, step) {
    this.fold = value;
    const bounds = new THREE.Box3();
    const matrices = this.model.matrices(this.fold, { grounded: false });
    this.paperSortCenters = paperSortCenters(this.model.faces, matrices);
    matrices.forEach((matrix, i) => {
      this.faces[i].group.matrix.copy(matrix);
      this.faces[i].group.matrixWorldNeedsUpdate = true;
      for (const point of this.model.faces[i].corners)
        bounds.expandByPoint(new THREE.Vector3(...point).applyMatrix4(matrix));
    });
    this.activeCrease.visible = this.hiddenCrease.visible = step?.kind === 'hinge';
    const moving = new Set(step?.movingFaces || []);
    this.movingFaceCount = moving.size;
    this.faces.forEach((face, index) => {
      const highlight = moving.has(index) ? (index === step?.child ? 0.42 : 0.2) : 0;
      const attribute = face.front.geometry.getAttribute('foldHighlight');
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
      const { instanceStart, instanceEnd, instanceDistanceStart, instanceDistanceEnd } = geometry.attributes;
      instanceStart.setXYZ(0, a.x, a.y, a.z);
      instanceEnd.setXYZ(0, b.x, b.y, b.z);
      instanceStart.needsUpdate = true;
      instanceDistanceStart.setX(0, 0);
      instanceDistanceEnd.setX(0, a.distanceTo(b));
      instanceDistanceStart.needsUpdate = true;
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    }
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    this.groundShadow.position.set(center.x, bounds.min.y - 0.12, center.z);
    this.groundShadow.scale.set(Math.max(1, size.x * 1.12), Math.max(1, size.z * 1.12), 1);
    this.groundShadow.visible = this.fold > 0.01;
    this.bounds = bounds;
  }

  setPaper(kind) {
    this.paper = kind;
    const tracing = kind === 'tracing';
    for (const material of [this.backMaterial, ...this.paintMaterials.values()]) {
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
      face.outline.material.opacity = tracing ? 0.5 : 1;
      face.creases.material.opacity = tracing ? 0.3 : 0.85;
    }
  }

  updateSortDepth(camera) {
    camera.updateMatrixWorld();
    const projected = new Map();
    this.faces.forEach(({ front, back }, index) => {
      [front, back].forEach((surface, side) => {
        const center = this.paperSortCenters[index][side];
        if (!projected.has(center)) projected.set(center, center.clone().project(camera).z);
        surface.userData.paperSortDepth = projected.get(center);
      });
    });
  }

  dispose() {
    this.clearModel();
    for (const material of [this.backMaterial, this.edgeMaterial]) material.dispose();
    this.activeCrease.geometry.dispose();
    this.activeCrease.material.dispose();
    this.hiddenCrease.material.dispose();
    this.groundShadow.geometry.dispose();
    this.groundShadow.material.map.dispose();
    this.groundShadow.material.dispose();
    this.removeFromParent();
  }
}
