import * as THREE from 'three';

export const FACE_IDS = ['center', 'north', 'south', 'west', 'east', 'lid'];
export const FACE_CORNERS = [
  [-1, -1, 0],
  [1, -1, 0],
  [1, 1, 0],
  [-1, 1, 0],
];
export const VIEW_DIRECTION = new THREE.Vector3(6, 7, 10).normalize();
export const PROJECTION_CENTER = new THREE.Vector3(0, 1.04, 0);
export const PROJECTION_SIZE = 3.45;
const translate = (x, y, z = 0) => new THREE.Matrix4().makeTranslation(x, y, z);
const rotationX = (a) => new THREE.Matrix4().makeRotationX(a);
const rotationY = (a) => new THREE.Matrix4().makeRotationY(a);

export function faceMatrices(fold) {
  const angle = (Math.max(0, Math.min(1, fold)) * Math.PI) / 2;
  const north = translate(0, 1).multiply(rotationX(-angle));
  const local = [
    new THREE.Matrix4(),
    north.clone().multiply(translate(0, 1)),
    translate(0, -1).multiply(rotationX(angle)).multiply(translate(0, -1)),
    translate(-1, 0).multiply(rotationY(-angle)).multiply(translate(-1, 0)),
    translate(1, 0).multiply(rotationY(angle)).multiply(translate(1, 0)),
    north.clone().multiply(translate(0, 2)).multiply(rotationX(-angle)).multiply(translate(0, 1)),
  ];
  const height = 0.04 + Math.max(2, 2 * Math.sin(angle) + 2 * Math.sin(2 * angle));
  const mount = translate(0, height).multiply(rotationX(-Math.PI / 2));
  return local.map((matrix) => mount.clone().multiply(matrix));
}

const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), VIEW_DIRECTION).normalize();
const up = new THREE.Vector3().crossVectors(VIEW_DIRECTION, right).normalize();

export function projectedUV(point) {
  const offset = point.clone().sub(PROJECTION_CENTER);
  return [0.5 + offset.dot(right) / PROJECTION_SIZE, 0.5 + offset.dot(up) / PROJECTION_SIZE];
}

export function faceUVs() {
  return faceMatrices(1).map((matrix) =>
    FACE_CORNERS.map((corner) => projectedUV(new THREE.Vector3(...corner).applyMatrix4(matrix))),
  );
}

export function faceVertices(fold) {
  return faceMatrices(fold).map((matrix) =>
    FACE_CORNERS.map((corner) => new THREE.Vector3(...corner).applyMatrix4(matrix)),
  );
}
