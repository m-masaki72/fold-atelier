import * as THREE from 'three';

export function paperWallPositions(corners, connected, thickness = 0.012) {
  const positions = [];
  for (let i = 0; i < corners.length; i++) {
    if (connected[i]) continue;
    const a = corners[i],
      b = corners[(i + 1) % corners.length];
    positions.push(...a, b[0], b[1], -thickness, ...b, ...a, a[0], a[1], -thickness, b[0], b[1], -thickness);
  }
  return positions;
}

export function foldFramePoints(model, progress, focus = false) {
  const sample = model.sequence.sample(progress),
    step = sample.active;
  const indices = focus && step?.kind === 'hinge' ? step.movingFaces : model.faces.map((_, i) => i);
  const values =
    progress === 0 || progress === 1
      ? [progress]
      : Array.from({ length: 9 }, (_, i) => (sample.index + i / 8) / model.sequence.count);
  const points = [];
  for (const value of values) {
    const matrices = model.matrices(value, { grounded: false });
    for (const index of indices)
      for (const point of model.faces[index].corners)
        points.push(new THREE.Vector3(...point).applyMatrix4(matrices[index]));
  }
  return points;
}

export function fitPaperFrame(points, direction, aspect, padding = { top: 0.1, bottom: 0.25 }) {
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
  const up = new THREE.Vector3().crossVectors(direction, right).normalize();
  const bounds = new THREE.Box3();
  for (const point of points)
    bounds.expandByPoint(new THREE.Vector3(point.dot(right), point.dot(up), point.dot(direction)));
  const center = bounds.getCenter(new THREE.Vector3()),
    size = bounds.getSize(new THREE.Vector3());
  return {
    target: right.multiplyScalar(center.x).addScaledVector(up, center.y).addScaledVector(direction, center.z),
    half: Math.max(0.5, (size.y * 0.55) / (1 - padding.top - padding.bottom), (size.x * 0.6) / aspect),
    shift: padding.bottom - padding.top,
  };
}
