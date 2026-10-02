import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { buildPaperModel, MODEL_PRESETS, polygonsOverlap, recipe, convexFaces } from './dist/fold-models.js';
import { exteriorSurface } from './dist/fold-topology.js';
import { STUDY_FAMILIES } from './dist/fold-collection.js';

const output = new URL('./dist/images/fold/collection/', import.meta.url);
await mkdir(output, { recursive: true });
const nets = {},
  entries = [];
if (process.argv.includes('--resume')) {
  const checkpoint = JSON.parse(
    await readFile(new URL('./qa/fold/collection-progress.json', import.meta.url), 'utf8'),
  );
  Object.assign(nets, checkpoint.nets);
  entries.push(...checkpoint.entries);
  console.log(`Resuming at ${entries.length}/100`);
}
const serialize = (model) => ({
  root: model.parts[0].root,
  tree: model.parts[0].tree.map((j) => [j.parent, j.child]),
});
const key = (p) =>
  p
    .toArray()
    .map((n) => Math.round(n * 1e6))
    .join(',');

function auditSurface(surface) {
  const edges = new Map(),
    vertices = new Set();
  for (const face of surface.faces)
    face.ids.forEach((id, i) => {
      vertices.add(id);
      const edge = [id, face.ids[(i + 1) % face.ids.length]].sort((a, b) => a - b).join(',');
      edges.set(edge, (edges.get(edge) || 0) + 1);
    });
  if ([...edges.values()].some((n) => n !== 2) || vertices.size - edges.size + surface.faces.length !== 2)
    throw new Error('Non-manifold or disconnected surface');
}
function auditNet(model) {
  const flat = model.vertices(0),
    y = flat[0][0].y;
  if (model.parts[0].tree.length !== model.faces.length - 1) throw new Error('Disconnected net');
  if (flat.flat().some((p) => Math.abs(p.y - y) > 1e-6)) throw new Error('Not flat');
  const projected = flat.map((face) => face.map((p) => new THREE.Vector2(p.x, p.z)));
  for (let a = 0; a < flat.length; a++)
    for (let b = a + 1; b < flat.length; b++)
      if (polygonsOverlap(projected[a], projected[b])) throw new Error('Overlapping net');
}
function thumbnail(model) {
  const direction = new THREE.Vector3(6, 5, 9).normalize(),
    right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize(),
    up = new THREE.Vector3().crossVectors(direction, right);
  const light = new THREE.Vector3(-0.4, 1, 0.6).normalize();
  const faces = model.vertices(1),
    points = faces.flat(),
    center = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
  const projected = faces.map((face) =>
    face.map((p) => {
      const d = p.clone().sub(center);
      return [d.dot(right), -d.dot(up), d.dot(direction)];
    }),
  );
  const width = Math.max(...projected.flat().map((p) => Math.abs(p[0]))) * 2,
    height = Math.max(...projected.flat().map((p) => Math.abs(p[1]))) * 2,
    scale = 166 / Math.max(width, height);
  const matrices = model.matrices(1);
  const paths = projected
    .map((face, i) => ({ face, i, depth: face.reduce((sum, p) => sum + p[2], 0) / face.length }))
    .sort((a, b) => a.depth - b.depth)
    .map(({ face, i }) => {
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(matrices[i]);
      if (normal.dot(direction) < 0.0001) return '';
      const color = new THREE.Color(model.faces[i].color)
        .multiplyScalar(0.7 + 0.3 * Math.max(0, normal.dot(light)))
        .getStyle();
      return `<polygon points="${face.map((p) => `${(110 + p[0] * scale).toFixed(2)},${(103 + p[1] * scale).toFixed(2)}`).join(' ')}" fill="${color}" stroke="#5a5443" stroke-opacity=".15" stroke-width=".45" stroke-linejoin="round"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 210"><rect width="220" height="210" fill="#f3efe6"/>${paths}</svg>`;
}

for (const preset of MODEL_PRESETS)
  for (const stature of [1, 0.78, 1.3]) {
    const model = buildPaperModel({ kind: preset.id, stature }, nets[`${preset.id}:${stature}`]);
    auditNet(model);
    nets[`${preset.id}:${stature}`] = serialize(model);
  }
for (let family = 0; family < STUDY_FAMILIES.length; family++) {
  const previous = entries.filter((entry) => entry.family === family);
  let count = previous.length;
  for (let seed = previous.length ? previous.at(-1).seed + 1 : 0; count < 10 && seed < 160; seed++) {
    const start = performance.now(),
      spec = { kind: 'study', family, seed };
    let model;
    try {
      auditSurface(exteriorSurface(recipe(spec), convexFaces));
      model = buildPaperModel(spec);
      auditNet(model);
    } catch (error) {
      console.log(`skip family=${family} seed=${seed}: ${error.message}`);
      continue;
    }
    const number = entries.length + 1,
      id = `study-${String(number).padStart(3, '0')}`;
    const entry = {
      id,
      family,
      seed,
      label: `${STUDY_FAMILIES[family]} ${String(count + 1).padStart(2, '0')}`,
      faces: model.faces.length,
      thumbnail: `./images/fold/collection/${id}.svg`,
    };
    entries.push(entry);
    nets[id] = serialize(model);
    count++;
    await writeFile(new URL(`${id}.svg`, output), thumbnail(model));
    console.log(`${number}/100 ${entry.label} ${entry.faces}面 ${(performance.now() - start).toFixed(0)}ms`);
    await writeFile(
      new URL('./qa/fold/collection-progress.json', import.meta.url),
      JSON.stringify({ entries, nets }, null, 2),
    );
  }
  if (count < 10) throw new Error(`Only ${count} models in ${STUDY_FAMILIES[family]}`);
}
const signatures = new Set();
for (const entry of entries) {
  const model = buildPaperModel({ kind: 'study', family: entry.family, seed: entry.seed }, nets[entry.id]);
  auditNet(model);
  signatures.add([...new Set(model.vertices(1).flat().map(key))].sort().join('|'));
}
if (signatures.size !== 100) throw new Error('Duplicate geometry');
await writeFile(
  new URL('./dist/fold-net-data.js', import.meta.url),
  `// Generated by generate-fold-collection.mjs; verified connected, flat and non-overlapping.\nexport const NETS = ${JSON.stringify(nets)};\nexport const COLLECTION = ${JSON.stringify(entries)};\n`,
);
await writeFile(
  new URL('./qa/fold/collection-generation.json', import.meta.url),
  JSON.stringify(entries, null, 2),
);
console.log('Saved 100 distinct models and 30 preset fold paths.');
