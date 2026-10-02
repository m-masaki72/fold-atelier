import { imageStore } from './fold-session.js';
const $ = (selector) => document.querySelector(selector);

export function createArtwork({ view, state, setArtMode, goTo, closeTools, toast, saveSession }) {
  let requestId = 0;
  let saveQueue = Promise.resolve();
  const imageURLs = new Set(state.imageSource.startsWith('blob:') ? [state.imageSource] : []);

  function releaseImage(source) {
    if (imageURLs.delete(source)) URL.revokeObjectURL(source);
  }

  function showImageError(message) {
    $('#image-status').textContent = message;
    toast(message);
  }

  async function loadImage(source, title, credit, request, imageKey = null) {
    if (request !== requestId) return false;
    const applied = await view.setImage(source, () => request === requestId);
    if (!applied || request !== requestId) return false;
    const previous = state.imageSource;
    state.artwork = title;
    state.imageSource = source;
    state.imageKey = imageKey;
    $('#art-thumbnail').src = source;
    $('#art-thumbnail').alt = title;
    $('#source-image').src = source;
    $('#art-title').textContent = title;
    $('#art-credit').textContent = credit;
    if (previous !== source) releaseImage(previous);
    return true;
  }

  async function applyImage(source, title, credit, request) {
    if (!(await loadImage(source, title, credit, request)) || request !== requestId) return false;
    setArtMode(true);
    $('#art-dialog').close();
    goTo(0.58);
    view.home();
    closeTools();
    if (source.startsWith('blob:')) {
      try {
        const key = `image-${Date.now()}`;
        const blob = await (await fetch(source)).blob();
        // A late conversion must not replace the newer image in the single saved slot.
        const save = saveQueue.then(async () => {
          if (state.imageSource !== source) return;
          await imageStore({ key, blob, title, credit });
          if (state.imageSource === source) state.imageKey = key;
        });
        saveQueue = save.catch(() => {});
        await save;
      } catch {
        if (state.imageSource === source)
          toast('絵を表示しました。画像の次回復元は、このブラウザでは利用できません。');
      }
    }
    saveSession();
    return request === requestId && state.imageSource === source;
  }

  async function applyBlob(blob, title, credit, request, restoreKey = null) {
    if (request !== requestId) return false;
    const source = URL.createObjectURL(blob);
    imageURLs.add(source);
    try {
      const applied = restoreKey
        ? await loadImage(source, title, credit, request, restoreKey)
        : await applyImage(source, title, credit, request);
      if (!applied && state.imageSource !== source) releaseImage(source);
      return applied;
    } catch (error) {
      if (state.imageSource !== source) releaseImage(source);
      throw error;
    }
  }

  async function upload(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    $('#image-status').textContent = '';
    const request = ++requestId;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      showImageError('10 MB以下の JPG・PNG・WebP を選んでください。');
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (request !== requestId) return;
      if (image.width * image.height > 40000000) throw new Error('画像のサイズが大きすぎます。');
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1536;
      const context = canvas.getContext('2d');
      context.fillStyle = '#efece4';
      context.fillRect(0, 0, 1536, 1536);
      const scale = 1536 / Math.max(image.width, image.height);
      context.drawImage(
        image,
        (1536 - image.width * scale) / 2,
        (1536 - image.height * scale) / 2,
        image.width * scale,
        image.height * scale,
      );
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (
        !(await applyBlob(
          blob,
          file.name.replace(/\.[^.]+$/, '').slice(0, 32),
          'YOUR PICTURE · ON PAPER',
          request,
        ))
      )
        return;
      toast('あなたの絵を、紙にのせました。');
    } catch {
      if (request === requestId) showImageError('画像を読み込めませんでした。別の画像でお試しください。');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function init() {
    $('#art-open').addEventListener('click', () => {
      $('#image-status').textContent = '';
      $('#art-dialog').showModal();
    });
    $('#source-open').addEventListener('click', () => $('#source-dialog').showModal());
    $('#restore-art').addEventListener('click', () => {
      $('#image-status').textContent = '';
      const request = ++requestId;
      return applyImage('./images/fold/crane.png', '日輪をわたる', 'ORIGINAL ARTWORK', request).catch(() => {
        if (request === requestId) showImageError('元の絵を読み込めませんでした。');
      });
    });
    $('#image-upload').addEventListener('change', upload);
  }
  async function restore(image) {
    return applyBlob(image.blob, image.title, image.credit, ++requestId, image.key);
  }
  return {
    init,
    restore,
  };
}
