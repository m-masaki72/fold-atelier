import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaperModel } from '../dist/js/fold-models.js';
import { NETS } from '../dist/js/fold-net-data.js';

test('fresh generation and explicit restoration work even when the bundled cache is stale', (t) => {
  const original = NETS['cube:1'];
  t.after(() => {
    NETS['cube:1'] = original;
  });
  NETS['cube:1'] = { root: 0, tree: [[0, 999]] };
  assert.throws(() => buildPaperModel({ kind: 'cube' }));
  const fresh = buildPaperModel({ kind: 'cube' }, { useCache: false });
  assert.equal(fresh.faces.length, 6);
  assert.equal(fresh.parts[0].tree.length, 5);
  const net = {
    root: fresh.parts[0].root,
    tree: fresh.parts[0].tree.map(({ parent, child }) => [parent, child]),
  };
  const restored = buildPaperModel({ kind: 'cube' }, { net, useCache: false });
  assert.deepEqual(restored.vertices(0), fresh.vertices(0));
  assert.deepEqual(restored.vertices(1), fresh.vertices(1));
  assert.throws(() => buildPaperModel({ kind: 'cube' }, { net: NETS['cube:1'], useCache: false }));
});
