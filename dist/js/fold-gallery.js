import { MODEL_PRESETS } from './fold-recipes.js';
import { COLLECTION } from './fold-net-data.js';
import { STUDY_FAMILIES } from './fold-collection.js';
import { createCollectionHistory } from './fold-history.js';

const $ = (selector) => document.querySelector(selector);

export function createGallery({ state, setModel, setTouring, setPlaying, closeTools, toast }) {
  const history = createCollectionHistory();
  const visited = history.visited;
  const shuffled = [...COLLECTION];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  function showStudy(entry, remember = true) {
    setModel({ kind: entry.id });
    visited.add(entry.id);
    if (remember) history.record(entry.id);
    $('#collection-prev').disabled = !history.canGoBack(state.model);
    $('#collection-count').textContent = `${visited.size} / ${COLLECTION.length}`;
  }

  function reflectModel(id) {
    $('#collection-prev').disabled = !history.canGoBack(id);
    const entry = COLLECTION.find((item) => item.id === id);
    $('#collection-current').textContent = entry
      ? `${entry.label} · ${entry.faces}面 · つながる一枚`
      : '凹凸のある立体が、すべて一枚の紙へ。';
    document
      .querySelectorAll('[data-study]')
      .forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.study === id)));
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

  function init() {
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
      img.dataset.src = entry.thumbnail;
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
      document.querySelectorAll('#collection-grid img[data-src]').forEach((image) => {
        image.src = image.dataset.src;
        delete image.dataset.src;
      });
      $('#collection-dialog').showModal();
    });
    $('#collection-next').addEventListener('click', () => {
      setTouring(false);
      nextStudy();
      closeTools();
    });
    $('#collection-prev').disabled = true;
    $('#collection-prev').addEventListener('click', () => {
      const id = history.previous(state.model);
      if (!id) return;
      setTouring(false);
      showStudy(
        COLLECTION.find((item) => item.id === id),
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
      setModel({ kind: preset.id });
      closeTools();
    });
  }
  function restore(saved) {
    history.restore(saved);
    $('#collection-count').textContent = visited.size ? `${visited.size} / ${COLLECTION.length}` : '100点';
    reflectModel(state.model);
  }
  return {
    init,
    restore,
    reflectModel,
    next: nextStudy,
    snapshot: history.snapshot,
  };
}
