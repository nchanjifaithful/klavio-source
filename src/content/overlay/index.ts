// In-page UI, injected on demand (never at page load): palette, QR panel, screenshot panel, prompt, confirm, toast.
// Lives in a closed Shadow DOM so page CSS can't break it. Called by the service worker via
// chrome.scripting.executeScript(func => globalThis.__klv_overlay(cmd, data)).

import { dataUrlToBlob, writeImage, writeText } from '../../lib/clipboard';
import type { PItem } from '../../lib/items';
import { createPalette, PALETTE_CSS, THEME_CSS } from '../../ui/palette';

declare global {
  // eslint-disable-next-line no-var
  var __klv_overlay: ((cmd: string, data: any) => unknown) | undefined;
  // eslint-disable-next-line no-var
  var __klv_key: ((e: KeyboardEvent) => void) | undefined;
  // eslint-disable-next-line no-var
  var __klv_qr: { toCanvas(c: HTMLCanvasElement, text: string, o: object): Promise<void> } | undefined;
}

const CSS = `
*{box-sizing:border-box}
.bd{position:fixed;inset:0;pointer-events:auto;background:rgba(10,10,20,.28);display:flex;align-items:flex-start;justify-content:center;padding-top:12vh;animation:f .08s ease-out}
.bd.mid{align-items:center;padding-top:0}
.card{pointer-events:auto;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.28);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden;max-width:92vw}
.pal{width:min(640px,92vw);height:min(440px,64vh);display:flex}
.pad{padding:18px}
h2{margin:0 0 4px;font-size:15px;font-weight:600}
.sub{color:var(--mut);font-size:12px;margin:0 0 12px;max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
canvas,img.shot{display:block;margin:0 auto;background:#fff;border-radius:8px}
canvas{width:280px;height:280px;image-rendering:pixelated}
img.shot{max-width:min(720px,80vw);max-height:56vh;border:1px solid var(--line)}
.row{display:flex;gap:8px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap}
button{font:inherit;font-size:13px;padding:7px 14px;border-radius:8px;border:1px solid var(--line);background:var(--kbd);color:var(--fg);cursor:pointer}
button:hover{border-color:var(--acc)}
button.pri{background:var(--acc);border-color:var(--acc);color:#fff}
input.txt{font:inherit;width:min(380px,80vw);padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);outline:none}
input.txt:focus{border-color:var(--acc)}
.err{color:var(--err);font-size:13px;max-width:320px;margin:8px 0 0}
.toasts{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:6px;align-items:center}
.toast{pointer-events:none;background:#1d1d1f;color:#fff;padding:9px 16px;border-radius:999px;font:13px/1.3 system-ui,"Segoe UI",sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);animation:f .12s ease-out}
.toast.err{background:#b3261e}
@keyframes f{from{opacity:0;transform:translateY(4px)}}
`;

let host: HTMLElement | null = null;
let root: ShadowRoot;
interface Layer { key(e: KeyboardEvent): void; close(): void }
const layers: Layer[] = [];

function ensureRoot(): ShadowRoot {
  if (host?.isConnected) return root;
  host = document.createElement('klavio-root');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block';
  root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = THEME_CSS + PALETTE_CSS + CSS;
  root.append(style);
  root.addEventListener('keydown', dispatch as EventListener);
  document.documentElement.append(host);
  return root;
}

function dispatch(e: KeyboardEvent) {
  e.stopPropagation();
  layers[layers.length - 1]?.key(e);
}
// keys.js (registered at document_start, before page scripts) forwards keys typed inside our
// overlay here and stops them, so page shortcuts never see them.
globalThis.__klv_key = dispatch;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
}

function modal(card: HTMLElement, key: (e: KeyboardEvent) => void, onClose: () => void, mid = true): Layer {
  const r = ensureRoot();
  closeAll(); // one modal at a time
  const bd = h('div', 'bd' + (mid ? ' mid' : ''));
  bd.append(card);
  bd.addEventListener('mousedown', (e) => { if (e.target === bd) layer.close(); });
  const layer: Layer = {
    key: (e) => { if (e.key === 'Escape') { e.preventDefault(); layer.close(); } else key(e); },
    close: () => { bd.remove(); const i = layers.indexOf(layer); if (i >= 0) layers.splice(i, 1); onClose(); },
  };
  r.append(bd);
  layers.push(layer);
  return layer;
}

function closeAll() { while (layers.length) layers[layers.length - 1].close(); }

function button(text: string, onClick: () => void, pri = false) {
  const b = h('button', pri ? 'pri' : '', text);
  b.addEventListener('click', onClick);
  return b;
}

function toast(msg: string, kind: 'ok' | 'err' = 'ok') {
  const r = ensureRoot();
  let box = r.querySelector('.toasts');
  if (!box) { box = h('div', 'toasts'); r.append(box); }
  const t = h('div', 'toast' + (kind === 'err' ? ' err' : ''), msg);
  box.append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 3200 : 1800);
  return true;
}

function download(href: string, name: string) {
  const a = h('a');
  a.href = href;
  a.download = name;
  a.style.display = 'none';
  ensureRoot().append(a);
  a.click();
  a.remove();
}

const safeName = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'page';

function palette(items: PItem[]) {
  const card = h('div', 'card pal');
  let layer: Layer;
  const p = createPalette(document, items, (id) => {
    layer.close();
    // Let the overlay disappear from the frame before running (screenshots must not include it).
    requestAnimationFrame(() => requestAnimationFrame(() => chrome.runtime.sendMessage({ type: 'run', id, via: 'palette' })));
  }, () => layer.close());
  card.append(p.el);
  layer = modal(card, p.key, () => {}, false);
  p.focus();
  return true;
}

async function qr({ url, size, ecl, domain }: { url: string; size: number; ecl: string; domain: string }) {
  const card = h('div', 'card pad');
  const title = h('h2', '', 'QR code for this page');
  const sub = h('p', 'sub', url);
  const canvas = h('canvas');
  const err = h('p', 'err');
  const row = h('div', 'row');
  card.append(title, sub, canvas, row);
  const layer = modal(card, () => {}, () => {});
  let ok = false;

  const draw = async (text: string) => {
    sub.textContent = text;
    try {
      await globalThis.__klv_qr!.toCanvas(canvas, text, { width: size, margin: 2, errorCorrectionLevel: ecl });
      canvas.style.cssText = '';
      err.remove();
      ok = true;
    } catch {
      ok = false;
      canvas.style.display = 'none';
      err.textContent = 'This URL is too long for a QR code (max ≈ 2,900 bytes).';
      card.insertBefore(err, row);
      let origin = '';
      try { origin = new URL(text).origin; } catch { /* not a URL */ }
      if (origin && origin !== 'null' && origin !== text) {
        row.prepend(button('QR the origin only', () => { row.firstChild?.remove(); void draw(origin); }));
      }
    }
  };
  await draw(url);
  row.append(
    button('Copy image', () => canvas.toBlob(async (b) => toast(b && (await writeImage(b)) ? 'QR image copied' : 'Copy failed', 'ok'))),
    button('Download PNG', () => download(canvas.toDataURL('image/png'), `qr-${safeName(domain)}.png`)),
    button('Close', () => layer.close(), true),
  );
  (row.lastChild as HTMLElement).focus();
  return ok ? canvas.toDataURL('image/png') : null;
}

async function shot({ dataUrl, format, title }: { dataUrl: string; format: string; title: string }) {
  const blob = dataUrlToBlob(dataUrl);
  const copied = await writeImage(blob);
  const card = h('div', 'card pad');
  const img = h('img', 'shot');
  img.src = dataUrl;
  const row = h('div', 'row');
  card.append(h('h2', '', 'Screenshot'), h('p', 'sub', copied ? 'Copied to clipboard.' : 'Click Copy to put it on the clipboard.'), img, row);
  const layer = modal(card, () => {}, () => {});
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  row.append(
    button('Copy', async () => toast((await writeImage(blob)) ? 'Screenshot copied' : 'Copy failed')),
    button(`Download ${ext.toUpperCase()}`, () => { download(dataUrl, `screenshot-${safeName(title)}.${ext}`); layer.close(); }),
    button('Close', () => layer.close(), true),
  );
  (row.lastChild as HTMLElement).focus();
  return copied;
}

function prompt({ label, value = '' }: { label: string; value?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string | null) => { if (!done) { done = true; resolve(v); layer.close(); } };
    const card = h('div', 'card pad');
    const input = h('input', 'txt');
    input.value = value;
    const row = h('div', 'row');
    row.append(button('Cancel', () => finish(null)), button('OK', () => finish(input.value), true));
    card.append(h('h2', '', label), input, row);
    const layer = modal(card, (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(input.value); } }, () => finish(null));
    input.focus();
    input.select();
  });
}

function confirmBox({ msg, ok = 'OK' }: { msg: string; ok?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => { if (!done) { done = true; resolve(v); layer.close(); } };
    const card = h('div', 'card pad');
    const row = h('div', 'row');
    const okBtn = button(ok, () => finish(true), true);
    row.append(button('Cancel', () => finish(false)), okBtn);
    card.append(h('h2', '', msg), row);
    const layer = modal(card, (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } }, () => finish(false));
    okBtn.focus();
  });
}

(globalThis as { __klv_owner?: unknown }).__klv_owner = chrome.runtime;
globalThis.__klv_overlay = (cmd: string, d: any) => {
  switch (cmd) {
    case 'toast': return toast(d.msg, d.kind);
    case 'palette': return palette(d.items);
    case 'qr': return qr(d);
    case 'shot': return shot(d);
    case 'prompt': return prompt(d);
    case 'confirm': return confirmBox(d);
    case 'copy': return writeText(document, d.text, d.html).then((ok) => (ok && d.toast ? toast(d.toast) : ok));
    case 'close': closeAll(); return true;
  }
  return null;
};
