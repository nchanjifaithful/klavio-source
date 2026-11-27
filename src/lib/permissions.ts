import { META } from '../actions/meta';
import { macroSteps, TYPES, type CustomAction } from './custom';
import { varsIn } from './template';

export const PERM_LABELS: Record<string, string> = {
  downloads: 'Downloads', sessions: 'Recently closed tabs', bookmarks: 'Bookmarks', tabGroups: 'Tab groups',
  readingList: 'Reading list', pageCapture: 'Page capture', browsingData: 'Browsing data', management: 'Manage extensions',
  userScripts: 'User scripts', clipboardRead: 'Read clipboard',
};

function customPerms(c: CustomAction, all: CustomAction[], depth: number): string[] {
  const out = new Set(TYPES[c.type].perms ?? []);
  if (varsIn(...Object.values(c.cfg)).has('clipboard')) out.add('clipboardRead');
  if (c.type === 'tabset' && c.cfg.group) out.add('tabGroups');
  if (c.type === 'macro' && depth < 5) {
    for (const st of macroSteps(c.cfg.steps)) if (st.id) for (const p of permsFor(st.id, all, depth + 1)) out.add(p);
  }
  return [...out];
}

/** Optional permissions an action needs (union of steps for macros). */
export function permsFor(id: string, custom: CustomAction[], depth = 0, draft?: CustomAction): string[] {
  if (draft) return customPerms(draft, custom, depth);
  if (META[id]) return META[id].perms ?? [];
  const c = custom.find((x) => x.id === id);
  return c ? customPerms(c, custom, depth) : [];
}

export const hasPerms = (permissions: string[]) =>
  permissions.length ? chrome.permissions.contains({ permissions: permissions as chrome.runtime.ManifestPermission[] }) : Promise.resolve(true);

export const requestPerms = (permissions: string[]) =>
  permissions.length ? chrome.permissions.request({ permissions: permissions as chrome.runtime.ManifestPermission[] }) : Promise.resolve(true);
