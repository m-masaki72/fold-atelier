import test from 'node:test';
import assert from 'node:assert/strict';
import { createArtwork } from '../dist/js/fold-artwork.js';
import { FoldView } from '../dist/js/fold-view.js';
import * as THREE from 'three';

function artworkFixture(t, setImage) {
  const previousDocument = globalThis.document;
  const elements = new Map();
  globalThis.document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, {});
      return elements.get(selector);
    },
  };
  t.after(() => {
    globalThis.document = previousDocument;
  });
  const source = URL.createObjectURL(new Blob(['previous image']));
  const state = { imageSource: source, imageKey: 'old', artwork: 'Previous' };
  t.after(() => URL.revokeObjectURL(state.imageSource));
  const noNavigation = () => {
    assert.fail('Restoring an image must preserve the folding and camera state');
  };
  const artwork = createArtwork({
    view: { setImage },
    state,
    setArtMode: noNavigation,
    goTo: noNavigation,
    closeTools: noNavigation,
    toast: noNavigation,
    saveSession: noNavigation,
  });
  return { artwork, state, elements, source };
}

const record = (key = 'new') => ({
  key,
  blob: new Blob(['new image']),
  title: 'New picture',
  credit: 'Test',
});

test('image resume updates the picture and saved key, releasing the previous local image', async (t) => {
  const { artwork, state, elements, source } = artworkFixture(t, async () => true);
  assert.equal(await artwork.restore(record()), true);
  assert.equal(await (await fetch(state.imageSource)).text(), 'new image');
  await assert.rejects(fetch(source));
  assert.equal(state.imageKey, 'new');
  assert.equal(state.artwork, 'New picture');
  assert.equal(elements.get('#art-thumbnail').src, state.imageSource);
  assert.equal(elements.get('#art-thumbnail').alt, 'New picture');
  assert.equal(elements.get('#source-image').src, state.imageSource);
});

test('failed image resume retains the current picture and releases its unused replacement', async (t) => {
  let replacement;
  const { artwork, state, source } = artworkFixture(t, async (url) => {
    replacement = url;
    throw new Error('Cannot decode');
  });
  await assert.rejects(artwork.restore(record()), /Cannot decode/);
  assert.equal(state.imageSource, source);
  assert.equal(state.imageKey, 'old');
  assert.equal(await (await fetch(source)).text(), 'previous image');
  await assert.rejects(fetch(replacement));
});

test('a superseded image request cannot overwrite the latest picture or leak its URL', async (t) => {
  let finishEarlier, earlierURL;
  const { artwork, state } = artworkFixture(t, (url) => {
    if (!earlierURL) {
      earlierURL = url;
      return new Promise((resolve) => {
        finishEarlier = resolve;
      });
    }
    return Promise.resolve(true);
  });
  const earlier = artwork.restore(record('earlier'));
  await artwork.restore(record('latest'));
  const latestURL = state.imageSource;
  finishEarlier(false);
  assert.equal(await earlier, false);
  assert.equal(state.imageSource, latestURL);
  assert.equal(state.imageKey, 'latest');
  assert.equal(await (await fetch(latestURL)).text(), 'new image');
  await assert.rejects(fetch(earlierURL));
});

test('a request superseded during texture loading never reaches the displayed paper', async (t) => {
  const texture = new THREE.Texture();
  let disposed = 0,
    finishLoading,
    current = true;
  texture.addEventListener('dispose', () => disposed++);
  t.mock.method(
    THREE.TextureLoader.prototype,
    'loadAsync',
    () =>
      new Promise((resolve) => {
        finishLoading = resolve;
      }),
  );
  const view = {
    paperMesh: {
      setImage() {
        assert.fail('Obsolete texture reached the paper');
      },
    },
    renderer: { capabilities: { getMaxAnisotropy: () => 8 } },
  };
  const pending = FoldView.prototype.setImage.call(view, 'test-image', () => current);
  current = false;
  finishLoading(texture);
  assert.equal(await pending, false);
  assert.equal(disposed, 1);
});
