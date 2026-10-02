import { FoldView } from './fold-view.js';
import { MODEL_PRESETS, COLLECTION, parseModelPrompt } from './fold-models.js';
import { STUDY_FAMILIES } from './fold-collection.js';
import { advancePlayback, END_HOLD_SECONDS, STEP_SECONDS } from './fold-sequence.js';
import { FoldAudio, audibleFold } from './fold-audio.js';
import { readSession, writeSession, imageStore } from './fold-session.js';
import { CompletedPreview, stepReplayPlan, playbackLabel } from './fold-guidance.js';

const $ = (selector) => document.querySelector(selector);
const range = $('#fold-range');
const preview = new CompletedPreview([$('#completed-mini'), $('#completed-large')]);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sound = new FoldAudio();
const savedSession = readSession();
const mobile = matchMedia('(max-width: 959px)');
const state = {
  ready: false,
  fold: reducedMotion ? 1 : 0,
  playing: false,
  paper: 'washi',
  artwork: '日輪をわたる',
  imageSource: './images/fold/crane.png',
  generating: false,
  model: 'person',
  modelGenerating: false,
  artMode: false,
  touring: false,
  imageKey: null,
};
let view,
  animation = null,
  previousTime = 0,
  uploadURL = null,
  generatedURL = null,
  generationAvailable = false;
let playback = { progress: state.fold, direction: 1, hold: 1.1 };
let tourElapsed = 0,
  historyIndex = -1;
let lastSaved = '';
const visited = new Set(),
  history = [];
const shuffled = [...COLLECTION];
for (let i = shuffled.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
}

function setTouring(value) {
  state.touring = value;
  tourElapsed = 0;
  $('#collection-tour').setAttribute('aria-pressed', String(value));
  $('#collection-tour').setAttribute('aria-label', value ? '連続再生を止める' : '100点を連続再生');
  $('#collection-tour').textContent = value ? 'Ⅱ 連続を止める' : '▷ 連続で見る';
  if (value && !reducedMotion) {
    setPlaying(true);
    if (state.fold === 1) playback.hold = END_HOLD_SECONDS;
  }
  updatePlayState();
}

function updatePlayState() {
  const label = playbackLabel({ ...state, ...playback, animation, settling: view?.cameraSettling });
  if ($('#play-state').textContent !== label) $('#play-state').textContent = label;
  const active = state.playing || !!animation;
  if ($('#play').getAttribute('aria-pressed') !== String(active)) {
    $('#play').setAttribute('aria-pressed', String(active));
    $('#play').setAttribute('aria-label', active ? '一時停止' : 'ゆっくり折る');
    $('#play-icon').textContent = active ? 'Ⅱ' : '▷';
    $('#play-label').textContent = active ? '一時停止' : '再生する';
  }
  const unavailable = active || !view || !stepReplayPlan(view.model.sequence, state.fold, view.reviewStep);
  if ($('#step-replay').getAttribute('aria-disabled') !== String(unavailable)) {
    $('#step-replay').setAttribute('aria-disabled', String(unavailable));
    $('#step-replay').disabled = unavailable;
  }
}

function closeTools() {
  if ($('#tools-dialog').open) $('#tools-dialog').close();
}

function openTools(name) {
  const content = $('#tools-content');
  content.querySelectorAll('.tool-section').forEach((section) => {
    section.classList.toggle('selected-tool', section.id === `tool-${name}`);
    if (section.tagName === 'DETAILS' && section.id === `tool-${name}`) section.open = true;
  });
  $('#tools-title').textContent = { works: '作品を選ぶ', paper: '紙と絵', prompt: 'ことばで作る' }[name];
  $('#tools-body').append(content);
  $('#tools-dialog').showModal();
}

function saveSession() {
  if (!state.ready) return;
  const value = {
    spec: view.model.spec,
    fold: state.fold,
    playing: state.playing,
    direction: playback.direction,
    paper: state.paper,
    cameraMode: view.cameraMode,
    camera: view.cameraState(),
    prompt: $('#model-prompt').value,
    artMode: state.artMode,
    imageKey: state.imageKey,
    family: $('#collection-family').value,
    visited: [...visited],
    history,
    historyIndex,
  };
  const serialized = JSON.stringify(value);
  if (serialized === lastSaved) return;
  const saved = writeSession(value);
  $('#save-status').textContent = saved ? 'このブラウザに自動保存済み' : 'このブラウザでは保存できません';
  if (saved) lastSaved = serialized;
}

async function restoreSession() {
  if (!savedSession) return;
  try {
    setModel(savedSession.spec, false);
    $('#model-prompt').value = savedSession.prompt;
    $('#collection-family').value = savedSession.family;
    $('#collection-family').dispatchEvent(new Event('change'));
    state.paper = savedSession.paper;
    view.setPaper(state.paper);
    $(`input[name="paper"][value="${state.paper}"]`).checked = true;
    if (savedSession.imageKey) {
      const image = await imageStore().catch(() => null);
      if (image?.key === savedSession.imageKey) {
        uploadURL = URL.createObjectURL(image.blob);
        await view.setImage(uploadURL);
        state.imageSource = uploadURL;
        state.imageKey = image.key;
        state.artwork = image.title;
        $('#art-thumbnail').src = $('#source-image').src = uploadURL;
        $('#art-title').textContent = image.title;
        $('#art-credit').textContent = image.credit;
      }
    }
    setArtMode(savedSession.artMode && (!savedSession.imageKey || !!state.imageKey));
    setFold(savedSession.fold);
    view.setCameraMode(savedSession.cameraMode);
    if (savedSession.camera?.manual) view.restoreCamera(savedSession.camera);
    setPlaying(savedSession.playing && !reducedMotion);
    playback.direction = savedSession.direction;
    savedSession.visited.forEach((id) => visited.add(id));
    history.push(...savedSession.history);
    historyIndex = Math.min(savedSession.historyIndex, history.length - 1);
    $('#collection-prev').disabled = historyIndex < 1;
    $('#collection-count').textContent = visited.size ? `${visited.size} / ${COLLECTION.length}` : '100点';
    const entry = COLLECTION.find((item) => item.id === state.model);
    if (entry) {
      $('#collection-current').textContent = `${entry.label} · ${entry.faces}面 · つながる一枚`;
      $(`[data-study="${entry.id}"]`).setAttribute('aria-pressed', 'true');
    }
    updateFocusControl();
    toast('前回の作品と折り具合を再開しました。');
  } catch {
    setModel({ kind: 'person' });
    toast('前回の状態を読み込めなかったため、最初の作品を開きました。');
  }
}

function showStudy(entry, remember = true) {
  setModel({ kind: entry.id });
  visited.add(entry.id);
  if (remember) {
    history.splice(historyIndex + 1);
    history.push(entry.id);
    historyIndex = history.length - 1;
  }
  $('#collection-prev').disabled = historyIndex < 1;
  $('#collection-count').textContent = `${visited.size} / ${COLLECTION.length}`;
  $('#collection-current').textContent = `${entry.label} · ${entry.faces}面 · つながる一枚`;
  document
    .querySelectorAll('[data-study]')
    .forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.study === entry.id)));
}

function nextStudy() {
  let entry = shuffled.find((item) => !visited.has(item.id));
  if (!entry) {
    if (state.touring) {
      setTouring(false);
      setPlaying(false);
      toast('100点の旅が終わりました。気になる形をもう一度。');
      return;
    }
    visited.clear();
    entry = shuffled.find((item) => item.id !== state.model) || shuffled[0];
  }
  if (entry) showStudy(entry);
}

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    $('#toast').hidden = true;
  }, 4000);
}

function setFold(value) {
  state.fold = Math.max(0, Math.min(1, value));
  view.setFold(state.fold);
  range.value = state.fold * 100;
  range.style.setProperty('--progress', `${state.fold * 100}%`);
  $('#fold-value').textContent = Math.round(state.fold * 100);
  $('#phase-label').textContent =
    state.fold < 0.01 ? '展開図' : state.fold > 0.99 ? '組み立てた姿' : '折りかけ';
  $('#seam-message').textContent =
    `一枚の紙 · ${view.model.faces.length}面${state.fold < 0.01 ? ' — すべてつながる展開図' : ''}`;
  $('#net-legend').hidden = state.fold >= 0.01;
  $('.view-hint').hidden = state.fold < 0.01;
  const sequence = view.model.sequence,
    current = view.currentStep;
  preview.setStep(current.active);
  const opening = animation ? animation.to < animation.from : playback.direction < 0 && state.playing;
  $('#step-current').textContent = `${current.index + 1} / ${sequence.count}`;
  $('#step-detail').textContent = !current.active
    ? 'できあがり'
    : current.active.kind === 'pose'
      ? opening
        ? '展開図の向きにもどす'
        : current.active.name
      : `${current.active.name}を${opening ? 'ひらく' : '折る'} · ${current.active.movingFaces.length}面`;
  updateFocusControl();
  $('#step-prev').disabled = state.fold === 0;
  $('#step-next').disabled = state.fold === 1;
  document
    .querySelectorAll('[data-fold]')
    .forEach((button) =>
      button.classList.toggle('active', Math.abs(Number(button.dataset.fold) - state.fold * 100) < 1),
    );
}

function updateFocusControl() {
  $('#focus-step').setAttribute('aria-pressed', String(view.focused));
  $('#camera-fixed').setAttribute('aria-pressed', String(!view.focused));
  $('#camera-status').textContent = view.focused
    ? view.manualCamera
      ? '手動で調整中 · フォーカス追従は一時停止'
      : 'フォーカス：曲がる2面を斜めから見る'
    : '定点：同じ位置から、全体を見る';
  $('#camera-resume').hidden = !view.focused || !view.manualCamera;
}

function setPlaying(playing) {
  state.playing = playing;
  animation = null;
  if (playing) view?.setReviewStep(null);
  playback.progress = state.fold;
  if (state.fold === 0) playback.direction = 1;
  if (state.fold === 1) playback.direction = -1;
  if (playing && state.fold > 0 && state.fold < 1) playback.hold = 0;
  updatePlayState();
}

function goTo(value, duration = 1600) {
  setPlaying(false);
  view.setReviewStep(null);
  if (reducedMotion || (view.focused && Math.abs(value - state.fold) * view.model.sequence.count > 1.01))
    setFold(value);
  else animation = { from: state.fold, to: value, elapsed: 0, duration };
  updatePlayState();
}

function replayStep() {
  if (state.playing || animation) return;
  const plan = stepReplayPlan(view.model.sequence, state.fold, view.reviewStep);
  if (!plan) return;
  setTouring(false);
  setPlaying(false);
  playback.direction = 1;
  view.setReviewStep(plan.index);
  setFold(reducedMotion ? plan.to : plan.from);
  if (!reducedMotion) animation = { ...plan, kind: 'replay', elapsed: 0, duration: STEP_SECONDS * 1000 };
  updatePlayState();
}

function stepFold(direction) {
  setTouring(false);
  playback.direction = direction;
  goTo(view.model.sequence.target(state.fold, direction), 850);
}

function setArtMode(enabled) {
  state.artMode = enabled;
  view.setArtMode(enabled);
  $('#art-mode').setAttribute('aria-pressed', String(enabled));
  $('#art-mode').textContent = enabled ? '元の色にもどす ↗' : 'この絵をのせる ↗';
  $('#align-view').firstChild.textContent = enabled ? '絵がつながる視点 ' : '完成した姿を見る ';
  $('#paper-summary').textContent =
    `${state.paper === 'washi' ? '和紙' : '透ける紙'} · ${enabled ? '絵あり' : '絵なし'}`;
}

function setModel(spec, animate = true) {
  setPlaying(false);
  view.setModel(spec);
  preview.setModel(view.model);
  $('#model-title').textContent = view.model.label;
  state.model = spec.kind;
  if (!COLLECTION.some((entry) => entry.id === spec.kind))
    $('#collection-current').textContent = '凹凸のある立体が、すべて一枚の紙へ。';
  $('#model-select').value = spec.kind;
  setArtMode(false);
  setFold(animate && !reducedMotion ? 0 : 1);
  view.home();
  playback = { progress: state.fold, direction: 1, hold: 1.1 };
  setPlaying(animate && !reducedMotion);
  const variation = [
    view.model.label,
    spec.colorName,
    spec.stature > 1 ? 'のっぽ' : spec.stature < 1 ? '小柄' : null,
  ]
    .filter(Boolean)
    .join(' / ');
  $('#model-status').textContent = `${variation}。${view.model.faces.length}面が一枚につながる展開図です。`;
}

async function generateModel(event) {
  event?.preventDefault();
  if (state.modelGenerating) return;
  setTouring(false);
  const prompt = $('#model-prompt').value;
  const spec = parseModelPrompt(prompt);
  if (!spec) {
    $('#model-status').textContent =
      'まだその形は用意していません。人・ロボット・ねこ・家・ロケット・お城、または多面体を試してください。';
    $('#model-prompt').focus();
    return;
  }
  state.modelGenerating = true;
  $('#model-generate').disabled = true;
  $('#model-select').disabled = true;
  document.querySelectorAll('[data-prompt]').forEach((button) => {
    button.disabled = true;
  });
  document
    .querySelectorAll('.collection-controls button, #collection-open, [data-study]')
    .forEach((button) => {
      button.disabled = true;
    });
  $('#model-status').textContent = '外側の面をつないで、一枚の展開図を作っています…';
  await new Promise((resolve) => setTimeout(resolve, reducedMotion ? 0 : 450));
  try {
    setModel(spec);
    closeTools();
  } catch {
    $('#model-status').textContent = 'その形の展開図を作れませんでした。別の形を試してください。';
  } finally {
    state.modelGenerating = false;
    $('#model-generate').disabled = false;
    $('#model-select').disabled = false;
    document.querySelectorAll('[data-prompt]').forEach((button) => {
      button.disabled = false;
    });
    document
      .querySelectorAll('.collection-controls button, #collection-open, [data-study]')
      .forEach((button) => {
        button.disabled = false;
      });
    $('#collection-prev').disabled = historyIndex < 1;
  }
}

async function applyImage(source, title, credit) {
  const applied = await view.setImage(source);
  if (!applied) return;
  state.artwork = title;
  state.imageSource = source;
  state.imageKey = null;
  $('#art-thumbnail').src = source;
  $('#art-thumbnail').alt = title;
  $('#source-image').src = source;
  $('#art-title').textContent = title;
  $('#art-credit').textContent = credit;
  setArtMode(true);
  $('#art-dialog').close();
  goTo(0.58);
  view.home();
  closeTools();
  if (source.startsWith('blob:')) {
    try {
      const key = `image-${Date.now()}`;
      const blob = await (await fetch(source)).blob();
      await imageStore({ key, blob, title, credit });
      if (state.imageSource === source) state.imageKey = key;
    } catch {
      toast('絵を表示しました。画像の次回復元は、このブラウザでは利用できません。');
    }
  }
  saveSession();
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
    if (!response.ok) throw new Error(payload.error || '絵を生成できませんでした。');
    const blob = await (await fetch(`data:image/png;base64,${payload.image}`)).blob();
    const nextURL = URL.createObjectURL(blob);
    try {
      await applyImage(nextURL, prompt.slice(0, 32), 'IMAGEGEN · CREATED JUST NOW');
    } catch (error) {
      URL.revokeObjectURL(nextURL);
      throw error;
    }
    if (generatedURL) URL.revokeObjectURL(generatedURL);
    generatedURL = nextURL;
    $('#generation-status').textContent = '新しい絵を紙にのせました。';
    toast(`新しい絵を、${view.model.faces.length}面につなぎました。`);
  } catch (error) {
    $('#generation-status').textContent =
      error.name === 'AbortError'
        ? '生成に時間がかかっています。しばらくしてから再度お試しください。'
        : error.message;
  } finally {
    clearTimeout(timer);
    busy(false);
  }
}

async function upload(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
    toast('10 MB以下の JPG・PNG・WebP を選んでください。');
    return;
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
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
    const nextURL = URL.createObjectURL(blob);
    try {
      await applyImage(nextURL, file.name.replace(/\.[^.]+$/, '').slice(0, 32), 'YOUR PICTURE · ON PAPER');
    } catch (error) {
      URL.revokeObjectURL(nextURL);
      throw error;
    }
    if (uploadURL) URL.revokeObjectURL(uploadURL);
    uploadURL = nextURL;
    toast('あなたの絵を、紙にのせました。');
  } catch {
    toast('画像を読み込めませんでした。別の画像でお試しください。');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function frame(now) {
  const dt = previousTime ? Math.min((now - previousTime) / 1000, 0.05) : 0;
  previousTime = now;
  const visible = !document.hidden && !document.querySelector('dialog[open]');
  sound.setVisible(visible);
  if (visible) {
    if (state.touring && reducedMotion) {
      tourElapsed += dt;
      if (tourElapsed >= END_HOLD_SECONDS) {
        tourElapsed = 0;
        nextStudy();
      }
    }
    const before = state.fold;
    const previousModel = view.model;
    if (state.playing && !view.cameraSettling) {
      playback = advancePlayback(playback, dt, view.model.sequence, state.touring);
      if (playback.progress !== state.fold) setFold(playback.progress);
      if (playback.nextModel) nextStudy();
    } else if (animation && !view.cameraSettling) {
      animation.elapsed += dt * 1000;
      const t = Math.min(1, animation.elapsed / animation.duration);
      const eased = animation.kind === 'replay' ? t : t * t * (3 - 2 * t);
      setFold(animation.from + (animation.to - animation.from) * eased);
      if (t === 1) animation = null;
    }
    const crease = previousModel === view.model ? audibleFold(view.model.sequence, before, state.fold) : null;
    if (crease !== null) sound.fold(crease);
    view.render(dt);
    updatePlayState();
  }
  requestAnimationFrame(frame);
}

async function init() {
  try {
    view = new FoldView($('#fold-viewport'));
    preview.setModel(view.model);
    view.onCameraChange = updateFocusControl;
    await view.setImage(state.imageSource);
    setFold(state.fold);
    setArtMode(false);
    setPlaying(!reducedMotion);
    $('#loading').hidden = true;
  } catch {
    $('#loading').textContent = '3D表示を開始できませんでした。WebGL対応ブラウザで再読み込みしてください。';
    return;
  }
  range.addEventListener('input', () => {
    setTouring(false);
    setPlaying(false);
    view.setReviewStep(null);
    setFold(Number(range.value) / 100);
  });
  $('#step-replay').addEventListener('click', replayStep);
  $('#preview-open').addEventListener('click', () => $('#preview-dialog').showModal());
  for (const [selector, direction] of [
    ['#step-prev', -1],
    ['#step-next', 1],
  ])
    $(selector).addEventListener('click', () => stepFold(direction));
  for (const preset of MODEL_PRESETS) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.label;
    $('#model-select').append(option);
  }
  const studies = document.createElement('optgroup');
  studies.label = '100の立体コレクション';
  for (const entry of COLLECTION) {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.label;
    studies.append(option);
    const card = document.createElement('button');
    card.className = 'study-card';
    card.dataset.study = entry.id;
    card.dataset.family = entry.family;
    card.setAttribute('aria-pressed', 'false');
    const img = document.createElement('img');
    img.src = entry.thumbnail;
    img.alt = '';
    img.loading = 'lazy';
    img.width = 220;
    img.height = 210;
    const title = document.createElement('strong');
    title.textContent = entry.label;
    const detail = document.createElement('span');
    detail.textContent = `${entry.id.slice(-3)} / ${entry.faces}面・一枚`;
    card.append(img, title, detail);
    card.addEventListener('click', () => {
      setTouring(false);
      showStudy(entry);
      $('#collection-dialog').close();
    });
    $('#collection-grid').append(card);
  }
  $('#model-select').append(studies);
  // Show different families together, so the first screen conveys the range.
  for (let variation = 0; variation < 10; variation++)
    COLLECTION.filter((_, index) => index % 10 === variation).forEach((entry) =>
      $('#collection-grid').append($(`[data-study="${entry.id}"]`)),
    );
  STUDY_FAMILIES.forEach((name, i) => {
    const option = document.createElement('option');
    option.value = i;
    option.textContent = name;
    $('#collection-family').append(option);
  });
  $('#collection-family').addEventListener('change', () => {
    const family = $('#collection-family').value;
    let count = 0;
    document.querySelectorAll('[data-study]').forEach((card) => {
      card.hidden = family !== 'all' && card.dataset.family !== family;
      if (!card.hidden) count++;
    });
    $('#collection-results').textContent = `${count}点`;
  });
  $('#collection-open').addEventListener('click', () => {
    setTouring(false);
    closeTools();
    $('#collection-dialog').showModal();
  });
  $('#collection-next').addEventListener('click', () => {
    setTouring(false);
    nextStudy();
    closeTools();
  });
  $('#collection-prev').disabled = true;
  $('#collection-prev').addEventListener('click', () => {
    if (historyIndex < 1) return;
    setTouring(false);
    historyIndex--;
    showStudy(
      COLLECTION.find((item) => item.id === history[historyIndex]),
      false,
    );
    closeTools();
  });
  $('#collection-tour').addEventListener('click', () => {
    const start = !state.touring;
    if (start && visited.size === COLLECTION.length) visited.clear();
    if (start && !COLLECTION.some((item) => item.id === state.model)) nextStudy();
    setTouring(start);
    closeTools();
  });
  $('#model-select').value = state.model;
  $('#model-select').addEventListener('change', () => {
    setTouring(false);
    const entry = COLLECTION.find((item) => item.id === $('#model-select').value);
    if (entry) {
      showStudy(entry);
      closeTools();
      return;
    }
    const preset = MODEL_PRESETS.find((item) => item.id === $('#model-select').value);
    $('#model-prompt').value = preset.prompt;
    setModel(parseModelPrompt(preset.prompt));
    closeTools();
  });
  $('#model-form').addEventListener('submit', generateModel);
  document.querySelectorAll('[data-prompt]').forEach((button) =>
    button.addEventListener('click', () => {
      $('#model-prompt').value = button.dataset.prompt;
      generateModel();
    }),
  );
  $('#art-mode').addEventListener('click', () => setArtMode(!state.artMode));
  document.querySelectorAll('[data-fold]').forEach((button) =>
    button.addEventListener('click', () => {
      setTouring(false);
      goTo(Number(button.dataset.fold) / 100);
    }),
  );
  $('#play').addEventListener('click', () => {
    setTouring(false);
    setPlaying(!state.playing && !animation);
  });
  document.querySelectorAll('[name=paper]').forEach((input) =>
    input.addEventListener('change', () => {
      state.paper = input.value;
      view.setPaper(input.value);
      setArtMode(state.artMode);
    }),
  );
  $('#align-view').addEventListener('click', () => {
    setTouring(false);
    goTo(1);
    view.setCameraMode('fixed');
    view.home();
    closeTools();
    updateFocusControl();
  });
  $('#focus-step').addEventListener('click', () => {
    view.setCameraMode('focus');
  });
  $('#camera-fixed').addEventListener('click', () => view.setCameraMode('fixed'));
  $('#camera-resume').addEventListener('click', () => view.setCameraMode('focus'));
  $('#reset-view').addEventListener('click', () => {
    view.home();
    updateFocusControl();
    if (mobile.matches) $('.view-menu').open = false;
  });
  $('#view-top').addEventListener('click', () => {
    view.top();
    if (mobile.matches) $('.view-menu').open = false;
  });
  $('#fold-viewport').addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      setTouring(false);
      event.preventDefault();
      setPlaying(!state.playing && !animation);
    }
    if (['ArrowLeft', 'ArrowRight'].includes(event.code)) {
      event.preventDefault();
      stepFold(event.code === 'ArrowRight' ? 1 : -1);
    }
    if (event.key.toLowerCase() === 'r') {
      view.home();
      updateFocusControl();
    }
  });
  $('#art-open').addEventListener('click', () => $('#art-dialog').showModal());
  $('#source-open').addEventListener('click', () => $('#source-dialog').showModal());
  $('#restore-art').addEventListener('click', () =>
    applyImage('./images/fold/crane.png', '日輪をわたる', 'IMAGEGEN · ORIGINAL ARTWORK').catch(() =>
      toast('元の絵を読み込めませんでした。'),
    ),
  );
  $('#image-upload').addEventListener('change', upload);
  $('#generate-form').addEventListener('submit', generate);
  document
    .querySelectorAll('[data-tool]')
    .forEach((button) => button.addEventListener('click', () => openTools(button.dataset.tool)));
  $('#tools-dialog').addEventListener('close', () => $('#tools-slot').append($('#tools-content')));
  $('.view-menu').open = !mobile.matches;
  mobile.addEventListener('change', () => {
    if (!mobile.matches) closeTools();
    $('.view-menu').open = !mobile.matches;
  });
  for (const kind of ['bgm', 'se']) {
    $(`#${kind}-volume`).value = sound.volumes[kind] * 100;
    $(`#${kind}-value`).textContent = `${Math.round(sound.volumes[kind] * 100)}%`;
    $(`#${kind}-volume`).addEventListener('input', (event) => {
      sound.setVolume(kind, Number(event.target.value) / 100);
      $(`#${kind}-value`).textContent = `${event.target.value}%`;
    });
  }
  $('#sound-toggle').addEventListener('click', async () => {
    try {
      await sound.setEnabled(!sound.enabled);
    } catch {
      toast('音を開始できませんでした。もう一度「音」を押してください。');
    }
    $('#sound-toggle').setAttribute('aria-pressed', String(sound.enabled));
    $('#sound-toggle').textContent = sound.enabled ? '♪ 音 ON' : '♪ 音 OFF';
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveSession();
    sound.setVisible(!document.hidden && !document.querySelector('dialog[open]'));
  });
  window.addEventListener('pagehide', () => {
    saveSession();
    sound.setVisible(false);
  });
  $('#capture').addEventListener('click', async () => {
    const image = await view.capture();
    if (!image) {
      toast('画像を保存できませんでした。');
      return;
    }
    const link = document.createElement('a');
    link.download = `fold-${Math.round(state.fold * 100)}.png`;
    link.href = URL.createObjectURL(image);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    toast('この瞬間を保存しました。');
  });
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
  await restoreSession();
  state.ready = true;
  requestAnimationFrame(frame);
  saveSession();
  setInterval(saveSession, 1500);
  window.__FOLD__ = {
    snapshot: () => ({
      ...state,
      imageSource: state.imageSource.startsWith('blob:') ? 'local-image' : state.imageSource,
      generationAvailable,
      animating: !!animation,
      camera: view.camera.position.toArray(),
      target: view.controls.target.toArray(),
      drawCalls: view.renderer.info.render.calls,
      renderedFrames: view.renderCount,
      focused: view.focused,
      cameraMode: view.cameraMode,
      cameraSettling: view.cameraSettling,
      audio: {
        enabled: sound.enabled,
        context: sound.context?.state,
        volumes: sound.volumes,
        voices: sound.voices.size,
      },
      movingFaces: view.movingFaceCount,
      frameHalf: view.frameHalf,
      parts: view.model.parts.length,
      sheets: view.model.sheetCount,
      hinges: view.model.parts[0].tree.length,
      foldSteps: view.model.sequence.count,
      foldStep: view.model.sequence.sample(state.fold).index + 1,
      collectionSize: COLLECTION.length,
      collectionVisited: visited.size,
      faces: view.model.faces.length,
      modelSpec: view.model.spec,
      geometryCount: view.renderer.info.memory.geometries,
      textureCount: view.renderer.info.memory.textures,
    }),
    setFold: (value) => {
      setTouring(false);
      setPlaying(false);
      setFold(value);
    },
    vertices: () => view.model.vertices(state.fold).map((face) => face.map((p) => p.toArray())),
    uvs: () => view.model.uvs,
  };
}

init();
