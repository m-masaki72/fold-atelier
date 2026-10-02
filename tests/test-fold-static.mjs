import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);

test('both static entrypoints reach the app and every local module import exists', () => {
  for (const path of ['index.html', 'dist/index.html']) {
    const page = new URL(path, root);
    const html = readFileSync(page, 'utf8');
    const target = html.match(/content="0; url=([^"]+)"/)[1];
    assert.equal(new URL(target, page).href, new URL('dist/fold.html', root).href);
  }
  const app = new URL('dist/fold.html', root);
  for (const [, path] of readFileSync(app, 'utf8').matchAll(/(?:src|href)="(\.\/[^" ]+)"/g))
    assert.ok(existsSync(new URL(path, app)), path);
  for (const path of ['dist/js/', 'dist/vendor/']) {
    const inspect = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
        if (entry.isDirectory()) inspect(file);
        else if (entry.name.endsWith('.js'))
          for (const [, imported] of readFileSync(file, 'utf8').matchAll(
            /(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g,
          ))
            assert.ok(existsSync(new URL(imported, file)), `${file.pathname}: ${imported}`);
      }
    };
    inspect(new URL(path, root));
  }
});

test('syntax checks work when the project directory contains spaces', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'fold tooling '));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'tools'));
  mkdirSync(join(directory, 'dist/js'), { recursive: true });
  copyFileSync(new URL('tools/check-syntax.mjs', root), join(directory, 'tools/check-syntax.mjs'));
  copyFileSync(new URL('dist/js/fold-audio.js', root), join(directory, 'dist/js/fold-audio.js'));
  const result = spawnSync(process.execPath, [join(directory, 'tools/check-syntax.mjs')], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Syntax OK: 1 modules/);
});
