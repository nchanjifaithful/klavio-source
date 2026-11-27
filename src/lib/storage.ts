// Settings live in chrome.storage.sync (small). Custom action definitions live in chrome.storage.local
// (they can hold large JS/CSS snippets that would blow the 8 KB per-item sync quota).
// The service worker compiles both into `compiled` (storage.local), the only key content scripts read.

import { ACTIONS, META } from '../actions/meta';
import type { CustomAction } from './custom';
import { hasModifier, isSequence } from './keymap';
import { patternToRegex, specificity } from './pattern';

export interface Opts {
  qrSize: number;
  qrEcl: 'L' | 'M' | 'Q' | 'H';
  shotFormat: 'png' | 'jpeg';
  shotQuality: number;
  linkFormat: 'markdown' | 'html' | 'text';
  closeThreshold: number;
  chords: boolean;
  singleKey: boolean;
  bookmarkFolder: string;
}

export interface Settings {
  keymap: Record<string, string | null>; // overrides only; null = unbound
  disabled: string[];
  sites: string[];
  opts: Opts;
  slots: Record<string, string>; // custom.slotN -> custom action id
}

export const DEFAULT_OPTS: Opts = {
  qrSize: 512, qrEcl: 'M', shotFormat: 'png', shotQuality: 92, linkFormat: 'markdown',
  closeThreshold: 5, chords: false, singleKey: false, bookmarkFolder: '',
};

export const SYNC_KEYS = ['keymap', 'disabled', 'sites', 'opts', 'slots'] as const;

export function withDefaults(raw: Partial<Record<string, any>>): Settings {
  return {
    keymap: raw.keymap ?? {},
    disabled: raw.disabled ?? [],
    sites: raw.sites ?? [],
    opts: { ...DEFAULT_OPTS, ...(raw.opts ?? {}) },
    slots: raw.slots ?? {},
  };
}

export const getSettings = async () => withDefaults(await chrome.storage.sync.get([...SYNC_KEYS]));
export const getCustom = async (): Promise<CustomAction[]> => ((await chrome.storage.local.get('custom')).custom as CustomAction[] | undefined) ?? [];
export const saveCustom = (custom: CustomAction[]) => chrome.storage.local.set({ custom });

export function effectiveKey(id: string, s: Settings): string | null {
  return id in s.keymap ? s.keymap[id] : META[id]?.key ?? null;
}

/** [actionId, scopeRegexSource | null, specificity] */
export type Binding = [string, string | null, number];
export interface Compiled {
  m: Record<string, Binding[]>; // combo -> candidates
  p: string[]; // chord prefixes
  s: string[]; // disabled sites
  c: boolean; // chords enabled
}

export function compile(s: Settings, custom: CustomAction[]): Compiled {
  const m: Record<string, Binding[]> = {};
  const add = (combo: string | null, b: Binding) => {
    if (!combo) return;
    if (isSequence(combo) && !s.opts.chords) return;
    if (!isSequence(combo) && !hasModifier(combo) && !s.opts.singleKey) return;
    (m[combo] ??= []).push(b);
  };
  for (const a of ACTIONS) {
    if (a.unsupported || s.disabled.includes(a.id)) continue;
    add(effectiveKey(a.id, s), [a.id, null, 0]);
  }
  for (const c of custom) {
    if (s.disabled.includes(c.id)) continue;
    const re = c.scope?.length ? c.scope.map(patternToRegex).join('|') : null;
    add(s.keymap[c.id] ?? null, [c.id, re, specificity(c.scope)]);
  }
  for (const k in m) m[k].sort((a, b) => b[2] - a[2]);
  const p = s.opts.chords ? [...new Set(Object.keys(m).filter(isSequence).map((k) => k.split(' ')[0]))] : [];
  return { m, p, s: s.sites, c: s.opts.chords };
}

export { hostDisabled } from './sites';

export async function pushMru(id: string) {
  const { mru = [] } = await chrome.storage.local.get('mru');
  const next = [id, ...(mru as string[]).filter((x) => x !== id)].slice(0, 20);
  await chrome.storage.local.set({ mru: next });
}
