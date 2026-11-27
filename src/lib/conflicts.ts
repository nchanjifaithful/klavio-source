import { ACTIONS } from '../actions/meta';
import type { CustomAction } from './custom';
import type { Settings } from './storage';
import { effectiveKey } from './storage';

/** Combos Chrome (or the OS / common editing) already uses. Warn, don't block. */
export const CHROME_KEYS: Record<string, string> = {
  'Ctrl+KeyT': 'New tab', 'Ctrl+KeyW': 'Close tab', 'Ctrl+Shift+KeyT': 'Reopen closed tab', 'Ctrl+KeyN': 'New window',
  'Ctrl+Shift+KeyN': 'New incognito window', 'Ctrl+KeyL': 'Focus address bar', 'Ctrl+KeyD': 'Bookmark page',
  'Ctrl+KeyP': 'Print', 'Ctrl+KeyU': 'View source', 'Ctrl+KeyF': 'Find', 'Ctrl+KeyG': 'Find next', 'Ctrl+KeyH': 'History',
  'Ctrl+KeyJ': 'Downloads', 'Ctrl+KeyR': 'Reload', 'Ctrl+Shift+KeyR': 'Hard reload', 'Ctrl+KeyS': 'Save page',
  'Ctrl+KeyO': 'Open file', 'Ctrl+KeyE': 'Search', 'Ctrl+KeyK': 'Search', 'Ctrl+Tab': 'Next tab', 'Ctrl+Shift+Tab': 'Previous tab',
  'Ctrl+PageUp': 'Previous tab', 'Ctrl+PageDown': 'Next tab', 'Ctrl+Shift+KeyB': 'Bookmarks bar', 'Ctrl+Shift+KeyO': 'Bookmark manager',
  'Ctrl+Shift+Delete': 'Clear browsing data', 'Ctrl+Shift+KeyI': 'DevTools', 'Ctrl+Shift+KeyJ': 'DevTools console',
  'Ctrl+Shift+KeyC': 'Inspect element', 'Ctrl+Shift+KeyW': 'Close window', 'Ctrl+Shift+KeyQ': 'Quit', 'Ctrl+Equal': 'Zoom in',
  'Ctrl+Minus': 'Zoom out', 'Ctrl+Digit0': 'Reset zoom', 'Ctrl+KeyC': 'Copy', 'Ctrl+KeyV': 'Paste', 'Ctrl+KeyX': 'Cut',
  'Ctrl+KeyA': 'Select all', 'Ctrl+KeyZ': 'Undo', 'Ctrl+KeyY': 'Redo', 'Ctrl+Shift+KeyV': 'Paste as plain text',
  'Alt+KeyF': 'Chrome menu', 'Alt+KeyE': 'Chrome menu', 'Alt+Home': 'Home page', 'Alt+ArrowLeft': 'Back', 'Alt+ArrowRight': 'Forward',
  'Alt+F4': 'Close window', 'Alt+Shift+KeyI': 'Send feedback', 'Alt+Shift+KeyA': 'Accessibility', F5: 'Reload', F6: 'Focus address bar', F11: 'Full screen', F12: 'DevTools',
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`Ctrl+Digit${i + 1}`, `Go to tab ${i + 1}`])),
};

export const chromeWarning = (combo: string) =>
  CHROME_KEYS[combo] ? `Chrome uses this for “${CHROME_KEYS[combo]}”; Chrome may handle it first.` : null;

/** Windows system shortcuts that are taken before Chrome (or a page) ever sees the key. */
export const WINDOWS_KEYS: Record<string, string> = {
  'Alt+Tab': 'Switch windows', 'Alt+Shift+Tab': 'Switch windows', 'Ctrl+Alt+Tab': 'Switch windows', 'Alt+F4': 'Close window',
  'Alt+Escape': 'Cycle windows', 'Alt+Space': 'Window menu', 'Ctrl+Escape': 'Start menu', 'Ctrl+Shift+Escape': 'Task Manager',
  'Ctrl+Alt+Delete': 'Security screen', 'Ctrl+Alt+NumpadDecimal': 'Security screen', PrintScreen: 'Screenshot', 'Alt+PrintScreen': 'Screenshot window',
  'Ctrl+PrintScreen': 'Screenshot', 'Shift+PrintScreen': 'Screenshot', 'Alt+Shift+PrintScreen': 'High contrast', 'Alt+Shift+NumLock': 'Mouse keys',
  'Ctrl+Space': 'Input method (IME) on/off', 'Shift+Space': 'Input method switch (some layouts)', 'Ctrl+Shift+Space': 'Input method (some layouts)',
  'Ctrl+Alt+ArrowUp': 'Rotate screen (some graphics drivers)', 'Ctrl+Alt+ArrowDown': 'Rotate screen (some graphics drivers)',
  'Ctrl+Alt+ArrowLeft': 'Rotate screen (some graphics drivers)', 'Ctrl+Alt+ArrowRight': 'Rotate screen (some graphics drivers)',
  'Ctrl+Shift+Digit0': 'Keyboard layout switch (if enabled)', 'Alt+Shift+Digit0': 'Input language hotkey (if enabled)',
};

export const isWindows = () =>
  /win/i.test((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '');

export function osWarning(combo: string, windows = isWindows()): string | null {
  if (!windows) return null;
  if (/(^|\+)Meta\+/.test(combo)) return 'Windows reserves most Windows-key (⊞) shortcuts; this will likely never reach Chrome.';
  if (WINDOWS_KEYS[combo]) return `Windows uses this for “${WINDOWS_KEYS[combo]}”, so Chrome won't receive it.`;
  if (/(^|\+)Ctrl\+Alt\+/.test(combo)) return 'Ctrl + Alt acts as AltGr on many keyboard layouts (used to type characters like @ € \\); it may type a character instead.';
  return null;
}

const CHROME_BINDABLE = /^(Key[A-Z]|Digit\d|Comma|Period|Home|End|PageUp|PageDown|Space|Insert|Delete|Arrow(Up|Down|Left|Right)|Media\w+)$/;

/** Can this combo be bound at chrome://extensions/shortcuts? (Needs Ctrl or Alt, not both, and a supported key.) */
export function chromeBindable(combo: string): boolean {
  if (combo.includes(' ')) return false;
  const parts = combo.split('+');
  const key = parts.pop()!;
  const ctrl = parts.includes('Ctrl'), alt = parts.includes('Alt');
  return (ctrl || alt) && !(ctrl && alt) && !parts.includes('Meta') && CHROME_BINDABLE.test(key);
}

/** All non-blocking warnings for a combo, most important first. */
export const keyWarnings = (combo: string, windows = isWindows()) =>
  [osWarning(combo.split(' ')[0], windows), chromeWarning(combo.split(' ')[0])].filter((x): x is string => !!x);

const scopeKey = (scope?: string[]) => (scope?.length ? [...scope].sort().join('\n') : '');

/** Returns the title of a Klavio action that already uses `combo` in the same scope, or null. */
export function findConflict(combo: string, forId: string, s: Settings, custom: CustomAction[], forScope?: string[]): string | null {
  const mine = scopeKey(forScope);
  for (const a of ACTIONS) {
    if (a.id !== forId && !a.unsupported && mine === '' && effectiveKey(a.id, s) === combo) return a.title;
  }
  for (const c of custom) {
    if (c.id !== forId && s.keymap[c.id] === combo && scopeKey(c.scope) === mine) return c.title;
  }
  return null;
}
