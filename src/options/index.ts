// Settings page: Shortcuts, Sites, Actions, Custom, Backup.

import { ACTIONS, type Category, META, SLOT_IDS } from '../actions/meta';
import { chromeWarning, findConflict } from '../lib/conflicts';
import { blank, DANGEROUS, describeDanger, parsePack, TYPES, type CustomAction, type CustomType, type Field } from '../lib/custom';
import { comboFromEvent, hasModifier, label } from '../lib/keymap';
import { PERM_LABELS, permsFor, requestPerms } from '../lib/permissions';
import { pageVars, render, varsIn } from '../lib/template';
import { describeStep, parseSteps } from '../lib/recording';
import { DEFAULT_OPTS, effectiveKey, getCustom, getSettings, saveCustom, type Settings, SYNC_KEYS } from '../lib/storage';

let S: Settings;
let C: CustomAction[] = [];
let chromeKeys: Record<string, string> = {};

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: (Node | string | null | false | undefined)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el && typeof v !== 'string') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c != null && c !== false) el.append(c);
  return el;
}

function flash(msg: string, kind: 'ok' | 'err' = 'ok') {
  const t = h('div', { class: `flash ${kind}` }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

const saveSync = (patch: Partial<Settings>) => {
  Object.assign(S, patch);
  return chrome.storage.sync.set(patch);
};

async function load() {
  [S, C] = await Promise.all([getSettings(), getCustom()]);
  const cmds = await chrome.commands.getAll();
  chromeKeys = Object.fromEntries(cmds.map((c) => [c.name!, c.shortcut ?? '']));
}

// ------------------------------------------------------------------------------------------------
// Key recorder
// ------------------------------------------------------------------------------------------------

let recording: (() => void) | null = null;

/** Records a combo (or a chord "A then B" when chords are on). Resolves null on Esc, '' on Backspace. */
function recordKey(btn: HTMLElement): Promise<string | null> {
  recording?.();
  return new Promise((resolve) => {
    const prev = btn.textContent;
    btn.textContent = 'Press keys… (Esc cancel, ⌫ clear)';
    btn.classList.add('rec');
    let first: string | null = null;
    let timer = 0;
    const finish = (v: string | null) => {
      document.removeEventListener('keydown', onKey, true);
      clearTimeout(timer);
      btn.classList.remove('rec');
      btn.textContent = prev;
      recording = null;
      resolve(v);
    };
    recording = () => finish(null);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!first && e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) return finish(null);
      if (!first && (e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey && !e.shiftKey) return finish('');
      const c = comboFromEvent(e);
      if (!c) return;
      if (first) return finish(first + ' ' + c);
      if (!hasModifier(c) && !S.opts.singleKey) { btn.textContent = 'Add Ctrl, Alt or Shift (or enable single-key mode)'; return; }
      if (S.opts.chords) {
        first = c;
        btn.textContent = `${label(c)} then… (wait to keep)`;
        timer = setTimeout(() => finish(first), 1000) as unknown as number;
      } else finish(c);
    };
    document.addEventListener('keydown', onKey, true);
  });
}

/** Validate + store a key for an action. Returns an inline message (error or warning) or ''. */
async function setKey(id: string, combo: string | null, scope?: string[]): Promise<{ ok: boolean; msg: string }> {
  if (combo) {
    const clash = findConflict(combo, id, S, C, scope);
    if (clash) return { ok: false, msg: `Already used by “${clash}”.` };
  }
  const keymap = { ...S.keymap };
  if (META[id] && combo === (META[id].key ?? null)) delete keymap[id];
  else keymap[id] = combo;
  await saveSync({ keymap });
  return { ok: true, msg: (combo && chromeWarning(combo.split(' ')[0])) || '' };
}

function keyCell(id: string, getScope?: () => string[] | undefined, onChange?: () => void) {
  const current = META[id] ? effectiveKey(id, S) : S.keymap[id] ?? null;
  const msg = h('div', { class: 'kmsg' });
  const b = h('button', { class: 'key', title: 'Click to record a new combo' }, current ? label(current) : '—');
  b.addEventListener('click', async () => {
    const c = await recordKey(b);
    if (c === null) return;
    const r = await setKey(id, c || null, getScope?.());
    msg.textContent = r.msg;
    msg.className = 'kmsg ' + (r.ok ? 'warn' : 'err');
    if (r.ok) { b.textContent = c ? label(c) : '—'; onChange?.(); }
  });
  return h('div', { class: 'kcell' }, b, msg);
}

const editInChrome = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });

// ------------------------------------------------------------------------------------------------
// Shortcuts tab
// ------------------------------------------------------------------------------------------------

function shortcutsTab() {
  const q = h('input', { type: 'search', placeholder: 'Search actions…', class: 'txt' });
  const cats: (Category | 'All')[] = ['All', 'General', 'Page', 'Tab', 'Open', 'Data', 'Custom'];
  const cat = h('select', { class: 'txt' }, ...cats.map((c) => h('option', { value: c }, c)));
  const tbody = h('tbody');

  const rows = () => {
    const needle = q.value.toLowerCase().trim();
    const all = [
      ...ACTIONS.map((a) => ({ id: a.id, title: a.title, cat: a.category as string, off: a.unsupported, kw: a.keywords ?? '' })),
      ...C.map((c) => ({ id: c.id, title: c.title, cat: 'Custom', off: undefined, kw: c.type })),
    ];
    tbody.replaceChildren(...all
      .filter((r) => (cat.value === 'All' || r.cat === cat.value) && (!needle || `${r.title} ${r.kw} ${r.id}`.toLowerCase().includes(needle)))
      .map((r) => {
        const ck = META[r.id] ? chromeKeys[r.id] : Object.entries(S.slots).find(([, v]) => v === r.id)?.[0];
        const chromeKey = META[r.id] ? ck : ck ? chromeKeys[ck] : '';
        const enabled = h('input', { type: 'checkbox', checked: !S.disabled.includes(r.id), disabled: !!r.off, title: 'Enabled' });
        enabled.addEventListener('change', () => saveSync({ disabled: enabled.checked ? S.disabled.filter((x) => x !== r.id) : [...S.disabled, r.id] }));
        return h('tr', { class: r.off ? 'off' : '' },
          h('td', {}, h('div', { class: 'ttl' }, r.title), r.off ? h('div', { class: 'reason' }, r.off) : h('div', { class: 'id' }, r.id)),
          h('td', {}, h('span', { class: 'chip' }, r.cat)),
          h('td', {}, r.off ? '—' : keyCell(r.id)),
          h('td', {}, chromeKey ? h('kbd', {}, chromeKey.replace(/\+/g, ' + ')) : h('span', { class: 'mut' }, META[r.id] || ck ? 'Not set' : 'Use a slot'), ' ', !r.off && h('button', { class: 'lnk', onclick: editInChrome }, 'Edit in Chrome')),
          h('td', { class: 'c' }, enabled),
          h('td', {}, META[r.id] && !r.off && h('button', { class: 'lnk', onclick: async () => { const keymap = { ...S.keymap }; delete keymap[r.id]; await saveSync({ keymap }); rows(); } }, 'Reset')),
        );
      }));
  };
  q.addEventListener('input', rows);
  cat.addEventListener('change', rows);
  rows();

  return h('section', {},
    h('div', { class: 'note' },
      h('b', {}, 'Two layers. '),
      'In-page keys (set here) work on normal web pages and apply instantly to open tabs. Content scripts can’t run on chrome:// pages, the New Tab page or the Chrome Web Store, so there use Chrome-level keys (bound at ',
      h('button', { class: 'lnk', onclick: editInChrome }, 'chrome://extensions/shortcuts'), ') or the toolbar palette.'),
    h('div', { class: 'bar' }, q, cat),
    h('table', {}, h('thead', {}, h('tr', {}, ...['Action', 'Category', 'In-page key', 'Chrome-level key', 'On', ''].map((t) => h('th', {}, t)))), tbody),
  );
}

// ------------------------------------------------------------------------------------------------
// Sites tab
// ------------------------------------------------------------------------------------------------

function sitesTab() {
  const list = h('ul', { class: 'sites' });
  const paint = () => list.replaceChildren(...(S.sites.length ? S.sites.map((d) => h('li', {}, h('span', {}, d), h('button', { class: 'lnk', onclick: async () => { await saveSync({ sites: S.sites.filter((x) => x !== d) }); paint(); } }, 'Remove'))) : [h('li', { class: 'mut' }, 'No sites disabled.')]));
  const input = h('input', { class: 'txt', placeholder: 'docs.google.com' });
  const add = async () => {
    let v = input.value.trim().toLowerCase();
    try { if (v.includes('/')) v = new URL(v.includes('://') ? v : 'https://' + v).hostname; } catch { /* keep */ }
    if (!v || S.sites.includes(v)) return;
    await saveSync({ sites: [...S.sites, v] });
    input.value = '';
    paint();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  paint();
  return h('section', {},
    h('p', { class: 'note' }, 'In-page shortcuts are turned off on these sites (and their subdomains). Chrome-level keys and the toolbar palette keep working. Tip: “Disable on this site” in the toolbar popup adds the current site in one click.'),
    h('div', { class: 'bar' }, input, h('button', { class: 'pri', onclick: add }, 'Add site')),
    list,
  );
}

// ------------------------------------------------------------------------------------------------
// Actions tab
// ------------------------------------------------------------------------------------------------

function actionsTab() {
  const opt = <K extends keyof Settings['opts']>(k: K, labelText: string, control: HTMLInputElement | HTMLSelectElement, hint = '') => {
    const v = S.opts[k];
    if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = !!v;
    else control.value = String(v);
    control.addEventListener('change', () => {
      const raw = control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked : control.value;
      const val = typeof DEFAULT_OPTS[k] === 'number' ? Number(raw) : raw;
      void saveSync({ opts: { ...S.opts, [k]: val } });
    });
    return h('label', { class: 'opt' }, h('span', {}, labelText, hint && h('small', {}, hint)), control);
  };
  const sel = (pairs: [string, string][]) => h('select', { class: 'txt' }, ...pairs.map(([v, t]) => h('option', { value: v }, t)));
  const folder = sel([['', 'Other bookmarks (default)']]);
  const folderBox = h('div', {});
  chrome.permissions.contains({ permissions: ['bookmarks'] }).then(async (has) => {
    if (!has) {
      folderBox.append(h('button', { class: 'lnk', onclick: async () => { if (await requestPerms(['bookmarks'])) location.reload(); } }, 'Allow bookmarks access to pick a folder'));
      return;
    }
    const walk = (nodes: chrome.bookmarks.BookmarkTreeNode[], depth: number) => {
      for (const n of nodes) if (!n.url) {
        if (n.id !== '0') folder.append(h('option', { value: n.id }, '  '.repeat(depth) + (n.title || 'Untitled')));
        if (n.children) walk(n.children, depth + 1);
      }
    };
    walk(await chrome.bookmarks.getTree(), 0);
    folder.value = S.opts.bookmarkFolder;
  });

  return h('section', { class: 'opts' },
    h('h3', {}, 'QR code'),
    opt('qrSize', 'Image size', sel([['256', '256 px'], ['512', '512 px'], ['1024', '1024 px']])),
    opt('qrEcl', 'Error correction', sel([['L', 'Low (7%) — longest URLs'], ['M', 'Medium (15%)'], ['Q', 'Quartile (25%)'], ['H', 'High (30%)']])),
    h('h3', {}, 'Screenshot'),
    opt('shotFormat', 'Format', sel([['png', 'PNG'], ['jpeg', 'JPEG']])),
    opt('shotQuality', 'JPEG quality', h('input', { type: 'number', min: '10', max: '100', class: 'txt' })),
    h('h3', {}, 'Links & tabs'),
    opt('linkFormat', '“Copy as link” format', sel([['markdown', 'Markdown [title](url)'], ['html', 'Rich HTML link'], ['text', 'Plain “title — url”']])),
    opt('closeThreshold', 'Confirm before closing more than', h('input', { type: 'number', min: '0', max: '100', class: 'txt' }), 'tabs'),
    opt('bookmarkFolder', 'Bookmark folder', folder),
    folderBox,
    h('h3', {}, 'Keys'),
    opt('chords', 'Chord sequences (e.g. G then Q)', h('input', { type: 'checkbox' }), '1-second timeout between keys'),
    opt('singleKey', 'Single-key mode', h('input', { type: 'checkbox' }), 'Allow keys without Ctrl/Alt/Shift (ignored while typing)'),
  );
}

// ------------------------------------------------------------------------------------------------
// Custom tab
// ------------------------------------------------------------------------------------------------

async function recentTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({});
  const self = chrome.runtime.getURL('');
  return tabs.filter((t) => t.url && !t.url.startsWith(self)).sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
}

let selected: string | null = null;

function customTab() {
  const wrap = h('section', { class: 'custom' });
  const listEl = h('ul', { class: 'clist' });
  const editor = h('div', { class: 'editor' });
  const fileIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });

  const persist = async () => { await saveCustom(C); paintList(); };

  const paintList = () => {
    listEl.replaceChildren(...(C.length ? C.map((c) => h('li', { class: c.id === selected ? 'sel' : '', onclick: () => { selected = c.id; paintList(); paintEditor(); } },
      h('div', { class: 'ttl' }, c.title, DANGEROUS.includes(c.type) && h('span', { class: 'badge' }, '⚠')),
      h('div', { class: 'mut' }, TYPES[c.type].label + (S.keymap[c.id] ? ` · ${label(S.keymap[c.id])}` : '')))) : [h('li', { class: 'mut empty' }, 'No custom actions yet.')]));
  };

  const paintEditor = async () => {
    const a = C.find((c) => c.id === selected);
    if (!a) { editor.replaceChildren(h('p', { class: 'mut' }, 'Select an action or create a new one.')); return; }
    const def = TYPES[a.type];
    const preview = h('pre', { class: 'preview' });
    const tab = await recentTab();
    const updatePreview = () => {
      const tplFields = def.fields.filter((f) => f.tpl);
      if (!tplFields.length) { preview.textContent = ''; preview.hidden = true; return; }
      preview.hidden = false;
      const vars = { ...pageVars(tab?.url, tab?.title), selection: '«selection»', clipboard: '«clipboard»' };
      for (const v of varsIn(...tplFields.map((f) => a.cfg[f.k]))) if (v.startsWith('prompt:')) (vars as any)[v] = `«${v.slice(7)}»`;
      preview.textContent = 'Preview (' + (tab?.title ?? 'no tab') + '):\n' + tplFields.map((f) => {
        const mode = /url/i.test(f.k) || f.k === 'url' ? 'url' : f.kind === 'code' ? 'json' : 'text';
        return `${f.label}: ${render(a.cfg[f.k] ?? '', vars, mode as any)}`;
      }).join('\n');
    };

    const field = (f: Field) => {
      let ctl: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (f.kind === 'select') ctl = h('select', { class: 'txt' }, ...f.options!.map(([v, t]) => h('option', { value: v }, t)));
      else if (f.kind === 'textarea' || f.kind === 'code' || f.kind === 'macro') ctl = h('textarea', { class: 'txt' + (f.kind !== 'textarea' ? ' code' : ''), rows: f.kind === 'textarea' ? 3 : 5, placeholder: f.ph ?? '', spellcheck: false });
      else if (f.kind === 'ext') {
        ctl = h('select', { class: 'txt' }, h('option', { value: '' }, '— choose an extension —'));
        const s = ctl;
        chrome.permissions.contains({ permissions: ['management'] }).then(async (has) => {
          if (!has) { s.replaceWith(h('button', { class: 'lnk', onclick: async () => { if (await requestPerms(['management'])) paintEditor(); } }, 'Allow “Manage extensions” to pick one')); return; }
          const exts = (await chrome.management.getAll()).filter((x) => x.type === 'extension' && x.id !== chrome.runtime.id).sort((x, y) => x.name.localeCompare(y.name));
          s.append(...exts.map((x) => h('option', { value: x.id }, `${x.name}${x.enabled ? '' : ' (disabled)'}`)));
          s.value = a.cfg[f.k] ?? '';
        });
      } else ctl = h('input', { class: 'txt', placeholder: f.ph ?? '', spellcheck: false });
      ctl.value = a.cfg[f.k] ?? '';
      ctl.addEventListener('input', () => { a.cfg[f.k] = ctl.value; updatePreview(); });
      ctl.addEventListener('change', () => { a.cfg[f.k] = ctl.value; void persist(); });
      const extra = f.kind === 'macro'
        ? h('select', { class: 'txt', onchange: (e: Event) => { const s = e.target as HTMLSelectElement; if (s.value) { ctl.value = (ctl.value.trim() ? ctl.value.trim() + '\n' : '') + s.value; a.cfg[f.k] = ctl.value; void persist(); s.value = ''; } } },
          h('option', { value: '' }, '+ add step…'), h('option', { value: 'wait 500' }, 'wait 500 ms'),
          ...ACTIONS.filter((x) => !x.unsupported && x.id !== 'palette.open').map((x) => h('option', { value: x.id }, x.title)),
          ...C.filter((x) => x.id !== a.id).map((x) => h('option', { value: x.id }, `${x.title} (custom)`)))
        : null;
      return h('label', { class: 'fld' }, h('span', {}, f.label), ctl, extra, f.hint && h('small', {}, f.hint));
    };

    const typeSel = h('select', { class: 'txt' }, ...(Object.keys(TYPES) as CustomType[]).map((t) => h('option', { value: t }, TYPES[t].label)));
    typeSel.value = a.type;
    typeSel.addEventListener('change', async () => {
      const fresh = blank(typeSel.value as CustomType);
      a.type = fresh.type;
      a.cfg = { ...fresh.cfg };
      if (Object.values(TYPES).some((t) => t.label === a.title)) a.title = fresh.title;
      await persist();
      paintEditor();
    });
    const title = h('input', { class: 'txt', value: a.title });
    title.addEventListener('change', () => { a.title = title.value.trim() || def.label; void persist(); });
    const scope = h('input', { class: 'txt', placeholder: 'All sites — or patterns like *://github.com/*, comma separated', value: (a.scope ?? []).join(', ') });
    scope.addEventListener('change', () => { a.scope = scope.value.split(',').map((s) => s.trim()).filter(Boolean); void persist(); });

    const slotSel = h('select', { class: 'txt' }, h('option', { value: '' }, 'None'), ...SLOT_IDS.map((sid, i) => {
      const used = S.slots[sid] && S.slots[sid] !== a.id ? C.find((c) => c.id === S.slots[sid])?.title : '';
      return h('option', { value: sid }, `Slot ${i + 1}${chromeKeys[sid] ? ` (${chromeKeys[sid]})` : ' (no key yet)'}${used ? ` — used by ${used}` : ''}`);
    }));
    slotSel.value = Object.entries(S.slots).find(([, v]) => v === a.id)?.[0] ?? '';
    slotSel.addEventListener('change', async () => {
      const slots = Object.fromEntries(Object.entries(S.slots).filter(([, v]) => v !== a.id));
      if (slotSel.value) slots[slotSel.value] = a.id;
      await saveSync({ slots });
      flash(slotSel.value ? 'Slot assigned. Bind its key at chrome://extensions/shortcuts.' : 'Slot cleared');
    });

    const perms = permsFor(a.id, C, 0, a);
    const userScriptsInfo = h('div', {});
    if (a.type === 'js') {
      let ok = false;
      try { ok = !!chrome.userScripts && (await chrome.userScripts.getScripts().then(() => true)); } catch { ok = false; }
      userScriptsInfo.append(h('div', { class: ok ? 'note okc' : 'note warnc' }, ok ? '“Allow User Scripts” is on.' : h('span', {},
        'Run JavaScript needs “Allow User Scripts”: open ', h('button', { class: 'lnk', onclick: () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }) }, 'Klavio’s details page'),
        ', turn on “Allow User Scripts”, then reopen this tab.', !chrome.userScripts && ' (You may also need to grant the User scripts permission with “Test now”.)')));
    }

    editor.replaceChildren(
      h('div', { class: 'ehead' }, h('h3', {}, a.title), def.danger && h('span', { class: 'danger' }, '⚠ ' + def.danger)),
      h('p', { class: 'mut' }, def.desc),
      h('label', { class: 'fld' }, h('span', {}, 'Type'), typeSel),
      h('label', { class: 'fld' }, h('span', {}, 'Name'), title),
      ...def.fields.map(field),
      userScriptsInfo,
      a.type === 'recording' ? stepList(a.cfg.steps) : '',
      preview,
      h('label', { class: 'fld' }, h('span', {}, 'Scope'), scope),
      h('div', { class: 'fld' }, h('span', {}, 'In-page key'), keyCell(a.id, () => a.scope, paintList)),
      h('label', { class: 'fld' }, h('span', {}, 'Global key slot'), slotSel),
      perms.length ? h('p', { class: 'mut' }, `Needs: ${perms.map((p) => PERM_LABELS[p] ?? p).join(', ')} (asked on first use).`) : '',
      h('div', { class: 'row' },
        h('button', { class: 'pri', onclick: async () => {
          await persist();
          if (perms.length && !(await requestPerms(perms).catch(() => false))) return flash('Permission not granted', 'err');
          const t = await recentTab();
          if (!t) return flash('Open a tab to test on', 'err');
          await chrome.tabs.update(t.id!, { active: true });
          await chrome.windows.update(t.windowId, { focused: true });
          await chrome.runtime.sendMessage({ type: 'run', id: a.id, tabId: t.id, via: 'test', draft: a });
        } }, 'Test now'),
        h('button', { onclick: async () => { const d = structuredClone(a); d.id = blank().id; d.title += ' copy'; C.push(d); selected = d.id; await persist(); paintEditor(); } }, 'Duplicate'),
        h('button', { onclick: () => exportPack([a]) }, 'Export'),
        h('button', { class: 'dangerbtn', onclick: async () => {
          if (!confirm(`Delete “${a.title}”?`)) return;
          C = C.filter((c) => c.id !== a.id);
          const keymap = { ...S.keymap }; delete keymap[a.id];
          const slots = Object.fromEntries(Object.entries(S.slots).filter(([, v]) => v !== a.id));
          await saveSync({ keymap, slots });
          selected = C[0]?.id ?? null;
          await persist();
          paintEditor();
        } }, 'Delete'),
      ),
    );
    updatePreview();
  };

  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0];
    fileIn.value = '';
    if (!f) return;
    try {
      const pack = parsePack(await f.text());
      const risky = pack.map(describeDanger).filter(Boolean);
      if (risky.length && !confirm(`This pack contains actions that can run code or send data:\n\n${risky.join('\n\n')}\n\nImport anyway?`)) return;
      const ids = new Set(C.map((c) => c.id));
      for (const a of pack) { if (ids.has(a.id)) a.id = blank().id; C.push(a); }
      selected = pack[0]?.id ?? selected;
      await persist();
      paintEditor();
      flash(`Imported ${pack.length} action${pack.length === 1 ? '' : 's'}`);
    } catch (e) {
      flash(`Import failed: ${(e as Error).message}`, 'err');
    }
  });

  const newSel = h('select', { class: 'txt' }, h('option', { value: '' }, '+ New action…'), ...(Object.keys(TYPES) as CustomType[]).map((t) => h('option', { value: t }, TYPES[t].label)));
  newSel.addEventListener('change', async () => {
    if (!newSel.value) return;
    const a = blank(newSel.value as CustomType);
    newSel.value = '';
    C.push(a);
    selected = a.id;
    await persist();
    paintEditor();
  });

  selected ??= C[0]?.id ?? null;
  paintList();
  void paintEditor();
  wrap.append(
    h('div', { class: 'side' },
      h('div', { class: 'bar' }, newSel, h('button', { class: 'pri', title: 'Record clicks and typing on your most recent tab', onclick: startRecord }, '● Record on a page')),
      listEl,
      h('div', { class: 'bar' }, h('button', { onclick: () => exportPack(C) }, 'Export all'), h('button', { onclick: () => fileIn.click() }, 'Import'), fileIn),
      h('p', { class: 'mut small' }, 'Variables: {url} {urlEncoded} {title} {domain} {origin} {path} {selection} {clipboard} {date} {time} {prompt:Label}'),
    ),
    editor,
  );
  return wrap;
}

function stepList(src: string) {
  try {
    const steps = parseSteps(src);
    return h('ol', { class: 'steps' }, ...steps.map((s) => h('li', {}, describeStep(s), s.nav ? h('span', { class: 'mut' }, ' → waits for page load') : '')));
  } catch (e) {
    return h('p', { class: 'kmsg err' }, `Steps can't be read: ${(e as Error).message}`);
  }
}

async function startRecord() {
  const t = await recentTab();
  if (!t?.url || !/^(https?|file):/.test(t.url)) return flash('Open the web page you want to record in another tab first', 'err');
  await chrome.tabs.update(t.id!, { active: true });
  await chrome.windows.update(t.windowId, { focused: true });
  await chrome.runtime.sendMessage({ type: 'run', id: 'record.start', tabId: t.id, via: 'popup' });
}

function saveJson(obj: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  const a = h('a', { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const exportPack = (actions: CustomAction[]) => saveJson({ klavio: 1, actions }, `klavio-actions-${new Date().toISOString().slice(0, 10)}.json`);

// ------------------------------------------------------------------------------------------------
// Backup tab
// ------------------------------------------------------------------------------------------------

function backupTab() {
  const fileIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0];
    fileIn.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data?.klavio !== 1 || typeof data.settings !== 'object') throw new Error('Not a Klavio backup');
      const patch: Record<string, unknown> = {};
      for (const k of SYNC_KEYS) if (k in data.settings) patch[k] = data.settings[k];
      let custom: CustomAction[] | null = null;
      if (Array.isArray(data.actions)) {
        custom = parsePack(JSON.stringify({ actions: data.actions }));
        const risky = custom.map(describeDanger).filter(Boolean);
        if (risky.length && !confirm(`This backup contains actions that can run code or send data:\n\n${risky.join('\n\n')}\n\nImport anyway?`)) return;
      }
      await chrome.storage.sync.set(patch);
      if (custom) await saveCustom(custom);
      flash('Backup restored');
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      flash(`Import failed: ${(e as Error).message}`, 'err');
    }
  });
  return h('section', { class: 'opts' },
    h('p', { class: 'note' }, 'Back up your keymap, options, disabled sites, slot assignments and custom actions as plain JSON.'),
    h('div', { class: 'row left' },
      h('button', { class: 'pri', onclick: () => saveJson({ klavio: 1, settings: S, actions: C }, `klavio-backup-${new Date().toISOString().slice(0, 10)}.json`) }, 'Export backup'),
      h('button', { onclick: () => fileIn.click() }, 'Import backup'), fileIn),
    h('h3', {}, 'Reset'),
    h('div', { class: 'row left' },
      h('button', { class: 'dangerbtn', onclick: async () => {
        if (!confirm('Reset all shortcuts and options to defaults? Custom actions are kept.')) return;
        await chrome.storage.sync.clear();
        location.reload();
      } }, 'Reset all to defaults')),
  );
}

// ------------------------------------------------------------------------------------------------

const TABS: [string, string, () => HTMLElement][] = [
  ['shortcuts', 'Shortcuts', shortcutsTab], ['sites', 'Sites', sitesTab], ['actions', 'Actions', actionsTab],
  ['custom', 'Custom', customTab], ['backup', 'Backup', backupTab],
];

function show(id: string) {
  const t = TABS.find((x) => x[0] === id) ?? TABS[0];
  for (const b of document.querySelectorAll('nav button')) b.classList.toggle('on', (b as HTMLElement).dataset.t === t[0]);
  $('main').replaceChildren(t[2]());
  history.replaceState(null, '', '#' + t[0]);
}

(async () => {
  await load();
  $('nav').append(...TABS.map(([id, name]) => h('button', { 'data-t': id, onclick: () => show(id) }, name)));
  show(location.hash.slice(1));
  // Chrome-level shortcuts can change in another tab; refresh when we come back.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && !recording) {
      const before = JSON.stringify(chromeKeys);
      await load();
      if (JSON.stringify(chromeKeys) !== before) show(location.hash.slice(1));
    }
  });
})();
