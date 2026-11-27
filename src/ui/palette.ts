// Command palette component, shared by the in-page Shadow-DOM overlay and the toolbar popup.

import { search } from '../lib/fuzzy';
import type { PItem } from '../lib/items';

export const PALETTE_CSS = `
.klv-pal{display:flex;flex-direction:column;width:100%;max-height:100%;font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--fg);background:var(--bg);overflow:hidden}
.klv-in{all:unset;box-sizing:border-box;width:100%;padding:14px 16px;font-size:16px;border-bottom:1px solid var(--line);color:var(--fg)}
.klv-in::placeholder{color:var(--mut)}
.klv-ls{list-style:none;margin:0;padding:6px;overflow-y:auto;flex:1;scrollbar-width:thin}
.klv-it{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;white-space:nowrap}
.klv-it[aria-selected=true]{background:var(--sel)}
.klv-it.off{opacity:.45;cursor:default}
.klv-t{flex:1;overflow:hidden;text-overflow:ellipsis}
.klv-r{font-size:12px;color:var(--mut);overflow:hidden;text-overflow:ellipsis;max-width:45%}
.klv-c{font-size:11px;color:var(--mut);min-width:48px}
kbd{font:11px/1 ui-monospace,Consolas,monospace;padding:3px 6px;border:1px solid var(--line);border-bottom-width:2px;border-radius:5px;color:var(--fg);background:var(--kbd)}
.klv-empty{padding:18px;text-align:center;color:var(--mut)}
`;

export const THEME_CSS = `
:host,:root{--bg:#fff;--fg:#1d1d1f;--mut:#6e6e73;--line:#e3e3e8;--sel:#ecebff;--kbd:#f6f6f8;--acc:#5b4cf0;--err:#d0312d;--ok:#1f8a4c}
@media (prefers-color-scheme:dark){:host,:root{--bg:#1e1e22;--fg:#f2f2f5;--mut:#9a9aa3;--line:#34343b;--sel:#34305c;--kbd:#2a2a30;--acc:#8f84ff;--err:#ff6b66;--ok:#4cc584}}
`;

export interface Palette { el: HTMLElement; key(e: KeyboardEvent): void; focus(): void }

export function createPalette(doc: Document, items: PItem[], onRun: (id: string) => void, onClose: () => void): Palette {
  const el = doc.createElement('div');
  el.className = 'klv-pal';
  const input = doc.createElement('input');
  input.className = 'klv-in';
  input.placeholder = 'Type a command…';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Search Klavio actions');
  const list = doc.createElement('ul');
  list.className = 'klv-ls';
  list.setAttribute('role', 'listbox');
  el.append(input, list);

  let shown: PItem[] = items;
  let sel = 0;

  const paint = () => {
    const frag = doc.createDocumentFragment();
    shown.forEach((it, i) => {
      const li = doc.createElement('li');
      li.className = 'klv-it' + (it.off ? ' off' : '');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === sel));
      li.dataset.i = String(i);
      const c = doc.createElement('span'); c.className = 'klv-c'; c.textContent = it.cat;
      const t = doc.createElement('span'); t.className = 'klv-t'; t.textContent = it.title;
      li.append(c, t);
      if (it.off) {
        const r = doc.createElement('span'); r.className = 'klv-r'; r.textContent = it.off; li.append(r);
      } else if (it.key) {
        const k = doc.createElement('kbd'); k.textContent = it.key; li.append(k);
      }
      frag.append(li);
    });
    if (!shown.length) {
      const li = doc.createElement('li'); li.className = 'klv-empty'; li.textContent = 'No matching actions'; frag.append(li);
    }
    list.replaceChildren(frag);
  };

  const move = (to: number) => {
    if (!shown.length) return;
    const prev = list.children[sel] as HTMLElement | undefined;
    sel = (to + shown.length) % shown.length;
    prev?.setAttribute('aria-selected', 'false');
    const cur = list.children[sel] as HTMLElement;
    cur.setAttribute('aria-selected', 'true');
    cur.scrollIntoView({ block: 'nearest' });
  };

  const run = (i: number) => {
    const it = shown[i];
    if (it && !it.off) onRun(it.id);
  };

  input.addEventListener('input', () => {
    shown = search(items, input.value, (i) => [i.title, `${i.kw ?? ''} ${i.cat} ${i.id}`], (i) => (i.off ? -500 : 0));
    sel = 0;
    paint();
  });
  list.addEventListener('mousemove', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('.klv-it');
    if (li && +li.dataset.i! !== sel) move(+li.dataset.i!);
  });
  list.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('.klv-it');
    if (li) run(+li.dataset.i!);
  });

  const key = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown': move(sel + 1); break;
      case 'ArrowUp': move(sel - 1); break;
      case 'PageDown': move(Math.min(sel + 8, shown.length - 1)); break;
      case 'PageUp': move(Math.max(sel - 8, 0)); break;
      case 'Enter': run(sel); break;
      case 'Escape': onClose(); break;
      default: return;
    }
    e.preventDefault();
  };

  paint();
  return { el, key, focus: () => input.focus() };
}
