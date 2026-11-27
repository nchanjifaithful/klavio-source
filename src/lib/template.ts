// Template variables: {url} {urlEncoded} {title} {domain} {origin} {path} {selection} {clipboard} {date} {time} {prompt:Label}

export type Mode = 'url' | 'text' | 'json' | 'html';
export type Vars = Record<string, string>;

const RE = /\{(url|urlEncoded|title|domain|origin|path|selection|clipboard|date|time|prompt:[^}]*)\}/g;
const URL_PARTS = new Set(['url', 'origin', 'path', 'domain']);

export function varsIn(...templates: (string | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const t of templates) if (t) for (const m of t.matchAll(RE)) out.add(m[1]);
  return out;
}

export const promptsIn = (...t: (string | undefined)[]) =>
  [...varsIn(...t)].filter((v) => v.startsWith('prompt:')).map((v) => v.slice(7));

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function render(tpl: string, vars: Vars, mode: Mode = 'text'): string {
  // In URL mode: URL-ish values may sit raw in the path ("https://web.archive.org/web/{url}");
  // anything after the first "?" or "#" (and any free text anywhere) is encoded.
  const qpos = mode === 'url' ? tpl.search(/[?#]/) : -1;
  return tpl.replace(RE, (_, name: string, offset: number) => {
    const v = vars[name] ?? '';
    if (name === 'urlEncoded') return encodeURIComponent(vars.url ?? '');
    switch (mode) {
      case 'url': {
        const inQuery = qpos >= 0 && offset > qpos;
        return !inQuery && URL_PARTS.has(name) ? v : encodeURIComponent(v);
      }
      case 'json': return JSON.stringify(v).slice(1, -1);
      case 'html': return escHtml(v);
      default: return v;
    }
  });
}

export function pageVars(url = '', title = ''): Vars {
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  let u: URL | null = null;
  try { u = new URL(url); } catch { /* not a URL */ }
  return {
    url, title,
    domain: u?.hostname ?? '',
    origin: u && u.origin !== 'null' ? u.origin : '',
    path: u ? u.pathname + u.search + u.hash : '',
    date: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`,
    time: `${p2(d.getHours())}:${p2(d.getMinutes())}`,
  };
}
