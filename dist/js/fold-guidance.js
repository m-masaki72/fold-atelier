import * as THREE from 'three';
import { VIEW_DIRECTION } from './fold-geometry.js';

export function stepReplayPlan(sequence, progress, reviewIndex = null) {
  let index = reviewIndex ?? sequence.sample(progress).index;
  while (index >= 0 && sequence.steps[index]?.kind !== 'hinge') index--;
  return index < 0 ? null : { index, from: index / sequence.count, to: (index + 1) / sequence.count };
}

export function playbackLabel({ playing, touring, fold, direction, hold, animation, settling }) {
  let label = '一時停止中';
  if (settling) label = '視点を移動中';
  else if (animation?.kind === 'replay') label = 'この折り目を再生中';
  else if (playing && hold > 0 && (fold === 0 || fold === 1))
    label = fold === 1 ? '完成 · ひと休み' : '展開図 · ひと休み';
  else if (playing || animation)
    label = (animation ? animation.to < animation.from : direction < 0) ? 'ひらいています' : '組み立て中';
  return touring ? `連続鑑賞 · ${label}` : label;
}

export function completedProjection(model) {
  const direction = VIEW_DIRECTION.clone().normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
  const up = new THREE.Vector3().crossVectors(direction, right).normalize();
  const matrices = model.matrices(1, { grounded: false });
  const polygons = model.faces.map((face, index) => {
    const world = face.corners.map((p) => new THREE.Vector3(...p).applyMatrix4(matrices[index]));
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(matrices[index]);
    return {
      index,
      color: face.color,
      facing: normal.dot(direction) > 0.001,
      depth: world.reduce((sum, p) => sum + p.dot(direction), 0) / world.length,
      points: world.map((p) => [p.dot(right), -p.dot(up)]),
    };
  });
  const points = polygons.flatMap((p) => p.points);
  const minX = Math.min(...points.map((p) => p[0])),
    maxX = Math.max(...points.map((p) => p[0]));
  const minY = Math.min(...points.map((p) => p[1])),
    maxY = Math.max(...points.map((p) => p[1]));
  const margin = Math.max(maxX - minX, maxY - minY) * 0.08;
  return {
    polygons: polygons.sort((a, b) => a.depth - b.depth),
    viewBox: [minX - margin, minY - margin, maxX - minX + 2 * margin, maxY - minY + 2 * margin],
  };
}

export class CompletedPreview {
  constructor(svgs) {
    this.svgs = svgs;
  }

  setModel(model) {
    const { polygons, viewBox } = completedProjection(model);
    this.nodes = [];
    this.key = null;
    for (const svg of this.svgs) {
      svg.replaceChildren();
      svg.setAttribute('viewBox', viewBox.join(' '));
      for (const hidden of [false, true]) {
        for (const polygon of polygons) {
          if (!hidden && !polygon.facing) continue;
          const node = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          node.setAttribute('points', polygon.points.map((p) => p.join(',')).join(' '));
          node.setAttribute('fill', hidden ? 'none' : polygon.color);
          node.setAttribute('vector-effect', 'non-scaling-stroke');
          node.classList.toggle('preview-hidden', hidden);
          svg.append(node);
          this.nodes.push({ node, index: polygon.index });
        }
      }
    }
  }

  setStep(step) {
    if (step === this.key) return;
    this.key = step;
    const moving = new Set(step?.movingFaces || []);
    for (const { node, index } of this.nodes || [])
      node.classList.toggle('preview-active', moving.has(index));
  }
}
