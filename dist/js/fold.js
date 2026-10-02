import { FoldView } from './fold-view.js';
import { COLLECTION } from './fold-net-data.js';
import { createGallery } from './fold-gallery.js';
import { createArtwork } from './fold-artwork.js';
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
  model: 'person',
  modelGenerating: false,
  artMode: false,
  touring: false,
  imageKey: null,
};
let view,
  animation = null,
  previousTime = 0;
let artwork;
const gallery = createGallery({
  state,
  setModel,
  setTouring,
  setPlaying,
  closeTools,
  toast,
  reducedMotion,
});
let playback = { progress: state.fold, direction: 1, hold: 1.1 };
let tourElapsed = 0;
let lastSaved = '';
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
  const label = playbackLabel({
    ...state,
    ...playback,
    animation,
    settling: view?.cameraSettling,
  });
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
  $('#tools-title').textContent = {
    works: '作品を選ぶ',
    paper: '紙と絵',
    prompt: 'ことばで作る',
  }[name];
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
    ...gallery.snapshot(),
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
        await artwork.restore(image);
      }
    }
    setArtMode(savedSession.artMode && (!savedSession.imageKey || !!state.imageKey));
    setFold(savedSession.fold);
    view.setCameraMode(savedSession.cameraMode);
    if (savedSession.camera?.manual) view.restoreCamera(savedSession.camera);
    setPlaying(savedSession.playing && !reducedMotion);
    playback.direction = savedSession.direction;
    gallery.restore(savedSession);
    updateFocusControl();
    toast('前回の作品と折り具合を再開しました。');
  } catch {
    setModel({ kind: 'person' });
    toast('前回の状態を読み込めなかったため、最初の作品を開きました。');
  }
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
  if (!reducedMotion)
    animation = {
      ...plan,
      kind: 'replay',
      elapsed: 0,
      duration: STEP_SECONDS * 1000,
    };
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
  gallery.reflectModel(spec.kind);
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
        gallery.next();
      }
    }
    const before = state.fold;
    const previousModel = view.model;
    if (state.playing && !view.cameraSettling) {
      playback = advancePlayback(playback, dt, view.model.sequence, state.touring);
      if (playback.progress !== state.fold) setFold(playback.progress);
      if (playback.nextModel) gallery.next();
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
  artwork = createArtwork({
    view,
    state,
    setArtMode,
    goTo,
    closeTools,
    toast,
    saveSession,
  });
  gallery.init();
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
  artwork.init();
  await restoreSession();
  state.ready = true;
  requestAnimationFrame(frame);
  saveSession();
  setInterval(saveSession, 1500);
  window.__FOLD__ = {
    snapshot: () => ({
      ...state,
      imageSource: state.imageSource.startsWith('blob:') ? 'local-image' : state.imageSource,
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
      collectionVisited: gallery.snapshot().visited.length,
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
