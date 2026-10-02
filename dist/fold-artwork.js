import { imageStore } from './fold-session.js';
const $ = (selector) => document.querySelector(selector);

export function createArtwork({ view, state, setArtMode, goTo, closeTools, toast, saveSession }) {
  let generationAvailable = false;
  let requestId = 0;
  let saveQueue = Promise.resolve();
  const imageURLs = new Set(state.imageSource.startsWith('blob:') ? [state.imageSource] : []);

  function startRequest() {
    if (state.generating) busy(false);
    return ++requestId;
  }

  function releaseImage(source) {
    if (imageURLs.delete(source)) URL.revokeObjectURL(source);
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

  function busy(value) {
    state.generating = value;
    $('#art-dialog').classList.toggle('busy', value);
    $('#generate').disabled = value || !generationAvailable;
    $('#art-prompt').disabled = value;
    $('#image-upload').disabled = value;
    $('#restore-art').disabled = value;
  }

  async function generate(event) {
    event.preventDefault();
    const request = startRequest();
    const prompt = $('#art-prompt').value.trim();
    if (!prompt) {
      $('#art-prompt').focus();
      return;
    }
    busy(true);
    $('#generation-status').textContent = '絵を描いています。そのまま紙を眺めながらお待ちください。';
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 190000);
    try {
      const response = await fetch('/api/fold/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: timeout.signal,
      });
      const payload = await response.json();
      if (request !== requestId) return;
      if (!response.ok) throw new Error(payload.error || '絵を生成できませんでした。');
      const blob = await (await fetch(`data:image/png;base64,${payload.image}`)).blob();
      if (!(await applyBlob(blob, prompt.slice(0, 32), 'IMAGEGEN · CREATED JUST NOW', request))) return;
      $('#generation-status').textContent = '新しい絵を紙にのせました。';
      toast(`新しい絵を、${view.model.faces.length}面につなぎました。`);
    } catch (error) {
      if (request === requestId)
        $('#generation-status').textContent =
          error.name === 'AbortError'
            ? '生成に時間がかかっています。しばらくしてから再度お試しください。'
            : error.message;
    } finally {
      clearTimeout(timer);
      if (request === requestId) busy(false);
    }
  }

  async function upload(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const request = startRequest();
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      toast('10 MB以下の JPG・PNG・WebP を選んでください。');
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
      if (request === requestId) toast('画像を読み込めませんでした。別の画像でお試しください。');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function init() {
    $('#art-open').addEventListener('click', () => $('#art-dialog').showModal());
    $('#source-open').addEventListener('click', () => $('#source-dialog').showModal());
    $('#restore-art').addEventListener('click', () => {
      const request = startRequest();
      return applyImage(
        './images/fold/crane.png',
        '日輪をわたる',
        'IMAGEGEN · ORIGINAL ARTWORK',
        request,
      ).catch(() => {
        if (request === requestId) toast('元の絵を読み込めませんでした。');
      });
    });
    $('#image-upload').addEventListener('change', upload);
    $('#generate-form').addEventListener('submit', generate);
    try {
      const response = await fetch('/api/fold/config');
      if (!response.ok) throw new Error();
      const config = await response.json();
      generationAvailable = config.generationAvailable === true;
    } catch {
      generationAvailable = false;
    }
    busy(false);
    $('#generation-status').textContent = generationAvailable
      ? '描いた絵を、その場で立体の面へ。生成には少し時間がかかります。'
      : '画像生成は未接続です。いまは手元の画像か、この作品の絵で楽しめます。';
  }
  async function restore(image) {
    return applyBlob(image.blob, image.title, image.credit, startRequest(), image.key);
  }
  return {
    init,
    restore,
    get generationAvailable() {
      return generationAvailable;
    },
  };
}
