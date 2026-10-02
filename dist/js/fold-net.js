import * as THREE from 'three';

const EPS = 1e-7;
const MAX_LAYOUT_TRIALS = 80;
const MAX_SEARCH_ATTEMPTS = 250;
const UP = new THREE.Vector3(0, 1, 0);
const NORMAL = new THREE.Vector3(0, 0, 1);

export function polygonsOverlap(a, b) {
  const boundsA = new THREE.Box2().setFromPoints(a);
  const boundsB = new THREE.Box2().setFromPoints(b);
  if (
    boundsA.max.x <= boundsB.min.x + EPS ||
    boundsB.max.x <= boundsA.min.x + EPS ||
    boundsA.max.y <= boundsB.min.y + EPS ||
    boundsB.max.y <= boundsA.min.y + EPS
  )
    return false;
  for (const polygon of [a, b])
    for (let i = 0; i < polygon.length; i++) {
      const next = polygon[(i + 1) % polygon.length];
      const axis = new THREE.Vector2(-(next.y - polygon[i].y), next.x - polygon[i].x).normalize();
      const projectedA = a.map((point) => point.x * axis.x + point.y * axis.y);
      const projectedB = b.map((point) => point.x * axis.x + point.y * axis.y);
      if (
        Math.max(...projectedA) <= Math.min(...projectedB) + EPS ||
        Math.max(...projectedB) <= Math.min(...projectedA) + EPS
      )
        return false;
    }
  return true;
}

function hingeMatrix(joint, fold) {
  return new THREE.Matrix4()
    .makeTranslation(joint.origin)
    .multiply(new THREE.Matrix4().makeRotationAxis(joint.axis, joint.angle * (1 - fold)))
    .multiply(new THREE.Matrix4().makeTranslation(joint.origin.clone().negate()))
    .multiply(joint.relative);
}

function hingeNeighbors({ vertices, faces }) {
  return faces.map((parent, parentIndex) =>
    faces.flatMap((child, childIndex) => {
      const shared = parent.ids.filter((id) => child.ids.includes(id));
      if (parentIndex === childIndex || shared.length < 2) return [];
      const anchor = vertices[shared[0]];
      shared.sort((a, b) => vertices[a].distanceToSquared(anchor) - vertices[b].distanceToSquared(anchor));
      const inverse = parent.frame.clone().invert();
      const origin = vertices[shared[0]].clone().applyMatrix4(inverse);
      const axis = vertices[shared.at(-1)].clone().applyMatrix4(inverse).sub(origin).normalize();
      const relative = inverse.clone().multiply(child.frame);
      const normal = NORMAL.clone().transformDirection(relative);
      const angle = Math.atan2(
        axis.dot(new THREE.Vector3().crossVectors(normal, NORMAL)),
        normal.dot(NORMAL),
      );
      return [
        {
          parent: parentIndex,
          child: childIndex,
          origin,
          axis,
          relative,
          angle,
          length: anchor.distanceTo(vertices[shared.at(-1)]),
        },
      ];
    }),
  );
}

function restoreLayout(net, neighbors) {
  const flat = new Map([[net.root, new THREE.Matrix4()]]);
  const tree = [];
  for (const [parent, child] of net.tree) {
    const joint = neighbors[parent].find((candidate) => candidate.child === child);
    if (!joint || !flat.has(parent)) throw new Error('Invalid saved fold path');
    tree.push(joint);
    flat.set(child, flat.get(parent).clone().multiply(hingeMatrix(joint, 0)));
  }
  return { root: net.root, flat, tree };
}

function attachmentCandidates(faces, neighbors, flat, polygons, trial) {
  const candidates = [];
  for (const [id, matrix] of flat)
    for (const joint of neighbors[id]) {
      if (flat.has(joint.child)) continue;
      const next = matrix.clone().multiply(hingeMatrix(joint, 0));
      const polygon = faces[joint.child].corners.map((point) => point.clone().applyMatrix4(next));
      if ([...polygons.values()].some((other) => polygonsOverlap(polygon, other))) continue;
      const center = polygon
        .reduce((sum, point) => sum.add(point), new THREE.Vector3())
        .divideScalar(polygon.length);
      const noise = (Math.sin((joint.parent * 137 + joint.child * 73 + trial * 571) * 1.237) + 1) / 2;
      candidates.push({
        joint,
        next,
        polygon,
        cost: trial ? center.lengthSq() * (0.2 + noise * 2) : center.lengthSq(),
      });
    }
  return candidates;
}

// Every unplaced component needs a collision-free attachment. Rejecting a
// sealed component avoids exploring permutations of unrelated leaves.
function remainingComponentsReachable(neighbors, flat, candidates) {
  const available = new Set(candidates.map((candidate) => candidate.joint.child));
  const remaining = new Set(neighbors.flatMap((_, index) => (flat.has(index) ? [] : [index])));
  while (remaining.size) {
    const pending = [remaining.values().next().value];
    let canAttach = false;
    remaining.delete(pending[0]);
    for (let i = 0; i < pending.length; i++) {
      const id = pending[i];
      if (available.has(id)) canAttach = true;
      for (const joint of neighbors[id]) if (remaining.delete(joint.child)) pending.push(joint.child);
    }
    if (!canAttach) return false;
  }
  return true;
}

function searchLayout(faces, neighbors, initialRoot) {
  for (let trial = 0; trial < MAX_LAYOUT_TRIALS; trial++) {
    const root = trial ? (trial * 17) % faces.length : initialRoot;
    const flat = new Map([[root, new THREE.Matrix4()]]);
    const polygons = new Map([[root, faces[root].corners]]);
    const tree = [];
    const seen = new Set();
    let attempts = 0;

    function search() {
      if (flat.size === faces.length) return true;
      if (++attempts > MAX_SEARCH_ATTEMPTS) return false;
      const signature = tree
        .map((joint) => `${joint.parent}:${joint.child}`)
        .sort()
        .join('|');
      if (seen.has(signature)) return false;
      seen.add(signature);
      const candidates = attachmentCandidates(faces, neighbors, flat, polygons, trial);
      if (!remainingComponentsReachable(neighbors, flat, candidates)) return false;
      const forced = candidates.find(
        ({ joint }) =>
          neighbors[joint.child].every((neighbor) => flat.has(neighbor.child)) &&
          candidates.filter((candidate) => candidate.joint.child === joint.child).length === 1,
      );
      if (forced) candidates.splice(0, candidates.length, forced);
      candidates.sort((a, b) => a.cost - b.cost || a.joint.child - b.joint.child);
      for (const { joint, next, polygon } of candidates) {
        flat.set(joint.child, next);
        polygons.set(joint.child, polygon);
        tree.push(joint);
        if (search()) return true;
        flat.delete(joint.child);
        polygons.delete(joint.child);
        tree.pop();
      }
      return false;
    }

    if (search()) return { root, flat, tree };
  }
  return null;
}

export function unfoldPart(part) {
  const { vertices, faces } = part.surface;
  const neighbors = hingeNeighbors(part.surface);
  const initialRoot =
    part.net?.root ??
    faces.reduce((best, face, index) => (face.normal.y > faces[best].normal.y ? index : best), 0);
  let layout = part.net ? restoreLayout(part.net, neighbors) : null;
  if (layout?.flat.size !== faces.length) layout = searchLayout(faces, neighbors, initialRoot);
  if (!layout) throw new Error(`Cannot unfold ${part.name}`);
  const { root, flat, tree } = layout;
  const flattenRotation = new THREE.Quaternion().setFromUnitVectors(faces[root].normal, UP);
  const flatMount = new THREE.Matrix4()
    .makeRotationFromQuaternion(flattenRotation)
    .multiply(faces[root].frame);
  const flatBounds = new THREE.Box3();
  for (const [index, matrix] of flat)
    for (const point of faces[index].corners)
      flatBounds.expandByPoint(point.clone().applyMatrix4(matrix).applyMatrix4(flatMount));
  return {
    ...part,
    position: new THREE.Vector3(...part.position),
    vertices,
    faces,
    root,
    tree,
    flattenRotation,
    flatBounds,
    flatCenter: flatBounds.getCenter(new THREE.Vector3()),
  };
}

export function foldMatrices(part, current, { grounded = true } = {}) {
  const rotation = part.flattenRotation.clone().slerp(new THREE.Quaternion(), current.poseProgress);
  const mount = new THREE.Matrix4()
    .makeTranslation(part.flatCenter.clone().negate())
    .multiply(new THREE.Matrix4().makeRotationFromQuaternion(rotation));
  const frames = [];
  frames[part.root] = mount.clone().multiply(part.faces[part.root].frame);
  part.tree.forEach((joint, index) => {
    frames[joint.child] = frames[joint.parent]
      .clone()
      .multiply(hingeMatrix(joint, current.hingeProgress[index]));
  });
  if (!grounded) return frames;
  const bounds = new THREE.Box3();
  frames.forEach((frame, index) => {
    for (const point of part.faces[index].corners) bounds.expandByPoint(point.clone().applyMatrix4(frame));
  });
  const lift = new THREE.Matrix4().makeTranslation(0, 0.04 - bounds.min.y, 0);
  return frames.map((frame) => lift.clone().multiply(frame));
}
