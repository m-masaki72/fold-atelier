import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);

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
  const imageResponse = await request.get('/dist/images/fold/social-preview.jpg');
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

test('an unavailable default image does not prevent folding or choosing a replacement', async ({ page }) => {
  await page.route('**/images/fold/crane.png', (route) => route.abort());
  await openApp(page);
  await expect(page.locator('#toast')).toContainText('元の絵を読み込めませんでした');
  await expect.poll(() => page.evaluate(() => window.__FOLD__.snapshot().drawCalls)).toBeGreaterThan(0);
  await page.locator('#model-select').selectOption('cube');
  await expect(page.locator('#model-title')).toHaveText('立方体');
  await page.locator('#tool-paper summary').click();
  await expect(page.locator('#art-mode')).toBeDisabled();
  await page.locator('#art-open').click();
  await page
    .locator('#image-upload')
    .setInputFiles({ name: 'picture.png', mimeType: 'image/png', buffer: pixel });
  await expect(page.locator('#art-dialog')).not.toBeVisible();
  await expect(page.locator('#art-mode')).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.__FOLD__.snapshot().artMode)).toBe(true);
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

test('an uploaded image, folding state and camera survive reload', async ({ page }) => {
  await openApp(page);
  await page.locator('#model-select').selectOption('cat');
  await page.locator('#tool-paper summary').click();
  await page.locator('#art-open').click();
  await page
    .locator('#image-upload')
    .setInputFiles({ name: 'saved.png', mimeType: 'image/png', buffer: pixel });
  await expect(page.locator('#art-dialog')).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__FOLD__.snapshot().imageKey)).toBeTruthy();
  await page.locator('#focus-step').click();
  await page.evaluate(() => window.__FOLD__.setFold(0.5));
  await page.route('**/images/fold/crane.png', (route) => route.abort());
  await page.reload();
  await expect(page.locator('#loading')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__FOLD__?.snapshot().ready)).toBe(true);
  const state = await page.evaluate(() => window.__FOLD__.snapshot());
  expect(state.model).toBe('cat');
  expect(state.fold).toBe(0.5);
  expect(state.playing).toBe(false);
  expect(state.artMode).toBe(true);
  expect(state.cameraMode).toBe('focus');
  await expect(page.locator('#art-title')).toHaveText('saved');
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

test('mobile tools return their content and focus correctly after a width change', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  await page.getByRole('button', { name: '紙と絵', exact: true }).click();
  await page.locator('#art-open').click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('#art-dialog').getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(page.locator('#tools-dialog')).not.toBeVisible();
  await expect(page.locator('#tools-slot #tools-content')).toBeVisible();
  await expect(page.locator('#art-open')).toBeFocused();
  await page.screenshot({ path: test.info().outputPath('tools-restored.png'), fullPage: true });
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

async function uploadPicture(page, name) {
  await page.locator('#tool-paper summary').click();
  await page.locator('#art-open').click();
  await page
    .locator('#image-upload')
    .setInputFiles({ name: `${name}.png`, mimeType: 'image/png', buffer: pixel });
  await expect(page.locator('#art-dialog')).not.toBeVisible();
}

test('image persistence failure stays visible after upload success', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.open = () => {
      throw new DOMException('Storage denied', 'SecurityError');
    };
  });
  await openApp(page);
  await uploadPicture(page, 'temporary');
  await expect(page.locator('#image-save-status')).toBeVisible();
  await expect(page.locator('#image-save-status')).toContainText('次回は画像を選び直して');
  await expect(page.locator('#art-title')).toHaveText('temporary');
  expect(await page.evaluate(() => window.__FOLD__.snapshot().imageKey)).toBeNull();
});

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
  await expect(page.locator('#camera-resume')).toBeVisible();
  const previousZoom = await page.evaluate(
    () => JSON.parse(localStorage.getItem('fold-atelier-session-v1')).camera.zoom,
  );
  await page.locator('[data-camera="zoom-in"]').focus();
  await page.keyboard.press('Enter');
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('fold-atelier-session-v1')).camera.zoom),
  ).toBeGreaterThan(previousZoom);
});

test('different tabs keep each uploaded image available for resuming', async ({ page, context }) => {
  await openApp(page);
  await uploadPicture(page, 'first');
  await expect.poll(() => page.evaluate(() => window.__FOLD__.snapshot().imageKey)).toBeTruthy();
  const firstKey = await page.evaluate(() => window.__FOLD__.snapshot().imageKey);
  const other = await context.newPage();
  await openApp(other);
  await uploadPicture(other, 'second');
  await expect.poll(() => other.evaluate(() => window.__FOLD__.snapshot().imageKey)).toBeTruthy();
  expect(await other.evaluate(() => window.__FOLD__.snapshot().imageKey)).not.toBe(firstKey);
  await other.close();
  await page.evaluate(() => window.__FOLD__.setFold(0.4));
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fold-atelier-session-v1')).fold))
    .toBe(0.4);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__FOLD__?.snapshot().ready)).toBe(true);
  await expect(page.locator('#art-title')).toHaveText('first');
  expect(await page.evaluate(() => window.__FOLD__.snapshot().imageKey)).toBe(firstKey);
});

test('clearing saved data removes pictures settings and resumes from defaults', async ({ page }) => {
  await openApp(page);
  await uploadPicture(page, 'forget-me');
  await expect.poll(() => page.evaluate(() => window.__FOLD__.snapshot().imageKey)).toBeTruthy();
  const savedKey = await page.evaluate(() => window.__FOLD__.snapshot().imageKey);
  await page.locator('#bgm-volume').evaluate((node) => {
    node.value = '80';
    node.dispatchEvent(new Event('input'));
  });
  await page.locator('#clear-saved-data').click();
  await page.locator('#clear-data-dialog').getByRole('button', { name: 'キャンセル' }).click();
  await expect(page.locator('#art-title')).toHaveText('forget-me');
  await page.locator('#clear-saved-data').click();
  await Promise.all([page.waitForEvent('load'), page.locator('#confirm-clear-data').click()]);
  await expect.poll(() => page.evaluate(() => window.__FOLD__?.snapshot().ready)).toBe(true);
  await expect(page.locator('#art-title')).toHaveText('日輪をわたる');
  expect(await page.evaluate(() => window.__FOLD__.snapshot().imageKey)).toBeNull();
  expect(await page.evaluate(() => window.__FOLD__.snapshot().audio.volumes.bgm)).toBe(0.32);
  const images = await page.evaluate(async (key) => {
    const { imageStore } = await import('./js/fold-session.js');
    return imageStore(undefined, key);
  }, savedKey);
  expect(images).toBeUndefined();
});

test('clearing in another tab stops stale automatic saves', async ({ page, context }) => {
  await openApp(page);
  await uploadPicture(page, 'old-picture');
  await expect.poll(() => page.evaluate(() => window.__FOLD__.snapshot().imageKey)).toBeTruthy();
  const other = await context.newPage();
  await openApp(other);
  await page.locator('#sound-toggle').click();
  await page.locator('#art-open').click();
  await other.locator('#clear-saved-data').click();
  await Promise.all([other.waitForEvent('load'), other.locator('#confirm-clear-data').click()]);
  await expect(page.locator('#storage-reset')).toBeVisible();
  await expect(page.locator('#art-dialog')).not.toBeVisible();
  await expect(page.getByRole('link', { name: '最初から開き直す' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__FOLD__.snapshot().audio.voices)).toBe(0);
  expect(await page.locator('.workspace').evaluate((node) => node.inert)).toBe(true);
  await page.close();
  await other.reload();
  await expect.poll(() => other.evaluate(() => window.__FOLD__?.snapshot().ready)).toBe(true);
  await expect(other.locator('#art-title')).toHaveText('日輪をわたる');
  expect(await other.evaluate(() => window.__FOLD__.snapshot().imageKey)).toBeNull();
});

test('reduced motion and narrow screens remain usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 800 });
  await openApp(page);
  expect(await page.evaluate(() => window.__FOLD__.snapshot().playing)).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
