import test from 'node:test';
import assert from 'node:assert/strict';
import { createArtwork } from './dist/fold-artwork.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(setImmediate);
  }
  assert.fail('Expected the pending image operation to reach its checkpoint');
}

async function fixture(t) {
  const globals = { document: globalThis.document, Image: globalThis.Image, indexedDB: globalThis.indexedDB };
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const created = [],
    revoked = [],
    displayed = [],
    writes = [],
    toasts = [];
  const controls = {
    decode: async () => {},
    encode: (blob, callback) => callback(blob),
    read: async (source) => (await nativeFetch(source)).blob(),
    write: async () => {},
    generate: async () => ({ image: 'aW1hZ2U=' }),
    setImage: async () => true,
  };
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector))
      elements.set(selector, {
        value: '',
        listeners: {},
        classList: { toggle() {} },
        addEventListener(type, callback) {
          this.listeners[type] = callback;
        },
        close() {},
        showModal() {},
        focus() {},
      });
    return elements.get(selector);
  };
  globalThis.document = {
    querySelector: element,
    createElement: () => ({
      getContext: () => ({ fillRect() {}, drawImage() {} }),
      toBlob: (callback) => controls.encode(new Blob(['converted image']), callback),
    }),
  };
  globalThis.Image = class {
    width = 100;
    height = 100;
    decode() {
      return controls.decode(this.src);
    }
  };
  let stored,
    activeWrites = 0,
    maximumWrites = 0;
  globalThis.indexedDB = {
    open() {
      const request = {
        result: {
          close() {},
          transaction() {
            const transaction = {
              objectStore: () => ({
                put(record) {
                  const result = { result: 'current' };
                  writes.push(record);
                  maximumWrites = Math.max(maximumWrites, ++activeWrites);
                  Promise.resolve()
                    .then(() => controls.write(record))
                    .then(
                      () => {
                        stored = record;
                        activeWrites--;
                        transaction.oncomplete();
                      },
                      (error) => {
                        activeWrites--;
                        transaction.error = error;
                        transaction.onerror();
                      },
                    );
                  return result;
                },
              }),
            };
            return transaction;
          },
        },
      };
      queueMicrotask(() => request.onsuccess());
      return request;
    },
  };
  t.mock.method(globalThis, 'fetch', async (source) => {
    if (source === '/api/fold/config') return { ok: true, json: async () => ({ generationAvailable: true }) };
    if (source === '/api/fold/generate') return { ok: true, json: () => controls.generate() };
    if (source.startsWith('blob:')) return { blob: () => controls.read(source) };
    return nativeFetch(source);
  });
  const createURL = URL.createObjectURL.bind(URL),
    revokeURL = URL.revokeObjectURL.bind(URL);
  t.mock.method(URL, 'createObjectURL', (blob) => {
    const source = createURL(blob);
    created.push(source);
    return source;
  });
  t.mock.method(URL, 'revokeObjectURL', (source) => {
    revoked.push(source);
    revokeURL(source);
  });
  t.after(() => {
    for (const source of created) revokeURL(source);
    Object.assign(globalThis, globals);
  });
  const state = { imageSource: './images/fold/crane.png', artwork: 'Original', imageKey: null };
  const artwork = createArtwork({
    state,
    view: {
      setImage: (source) => {
        displayed.push(source);
        return controls.setImage(source);
      },
      home() {},
      model: { faces: [] },
    },
    setArtMode() {},
    goTo() {},
    closeTools() {},
    saveSession() {},
    toast: (message) => toasts.push(message),
  });
  await artwork.init();
  return {
    artwork,
    state,
    controls,
    created,
    revoked,
    displayed,
    writes,
    toasts,
    get stored() {
      return stored;
    },
    get maximumWrites() {
      return maximumWrites;
    },
    upload(name) {
      const file = new Blob([name], { type: 'image/png' });
      file.name = `${name}.png`;
      return element('#image-upload').listeners.change({ target: { files: [file], value: '' } });
    },
    original: () => element('#restore-art').listeners.click(),
    generate() {
      element('#art-prompt').value = 'Generated';
      return element('#generate-form').listeners.submit({ preventDefault() {} });
    },
  };
}

const saved = (key) => ({ key, blob: new Blob([key]), title: key, credit: 'Test' });

test('an earlier upload finishing decode cannot replace a newer upload', async (t) => {
  const f = await fixture(t),
    decode = deferred();
  let calls = 0;
  f.controls.decode = () => (++calls === 1 ? decode.promise : Promise.resolve());
  const earlier = f.upload('Earlier');
  await f.upload('Latest');
  const latestURL = f.state.imageSource;
  decode.resolve();
  await earlier;
  assert.equal(f.state.artwork, 'Latest');
  assert.equal(f.state.imageSource, latestURL);
  assert.equal(f.displayed.length, 1);
  assert.equal(f.revoked.filter((url) => url === f.created[0]).length, 1);
});

test('returning to the original picture supersedes an upload during canvas conversion', async (t) => {
  const f = await fixture(t);
  let finishEncoding;
  f.controls.encode = (blob, callback) => {
    finishEncoding = () => callback(blob);
  };
  const upload = f.upload('Earlier');
  await until(() => finishEncoding);
  await f.original();
  finishEncoding();
  await upload;
  assert.equal(f.state.imageSource, './images/fold/crane.png');
  assert.equal(f.state.artwork, '日輪をわたる');
  assert.equal(f.created.length, 1, 'No object URL is allocated for the obsolete converted image');
  assert.equal(f.revoked.length, 1);
});

test('restoring a saved picture supersedes an outstanding generation response', async (t) => {
  const f = await fixture(t),
    generation = deferred();
  f.controls.generate = () => generation.promise;
  const pending = f.generate();
  await f.artwork.restore(saved('Restored'));
  generation.resolve({ image: 'aW1hZ2U=' });
  await pending;
  assert.equal(f.state.artwork, 'Restored');
  assert.equal(f.state.imageKey, 'Restored');
  assert.equal(f.state.generating, false);
  assert.equal(f.displayed.length, 1);
});

test('a superseded texture load reports false and releases only its unused URL', async (t) => {
  const f = await fixture(t),
    load = deferred();
  let calls = 0;
  f.controls.setImage = () => (++calls === 1 ? load.promise : Promise.resolve(true));
  const earlier = f.artwork.restore(saved('Earlier'));
  await f.artwork.restore(saved('Latest'));
  load.resolve(true);
  assert.equal(await earlier, false);
  assert.equal(f.state.imageKey, 'Latest');
  assert.equal(f.revoked.filter((url) => url === f.created[0]).length, 1);
  assert.equal(f.revoked.includes(f.state.imageSource), false);
});

test('a late blob read cannot overwrite the newer saved image or revoke its URL', async (t) => {
  const f = await fixture(t),
    read = deferred();
  let reads = 0,
    earlierURL;
  f.controls.read = async (source) => {
    if (++reads === 1) {
      earlierURL = source;
      return read.promise;
    }
    return new Blob(['latest']);
  };
  const earlier = f.upload('Earlier');
  await until(() => earlierURL);
  await f.upload('Latest');
  read.resolve(new Blob(['earlier']));
  await earlier;
  assert.equal(f.state.artwork, 'Latest');
  assert.equal(f.stored.title, 'Latest');
  assert.equal(f.state.imageKey, f.stored.key);
  assert.deepEqual(
    f.writes.map((record) => record.title),
    ['Latest'],
  );
  assert.equal(f.revoked.filter((url) => url === earlierURL).length, 1);
  assert.equal(f.revoked.includes(f.state.imageSource), false);
});

test('image saves run serially and skip pictures superseded while queued', async (t) => {
  const f = await fixture(t),
    write = deferred();
  f.controls.write = (record) => (record.title === 'Earlier' ? write.promise : Promise.resolve());
  const earlier = f.upload('Earlier');
  await until(() => f.writes.length === 1);
  const earlierURL = f.state.imageSource;
  const middle = f.upload('Middle');
  await until(() => f.state.artwork === 'Middle');
  const middleURL = f.state.imageSource;
  const latest = f.upload('Latest');
  await until(() => f.state.artwork === 'Latest');
  write.resolve();
  await Promise.all([earlier, middle, latest]);
  assert.equal(f.maximumWrites, 1);
  assert.deepEqual(
    f.writes.map((record) => record.title),
    ['Earlier', 'Latest'],
  );
  assert.equal(f.stored.title, 'Latest');
  assert.equal(f.state.imageKey, f.stored.key);
  for (const source of [earlierURL, middleURL])
    assert.equal(f.revoked.filter((url) => url === source).length, 1);
  assert.equal(f.revoked.includes(f.state.imageSource), false);
});
