import { MODEL_PRESETS } from './fold-recipes.js';
import { COLLECTION } from './fold-net-data.js';

export const SESSION_KEY = 'fold-atelier-session-v1';
const collectionIds = new Set(COLLECTION.map((entry) => entry.id));
const kinds = new Set([...MODEL_PRESETS.map((entry) => entry.id), ...collectionIds]);
const clamp = (value, min, max, fallback) =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

function normalizeHistory(value, index) {
  const source = Array.isArray(value) ? value : [];
  const cursor = Math.floor(clamp(index, -1, source.length - 1, -1));
  const history = [];
  let historyIndex = -1;
  source.forEach((id, i) => {
    if (!collectionIds.has(id)) return;
    history.push(id);
    if (i <= cursor) historyIndex = history.length - 1;
  });
  const start = Math.max(0, historyIndex - 99);
  return { history: history.slice(start, start + 100), historyIndex: historyIndex - start };
}

export function validateSession(value) {
  if (value?.version !== 1 || !kinds.has(value.spec?.kind)) return null;
  const spec = { kind: value.spec.kind };
  if ([0.78, 1, 1.3].includes(value.spec.stature)) spec.stature = value.spec.stature;
  if (/^#[0-9a-f]{6}$/i.test(value.spec.color || '')) spec.color = value.spec.color;
  if (typeof value.spec.colorName === 'string') spec.colorName = value.spec.colorName.slice(0, 12);
  const vector = (p) =>
    Array.isArray(p) && p.length === 3 && p.every((n) => Number.isFinite(n) && Math.abs(n) < 10000);
  const camera = value.camera;
  return {
    version: 1,
    spec,
    fold: clamp(value.fold, 0, 1, 0),
    playing: value.playing === true,
    direction: value.direction === -1 ? -1 : 1,
    paper: value.paper === 'tracing' ? 'tracing' : 'washi',
    cameraMode: value.cameraMode === 'focus' ? 'focus' : 'fixed',
    family: /^(all|[0-9])$/.test(value.family) ? value.family : 'all',
    camera:
      camera &&
      vector(camera.position) &&
      vector(camera.target) &&
      camera.position.some((n, i) => Math.abs(n - camera.target[i]) > 0.001)
        ? {
            position: camera.position,
            target: camera.target,
            half: clamp(camera.half, 0.01, 1000, 3),
            zoom: clamp(camera.zoom, 0.65, 4, 1),
            manual: camera.manual === true,
          }
        : null,
    prompt: typeof value.prompt === 'string' ? value.prompt.slice(0, 180) : '',
    artMode: value.artMode === true,
    imageKey: typeof value.imageKey === 'string' ? value.imageKey.slice(0, 50) : null,
    visited: Array.isArray(value.visited)
      ? [...new Set(value.visited.filter((id) => collectionIds.has(id)))]
      : [],
    ...normalizeHistory(value.history, value.historyIndex),
  };
}

export function readSession(storage) {
  try {
    return validateSession(JSON.parse((storage || localStorage).getItem(SESSION_KEY)));
  } catch {
    return null;
  }
}

export function writeSession(value, storage) {
  try {
    (storage || localStorage).setItem(SESSION_KEY, JSON.stringify({ ...value, version: 1 }));
    return true;
  } catch {
    return false;
  }
}

// Images can exceed localStorage's quota. Keep the last image in IndexedDB and
// store only its key in the small view-state record.
export async function imageStore(record) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('fold-atelier-images', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('images');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('images', record ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('images');
      const request = record ? store.put(record, 'current') : store.get('current');
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}
