// Tiny fuzzy matcher (replaces Fuse.js: ~40 lines instead of ~25 KB).
// Scores substring hits highest, then subsequence matches with word-start and adjacency bonuses.

function scoreOne(q: string, text: string): number {
  if (!q) return 1;
  const idx = text.indexOf(q);
  if (idx >= 0) {
    const wordStart = idx === 0 || /[\s\-_./([]/.test(text[idx - 1]);
    return 1000 - idx + (wordStart ? 200 : 0) + (q.length === text.length ? 300 : 0);
  }
  let score = 0, ti = 0, prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    const found = text.indexOf(ch, ti);
    if (found < 0) return 0;
    const wordStart = found === 0 || /[\s\-_./([]/.test(text[found - 1]);
    score += 10 + (found === prev + 1 ? 15 : 0) + (wordStart ? 25 : 0) - Math.min(found - ti, 10);
    prev = found;
    ti = found + 1;
  }
  return Math.max(score, 1);
}

/** Every whitespace-separated token must match the title or the keywords. */
export function score(query: string, title: string, keywords = ''): number {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 1;
  const t = title.toLowerCase();
  const k = keywords.toLowerCase();
  let total = 0;
  for (const tok of tokens) {
    const s = Math.max(scoreOne(tok, t) * 1.5, scoreOne(tok, k));
    if (!s) return 0;
    total += s;
  }
  return total;
}

export function search<T>(items: T[], query: string, fields: (t: T) => [string, string?], boost: (t: T) => number = () => 0): T[] {
  if (!query.trim()) return items;
  const scored: [T, number][] = [];
  for (const it of items) {
    const [title, kw] = fields(it);
    const s = score(query, title, kw);
    if (s > 0) scored.push([it, s + boost(it)]);
  }
  return scored.sort((a, b) => b[1] - a[1]).map((x) => x[0]);
}
