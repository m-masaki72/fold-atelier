import * as THREE from 'three';
import { exteriorSurface } from './fold-topology.js';
import { unfoldPart, foldMatrices } from './fold-net.js';
import { MODEL_PRESETS, recipe } from './fold-recipes.js';
import { STUDY_FAMILIES } from './fold-collection.js';
import { NETS, COLLECTION } from './fold-net-data.js';
import { createFoldSequence } from './fold-sequence.js';

export { MODEL_PRESETS, recipe } from './fold-recipes.js';
export { convexFaces } from './fold-topology.js';
export { polygonsOverlap } from './fold-net.js';
export { COLLECTION } from './fold-net-data.js';

const edgeKey = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);

function paperFaces(part) {
  const hinges = new Set(),
    creases = new Set();
  for (const joint of part.tree) {
    const parent = part.faces[joint.parent],
      child = part.faces[joint.child];
    parent.ids.forEach((id, index) => {
      const next = parent.ids[(index + 1) % parent.ids.length];
      if (child.ids.includes(id) && child.ids.includes(next)) {
        const key = edgeKey(id, next);
        hinges.add(key);
        if (Math.abs(joint.angle) > 1e-7) creases.add(key);
      }
    });
  }
  return part.faces.map((face) => {
    const edges = face.ids.map((id, index) => edgeKey(id, face.ids[(index + 1) % face.ids.length]));
    return {
      corners: face.corners.map((point) => point.toArray()),
      color: face.color,
      pattern: face.pattern,
      paintUVs: face.paintUVs,
      foldEdges: edges.map((edge) => hinges.has(edge)),
      creaseEdges: edges.map((edge) => creases.has(edge)),
      part: 0,
      name: face.name,
    };
  });
}

export function buildPaperModel(spec, { net, useCache = true } = {}) {
  const entry = COLLECTION.find((item) => item.id === spec.kind);
  const resolvedSpec = entry ? { ...spec, kind: 'study', family: entry.family, seed: entry.seed } : spec;
  const stature = resolvedSpec.stature || 1;
  const solids = recipe(resolvedSpec).map((solid) => ({
    ...solid,
    vertices: solid.vertices.map(([x, y, z]) => [x, y * stature, z]),
    position: [solid.position[0], solid.position[1] * stature, solid.position[2]],
  }));
  const netKey = entry?.id || `${resolvedSpec.kind}:${stature}`;
  const part = unfoldPart({
    name: resolvedSpec.kind,
    position: [0, 0, 0],
    surface: exteriorSurface(solids),
    net: net ?? (useCache ? NETS[netKey] : undefined),
  });
  const sequence = createFoldSequence(part);
  const faces = paperFaces(part);
  const matrices = (fold, options) =>
    foldMatrices(part, sequence.sample(THREE.MathUtils.clamp(fold, 0, 1)), options);
  const vertices = (fold) =>
    matrices(fold).map((frame, index) =>
      faces[index].corners.map((point) => new THREE.Vector3(...point).applyMatrix4(frame)),
    );
  return {
    spec,
    label:
      entry?.label ||
      MODEL_PRESETS.find((preset) => preset.id === resolvedSpec.kind)?.label ||
      STUDY_FAMILIES[resolvedSpec.family],
    sheetCount: 1,
    sequence,
    parts: [part],
    faces,
    matrices,
    vertices,
  };
}
