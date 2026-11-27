// Builds the palette list (built-ins + in-scope custom actions), MRU first.

import { ACTIONS } from '../actions/meta';
import { label } from './keymap';
import { matches } from './pattern';
import { effectiveKey, getCustom, getSettings } from './storage';

export interface PItem { id: string; title: string; cat: string; kw?: string; key?: string; off?: string }

export async function buildItems(url?: string): Promise<PItem[]> {
  const [s, custom, { mru = [] }, cmds] = await Promise.all([
    getSettings(), getCustom(), chrome.storage.local.get('mru'), chrome.commands.getAll(),
  ]);
  const chromeKey: Record<string, string> = {};
  for (const c of cmds) if (c.name && c.shortcut) chromeKey[c.name] = c.shortcut;
  for (const [slot, id] of Object.entries(s.slots)) if (chromeKey[slot]) chromeKey[id] = chromeKey[slot];

  const items: PItem[] = [];
  for (const a of ACTIONS) {
    if (a.id === 'palette.open' || s.disabled.includes(a.id)) continue;
    items.push({
      id: a.id, title: a.title, cat: a.category, kw: a.keywords, off: a.unsupported,
      key: chromeKey[a.id]?.replace(/\+/g, ' + ') || label(effectiveKey(a.id, s)),
    });
  }
  for (const c of custom) {
    if (s.disabled.includes(c.id) || !matches(url, c.scope)) continue;
    items.push({ id: c.id, title: c.title, cat: 'Custom', kw: c.type, key: chromeKey[c.id]?.replace(/\+/g, ' + ') || label(s.keymap[c.id]) });
  }
  const rank = new Map((mru as string[]).map((id, i) => [id, i]));
  const r = (i: PItem) => (rank.has(i.id) ? rank.get(i.id)! : 1e3) + (i.off ? 2e3 : 0);
  return items.map((it, i) => [it, r(it) * 100 + i] as const).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
}
