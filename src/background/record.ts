// Recording lifecycle (start / resume after navigation / save) and replay of recorded steps.

import { findConflict, keyWarnings } from '../lib/conflicts';
import { blank } from '../lib/custom';
import { label } from '../lib/keymap';
import { stringifySteps, type Step } from '../lib/recording';
import { getCustom, getSettings, saveCustom } from '../lib/storage';
import { type Ctx, NOT_AVAILABLE, overlay, promptText, scriptable, toast } from './ui';

interface RecState { tabId: number; steps: Step[]; startUrl: string }
const getRec = async () => (await chrome.storage.local.get('rec')).rec as RecState | undefined;

async function inject(tabId: number, steps: Step[]) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['recorder.js'] });
  await chrome.scripting.executeScript({ target: { tabId }, func: (s: Step[]) => globalThis.__klv_rec!({ steps: s }), args: [steps] });
}

export async function startRecording(ctx: Ctx) {
  if (!scriptable(ctx.tab)) throw new Error(NOT_AVAILABLE);
  await chrome.storage.local.set({ rec: { tabId: ctx.tab.id!, steps: [], startUrl: ctx.tab.url ?? '' } satisfies RecState });
  await inject(ctx.tab.id!, []);
  await toast(ctx, 'Recording: click and type, then press Stop & save');
}

/** Message handlers from recorder.js / keys.js. */
export async function onRecMessage(msg: { type: string; steps?: Step[] }, tab: chrome.tabs.Tab) {
  const rec = await getRec();
  if (!rec || rec.tabId !== tab.id) return;
  switch (msg.type) {
    case 'recResume': {
      // A new document loaded in the recording tab: the last step caused a navigation.
      const steps = rec.steps.map((s, i) => (i === rec.steps.length - 1 ? { ...s, nav: true } : s));
      await chrome.storage.local.set({ rec: { ...rec, steps } });
      await inject(tab.id!, steps).catch(() => {});
      return;
    }
    case 'recSave':
      await chrome.storage.local.set({ rec: { ...rec, steps: msg.steps ?? [] } });
      return;
    case 'recCancel':
      await chrome.storage.local.remove('rec');
      return;
    case 'recStop':
      await chrome.storage.local.remove('rec');
      await finish({ tab, via: 'page', depth: 0 }, msg.steps ?? rec.steps, rec.startUrl);
  }
}

async function finish(ctx: Ctx, steps: Step[], startUrl: string) {
  if (!steps.length) return toast(ctx, 'Nothing was recorded');
  let host = '';
  try { host = new URL(startUrl).hostname; } catch { /* ignore */ }
  const title = (await promptText(ctx, `Name this action (${steps.length} step${steps.length === 1 ? '' : 's'})`, host ? `Recorded on ${host}` : 'Recorded action').catch(() => null))?.trim();
  if (!title) return toast(ctx, 'Recording discarded');

  const action = { ...blank('recording'), title, cfg: { steps: stringifySteps(steps), start: 'auto', startUrl } };
  const custom = await getCustom();
  await saveCustom([...custom, action]);

  let combo: string | null = null;
  try { combo = await overlay<string | null>(ctx.tab.id!, 'keycap', { title }); } catch { /* restricted: set it in Settings */ }
  if (combo) {
    const s = await getSettings();
    const clash = findConflict(combo, action.id, s, [...custom, action]);
    if (clash) return toast(ctx, `Saved “${title}”, but ${label(combo)} is used by “${clash}”. Pick a key in Settings → Custom.`, 'err');
    await chrome.storage.sync.set({ keymap: { ...s.keymap, [action.id]: combo } });
    const warn = keyWarnings(combo);
    return toast(ctx, `Saved “${title}” on ${label(combo)}` + (warn.length ? `. Heads up: ${warn[0]}` : ''), warn.length ? 'err' : 'ok');
  }
  await toast(ctx, `Saved “${title}”. Give it a key in Settings → Custom.`);
}

// ---- replay -----------------------------------------------------------------------------------

function waitForLoad(tabId: number, timeout = 15000): Promise<void> {
  return new Promise((resolve) => {
    let sawLoading = false;
    const done = () => { chrome.tabs.onUpdated.removeListener(on); clearTimeout(t1); clearTimeout(t2); resolve(); };
    const on = (id: number, info: { status?: string }) => {
      if (id !== tabId) return;
      if (info.status === 'loading') sawLoading = true;
      if (info.status === 'complete' && sawLoading) done();
    };
    chrome.tabs.onUpdated.addListener(on);
    const t1 = setTimeout(() => { if (!sawLoading) done(); }, 3000); // SPA: no real navigation happened
    const t2 = setTimeout(done, timeout);
  });
}

/** Runs inside the page (serialised by chrome.scripting): find the element (waiting for it) and act. */
async function performStep(s: Step, timeout: number): Promise<string> {
  const norm = (x: string | null | undefined) => (x ?? '').replace(/\s+/g, ' ').trim();
  const shown = (e: Element) => !!((e as HTMLElement).offsetParent || e.getClientRects().length);
  const find = (): HTMLElement | null => {
    let all: Element[] = [];
    try { if (s.sel) all = [...document.querySelectorAll(s.sel)]; } catch { /* invalid selector */ }
    if (all.length === 1) return all[0] as HTMLElement;
    if (s.text) {
      const pool = all.length ? all : [...document.querySelectorAll(s.tag || '*')];
      const hit = pool.find((e) => shown(e) && norm((e as HTMLElement).innerText) === s.text);
      if (hit) return hit as HTMLElement;
    }
    return (all.find(shown) as HTMLElement) ?? null;
  };
  const end = Date.now() + timeout;
  let el = find();
  while (!el && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 100));
    el = find();
  }
  if (!el) return 'missing';
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const fire = (type: string, Ctor: new (t: string, i?: any) => Event = Event, init: object = {}) =>
    el!.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, composed: true, ...init }));

  switch (s.do) {
    case 'click': {
      const r = el.getBoundingClientRect();
      const pos = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, view: window };
      fire('pointerdown', PointerEvent, pos); fire('mousedown', MouseEvent, pos);
      el.focus?.();
      fire('pointerup', PointerEvent, pos); fire('mouseup', MouseEvent, pos);
      el.click();
      return 'ok';
    }
    case 'fill': {
      el.focus();
      const v = s.value ?? '';
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set?.call(el, v);
        fire('input', InputEvent, { inputType: 'insertText', data: v });
        fire('change');
      } else if (el.isContentEditable) {
        document.getSelection()?.selectAllChildren(el);
        document.execCommand('insertText', false, v);
      } else return 'notext';
      return 'ok';
    }
    case 'select': {
      (el as HTMLSelectElement).value = s.value ?? '';
      fire('input'); fire('change');
      return 'ok';
    }
    case 'key': {
      el.focus();
      const init = { key: s.key, code: s.key, bubbles: true, cancelable: true };
      const go = el.dispatchEvent(new KeyboardEvent('keydown', init));
      el.dispatchEvent(new KeyboardEvent('keypress', init));
      el.dispatchEvent(new KeyboardEvent('keyup', init));
      // Synthetic keys have no default action: submit the form ourselves.
      const form = (el as HTMLInputElement).form;
      if (go && s.key === 'Enter' && form && el.localName === 'input') form.requestSubmit();
      return 'ok';
    }
  }
  return 'ok';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Steps must already have template variables filled in. */
export async function replay(ctx: Ctx, steps: Step[], start: string, startUrl: string) {
  let tab = ctx.tab;
  const tabId = tab.id!;
  let sameSite = false;
  try { sameSite = new URL(startUrl).host === new URL(tab.url ?? '').host; } catch { /* ignore */ }
  if (startUrl && (start === 'always' || (start === 'auto' && !sameSite))) {
    const loaded = waitForLoad(tabId);
    tab = await chrome.tabs.update(tabId, { url: startUrl }) ?? tab;
    await loaded;
  }
  for (const [i, s] of steps.entries()) {
    if (s.do === 'wait') { await sleep(s.ms ?? 0); continue; }
    const loaded = s.nav ? waitForLoad(tabId) : null;
    let res: string | undefined;
    try {
      [{ result: res }] = (await chrome.scripting.executeScript({ target: { tabId }, func: performStep, args: [s, 6000] })) as { result: string }[];
    } catch (e) {
      if (!s.nav) throw e; // the page may unload mid-step when the step navigates
    }
    if (res === 'missing') throw new Error(`Step ${i + 1}: couldn't find ${s.text ? `“${s.text}”` : s.sel}`);
    if (res === 'notext') throw new Error(`Step ${i + 1}: that element doesn't accept text`);
    if (loaded) await loaded;
    else await sleep(120); // let the page react before the next step
  }
}

