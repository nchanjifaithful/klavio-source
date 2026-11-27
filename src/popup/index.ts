// Toolbar popup: the palette (same component as the overlay) + footer. Also hosts fallback views for
// restricted pages, opened via an "intent" in storage.session or URL params: qr, shot, dialog, grant, msg.

import { META } from '../actions/meta';
import { dataUrlToBlob, writeImage } from '../lib/clipboard';
import { buildItems } from '../lib/items';
import { PERM_LABELS, permsFor, requestPerms } from '../lib/permissions';
import { getCustom, getSettings, hostDisabled } from '../lib/storage';
import { createPalette, PALETTE_CSS, THEME_CSS } from '../ui/palette';

const CSS = `
html,body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
body.pop{width:560px;height:460px}
body.win{width:100vw;height:100vh}
#app{display:flex;flex-direction:column;height:100%}
.klv-pal{flex:1;min-height:0}
footer{display:flex;gap:8px;align-items:center;padding:8px 12px;border-top:1px solid var(--line);font-size:12px;color:var(--mut)}
footer .sp{flex:1}
button{font:inherit;font-size:13px;padding:6px 12px;border-radius:8px;border:1px solid var(--line);background:var(--kbd);color:var(--fg);cursor:pointer}
button:hover{border-color:var(--acc)}
button.pri{background:var(--acc);border-color:var(--acc);color:#fff}
.lnk{all:unset;cursor:pointer;color:var(--acc);font-size:12px}
.view{padding:18px;display:flex;flex-direction:column;gap:12px;height:100%;box-sizing:border-box}
h2{margin:0;font-size:15px}
.sub{margin:0;color:var(--mut);font-size:12px;word-break:break-all;max-height:3em;overflow:hidden}
.row{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:auto}
canvas{width:260px;height:260px;align-self:center;image-rendering:pixelated;background:#fff;border-radius:8px}
img{max-width:100%;max-height:70vh;align-self:center;border:1px solid var(--line);border-radius:6px}
input.txt{font:inherit;padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);outline:none}
input.txt:focus{border-color:var(--acc)}
.err{color:var(--err)}
`;

const style = document.createElement('style');
style.textContent = THEME_CSS + PALETTE_CSS + CSS;
document.head.append(style);

const app = document.getElementById('app')!;
const params = new URLSearchParams(location.search);
const isWindow = params.size > 0;
document.body.className = isWindow ? 'win' : 'pop';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
}
function btn(text: string, onClick: () => void, pri = false) {
  const b = h('button', pri ? 'pri' : '', text);
  b.addEventListener('click', onClick);
  return b;
}
function download(href: string, name: string) {
  const a = h('a');
  a.href = href;
  a.download = name;
  a.click();
}

async function targetTab(p: Record<string, string>): Promise<chrome.tabs.Tab | undefined> {
  if (p.tab) return chrome.tabs.get(+p.tab).catch(() => undefined);
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  const [t] = await chrome.tabs.query(win?.id != null ? { active: true, windowId: win.id } : { active: true, currentWindow: true });
  return t;
}

const send = (msg: object) => chrome.runtime.sendMessage(msg).catch(() => {});

async function paletteView(tab: chrome.tabs.Tab | undefined) {
  const [items, custom, settings] = await Promise.all([buildItems(tab?.url), getCustom(), getSettings()]);
  const p = createPalette(document, items, async (id) => {
    const perms = permsFor(id, custom);
    if (perms.length && !(await requestPerms(perms).catch(() => false))) return;
    await send({ type: 'run', id, tabId: tab?.id, via: 'popup' });
    window.close();
  }, () => window.close());
  document.addEventListener('keydown', p.key);

  const footer = h('footer');
  let host = '';
  try { host = tab?.url && /^https?:/.test(tab.url) ? new URL(tab.url).hostname : ''; } catch { /* ignore */ }
  if (host) {
    const off = hostDisabled(host, settings.sites);
    footer.append(btn(off ? `Enable on ${host}` : 'Disable on this site', async () => {
      const sites = off ? settings.sites.filter((d) => !(host === d || host.endsWith('.' + d))) : [...settings.sites, host];
      await chrome.storage.sync.set({ sites });
      window.close();
    }));
  } else if (tab) {
    footer.append(h('span', '', 'In-page keys are unavailable here; this palette still works.'));
  }
  footer.append(h('span', 'sp'), btn('Settings', () => { chrome.runtime.openOptionsPage(); window.close(); }));
  app.append(p.el, footer);
  p.focus();
}

async function qrView(tab: chrome.tabs.Tab | undefined) {
  const url = tab?.url ?? '';
  const { opts } = await getSettings();
  await new Promise<void>((res, rej) => {
    const s = h('script');
    s.src = 'qr.js';
    s.onload = () => res();
    s.onerror = rej;
    document.head.append(s);
  });
  const v = h('div', 'view');
  const sub = h('p', 'sub', url);
  const canvas = h('canvas');
  const row = h('div', 'row');
  v.append(h('h2', '', 'QR code for this page'), sub, canvas, row);
  app.append(v);
  try {
    await globalThis.__klv_qr!.toCanvas(canvas, url, { width: opts.qrSize, margin: 2, errorCorrectionLevel: opts.qrEcl });
  } catch {
    canvas.remove();
    v.insertBefore(h('p', 'err', 'This URL is too long for a QR code (max ≈ 2,900 bytes).'), row);
  }
  row.append(
    btn('Copy image', () => canvas.toBlob((b) => b && writeImage(b))),
    btn('Download PNG', () => download(canvas.toDataURL('image/png'), 'qr.png')),
    btn('Close', () => window.close(), true),
  );
}

async function shotView() {
  const { shot } = (await chrome.storage.session.get('shot')) as { shot?: { dataUrl: string; format: string } };
  await chrome.storage.session.remove('shot');
  const v = h('div', 'view');
  if (!shot) { v.append(h('p', '', 'No screenshot.')); app.append(v); return; }
  const img = h('img');
  img.src = shot.dataUrl;
  const status = h('p', 'sub', '');
  const ext = shot.format === 'jpeg' ? 'jpg' : 'png';
  const copy = async () => { status.textContent = (await writeImage(dataUrlToBlob(shot.dataUrl))) ? 'Copied to clipboard.' : 'Copy failed.'; };
  v.append(h('h2', '', 'Screenshot'), status, img, h('div', 'row'));
  (v.lastChild as HTMLElement).append(btn('Copy', copy), btn(`Download ${ext.toUpperCase()}`, () => download(shot.dataUrl, `screenshot.${ext}`)), btn('Close', () => window.close(), true));
  app.append(v);
  void copy();
}

async function dialogView(id: string) {
  const key = 'dlg:' + id;
  const req = (await chrome.storage.session.get(key))[key] as any;
  const v = h('div', 'view');
  app.append(v);
  if (!req) { window.close(); return; }
  const done = async (value: unknown) => { await send({ type: 'dlg', id, value }); window.close(); };
  const row = h('div', 'row');
  if (req.kind === 'prompt') {
    const input = h('input', 'txt');
    input.value = req.data.value ?? '';
    v.append(h('h2', '', req.data.label), input, row);
    row.append(btn('Cancel', () => done(null)), btn('OK', () => done(input.value), true));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value); if (e.key === 'Escape') done(null); });
    input.focus();
  } else {
    v.append(h('h2', '', req.data.msg), row);
    const ok = btn(req.data.ok ?? 'OK', () => done(true), true);
    row.append(btn('Cancel', () => done(false)), ok);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(false); });
    ok.focus();
  }
}

async function grantView(p: Record<string, string>) {
  const perms = p.perms.split(',');
  const custom = await getCustom();
  const title = META[p.id]?.title ?? custom.find((c) => c.id === p.id)?.title ?? p.id;
  const v = h('div', 'view');
  const row = h('div', 'row');
  v.append(h('h2', '', `“${title}” needs permission`), h('p', '', `Klavio asks for optional permissions only when an action first needs them: ${perms.map((x) => PERM_LABELS[x] ?? x).join(', ')}.`), row);
  row.append(btn('Cancel', () => window.close()), btn('Allow and run', async () => {
    if (await requestPerms(perms).catch(() => false)) await send({ type: 'run', id: p.id, tabId: +p.tab, via: 'popup' });
    window.close();
  }, true));
  app.append(v);
  (row.lastChild as HTMLElement).focus();
}

function msgView(msg: string) {
  const v = h('div', 'view');
  const row = h('div', 'row');
  row.append(btn('Settings', () => chrome.runtime.openOptionsPage()), btn('OK', () => window.close(), true));
  v.append(h('h2', '', 'Klavio'), h('p', '', msg), row);
  app.append(v);
  (row.lastChild as HTMLElement).focus();
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'Enter') window.close(); });
}

(async () => {
  const { intent } = (await chrome.storage.session.get('intent')) as { intent?: Record<string, string> };
  if (intent) await chrome.storage.session.remove('intent');
  const p: Record<string, string> = intent ?? Object.fromEntries(params);
  const tab = await targetTab(p);
  switch (p.view) {
    case 'qr': return qrView(tab);
    case 'shot': return shotView();
    case 'dialog': return dialogView(p.id);
    case 'grant': return grantView(p);
    case 'msg': return msgView(p.msg);
    default: return paletteView(tab);
  }
})();
