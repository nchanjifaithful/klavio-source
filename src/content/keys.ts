// In-page shortcut layer. Runs at document_start on every page; kept tiny (no UI code here).
// Reads one precomputed key (`compiled`) from storage.local and updates live via storage.onChanged.

import { comboFromEvent, hasStrongModifier } from '../lib/keymap';
import type { Compiled } from '../lib/storage';
import { hostDisabled } from '../lib/sites';

let cfg: Compiled | null = null;
let off = false;
let pending: string | null = null;
let timer = 0;
const reCache = new Map<string, RegExp>();

const apply = (c: Compiled | undefined) => {
  cfg = c ?? null;
  off = !!cfg && hostDisabled(location.hostname, cfg.s);
};

function init() {
  // Skip if this extension instance already injected us; a stale copy from before a reload
  // has a different chrome.runtime and tears itself down on its next key event.
  const g = globalThis as { __klv_keys?: unknown };
  if (g.__klv_keys === chrome.runtime) return;
  g.__klv_keys = chrome.runtime;
  chrome.storage.local.get(['compiled', 'rec']).then((r) => {
    apply(r.compiled as Compiled);
    // A recording is in progress (in some tab): the worker resumes it if it's this tab.
    if (r.rec) chrome.runtime.sendMessage({ type: 'recResume' }).catch(() => {});
  }).catch(() => {});
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ch.compiled) apply(ch.compiled.newValue as Compiled);
  });
  for (const t of ['keydown', 'keyup', 'keypress']) window.addEventListener(t, onKey as EventListener, opts);
}

function editable(el: EventTarget | undefined): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const t = el.localName;
  return t === 'input' || t === 'textarea' || t === 'select' || el.isContentEditable;
}

function resolve(combo: string): string | null {
  const cands = cfg!.m[combo];
  if (!cands) return null;
  const href = location.href;
  for (const [id, re] of cands) {
    if (!re) return id;
    let rx = reCache.get(re);
    if (!rx) { try { rx = new RegExp(re); } catch { continue; } reCache.set(re, rx); }
    if (rx.test(href)) return id;
  }
  return null;
}

function onKey(e: KeyboardEvent) {
  if (!chrome.runtime?.id) { teardown(); return; } // orphaned after the extension was reloaded/removed
  // Keys typed inside Klavio's own overlay: hand them to it and keep them away from page handlers.
  if ((e.target as Element | null)?.localName === 'klavio-root') {
    if (e.type === 'keydown') globalThis.__klv_key?.(e);
    e.stopImmediatePropagation();
    return;
  }
  if (e.type !== 'keydown' || !cfg || off || e.repeat || e.isComposing) return;

  const combo = comboFromEvent(e);
  if (!combo) return;
  const target = e.composedPath()[0];
  if (editable(target) && !hasStrongModifier(combo)) { pending = null; return; }

  let id: string | null = null;
  if (pending) {
    id = resolve(pending + ' ' + combo);
    pending = null;
    clearTimeout(timer);
    if (!id) return;
  } else {
    id = resolve(combo);
    if (!id && cfg.c && cfg.p.includes(combo)) {
      pending = combo;
      timer = setTimeout(() => (pending = null), 1000) as unknown as number;
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
  }
  if (!id) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  chrome.runtime.sendMessage({ type: 'run', id, via: 'page' }).catch(() => {});
}

const opts = { capture: true };
function teardown() {
  for (const t of ['keydown', 'keyup', 'keypress']) window.removeEventListener(t, onKey as EventListener, opts);
}
init();
