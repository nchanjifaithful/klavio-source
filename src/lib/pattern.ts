// URL scope patterns: Chrome match patterns ("*://github.com/*") or plain globs ("*github.com*").

const esc = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

export function patternToRegex(p: string): string {
  p = p.trim();
  if (p === '<all_urls>') return '^(https?|file|ftp)://';
  const m = /^(\*|https?|file|ftp|wss?):\/\/([^/]*)(\/.*)?$/.exec(p);
  if (m) {
    const scheme = m[1] === '*' ? 'https?' : esc(m[1]);
    let host = m[2];
    host = host === '*' ? '[^/]*' : host.startsWith('*.') ? '([^/]*\\.)?' + esc(host.slice(2)) : esc(host);
    const path = (m[3] ?? '/*').split('*').map(esc).join('.*');
    return `^${scheme}://${host}(:\\d+)?${path}$`;
  }
  return '^' + p.split('*').map(esc).join('.*') + (p.endsWith('*') ? '' : '$');
}

export function matches(url: string | undefined, patterns: string[] | undefined): boolean {
  if (!patterns?.length) return true;
  if (!url) return false;
  return patterns.some((p) => {
    try { return new RegExp(patternToRegex(p)).test(url); } catch { return false; }
  });
}

/** Rough specificity: number of literal characters. Global (no scope) = 0. */
export const specificity = (patterns?: string[]) =>
  patterns?.length ? Math.max(...patterns.map((p) => p.replace(/\*/g, '').length)) : 0;
