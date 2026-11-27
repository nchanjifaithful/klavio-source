// End-to-end: loads dist/ as an unpacked extension in Playwright's Chromium.
// Pages are served by request interception on http://klavio.test so content scripts run on them.
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import jsQR from 'jsqr';
import path from 'node:path';

const DIST = path.resolve('dist');
const PAGE = 'http://klavio.test/page';
let ctx: BrowserContext;
let sw: Worker;

test.beforeAll(async () => {
  ctx = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await ctx.route('http://klavio.test/form', (r) => r.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><title>Form</title><input id="name" placeholder="Your name"><button id="greet" onclick="document.getElementById('out').textContent='Hi '+document.getElementById('name').value">Greet</button><p id="out"></p>`,
  }));
  await ctx.route(/http:\/\/klavio\.test\/(?!form)/, (r) => r.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><title>Klavio test</title><h1>Hello</h1><input id="t"><p id="log"></p>
      <script>addEventListener('keydown', e => document.getElementById('log').textContent += e.code + ' ')</script>`,
  }));
  sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await sw.evaluate(() => (globalThis as any).__klavio.recompile());
});

test.afterAll(() => ctx?.close());

async function openPage(): Promise<[Page, number]> {
  const page = await ctx.newPage();
  await page.goto(PAGE);
  await page.bringToFront();
  const id = await sw.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id!, PAGE);
  return [page, id];
}

const run = (id: string, tabId: number) => sw.evaluate(([a, t]) => (globalThis as any).__klavio.runAction(a, t), [id, tabId] as const);
const tab = (tabId: number) => sw.evaluate((t) => chrome.tabs.get(t), tabId);

test('QR overlay appears and its PNG decodes back to the URL', async () => {
  const [page, id] = await openPage();
  const t0 = Date.now();
  const res = await run('page.qr', id);
  expect(Date.now() - t0).toBeLessThan(1500); // headless CI budget; 300 ms target in real Chrome
  expect(res.ok).toBe(true);
  await expect(page.locator('klavio-root')).toHaveCount(1);
  const dataUrl: string = res.result;
  const pixels = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    return { w: c.width, h: c.height, d: Array.from(g.getImageData(0, 0, c.width, c.height).data) };
  }, dataUrl);
  const code = jsQR(Uint8ClampedArray.from(pixels.d), pixels.w, pixels.h);
  expect(code?.data).toBe(PAGE);
  await page.close();
});

test('copy URL puts the right text on the clipboard', async () => {
  const [page, id] = await openPage();
  const res = await run('page.copyUrl', id);
  expect(res.ok).toBe(true);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(PAGE);
  await page.close();
});

test('pin / mute / duplicate change tab state', async () => {
  const [page, id] = await openPage();
  await run('tab.pin', id);
  expect((await tab(id)).pinned).toBe(true);
  await run('tab.pin', id);
  expect((await tab(id)).pinned).toBe(false);
  await run('tab.mute', id);
  expect((await tab(id)).mutedInfo?.muted).toBe(true);
  const before = ctx.pages().length;
  const dup = await run('tab.duplicate', id);
  expect(dup.ok).toBe(true);
  await expect.poll(() => ctx.pages().length).toBe(before + 1);
  await page.close();
});

test('in-page shortcut runs on the page but is ignored inside a text input', async () => {
  const [page, id] = await openPage();
  await page.waitForFunction(() => document.readyState === 'complete');
  // Alt+Shift+I (pin) is an in-page default.
  await page.locator('h1').click();
  await page.keyboard.press('Alt+Shift+KeyI');
  await expect.poll(async () => (await tab(id)).pinned).toBe(true);
  await page.keyboard.press('Alt+Shift+KeyI');
  await expect.poll(async () => (await tab(id)).pinned).toBe(false);
  // The page never saw the matched key (preventDefault + stopImmediatePropagation in capture phase).
  expect(await page.locator('#log').textContent()).not.toContain('KeyI');
  // Shift-only combos are ignored while typing (Alt/Ctrl combos still work by design).
  await sw.evaluate(() => chrome.storage.sync.set({ keymap: { 'tab.pin': 'Shift+KeyP' } }));
  await page.waitForTimeout(300);
  await page.locator('#t').click();
  await page.keyboard.press('Shift+KeyP');
  await page.waitForTimeout(300);
  expect((await tab(id)).pinned).toBe(false);
  await expect(page.locator('#t')).toHaveValue('P');
  // Same combo outside the input runs the action — and the remap applied without a reload.
  await page.locator('h1').click();
  await page.keyboard.press('Shift+KeyP');
  await expect.poll(async () => (await tab(id)).pinned).toBe(true);
  await sw.evaluate(() => chrome.storage.sync.remove('keymap'));
  await page.close();
});

test('palette overlay opens, filters and runs an action', async () => {
  const [page, id] = await openPage();
  await page.locator('h1').click();
  const res = await run('palette.open', id);
  expect(res.ok).toBe(true);
  await page.keyboard.type('mute');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await tab(id)).mutedInfo?.muted).toBe(true);
  expect(await page.locator('#log').textContent()).toBe(''); // typing in the palette never reached the page
  await page.close();
});

test('custom action: copy template with variables', async () => {
  const [page, id] = await openPage();
  await sw.evaluate(() => chrome.storage.local.set({ custom: [{ id: 'u_e2e', source: 'user', type: 'copy', title: 'Cite', scope: [], cfg: { text: '{title} <{url}> ({domain})', format: 'text' } }] }));
  const res = await run('u_e2e', id);
  expect(res.ok).toBe(true);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`Klavio test <${PAGE}> (klavio.test)`);
  await page.close();
});

test('recorder: record clicks + typing, save with a shortcut, replay after reload', async () => {
  const page = await ctx.newPage();
  await page.goto('http://klavio.test/form');
  await page.bringToFront();
  const id = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'http://klavio.test/form' }))[0].id!);
  expect((await run('record.start', id)).ok).toBe(true);
  await expect(page.locator('klavio-rec')).toHaveCount(1);

  await page.locator('#name').fill('');
  await page.locator('#name').pressSequentially('Ada');
  await page.locator('#greet').click();
  await expect(page.locator('#out')).toHaveText('Hi Ada');
  await expect(page.locator('klavio-rec').getByText('2 steps')).toBeVisible();

  await page.locator('klavio-rec').getByRole('button', { name: 'Stop & save' }).click();
  // Name prompt (overlay): replace the suggested name, then press a shortcut.
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Greet Ada');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  await page.keyboard.press('Alt+Shift+Digit1');

  await expect.poll(async () => sw.evaluate(async () => {
    const { custom } = await chrome.storage.local.get('custom');
    const { keymap } = await chrome.storage.sync.get('keymap');
    const a = (custom as any[]).find((x) => x.title === 'Greet Ada');
    return a ? { type: a.type, key: keymap?.[a.id], steps: a.cfg.steps.split('\n').length } : null;
  })).toEqual({ type: 'recording', key: 'Alt+Shift+Digit1', steps: 2 });

  await page.reload();
  await page.waitForFunction(() => document.readyState === 'complete');
  await expect(page.locator('#out')).toHaveText('');
  await page.locator('body').click({ position: { x: 5, y: 200 } });
  await page.keyboard.press('Alt+Shift+Digit1');
  await expect(page.locator('#out')).toHaveText('Hi Ada');
  await expect(page.locator('#name')).toHaveValue('Ada');
  await page.close();
});