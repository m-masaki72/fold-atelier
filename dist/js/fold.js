import { FoldView } from './fold-view.js';
import { COLLECTION } from './fold-net-data.js';
import { createGallery } from './fold-gallery.js';
import { advancePlayback, END_HOLD_SECONDS, STEP_SECONDS } from './fold-sequence.js';
import { FoldAudio, audibleFold } from './fold-audio.js';
import { clearSavedData, SESSION_KEY } from './fold-session.js';
import { createSessionController, startApp } from './fold-lifecycle.js';
import { CompletedPreview, stepReplayPlan, playbackLabel } from './fold-guidance.js';

const $ = (selector) => document.querySelector(selector);
const range = $('#fold-range');
const preview = new CompletedPreview([$('#completed-mini'), $('#completed-large')]);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sound = new FoldAudio();
const mobile = matchMedia('(max-width: 959px)');
const state = {
  ready: false,
  fold: reducedMotion ? 1 : 0,
  playing: false,
  paper: 'washi',
  model: 'person',
  touring: false,
};
let view,
  animation = null,
  previousTime = 0;
let saveBlocked = false;
const gallery = createGallery({
  state,
  setModel,
  setTouring,
  setPlaying,
  closeTools,
  toast,
});
let playback = { progress: state.fold, direction: 1, hold: 1.1 };
let tourElapsed = 0;
const session = createSessionController({
  snapshot: snapshotSession,
  apply: applySession,
  reset: () => setModel({ kind: 'person' }),
  onSave: (success) => {
    $('#save-status').textContent = success ? 'このブラウザに自動保存済み' : 'このブラウザでは保存できません';
  },
  notify: toast,
});
const saveSession = () => {
  if (!saveBlocked) session.save();
};
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
    paper: '紙の質感',
  }[name];
  $('#tools-body').append(content);
  $('#tools-dialog').showModal();
}

function snapshotSession() {
  if (!state.ready) return null;
  return {
    spec: view.model.spec,
    fold: state.fold,
    playing: state.playing,
    direction: playback.direction,
    paper: state.paper,
    cameraMode: view.cameraMode,
    camera: view.cameraState(),
    family: $('#collection-family').value,
    ...gallery.snapshot(),
  };
}

function applySession(saved) {
  setModel(saved.spec, false);
  $('#collection-family').value = saved.family;
  $('#collection-family').dispatchEvent(new Event('change'));
  state.paper = saved.paper;
  view.setPaper(state.paper);
  $(`input[name="paper"][value="${state.paper}"]`).checked = true;
  $('#paper-summary').textContent = state.paper === 'washi' ? '和紙' : '透ける紙';
  setFold(saved.fold);
  view.setCameraMode(saved.cameraMode);
  if (saved.camera?.manual) view.restoreCamera(saved.camera);
  setPlaying(saved.playing && !reducedMotion);
  playback.direction = saved.direction;
  gallery.restore(saved);
  updateFocusControl();
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

function setModel(spec, animate = true) {
  setPlaying(false);
  view.setModel(spec);
  preview.setModel(view.model);
  $('#model-title').textContent = view.model.label;
  state.model = spec.kind;
  gallery.reflectModel(spec.kind);
  $('#model-select').value = spec.kind;
  setFold(animate && !reducedMotion ? 0 : 1);
  view.home();
  playback = { progress: state.fold, direction: 1, hold: 1.1 };
  setPlaying(animate && !reducedMotion);
}

function frame(now) {
  const dt = previousTime ? Math.min((now - previousTime) / 1000, 0.05) : 0;
  previousTime = now;
  const visible = !saveBlocked && !document.hidden && !document.querySelector('dialog[open]');
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

async function initializeView() {
  view = new FoldView($('#fold-viewport'));
  preview.setModel(view.model);
  view.onCameraChange = updateFocusControl;
  setFold(state.fold);
  setPlaying(!reducedMotion);
}

function bindControls() {
  $('#copy-link').addEventListener('click', async () => {
    const input = $('#share-url');
    try {
      await navigator.clipboard.writeText(input.value);
      input.hidden = true;
      toast('共有URLをコピーしました。');
    } catch {
      input.hidden = false;
      input.focus();
      input.select();
      toast('表示されたURLをコピーしてください。');
    }
  });
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
  gallery.init();
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
      $('#paper-summary').textContent = state.paper === 'washi' ? '和紙' : '透ける紙';
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
  document.querySelectorAll('[data-camera]').forEach((button) => {
    button.addEventListener('click', () => {
      view.adjustCamera(button.dataset.camera);
      updateFocusControl();
      saveSession();
    });
  });
  $('#clear-saved-data').disabled = false;
  $('#clear-saved-data').addEventListener('click', () => {
    $('#clear-data-error').textContent = '';
    $('#clear-data-dialog').showModal();
  });
  $('#clear-data-dialog').addEventListener('cancel', (event) => {
    if (saveBlocked) event.preventDefault();
  });
  $('#confirm-clear-data').addEventListener('click', async () => {
    saveBlocked = true;
    $('#confirm-clear-data').disabled = true;
    $('#clear-data-dialog form button').disabled = true;
    try {
      await clearSavedData();
      location.reload();
    } catch {
      saveBlocked = false;
      $('#confirm-clear-data').disabled = false;
      $('#clear-data-dialog form button').disabled = false;
      $('#clear-data-error').textContent =
        '保存データを消せませんでした。他のFOLDのタブを閉じて、もう一度お試しください。';
    }
  });
  $('#fold-viewport').addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.repeat) {
      if (['Space', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
      return;
    }
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
    sound.setVisible(!saveBlocked && !document.hidden && !document.querySelector('dialog[open]'));
  });
  window.addEventListener('pagehide', () => {
    saveSession();
    sound.setVisible(false);
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== SESSION_KEY || event.newValue !== null || !event.oldValue) return;
    saveBlocked = true;
    setTouring(false);
    setPlaying(false);
    sound.setVisible(false);
    document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
    $('.workspace').inert = true;
    $('.header-tools').inert = true;
    $('#clear-saved-data').disabled = true;
    $('#storage-reset').hidden = false;
  });
  $('#capture').addEventListener('click', async () => {
    const filename = `fold-${Math.round(state.fold * 100)}.png`;
    let source;
    try {
      const image = await view.capture();
      if (!image) throw new Error('PNG encoding failed');
      const link = document.createElement('a');
      link.download = filename;
      source = URL.createObjectURL(image);
      link.href = source;
      link.click();
      setTimeout(() => URL.revokeObjectURL(source), 5000);
      toast('この瞬間を保存しました。');
    } catch {
      if (source) URL.revokeObjectURL(source);
      toast('画像を保存できませんでした。');
    }
  });
}

function activate() {
  state.ready = true;
  $('#loading').hidden = true;
  requestAnimationFrame(frame);
  saveSession();
  setInterval(saveSession, 1500);
  window.__FOLD__ = {
    snapshot: () => ({
      ...state,
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
  };
}

startApp({
  setInteractive: (enabled) => {
    $('.workspace').inert = !enabled || !state.ready || saveBlocked;
    $('.header-tools').inert = !enabled || !state.ready || saveBlocked;
  },
  initialize: async () => {
    await initializeView();
    bindControls();
  },
  restore: session.restore,
  activate,
  onError: () => {
    window.dispatchEvent(new Event('fold-startup-error'));
  },
});
