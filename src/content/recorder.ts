// In-page action recorder, injected only while recording. Captures trusted clicks, field edits, select
// changes and Enter/Escape presses as replayable steps, with a small floating bar (Undo / Stop / Cancel).
// Steps are sent to the service worker after every change, so a recording survives page navigations
// (keys.js asks the worker to resume it on the next page).

import { pushStep, type Step } from '../lib/recording';

declare global {
  // eslint-disable-next-line no-var
  var __klv_rec: ((init: { steps: Step[] }) => void) | undefined;
}

const OURS = new Set(['klavio-root', 'klavio-rec']);
let steps: Step[] = [];
let active = false;
let host: HTMLElement | null = null;
let count: HTMLElement;

// ---- selectors --------------------------------------------------------------------------------

const cssEsc = (s: string) => CSS.escape(s);
const looksGenerated = (s: string) => /\d{3,}|^[a-f0-9-]{16,}$|^(ember|react|radix|headlessui|mui|:r)/i.test(s);
const unique = (sel: string) => { try { return document.querySelectorAll(sel).length === 1; } catch { return false; } };

function selectorFor(el: Element): string {
  if (el.id && !looksGenerated(el.id) && unique('#' + cssEsc(el.id))) return '#' + cssEsc(el.id);
  const tag = el.localName;
  for (const a of ['data-testid', 'data-test', 'data-qa', 'data-cy', 'name', 'aria-label', 'placeholder', 'title', 'alt']) {
    const v = el.getAttribute(a);
    if (v && v.length < 80) {
      const sel = `${tag}[${a}="${v.replace(/"/g, '\\"')}"]`;
      if (unique(sel)) return sel;
    }
  }
  if (tag === 'a') {
    const href = el.getAttribute('href');
    if (href && !href.startsWith('javascript:') && href.length < 200) {
      const sel = `a[href="${href.replace(/"/g, '\\"')}"]`;
      if (unique(sel)) return sel;
    }
  }
  // Structural path up to the nearest ancestor with a usable id (or the body).
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.body && cur !== document.documentElement) {
    if (cur !== el && cur.id && !looksGenerated(cur.id)) { parts.unshift('#' + cssEsc(cur.id)); break; }
    const parent: Element | null = cur.parentElement;
    let part = cur.localName;
    if (parent) {
      const same = [...parent.children].filter((c) => c.localName === cur!.localName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
    }
    parts.unshift(part);
    const sel = parts.join(' > ');
    if (unique(sel)) return sel;
    cur = parent;
  }
  return parts.join(' > ');
}

const visibleText = (el: Element) => ((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();

function describe(el: Element): Pick<Step, 'sel' | 'tag' | 'text'> {
  const text = visibleText(el);
  return { sel: selectorFor(el), tag: el.localName, text: text && text.length <= 60 ? text : undefined };
}

// ---- capture ----------------------------------------------------------------------------------

const target = (e: Event) => {
  const path = e.composedPath();
  if (path.some((n) => n instanceof Element && OURS.has(n.localName))) return null;
  const t = path[0];
  return t instanceof Element ? t : null;
};

const isTextField = (el: Element): el is HTMLInputElement | HTMLTextAreaElement =>
  el.localName === 'textarea' || (el.localName === 'input' && !/^(button|submit|reset|checkbox|radio|file|image|range|color)$/i.test((el as HTMLInputElement).type));

function fieldValue(el: HTMLInputElement | HTMLTextAreaElement): string {
  return el.localName === 'input' && (el as HTMLInputElement).type === 'password' ? '{prompt:Password}' : el.value;
}

function add(st: Step) {
  steps = pushStep(steps, st);
  save();
}

function save() {
  if (count) count.textContent = `${steps.length} step${steps.length === 1 ? '' : 's'}`;
  chrome.runtime.sendMessage({ type: 'recSave', steps }).catch(() => {});
}

const ACTIONABLE = 'a,button,input,select,textarea,label,summary,option,[role=button],[role=link],[role=menuitem],[role=tab],[role=checkbox],[role=option],[onclick],[tabindex]';

function onClick(e: MouseEvent) {
  if (!e.isTrusted) return;
  const t = target(e);
  if (!t || isTextField(t) || t.localName === 'select' || t.localName === 'option') return; // focus clicks; fills are recorded instead
  const el = t.closest(ACTIONABLE) ?? t;
  add({ do: 'click', ...describe(el) });
}

function onChange(e: Event) {
  if (!e.isTrusted) return;
  const t = target(e);
  if (!t) return;
  if (t.localName === 'select') add({ do: 'select', sel: selectorFor(t), value: (t as HTMLSelectElement).value });
  else if (isTextField(t)) add({ do: 'fill', sel: selectorFor(t), value: fieldValue(t) });
}

function onFocusOut(e: FocusEvent) {
  const t = target(e) as HTMLElement | null;
  if (t?.isContentEditable && e.isTrusted) add({ do: 'fill', sel: selectorFor(t), value: t.innerText });
}

function onKey(e: KeyboardEvent) {
  if (!e.isTrusted || (e.key !== 'Enter' && e.key !== 'Escape') || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
  const t = target(e) as HTMLElement | null;
  if (!t) return;
  if (isTextField(t)) {
    if (t.localName === 'textarea' && e.key === 'Enter' && !e.shiftKey) return; // newline, not a submit
    add({ do: 'fill', sel: selectorFor(t), value: fieldValue(t) }); // change hasn't fired yet
    add({ do: 'key', sel: selectorFor(t), key: e.key });
  } else if (t.isContentEditable) {
    add({ do: 'fill', sel: selectorFor(t), value: t.innerText });
    add({ do: 'key', sel: selectorFor(t), key: e.key });
  }
}

const LISTEN: [string, EventListener][] = [
  ['click', onClick as EventListener], ['change', onChange], ['focusout', onFocusOut as EventListener], ['keydown', onKey as EventListener],
];

// ---- bar --------------------------------------------------------------------------------------

function mountBar() {
  host = document.createElement('klavio-rec');
  host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;display:block';
  const root = host.attachShadow({ mode: 'open' }); // open so tests can drive the bar; it holds only buttons
  root.innerHTML = `<style>
    .bar{display:flex;align-items:center;gap:8px;padding:8px 10px 8px 14px;border-radius:999px;background:#1d1d1f;color:#fff;font:13px/1 system-ui,"Segoe UI",sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.3)}
    .dot{width:9px;height:9px;border-radius:50%;background:#ff453a;animation:p 1.2s infinite}
    @keyframes p{50%{opacity:.35}}
    b{font-weight:600}.n{color:#bbb;min-width:52px}
    button{all:unset;cursor:pointer;padding:6px 11px;border-radius:999px;background:#333;color:#fff;font-size:12.5px}
    button:hover{background:#444}button.pri{background:#5b4cf0}button.pri:hover{background:#6d5ff5}
  </style><div class="bar"><span class="dot"></span><b>Recording</b><span class="n"></span>
    <button data-a="undo" title="Remove the last step">Undo</button><button data-a="cancel">Cancel</button><button data-a="stop" class="pri">Stop &amp; save</button></div>`;
  count = root.querySelector('.n')!;
  root.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('button')?.dataset.a;
    if (a === 'undo') { steps = steps.slice(0, -1); save(); }
    else if (a === 'cancel') { stop(); chrome.runtime.sendMessage({ type: 'recCancel' }).catch(() => {}); }
    else if (a === 'stop') { const s = steps; stop(); chrome.runtime.sendMessage({ type: 'recStop', steps: s }).catch(() => {}); }
  });
  document.documentElement.append(host);
}

function stop() {
  active = false;
  for (const [t, f] of LISTEN) window.removeEventListener(t, f, true);
  host?.remove();
  host = null;
}

globalThis.__klv_rec = ({ steps: initial }) => {
  steps = initial ?? [];
  if (active) { save(); return; }
  active = true;
  for (const [t, f] of LISTEN) window.addEventListener(t, f, true);
  mountBar();
  count.textContent = `${steps.length} step${steps.length === 1 ? '' : 's'}`;
};
