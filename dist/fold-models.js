import * as THREE from 'three';
import { VIEW_DIRECTION } from './fold-geometry.js';
import { exteriorSurface } from './fold-topology.js';
import { createStudy, STUDY_FAMILIES } from './fold-collection.js';
import { NETS, COLLECTION } from './fold-net-data.js';
import { createFoldSequence } from './fold-sequence.js';
export { COLLECTION } from './fold-net-data.js';

export const MODEL_PRESETS = [
  { id: 'person', label: 'ブロックの人', prompt: '青い服のブロックの人' },
  { id: 'robot', label: 'ロボット', prompt: '赤いロボット' },
  { id: 'cat', label: 'ねこ', prompt: 'オレンジのねこ' },
  { id: 'house', label: '小さな家', prompt: '赤い屋根の小さな家' },
  { id: 'rocket', label: 'ロケット', prompt: '青いロケット' },
  { id: 'castle', label: 'お城', prompt: '紫色のお城' },
  { id: 'cube', label: '立方体', prompt: '立方体' },
  { id: 'tetrahedron', label: '四面体', prompt: '四面体' },
  { id: 'octahedron', label: '八面体', prompt: '八面体' },
  { id: 'dodecahedron', label: '十二面体', prompt: '十二面体' },
];

const COLORS = [
  [/赤|レッド/, '#b8503e', '赤'],
  [/青|ブルー/, '#4c819b', '青'],
  [/緑|グリーン/, '#658772', '緑'],
  [/黄|イエロー/, '#d7ae49', '黄'],
  [/紫|パープル/, '#8a709e', '紫'],
  [/ピンク|桃色/, '#cf8c9c', 'ピンク'],
  [/オレンジ|橙|茶色/, '#be8754', 'オレンジ'],
  [/白|ホワイト/, '#e1dfd2', '白'],
  [/黒|ブラック/, '#4c5158', '黒'],
];

export function parseModelPrompt(prompt) {
  const text = prompt.trim().toLowerCase();
  const patterns = [
    ['dodecahedron', /十二面|12面/],
    ['octahedron', /八面|8面|ダイヤ|宝石/],
    ['tetrahedron', /四面|4面|三角錐|ピラミッド/],
    ['cube', /立方体|六面|6面|キューブ/],
    ['robot', /ロボット|ロボ|robot/],
    ['cat', /ねこ|ネコ|猫|cat/],
    ['castle', /城|castle/],
    ['house', /家|ハウス|おうち|house/],
    ['rocket', /ロケット|宇宙船|rocket/],
    ['person', /人|マイクラ|minecraft|キャラ|ヒーロー|person/],
  ];
  const kind = patterns.find(([, regex]) => regex.test(text))?.[0];
  if (!kind) return null;
  const color = COLORS.find(([regex]) => regex.test(text));
  const stature = /のっぽ|背[がの]高|長身|細長/.test(text)
    ? 1.3
    : /小柄|背[がの]低|ずんぐり|ちび/.test(text)
      ? 0.78
      : 1;
  return { kind, color: color?.[1], colorName: color?.[2], stature };
}

const vec = (p) => new THREE.Vector3(...p);
const translation = (p) => new THREE.Matrix4().makeTranslation(p.x, p.y, p.z);
const clamp = (t) => Math.min(1, Math.max(0, t));
const UP = new THREE.Vector3(0, 1, 0);
const NORMAL = new THREE.Vector3(0, 0, 1);

function box(name, size, position, color, pattern) {
  const vertices = [];
  for (const x of [-1, 1])
    for (const y of [-1, 1])
      for (const z of [-1, 1]) vertices.push([(x * size[0]) / 2, (y * size[1]) / 2, (z * size[2]) / 2]);
  return { name, vertices, position: [...position], color, pattern };
}

function prism(name, polygon, depth, position, color, pattern) {
  return {
    name,
    vertices: [-depth / 2, depth / 2].flatMap((z) => polygon.map(([x, y]) => [x, y, z])),
    position,
    color,
    pattern,
  };
}

function pyramid(name, width, height, position, color) {
  return {
    name,
    vertices: [
      [-width / 2, 0, -width / 2],
      [width / 2, 0, -width / 2],
      [width / 2, 0, width / 2],
      [-width / 2, 0, width / 2],
      [0, height, 0],
    ],
    position,
    color,
  };
}

export function recipe(spec) {
  if (spec.kind === 'study') return createStudy(spec.family, spec.seed, { box, pyramid });
  const color = spec.color;
  switch (spec.kind) {
    case 'person':
    case 'robot': {
      const robot = spec.kind === 'robot';
      const main = color || (robot ? '#bd6350' : '#4c819b');
      const skin = robot ? '#b8bfc0' : '#d8ae82';
      const parts = [
        box('頭', [1.12, 1.02, 1.04], [0, 3.52, 0], skin, robot ? 'robot-face' : 'face'),
        box('胴', [1.28, 1.56, 0.7], [0, 2.23, 0], main, robot ? 'robot-chest' : 'shirt'),
        box('左腕', [0.46, 1.5, 0.64], [-0.87, 2.25, 0], main),
        box('右腕', [0.46, 1.5, 0.64], [0.87, 2.25, 0], main),
        box('左脚', [0.58, 1.45, 0.65], [-0.34, 0.725, 0], robot ? '#777e83' : '#505b72', 'boots'),
        box('右脚', [0.58, 1.45, 0.65], [0.34, 0.725, 0], robot ? '#777e83' : '#505b72', 'boots'),
      ];
      if (robot) parts.push(box('アンテナ', [0.16, 0.38, 0.16], [0, 4.22, 0], main));
      return parts;
    }
    case 'cat': {
      const fur = color || '#be8754';
      return [
        box('胴', [1.65, 0.95, 0.86], [0.15, 0.98, 0], fur),
        box('顔', [1, 0.86, 0.94], [-0.65, 1.57, 0.04], fur, 'cat-face'),
        ...[-0.42, 0.68].flatMap((x, a) =>
          [-0.27, 0.27].map((z, b) =>
            box(`足${a * 2 + b + 1}`, [0.28, 0.53, 0.28], [x, 0.265, z], '#d9c8a3'),
          ),
        ),
        box('しっぽ', [0.9, 0.25, 0.25], [1.33, 1.18, -0.15], fur),
        prism(
          '左耳',
          [
            [-0.2, 0],
            [0.2, 0],
            [-0.12, 0.44],
          ],
          0.28,
          [-0.92, 2, 0.03],
          fur,
        ),
        prism(
          '右耳',
          [
            [-0.2, 0],
            [0.2, 0],
            [0.12, 0.44],
          ],
          0.28,
          [-0.38, 2, 0.03],
          fur,
        ),
      ];
    }
    case 'house':
      return [
        box('壁', [2.2, 1.8, 1.8], [0, 0.9, 0], '#dbcba9', 'house'),
        prism(
          '屋根',
          [
            [-1.3, 0],
            [1.3, 0],
            [0, 1.1],
          ],
          2.1,
          [0, 1.8, 0],
          color || '#ac5947',
        ),
        box('煙突', [0.32, 0.85, 0.35], [0.65, 2.52, -0.3], '#9b8875'),
      ];
    case 'rocket':
      return [
        box('機体', [1, 2.1, 1], [0, 1.55, 0], '#dddcd1', 'rocket-window'),
        pyramid('先端', 1.02, 1.0, [0, 2.6, 0], color || '#4c819b'),
        prism(
          '左翼',
          [
            [-0.75, 0],
            [0, 0],
            [0, 1.3],
          ],
          0.3,
          [-0.5, 0.45, 0],
          color || '#4c819b',
        ),
        prism(
          '右翼',
          [
            [0, 0],
            [0.75, 0],
            [0, 1.3],
          ],
          0.3,
          [0.5, 0.45, 0],
          color || '#4c819b',
        ),
        pyramid('噴射口', 0.65, -0.5, [0, 0.5, 0], '#d5a047'),
      ];
    case 'castle':
      return [
        box('城壁', [1.8, 1.35, 1.05], [0, 0.675, 0], '#c1b8a4', 'castle-door'),
        ...[-1.18, 1.18].flatMap((x, i) => [
          box(`塔${i + 1}`, [0.75, 2, 0.9], [x, 1, 0], '#d2c7b0', 'tower'),
          pyramid(`塔の屋根${i + 1}`, 1.0, 0.78, [x, 2, 0], color || '#8a709e'),
        ]),
        ...[-0.65, 0, 0.65].map((x, i) => box(`胸壁${i + 1}`, [0.28, 0.3, 1.05], [x, 1.5, 0], '#c1b8a4')),
      ];
    case 'cube':
      return [box('立方体', [2, 2, 2], [0, 1, 0], color || '#799a95')];
    case 'tetrahedron':
      return [
        {
          name: '四面体',
          vertices: [
            [1, 1, 1],
            [-1, -1, 1],
            [-1, 1, -1],
            [1, -1, -1],
          ],
          position: [0, 1, 0],
          color: color || '#b58566',
        },
      ];
    case 'octahedron':
      return [
        {
          name: '八面体',
          vertices: [
            [1.35, 0, 0],
            [-1.35, 0, 0],
            [0, 1.65, 0],
            [0, -1.65, 0],
            [0, 0, 1.35],
            [0, 0, -1.35],
          ],
          position: [0, 1.65, 0],
          color: color || '#7b99ae',
        },
      ];
    case 'dodecahedron': {
      const p = (1 + Math.sqrt(5)) / 2,
        r = 1 / p,
        vertices = [];
      for (const a of [-1, 1])
        for (const b of [-1, 1]) {
          for (const c of [-1, 1]) vertices.push([a, b, c]);
          vertices.push([0, a * r, b * p], [a * r, b * p, 0], [a * p, 0, b * r]);
        }
      return [{ name: '十二面体', vertices, position: [0, p, 0], color: color || '#7f9b79' }];
    }
    default:
      throw new Error('Unknown paper model');
  }
}

export function convexFaces(vertices) {
  const faces = new Map();
  for (let i = 0; i < vertices.length; i++)
    for (let j = i + 1; j < vertices.length; j++)
      for (let k = j + 1; k < vertices.length; k++) {
        const normal = new THREE.Vector3().crossVectors(
          vertices[j].clone().sub(vertices[i]),
          vertices[k].clone().sub(vertices[i]),
        );
        if (normal.lengthSq() < 1e-12) continue;
        normal.normalize();
        const distances = vertices.map((v) => v.clone().sub(vertices[i]).dot(normal));
        if (distances.some((d) => d > 1e-7) && distances.some((d) => d < -1e-7)) continue;
        if (distances.some((d) => d > 1e-7)) normal.negate();
        const ids = distances.flatMap((d, index) => (Math.abs(d) < 1e-7 ? [index] : []));
        const key = ids.join(',');
        if (faces.has(key)) continue;
        const center = ids
          .reduce((sum, index) => sum.add(vertices[index]), new THREE.Vector3())
          .divideScalar(ids.length);
        const x =
          Math.abs(normal.y) > 0.99
            ? new THREE.Vector3(1, 0, 0)
            : new THREE.Vector3().crossVectors(UP, normal).normalize();
        const y = new THREE.Vector3().crossVectors(normal, x);
        ids.sort((a, b) => {
          const va = vertices[a].clone().sub(center),
            vb = vertices[b].clone().sub(center);
          return Math.atan2(va.dot(y), va.dot(x)) - Math.atan2(vb.dot(y), vb.dot(x));
        });
        const frame = new THREE.Matrix4().makeBasis(x, y, normal).setPosition(center);
        const inverse = frame.clone().invert();
        faces.set(key, {
          ids,
          normal,
          frame,
          corners: ids.map((id) => vertices[id].clone().applyMatrix4(inverse).setZ(0)),
        });
      }
  return [...faces.values()];
}

export function polygonsOverlap(a, b) {
  const bounds = (polygon) => {
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const p of polygon) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, maxX, minY, maxY };
  };
  const ba = bounds(a),
    bb = bounds(b);
  if (
    ba.maxX <= bb.minX + 1e-7 ||
    bb.maxX <= ba.minX + 1e-7 ||
    ba.maxY <= bb.minY + 1e-7 ||
    bb.maxY <= ba.minY + 1e-7
  )
    return false;
  for (const polygon of [a, b])
    for (let i = 0; i < polygon.length; i++) {
      const next = polygon[(i + 1) % polygon.length];
      const axis = new THREE.Vector2(-(next.y - polygon[i].y), next.x - polygon[i].x).normalize();
      const pa = a.map((p) => p.x * axis.x + p.y * axis.y),
        pb = b.map((p) => p.x * axis.x + p.y * axis.y);
      if (Math.max(...pa) <= Math.min(...pb) + 1e-7 || Math.max(...pb) <= Math.min(...pa) + 1e-7)
        return false;
    }
  return true;
}

function hingeMatrix(joint, fold) {
  return translation(joint.origin)
    .multiply(new THREE.Matrix4().makeRotationAxis(joint.axis, joint.angle * (1 - fold)))
    .multiply(translation(joint.origin.clone().negate()))
    .multiply(joint.relative);
}

function unfoldPart(part) {
  const { vertices, faces } = part.surface;
  let root = faces.reduce((best, f, i) => (f.normal.y > faces[best].normal.y ? i : best), 0);
  const neighbors = faces.map((parent, p) =>
    faces.flatMap((child, c) => {
      const shared = parent.ids.filter((id) => child.ids.includes(id));
      if (p === c || shared.length < 2) return [];
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
          parent: p,
          child: c,
          origin,
          axis,
          relative,
          angle,
          length: anchor.distanceTo(vertices[shared.at(-1)]),
        },
      ];
    }),
  );
  const flat = new Map([[root, new THREE.Matrix4()]]),
    polygons = new Map([[root, faces[root].corners]]),
    tree = [];
  let attempts = 0,
    trial = 0;
  const seen = new Set();
  function search() {
    if (flat.size === faces.length) return true;
    if (++attempts > 250) return false;
    const signature = tree
      .map((j) => `${j.parent}:${j.child}`)
      .sort()
      .join('|');
    if (seen.has(signature)) return false;
    seen.add(signature);
    const candidates = [];
    for (const [id, matrix] of flat)
      for (const joint of neighbors[id]) {
        if (flat.has(joint.child)) continue;
        const next = matrix.clone().multiply(hingeMatrix(joint, 0));
        const polygon = faces[joint.child].corners.map((p) => p.clone().applyMatrix4(next));
        if ([...polygons.values()].some((other) => polygonsOverlap(polygon, other))) continue;
        const center = polygon
          .reduce((sum, p) => sum.add(p), new THREE.Vector3())
          .divideScalar(polygon.length);
        const noise = (Math.sin((joint.parent * 137 + joint.child * 73 + trial * 571) * 1.237) + 1) / 2;
        candidates.push({
          joint,
          next,
          polygon,
          cost: trial ? center.lengthSq() * (0.2 + noise * 2) : center.lengthSq(),
        });
      }
    // An unplaced component needs at least one collision-free attachment. Prune
    // as soon as all its doors close, instead of permuting unrelated leaves.
    const available = new Set(candidates.map((c) => c.joint.child));
    const remaining = new Set(faces.map((_, i) => i).filter((i) => !flat.has(i)));
    while (remaining.size) {
      const todo = [remaining.values().next().value];
      let canAttach = false;
      remaining.delete(todo[0]);
      for (let i = 0; i < todo.length; i++) {
        const id = todo[i];
        if (available.has(id)) canAttach = true;
        for (const joint of neighbors[id]) if (remaining.delete(joint.child)) todo.push(joint.child);
      }
      if (!canAttach) return false;
    }
    const forced = candidates.find(
      ({ joint }) =>
        neighbors[joint.child].every((j) => flat.has(j.child)) &&
        candidates.filter((c) => c.joint.child === joint.child).length === 1,
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
  let found = false;
  if (part.net) {
    root = part.net.root;
    flat.clear();
    polygons.clear();
    tree.length = 0;
    flat.set(root, new THREE.Matrix4());
    for (const [parent, child] of part.net.tree) {
      const joint = neighbors[parent].find((j) => j.child === child);
      if (!joint || !flat.has(parent)) throw new Error('Invalid saved fold path');
      tree.push(joint);
      flat.set(child, flat.get(parent).clone().multiply(hingeMatrix(joint, 0)));
    }
    found = flat.size === faces.length;
  }
  for (; !found && trial < 80; trial++) {
    if (trial) root = (trial * 17) % faces.length;
    flat.clear();
    polygons.clear();
    tree.length = 0;
    seen.clear();
    attempts = 0;
    flat.set(root, new THREE.Matrix4());
    polygons.set(root, faces[root].corners);
    if (search()) {
      found = true;
      break;
    }
  }
  if (!found) throw new Error(`Cannot unfold ${part.name}`);
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
    position: vec(part.position),
    vertices,
    faces,
    root,
    tree,
    flattenRotation,
    flatBounds,
    flatCenter: flatBounds.getCenter(new THREE.Vector3()),
  };
}

export function buildPaperModel(spec, savedNet) {
  const entry = COLLECTION.find((item) => item.id === spec.kind);
  const originalSpec = spec;
  if (entry) spec = { ...spec, kind: 'study', family: entry.family, seed: entry.seed };
  const source = recipe(spec);
  const stature = spec.stature || 1;
  const scaled = source.map((part) => ({
    ...part,
    vertices: part.vertices.map(([x, y, z]) => [x, y * stature, z]),
    position: [part.position[0], part.position[1] * stature, part.position[2]],
  }));
  const surface = exteriorSurface(scaled, convexFaces);
  const netKey = entry?.id || `${spec.kind}:${stature}`;
  const parts = [
    unfoldPart({ name: spec.kind, position: [0, 0, 0], surface, net: savedNet || NETS[netKey] }),
  ];
  const sequence = createFoldSequence(parts[0]);
  const hinges = new Set(),
    creases = new Set();
  for (const joint of parts[0].tree) {
    const parent = parts[0].faces[joint.parent],
      child = parts[0].faces[joint.child];
    parent.ids.forEach((id, i) => {
      const next = parent.ids[(i + 1) % parent.ids.length];
      if (child.ids.includes(id) && child.ids.includes(next)) {
        const key = [id, next].sort((a, b) => a - b).join(',');
        hinges.add(key);
        if (Math.abs(joint.angle) > 1e-7) creases.add(key);
      }
    });
  }
  const faces = parts.flatMap((part, p) =>
    part.faces.map((face) => ({
      corners: face.corners.map((v) => v.toArray()),
      color: face.color,
      pattern: face.pattern,
      paintUVs: face.paintUVs,
      foldEdges: face.ids.map((id, i) =>
        hinges.has([id, face.ids[(i + 1) % face.ids.length]].sort((a, b) => a - b).join(',')),
      ),
      creaseEdges: face.ids.map((id, i) =>
        creases.has([id, face.ids[(i + 1) % face.ids.length]].sort((a, b) => a - b).join(',')),
      ),
      part: p,
      name: face.name,
    })),
  );
  function matrices(fold, { grounded = true } = {}) {
    fold = clamp(fold);
    const current = sequence.sample(fold);
    const all = [];
    const bounds = new THREE.Box3();
    for (const part of parts) {
      const q = part.flattenRotation.clone().slerp(new THREE.Quaternion(), current.poseProgress);
      const position = part.flatCenter.clone().negate();
      const mount = translation(position).multiply(new THREE.Matrix4().makeRotationFromQuaternion(q));
      const frames = [];
      frames[part.root] = mount.clone().multiply(part.faces[part.root].frame);
      part.tree.forEach((joint, index) => {
        frames[joint.child] = frames[joint.parent]
          .clone()
          .multiply(hingeMatrix(joint, current.hingeProgress[index]));
      });
      frames.forEach((frame, i) => {
        if (grounded)
          for (const point of part.faces[i].corners) bounds.expandByPoint(point.clone().applyMatrix4(frame));
        all.push(frame);
      });
    }
    if (!grounded) return all;
    const lift = new THREE.Matrix4().makeTranslation(0, 0.04 - bounds.min.y, 0);
    return all.map((frame) => lift.clone().multiply(frame));
  }
  const closed = matrices(1),
    closedBounds = new THREE.Box3();
  const vertices = (fold) =>
    matrices(fold).map((frame, i) => faces[i].corners.map((p) => vec(p).applyMatrix4(frame)));
  closed.forEach((frame, i) =>
    faces[i].corners.forEach((p) => closedBounds.expandByPoint(vec(p).applyMatrix4(frame))),
  );
  const center = closedBounds.getCenter(new THREE.Vector3());
  const right = new THREE.Vector3().crossVectors(UP, VIEW_DIRECTION).normalize();
  const up = new THREE.Vector3().crossVectors(VIEW_DIRECTION, right).normalize();
  const points = vertices(1)
    .flat()
    .map((p) => p.sub(center));
  const projectionSize =
    Math.max(...points.flatMap((p) => [Math.abs(p.dot(right)), Math.abs(p.dot(up))])) * 2.05;
  const uvs = closed.map((frame, i) =>
    faces[i].corners.map((p) => {
      const delta = vec(p).applyMatrix4(frame).sub(center);
      return [0.5 + delta.dot(right) / projectionSize, 0.5 + delta.dot(up) / projectionSize];
    }),
  );
  return {
    spec: originalSpec,
    label:
      entry?.label || MODEL_PRESETS.find((p) => p.id === spec.kind)?.label || STUDY_FAMILIES[spec.family],
    sheetCount: 1,
    sequence,
    parts,
    faces,
    matrices,
    vertices,
    uvs,
  };
}
