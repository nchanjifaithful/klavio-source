// Key combos are stored as "Ctrl+Alt+Shift+Meta+<KeyboardEvent.code>" (modifiers in that order).
// A chord sequence is two combos separated by a space: "KeyG KeyQ".

const MOD_CODE = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$|^(CapsLock|Fn|FnLock)$/;

export function comboFromEvent(e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | null {
  const c = e.code;
  if (!c || MOD_CODE.test(c)) return null;
  return (e.ctrlKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + (e.metaKey ? 'Meta+' : '') + c;
}

export const hasModifier = (combo: string) => /^(Ctrl|Alt|Shift|Meta)\+/.test(combo);
/** Ctrl/Alt/Meta make a combo "safe" to fire while typing in a text field. */
export const hasStrongModifier = (combo: string) => /(^|\+)(Ctrl|Alt|Meta)\+/.test(combo);
export const isSequence = (combo: string) => combo.includes(' ');

const NAMES: Record<string, string> = {
  Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Backquote: '`', Space: 'Space', Enter: 'Enter', Escape: 'Esc',
  Backspace: 'Backspace', Tab: 'Tab', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  PageUp: 'PgUp', PageDown: 'PgDn', Delete: 'Del', Insert: 'Ins', IntlBackslash: '\\',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num .', NumpadEnter: 'Num Enter',
};

export function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad') && /\d$/.test(code)) return 'Num ' + code.slice(6);
  return NAMES[code] ?? code;
}

/** "Alt+Shift+KeyQ" → "Alt + Shift + Q"; "KeyG KeyQ" → "G then Q". */
export function label(combo: string | null | undefined): string {
  if (!combo) return '';
  return combo
    .split(' ')
    .map((part) => part.split('+').map((p, i, a) => (i === a.length - 1 ? keyName(p) : p)).join(' + '))
    .join(' then ');
}

/** Convert a chrome.commands shortcut ("Alt+Shift+Q", "Ctrl+Comma") to our combo format when possible. */
export function fromChromeShortcut(s: string): string {
  const parts = s.split('+');
  const k = parts.pop() ?? '';
  const code = /^[A-Z]$/.test(k) ? 'Key' + k : /^\d$/.test(k) ? 'Digit' + k : k;
  const order = ['Ctrl', 'Alt', 'Shift', 'Meta'];
  return [...order.filter((m) => parts.includes(m) || (m === 'Meta' && parts.includes('Command'))), code].join('+');
}
