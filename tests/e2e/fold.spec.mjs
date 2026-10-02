import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function openApp(page) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/dist\/fold\.html$/);
  await expect(page.locator('#loading')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__FOLD__?.snapshot().ready)).toBe(true);
}

test('site metadata, favicon, share image and sitemap point to the published app', async ({
  page,
  request,
}) => {
  await openApp(page);
  const canonical = 'https://m-masaki72.github.io/fold-atelier/dist/fold.html';
  const metadata = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
  expect(metadata['@type']).toBe('WebApplication');
  expect(metadata.url).toBe(canonical);
  expect(metadata.inLanguage).toBe('ja');
  expect(metadata.isAccessibleForFree).toBe(true);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', canonical);
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', canonical);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
  const icon = await page.locator('link[rel="icon"]').getAttribute('href');
  const iconResponse = await request.get(new URL(icon, page.url()).href);
  expect(iconResponse.ok()).toBe(true);
  expect(iconResponse.headers()['content-type']).toContain('image/svg+xml');
  const touchIcon = await request.get('/dist/apple-touch-icon.png');
  expect(touchIcon.ok()).toBe(true);
  expect((await touchIcon.body()).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const image = await page.locator('meta[property="og:image"]').getAttribute('content');
  expect(image).toBe('https://m-masaki72.github.io/fold-atelier/dist/images/fold/ogp-paper.jpg');
  const imageResponse = await request.get(new URL(image).pathname.replace('/fold-atelier', ''));
  expect(imageResponse.ok()).toBe(true);
  expect(imageResponse.headers()['content-type']).toContain('image/jpeg');
  for (const entry of ['/', '/dist/']) {
    const html = await (await request.get(entry)).text();
    expect(html).toContain('property="og:title"');
    expect(html).toContain(canonical);
  }
  const sitemap = await (await request.get('/sitemap.xml')).text();
  const locations = await page.evaluate((xml) => {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    if (document.querySelector('parsererror')) throw new Error('Invalid sitemap XML');
    return [...document.querySelectorAll('loc')].map((node) => node.textContent);
  }, sitemap);
  expect(locations).toEqual([canonical]);
});

test('startup needs no artwork or collection image downloads', async ({ page }) => {
  const images = [];
  page.on('request', (request) => {
    if (request.url().includes('/images/fold/')) images.push(request.url());
  });
  await page.addInitScript(() => {
    indexedDB.open = () => {
      throw new Error('Unused image storage');
    };
  });
  await openApp(page);
  expect(images).toEqual([]);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.getByText('絵を変える')).toHaveCount(0);
  await expect(page.getByText('ことばで作る')).toHaveCount(0);
  await expect(page.locator('textarea')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__FOLD__.snapshot().drawCalls)).toBeGreaterThan(0);
  await page.locator('#collection-open').click();
  await expect.poll(() => images.length).toBeGreaterThan(0);
  await expect(page.locator('#collection-grid img').first()).toHaveJSProperty('complete', true);
});

test('holding Space toggles playback once and browser shortcuts are left alone', async ({ page }) => {
  await openApp(page);
  await page.locator('#play').click();
  await page.locator('#fold-viewport').focus();
  await page.keyboard.down('Space');
  expect(await page.evaluate(() => window.__FOLD__.snapshot().playing)).toBe(true);
  await page.keyboard.down('Space');
  await page.keyboard.up('Space');
  expect(await page.evaluate(() => window.__FOLD__.snapshot().playing)).toBe(true);
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => window.__FOLD__.snapshot().playing)).toBe(false);
  const modifiers = await page.evaluate(() => {
    const before = window.__FOLD__.snapshot().fold;
    const viewport = document.querySelector('#fold-viewport');
    const events = [
      { code: 'ArrowLeft', key: 'ArrowLeft', altKey: true },
      { code: 'Space', key: ' ', ctrlKey: true },
      { code: 'Space', key: ' ', metaKey: true },
    ].map((options) => {
      const event = new KeyboardEvent('keydown', { ...options, bubbles: true, cancelable: true });
      viewport.dispatchEvent(event);
      return event.defaultPrevented;
    });
    return {
      events,
      before,
      after: window.__FOLD__.snapshot().fold,
      playing: window.__FOLD__.snapshot().playing,
    };
  });
  expect(modifiers.events).toEqual([false, false, false]);
  expect(modifiers.after).toBe(modifiers.before);
  expect(modifiers.playing).toBe(false);
});

test('PNG export keeps the captured progress in its filename while the encoder is delayed', async ({
  page,
}) => {
  await openApp(page);
  await page.locator('#play').click();
  await page.evaluate(() => {
    window.__FOLD__.setFold(0.4);
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      window.__FOLD__.setFold(0.8);
      setTimeout(() => original.apply(this, args), 100);
    };
  });
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#capture').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('fold-40.png');
  const data = await readFile(await download.path());
  expect([...data.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(data.readUInt32BE(16)).toBeGreaterThan(0);
  expect(data.readUInt32BE(20)).toBeGreaterThan(0);
});

for (const failure of ['exception', 'empty result', 'missing 2D context']) {
  test(`PNG export failure (${failure}) produces a notification instead of an unhandled exception`, async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openApp(page);
    await page.evaluate((mode) => {
      if (mode === 'missing 2D context') {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
          return kind === '2d' ? null : getContext.call(this, kind, ...args);
        };
      } else {
        HTMLCanvasElement.prototype.toBlob = (callback) => {
          if (mode === 'exception') throw new Error('Encoder unavailable');
          callback(null);
        };
      }
    }, failure);
    await page.locator('#capture').click();
    await expect(page.locator('#toast')).toHaveText('画像を保存できませんでした。');
    expect(errors).toEqual([]);
  });
}

test('folding paper and camera settings survive reload', async ({ page }) => {
  await openApp(page);
  await page.locator('#model-select').selectOption('cat');
  await page.locator('#tool-paper summary').click();
  await page.locator('input[value="tracing"]').check();
  await page.locator('#focus-step').click();
  await page.evaluate(() => window.__FOLD__.setFold(0.5));
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__FOLD__?.snapshot().ready)).toBe(true);
  const state = await page.evaluate(() => window.__FOLD__.snapshot());
  expect(state.model).toBe('cat');
  expect(state.fold).toBe(0.5);
  expect(state.playing).toBe(false);
  expect(state.paper).toBe('tracing');
  expect(state.cameraMode).toBe('focus');
  await expect(page.locator('#paper-summary')).toHaveText('透ける紙');
});

test('an older audio start failure cannot turn off a newer successful start', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page);
  await page.evaluate(() => {
    const resume = AudioContext.prototype.resume;
    window.audioStarts = [];
    AudioContext.prototype.resume = function () {
      const context = this;
      return new Promise((resolve, reject) => {
        window.audioStarts.push({
          succeed: async () => {
            await resume.call(context);
            resolve();
          },
          fail: () => reject(new Error('Older audio start failed')),
        });
      });
    };
  });
  await page.locator('#sound-toggle').click();
  await page.locator('#sound-toggle').click();
  await page.locator('#sound-toggle').click();
  await page.evaluate(() => window.audioStarts[1].succeed());
  await expect(page.locator('#sound-toggle')).toHaveText('♪ 音 ON');
  await page.evaluate(() => window.audioStarts[0].fail());
  await expect(page.locator('#sound-toggle')).toHaveText('♪ 音 ON');
  expect(await page.evaluate(() => window.__FOLD__.snapshot().audio.context)).toBe('running');
  await expect(page.locator('#toast')).not.toContainText('音を開始できません');
  await page.locator('#sound-toggle').click();
  await expect(page.locator('#sound-toggle')).toHaveText('♪ 音 OFF');
  expect(errors).toEqual([]);
});

test('mobile paper tools return their content after a width change', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  await page.getByRole('button', { name: '紙の質感', exact: true }).click();
  await page.locator('input[value="tracing"]').check();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('#tools-dialog')).not.toBeVisible();
  await expect(page.locator('#tools-slot #tools-content')).toBeVisible();
  await expect(page.locator('input[value="tracing"]')).toBeChecked();
  await page.screenshot({ path: test.info().outputPath('paper-tools.png'), fullPage: true });
  await page.screenshot({ path: test.info().outputPath('paper-tools.jpg'), fullPage: true, quality: 85 });
});

for (const failure of ['module', 'webgl']) {
  test(`startup ${failure} failure offers recovery and disables unavailable controls`, async ({ page }) => {
    if (failure === 'module') await page.route('**/js/fold.js', (route) => route.abort());
    else
      await page.addInitScript(() => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) {
          return type.startsWith('webgl') ? null : getContext.call(this, type, ...args);
        };
      });
    await page.goto('/dist/fold.html');
    await expect(page.locator('#startup-error')).toBeVisible();
    await expect(page.locator('#loading')).toBeHidden();
    expect(await page.locator('.workspace').evaluate((node) => node.inert)).toBe(true);
    expect(await page.locator('.header-tools').evaluate((node) => node.inert)).toBe(true);
    await expect(page.getByRole('link', { name: '再読み込みする' })).toHaveAttribute('href', './fold.html');
  });
}

test('keyboard camera buttons rotate and zoom without changing the fold', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.__FOLD__.setFold(0.5));
  await page.locator('#focus-step').click();
  const before = await page.evaluate(() => window.__FOLD__.snapshot());
  await page.locator('[data-camera="left"]').focus();
  await page.keyboard.press('Enter');
  const rotated = await page.evaluate(() => window.__FOLD__.snapshot());
  expect(rotated.camera).not.toEqual(before.camera);
  expect(rotated.fold).toBe(0.5);
  expect(rotated.cameraMode).toBe('fixed');
  await expect(page.locator('#camera-fixed')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#focus-step')).toHaveAttribute('aria-pressed', 'false');
  const previousZoom = await page.evaluate(
    () => JSON.parse(localStorage.getItem('fold-atelier-session-v1')).camera.zoom,
  );
  await page.locator('[data-camera="zoom-in"]').focus();
  await page.keyboard.press('Enter');
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('fold-atelier-session-v1')).camera.zoom),
  ).toBeGreaterThan(previousZoom);
});

test('clearing saved settings starts again with defaults', async ({ page }) => {
  await openApp(page);
  await page.locator('#model-select').selectOption('cat');
  await page.evaluate(() => window.__FOLD__.setFold(0.5));
  await page.locator('#bgm-volume').evaluate((node) => {
    node.value = '80';
    node.dispatchEvent(new Event('input'));
  });
  await page.locator('#clear-saved-data').click();
  await page.locator('#clear-data-dialog').getByRole('button', { name: 'キャンセル' }).click();
  await expect(page.locator('#model-title')).toHaveText('ねこ');
  await page.locator('#clear-saved-data').click();
  await Promise.all([page.waitForEvent('load'), page.locator('#confirm-clear-data').click()]);
  await expect.poll(() => page.evaluate(() => window.__FOLD__?.snapshot().ready)).toBe(true);
  expect(await page.evaluate(() => window.__FOLD__.snapshot().model)).toBe('person');
  expect(await page.evaluate(() => window.__FOLD__.snapshot().audio.volumes.bgm)).toBe(0.32);
});

test('clearing in another tab closes tools and stops stale automatic saves', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  const other = await context.newPage();
  await openApp(other);
  await page.locator('#sound-toggle').click();
  await page.getByRole('button', { name: '紙の質感', exact: true }).click();
  await other.locator('#clear-saved-data').click();
  await Promise.all([other.waitForEvent('load'), other.locator('#confirm-clear-data').click()]);
  await expect(page.locator('#storage-reset')).toBeVisible();
  await expect(page.locator('#tools-dialog')).not.toBeVisible();
  expect(await page.locator('.workspace').evaluate((node) => node.inert)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__FOLD__.snapshot().audio.voices)).toBe(0);
  await page.close();
  await other.reload();
  await expect.poll(() => other.evaluate(() => window.__FOLD__?.snapshot().ready)).toBe(true);
  expect(await other.evaluate(() => window.__FOLD__.snapshot().model)).toBe('person');
});

test('reduced motion and narrow screens remain usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 800 });
  await openApp(page);
  expect(await page.evaluate(() => window.__FOLD__.snapshot().playing)).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('old picture settings are ignored and explicit clearing removes legacy pictures', async ({ page }) => {
  await page.goto('/404.html');
  await page.evaluate(async () => {
    localStorage.setItem(
      'fold-atelier-session-v1',
      JSON.stringify({
        version: 1,
        spec: { kind: 'cat' },
        fold: 0.5,
        playing: false,
        artMode: true,
        imageKey: 'legacy',
      }),
    );
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('fold-atelier-images', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('images');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('images', 'readwrite');
      transaction
        .objectStore('images')
        .put({ key: 'legacy', blob: new Blob(['old private image']) }, 'current');
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  });
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    window.imageDatabaseOpens = 0;
    indexedDB.open = (...args) => {
      window.imageDatabaseOpens++;
      return open(...args);
    };
  });
  await openApp(page);
  const state = await page.evaluate(() => window.__FOLD__.snapshot());
  expect(state.model).toBe('cat');
  expect(state.fold).toBe(0.5);
  expect(state).not.toHaveProperty('imageKey');
  expect(await page.evaluate(() => window.imageDatabaseOpens)).toBe(0);
  await page.locator('#clear-saved-data').click();
  await Promise.all([page.waitForEvent('load'), page.locator('#confirm-clear-data').click()]);
  await expect.poll(() => page.evaluate(() => window.__FOLD__?.snapshot().ready)).toBe(true);
  const count = await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const request = indexedDB.open('fold-atelier-images');
      request.onsuccess = () => resolve(request.result);
    });
    try {
      return await new Promise((resolve) => {
        const request = db.transaction('images').objectStore('images').count();
        request.onsuccess = () => resolve(request.result);
      });
    } finally {
      db.close();
    }
  });
  expect(count).toBe(0);
});

test('dragging in focus mode returns the camera toggle to fixed', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.__FOLD__.setFold(0.5));
  await page.locator('#focus-step').click();
  await expect(page.locator('#focus-step')).toHaveAttribute('aria-pressed', 'true');
  const area = await page.locator('#fold-viewport').boundingBox();
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width / 2 + 45, area.y + area.height / 2 + 15, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator('#camera-fixed')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#focus-step')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.__FOLD__.snapshot().cameraMode)).toBe('fixed');
  await page.locator('#focus-step').click();
  await expect(page.locator('#focus-step')).toHaveAttribute('aria-pressed', 'true');
});

test('share links use the public URL and copying has a manual fallback', async ({
  page,
  context,
}, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openApp(page);
  const canonical = 'https://m-masaki72.github.io/fold-atelier/dist/fold.html';
  const links = page.getByRole('navigation', { name: 'FOLDを共有' }).getByRole('link');
  await expect(links).toHaveCount(2);
  for (const link of await links.all()) {
    const url = new URL(await link.getAttribute('href'));
    expect(url.searchParams.get('url')).toBe(canonical);
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
  await page.getByRole('button', { name: 'URLをコピー' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(canonical);
  await expect(page.locator('#toast')).toHaveText('共有URLをコピーしました。');
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new Error('Clipboard blocked');
    };
  });
  await page.getByRole('button', { name: 'URLをコピー' }).click();
  await expect(page.getByRole('textbox', { name: '共有するURL' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '共有するURL' })).toHaveValue(canonical);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('share-mobile.png'), fullPage: true });
});
