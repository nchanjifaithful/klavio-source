// Service-worker side of the UI: overlay injection, toasts, prompts/confirms with a popup-window
// fallback on restricted pages, badge feedback, offscreen clipboard.

export interface Ctx {
  tab: chrome.tabs.Tab;
  via: 'command' | 'page' | 'palette' | 'popup' | 'macro' | 'test';
  depth: number;
}

export class Cancelled extends Error {}

const RESTRICTED = /^(chrome|edge|about|devtools|chrome-extension|chrome-untrusted|chrome-search|view-source|data|blob|javascript):|^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i;

export const scriptable = (tab?: chrome.tabs.Tab) => !!tab?.url && !RESTRICTED.test(tab.url);

export const NOT_AVAILABLE = 'Not available on this page';

export function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/Cannot access|cannot be scripted|Missing host permission|chrome:\/\/ URL|extensions gallery|No tab with id|Frame with ID 0/i.test(m)) return NOT_AVAILABLE;
  return m.replace(/^Error:\s*/, '');
}

/** Run a command in the tab's overlay, injecting overlay (and optional modules) on first use. */
export async function overlay<T = unknown>(tabId: number, cmd: string, data: unknown = {}, mods: string[] = ['overlay']): Promise<T> {
  const call = async () => (await chrome.scripting.executeScript({
    target: { tabId },
    func: (c: string, d: unknown, m: string[]) => {
      const g = globalThis as any;
      if (g.__klv_owner !== chrome.runtime || m.some((x) => !g['__klv_' + x])) return { __missing: 1 };
      return g.__klv_overlay(c, d);
    },
    args: [cmd, data, mods],
  }))[0]?.result as any;
  let r = await call();
  if (r && r.__missing) {
    await chrome.scripting.executeScript({ target: { tabId }, files: mods.map((m) => `${m}.js`) });
    r = await call();
  }
  return r as T;
}

// --- keep the worker alive while a dialog waits on the user -------------------------------------
let alive = 0;
let aliveTimer: ReturnType<typeof setInterval> | undefined;
async function keepAlive<T>(p: Promise<T>): Promise<T> {
  if (!alive++) aliveTimer = setInterval(() => chrome.runtime.getPlatformInfo(), 20e3);
  try { return await p; } finally { if (!--alive) clearInterval(aliveTimer); }
}

// --- dialogs in a popup window (restricted pages) ------------------------------------------------
const waiting = new Map<string, (v: unknown) => void>();

export function settleDialog(id: string, value: unknown) {
  waiting.get(id)?.(value);
  waiting.delete(id);
}

export async function openPopupWindow(query: string, w = 440, h = 260) {
  const last = await chrome.windows.getLastFocused().catch(() => null);
  const left = last?.left != null && last.width ? Math.round(last.left + (last.width - w) / 2) : undefined;
  const top = last?.top != null ? last.top + 90 : undefined;
  return chrome.windows.create({ url: `popup.html?${query}`, type: 'popup', width: w, height: h, left, top, focused: true });
}

async function dialogWindow<T>(kind: string, data: object): Promise<T | null> {
  const id = crypto.randomUUID();
  await chrome.storage.session.set({ ['dlg:' + id]: { kind, data } });
  const win = await openPopupWindow(`view=dialog&id=${id}`);
  return keepAlive(new Promise<T | null>((resolve) => {
    const onRemoved = (wid: number) => { if (wid === win?.id) settleDialog(id, null); };
    chrome.windows.onRemoved.addListener(onRemoved);
    waiting.set(id, (v) => {
      chrome.windows.onRemoved.removeListener(onRemoved);
      chrome.storage.session.remove('dlg:' + id);
      resolve(v as T | null);
    });
  }));
}

export async function ask<T>(ctx: Ctx, kind: 'prompt' | 'confirm', data: object): Promise<T | null> {
  if (scriptable(ctx.tab)) {
    try { return await keepAlive(overlay<T>(ctx.tab.id!, kind, data)); } catch { /* fall through */ }
  }
  return dialogWindow<T>(kind, data);
}

export async function promptText(ctx: Ctx, label: string, value = ''): Promise<string> {
  const v = await ask<string>(ctx, 'prompt', { label, value });
  if (v == null) throw new Cancelled();
  return v;
}

export async function confirmIt(ctx: Ctx, msg: string, ok = 'OK') {
  if (!(await ask<boolean>(ctx, 'confirm', { msg, ok }))) throw new Cancelled();
}

// --- feedback ------------------------------------------------------------------------------------
export async function badge(tabId: number | undefined, ok: boolean) {
  const opts = tabId != null ? { tabId } : {};
  await chrome.action.setBadgeBackgroundColor({ ...opts, color: ok ? '#1f8a4c' : '#b3261e' });
  await chrome.action.setBadgeText({ ...opts, text: ok ? '✓' : '!' });
  setTimeout(() => chrome.action.setBadgeText({ ...opts, text: '' }).catch(() => {}), 1500);
}

export async function toast(ctx: Ctx, msg: string, kind: 'ok' | 'err' = 'ok') {
  if (scriptable(ctx.tab)) {
    try { if (await overlay(ctx.tab.id!, 'toast', { msg, kind })) return; } catch { /* restricted after all */ }
  }
  await badge(ctx.tab.id, kind === 'ok');
  await chrome.action.setTitle({ tabId: ctx.tab.id, title: `Klavio: ${msg}` }).catch(() => {});
  if (kind === 'err' && ctx.via !== 'popup') {
    await chrome.storage.session.set({ intent: { view: 'msg', msg } });
    await chrome.action.openPopup().catch(() => {});
  }
}

// --- clipboard -------------------------------------------------------------------------------------
async function offscreen<T>(op: string, payload: object = {}): Promise<T> {
  const ctxs = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (!ctxs.length) {
    await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: [chrome.offscreen.Reason.CLIPBOARD], justification: 'Copy text to and read text from the clipboard' })
      .catch((e) => { if (!/single offscreen/i.test(String(e))) throw e; });
  }
  try {
    return await chrome.runtime.sendMessage({ target: 'offscreen', op, ...payload });
  } finally {
    chrome.offscreen.closeDocument().catch(() => {});
  }
}

export async function copyText(ctx: Ctx, text: string, html?: string, msg = 'Copied') {
  if (scriptable(ctx.tab)) {
    try { if (await overlay(ctx.tab.id!, 'copy', { text, html, toast: msg })) return; } catch { /* fall back */ }
  }
  const ok = await offscreen<boolean>('copy', { text, html });
  if (!ok) throw new Error('Could not write to the clipboard');
  await toast(ctx, msg);
}

export const readClipboard = () => offscreen<string>('paste');
