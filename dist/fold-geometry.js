import * as THREE from 'three';

export const VIEW_DIRECTION = new THREE.Vector3(6, 7, 10).normalize();

const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), VIEW_DIRECTION).normalize();
const up = new THREE.Vector3().crossVectors(VIEW_DIRECTION, right).normalize();

export function artworkProjection(points) {
  const center = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
  const offsets = points.map((point) => point.clone().sub(center));
  const size =
    Math.max(...offsets.flatMap((point) => [Math.abs(point.dot(right)), Math.abs(point.dot(up))])) * 2.05;
  return (point) => {
    const offset = point.clone().sub(center);
    return [0.5 + offset.dot(right) / size, 0.5 + offset.dot(up) / size];
  };
}
