import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollectionHistory } from '../dist/js/fold-history.js';

test('returning from a preset reaches the last collection work before earlier works', () => {
  const history = createCollectionHistory();
  history.record('study-001');
  history.record('study-002');
  assert.equal(history.previous('person'), 'study-002');
  assert.equal(history.previous('study-002'), 'study-001');
  assert.equal(history.previous('study-001'), null);
  assert.equal(history.canGoBack('study-001'), false);
  assert.equal(history.canGoBack('cat'), true);
});

test('selecting after going back replaces the forward branch and retains visited works', () => {
  const history = createCollectionHistory();
  history.record('study-001');
  history.record('study-002');
  history.previous('study-002');
  history.record('study-003');
  assert.deepEqual(history.snapshot(), {
    history: ['study-001', 'study-003'],
    historyIndex: 1,
    visited: ['study-001', 'study-002', 'study-003'],
  });
});

test('restoring history replaces existing data and keeps the current cursor', () => {
  const history = createCollectionHistory();
  history.record('study-099');
  const saved = {
    history: ['study-001', 'study-002', 'study-003'],
    historyIndex: 1,
    visited: ['study-001', 'study-002', 'study-003'],
  };
  history.restore(saved);
  saved.history.push('study-004');
  assert.equal(history.previous('cat'), 'study-002');
  assert.equal(history.previous('study-002'), 'study-001');
  assert.equal(history.visited.has('study-099'), false);
  assert.deepEqual(history.snapshot().history, ['study-001', 'study-002', 'study-003']);
});
