// Recorded in-page actions: a list of steps captured by the recorder and replayed by the service worker.
// Stored as one JSON object per line so packs stay readable and hand-editable.

export interface Step {
  do: 'click' | 'fill' | 'select' | 'key' | 'wait';
  /** CSS selector for the target element. */
  sel?: string;
  /** Fallback: tag + visible text, used when the selector no longer matches exactly one element. */
  tag?: string;
  text?: string;
  /** fill: text to type (template variables allowed); select: option value. */
  value?: string;
  /** key: KeyboardEvent.key (Enter, Escape, Tab). */
  key?: string;
  /** wait: milliseconds. */
  ms?: number;
  /** The page navigated after this step: replay waits for the new page to load. */
  nav?: boolean;
}

export function parseSteps(s = ''): Step[] {
  const out: Step[] = [];
  for (const line of s.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    const w = /^wait\s+(\d+)$/i.exec(l);
    if (w) { out.push({ do: 'wait', ms: Math.min(+w[1], 60000) }); continue; }
    const st = JSON.parse(l) as Step;
    if (!['click', 'fill', 'select', 'key', 'wait'].includes(st?.do)) throw new Error(`Unknown step: ${l.slice(0, 60)}`);
    out.push(st);
  }
  return out;
}

export const stringifySteps = (steps: Step[]) =>
  steps.map((s) => (s.do === 'wait' ? `wait ${s.ms ?? 0}` : JSON.stringify(s))).join('\n');

const short = (s = '', n = 40) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function describeStep(s: Step): string {
  const target = s.text ? `“${short(s.text, 30)}”` : short(s.sel);
  switch (s.do) {
    case 'click': return `Click ${target}`;
    case 'fill': return `Type “${short(s.value, 30)}” into ${short(s.sel)}`;
    case 'select': return `Choose “${short(s.value, 30)}” in ${short(s.sel)}`;
    case 'key': return `Press ${s.key} in ${short(s.sel)}`;
    default: return `Wait ${s.ms} ms`;
  }
}

/** Append a step, merging repeated fills of the same field and dropping exact duplicates. */
export function pushStep(steps: Step[], st: Step): Step[] {
  const last = steps[steps.length - 1];
  if (last && (st.do === 'fill' || st.do === 'select') && last.do === st.do && last.sel === st.sel) {
    return [...steps.slice(0, -1), { ...last, value: st.value }];
  }
  if (last && st.do === 'fill' && steps.some((x) => x.do === 'fill' && x.sel === st.sel && x.value === st.value) && last.do === 'key' && last.sel === st.sel) {
    return steps; // the change event after Enter repeats the fill we already flushed
  }
  return [...steps, st];
}
