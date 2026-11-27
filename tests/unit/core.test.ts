import { describe, expect, it } from 'vitest';
import { ACTIONS, META } from '../../src/actions/meta';
import { chromeBindable, chromeWarning, findConflict, keyWarnings, osWarning } from '../../src/lib/conflicts';
import { blank, describeDanger, macroSteps, parsePack, type CustomAction } from '../../src/lib/custom';
import { score, search } from '../../src/lib/fuzzy';
import { comboFromEvent, fromChromeShortcut, hasStrongModifier, label } from '../../src/lib/keymap';
import { matches, patternToRegex, specificity } from '../../src/lib/pattern';
import { permsFor } from '../../src/lib/permissions';
import { compile, effectiveKey, withDefaults } from '../../src/lib/storage';
import { hostDisabled } from '../../src/lib/sites';
import { describeStep, parseSteps, pushStep, stringifySteps, type Step } from '../../src/lib/recording';
import { pageVars, promptsIn, render, varsIn } from '../../src/lib/template';

const ev = (code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) =>
  ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

describe('key matcher', () => {
  it('builds combos from KeyboardEvent.code in fixed modifier order', () => {
    expect(comboFromEvent(ev('KeyQ', { shiftKey: true, altKey: true }))).toBe('Alt+Shift+KeyQ');
    expect(comboFromEvent(ev('Digit0', { ctrlKey: true, shiftKey: true, metaKey: true }))).toBe('Ctrl+Shift+Meta+Digit0');
    expect(comboFromEvent(ev('KeyA'))).toBe('KeyA');
  });
  it('ignores bare modifier presses', () => {
    for (const c of ['ShiftLeft', 'ControlRight', 'AltLeft', 'MetaLeft', 'CapsLock']) expect(comboFromEvent(ev(c, { shiftKey: true }))).toBeNull();
  });
  it('is layout independent (AZERTY "A" key still reports KeyQ)', () => {
    expect(comboFromEvent(ev('KeyQ', { altKey: true }))).toBe('Alt+KeyQ');
  });
  it('labels combos and chords', () => {
    expect(label('Alt+Shift+KeyQ')).toBe('Alt + Shift + Q');
    expect(label('Alt+Shift+Equal')).toBe('Alt + Shift + =');
    expect(label('KeyG KeyQ')).toBe('G then Q');
    expect(label(null)).toBe('');
  });
  it('knows which modifiers are safe inside text fields', () => {
    expect(hasStrongModifier('Alt+KeyQ')).toBe(true);
    expect(hasStrongModifier('Ctrl+Shift+KeyQ')).toBe(true);
    expect(hasStrongModifier('Shift+KeyQ')).toBe(false);
  });
  it('converts chrome.commands shortcuts', () => {
    expect(fromChromeShortcut('Alt+Shift+Q')).toBe('Alt+Shift+KeyQ');
    expect(fromChromeShortcut('Ctrl+5')).toBe('Ctrl+Digit5');
  });
});

describe('fuzzy search', () => {
  const items = ACTIONS.map((a) => ({ id: a.id, title: a.title, kw: a.keywords ?? '' }));
  const top = (q: string) => search(items, q, (i) => [i.title, i.kw])[0]?.id;
  it('ranks obvious matches first', () => {
    expect(top('qr')).toBe('page.qr');
    expect(top('copy url')).toBe('page.copyUrl');
    expect(top('pin')).toBe('tab.pin');
    expect(top('scrn')).toBe('page.screenshot');
    expect(top('mute')).toBe('tab.mute');
  });
  it('matches keywords', () => { expect(top('chromecast')).toBe('page.cast'); });
  it('rejects non-matches', () => { expect(score('zzzz', 'Duplicate tab')).toBe(0); });
  it('returns everything for empty query', () => { expect(search(items, '  ', (i) => [i.title]).length).toBe(items.length); });
});

describe('templates', () => {
  const vars: Record<string, string> = { ...pageVars('https://example.com/a b?x=1#h', 'Hello & "World"'), selection: 'a&b c' };
  it('extracts used variables and prompts', () => {
    expect([...varsIn('{url} {title} {prompt:Name}')]).toEqual(['url', 'title', 'prompt:Name']);
    expect(promptsIn('x {prompt:Tag} {prompt:}')).toEqual(['Tag', '']);
  });
  it('keeps {url} raw in a URL path but encodes in the query', () => {
    expect(render('https://web.archive.org/web/{url}', vars, 'url')).toBe('https://web.archive.org/web/https://example.com/a b?x=1#h');
    expect(render('https://x.test/?u={url}&s={selection}', vars, 'url')).toBe(`https://x.test/?u=${encodeURIComponent(vars.url)}&s=a%26b%20c`);
    expect(render('mailto:?body={url}', vars, 'url')).toBe('mailto:?body=' + encodeURIComponent(vars.url));
  });
  it('escapes for JSON and HTML', () => {
    expect(JSON.parse(render('{"t":"{title}"}', vars, 'json')).t).toBe('Hello & "World"');
    expect(render('<b>{title}</b>', vars, 'html')).toBe('<b>Hello &#38; &#34;World&#34;</b>');
  });
  it('fills page parts', () => {
    expect(vars.domain).toBe('example.com');
    expect(vars.origin).toBe('https://example.com');
    expect(render('{urlEncoded}', vars)).toBe(encodeURIComponent(vars.url));
    expect(vars.date).toMatch(/^\d{4}-\d\d-\d\d$/);
  });
});

describe('scope patterns', () => {
  it('handles Chrome match patterns', () => {
    expect(matches('https://github.com/foo', ['*://github.com/*'])).toBe(true);
    expect(matches('https://gist.github.com/foo', ['*://*.github.com/*'])).toBe(true);
    expect(matches('https://github.com.evil.io/', ['*://github.com/*'])).toBe(false);
    expect(matches('http://localhost:3000/x', ['*://localhost/*'])).toBe(true);
  });
  it('handles plain globs and empty scope', () => {
    expect(matches('https://a.com/docs/1', ['*a.com/docs*'])).toBe(true);
    expect(matches('https://anything', [])).toBe(true);
    expect(new RegExp(patternToRegex('<all_urls>')).test('https://x.y')).toBe(true);
  });
  it('more literal patterns are more specific', () => {
    expect(specificity(['*://github.com/org/*'])).toBeGreaterThan(specificity(['*://github.com/*']));
    expect(specificity([])).toBe(0);
  });
  it('per-site disable matches subdomains', () => {
    expect(hostDisabled('docs.google.com', ['google.com'])).toBe(true);
    expect(hostDisabled('notgoogle.com', ['google.com'])).toBe(false);
  });
});

const custom = (over: Partial<CustomAction>): CustomAction => ({ ...blank('url'), ...over });

describe('conflicts', () => {
  const s = withDefaults({});
  it('blocks a combo already used by another Klavio action', () => {
    expect(findConflict('Alt+Shift+KeyD', 'tab.pin', s, [])).toBe(META['tab.duplicate'].title);
    expect(findConflict('Alt+Shift+KeyD', 'tab.duplicate', s, [])).toBeNull();
    expect(findConflict('Alt+Shift+KeyJ', 'tab.pin', s, [])).toBeNull();
  });
  it('allows the same key for different scopes, blocks for the same scope', () => {
    const a = custom({ id: 'u_a', title: 'A', scope: ['*://github.com/*'] });
    const s2 = withDefaults({ keymap: { u_a: 'Alt+KeyJ' } });
    expect(findConflict('Alt+KeyJ', 'u_b', s2, [a], ['*://gitlab.com/*'])).toBeNull();
    expect(findConflict('Alt+KeyJ', 'u_b', s2, [a], ['*://github.com/*'])).toBe('A');
    expect(findConflict('Alt+Shift+KeyQ', 'u_b', s2, [a], ['*://github.com/*'])).toBeNull(); // scoped beats global
  });
  it('warns on Windows system shortcuts (only on Windows)', () => {
    expect(osWarning('Alt+Tab', true)).toMatch(/Switch windows/);
    expect(osWarning('Ctrl+Shift+Escape', true)).toMatch(/Task Manager/);
    expect(osWarning('Meta+KeyE', true)).toMatch(/Windows-key/);
    expect(osWarning('Ctrl+Alt+KeyQ', true)).toMatch(/AltGr/);
    expect(osWarning('Alt+Shift+KeyQ', true)).toBeNull();
    expect(osWarning('Alt+Tab', false)).toBeNull();
    expect(keyWarnings('Ctrl+KeyT', true)).toHaveLength(1);
  });
  it('knows which combos Chrome can bind at chrome://extensions/shortcuts', () => {
    expect(chromeBindable('Alt+Shift+Digit1')).toBe(true);
    expect(chromeBindable('Ctrl+Shift+KeyK')).toBe(true);
    expect(chromeBindable('Ctrl+Shift+Semicolon')).toBe(false);
    expect(chromeBindable('Ctrl+Numpad4')).toBe(false);
    expect(chromeBindable('Ctrl+Alt+KeyK')).toBe(false);
    expect(chromeBindable('Shift+KeyK')).toBe(false);
  });
  it('warns on Chrome combos', () => {
    expect(chromeWarning('Ctrl+KeyT')).toMatch(/New tab/);
    expect(chromeWarning('Alt+Shift+KeyQ')).toBeNull();
  });
});

describe('keymap compile', () => {
  it('includes defaults, overrides and unbinds', () => {
    const s = withDefaults({ keymap: { 'tab.pin': 'Ctrl+Alt+KeyP', 'tab.mute': null } });
    const c = compile(s, []);
    expect(c.m['Alt+Shift+KeyQ'][0][0]).toBe('page.qr');
    expect(c.m['Ctrl+Alt+KeyP'][0][0]).toBe('tab.pin');
    expect(c.m['Alt+Shift+KeyI']).toBeUndefined();
    expect(Object.values(c.m).flat().some((b) => b[0] === 'tab.mute')).toBe(false);
    expect(effectiveKey('tab.duplicate', s)).toBe('Alt+Shift+KeyD');
  });
  it('drops disabled actions, single keys (unless enabled) and chords (unless enabled)', () => {
    const cs = [custom({ id: 'u_1' }), custom({ id: 'u_2' })];
    const base = { keymap: { u_1: 'KeyJ', u_2: 'KeyG KeyQ' }, disabled: ['page.qr'] };
    let c = compile(withDefaults(base), cs);
    expect(c.m['Alt+Shift+KeyQ']).toBeUndefined();
    expect(c.m.KeyJ).toBeUndefined();
    expect(c.m['KeyG KeyQ']).toBeUndefined();
    c = compile(withDefaults({ ...base, opts: { chords: true, singleKey: true } }), cs);
    expect(c.m.KeyJ[0][0]).toBe('u_1');
    expect(c.m['KeyG KeyQ'][0][0]).toBe('u_2');
    expect(c.p).toEqual(['KeyG']);
  });
  it('orders scoped candidates before global ones (most specific wins)', () => {
    const cs = [custom({ id: 'u_g', scope: [] }), custom({ id: 'u_s', scope: ['*://github.com/*'] }), custom({ id: 'u_ss', scope: ['*://github.com/org/*'] })];
    const c = compile(withDefaults({ keymap: { u_g: 'Alt+KeyJ', u_s: 'Alt+KeyJ', u_ss: 'Alt+KeyJ' } }), cs);
    expect(c.m['Alt+KeyJ'].map((b) => b[0])).toEqual(['u_ss', 'u_s', 'u_g']);
    expect(new RegExp(c.m['Alt+KeyJ'][1][1]!).test('https://github.com/x')).toBe(true);
  });
});

describe('custom action packs (import/export)', () => {
  it('round-trips through JSON', () => {
    const pack = [custom({ id: 'u_abc', title: 'Archive', cfg: { url: 'https://web.archive.org/web/{url}', target: 'newTab' } })];
    const back = parsePack(JSON.stringify({ klavio: 1, actions: pack }));
    expect(back).toEqual(pack);
  });
  it('rejects unknown types and normalises fields', () => {
    expect(() => parsePack('{"actions":[{"type":"rm -rf"}]}')).toThrow(/Unknown action type/);
    expect(() => parsePack('{"nope":1}')).toThrow();
    const [a] = parsePack('[{"type":"copy","id":"bad id","cfg":{"text":42}}]');
    expect(a.id).toMatch(/^u_/);
    expect(a.cfg.text).toBe('42');
    expect(a.source).toBe('user');
  });
  it('describes dangerous actions for confirmation', () => {
    expect(describeDanger(custom({ type: 'js', cfg: { code: 'alert(1)' } }))).toMatch(/alert\(1\)/);
    expect(describeDanger(custom({ type: 'webhook', cfg: { url: 'https://h.test' } }))).toMatch(/h\.test/);
    expect(describeDanger(custom({ type: 'url' }))).toBeNull();
  });
  it('parses macro steps', () => {
    expect(macroSteps('tab.duplicate\n wait 300 \n\npage.zoomIn')).toEqual([{ id: 'tab.duplicate' }, { wait: 300 }, { id: 'page.zoomIn' }]);
  });
  it('computes permissions as the union of macro steps', () => {
    const m = custom({ id: 'u_m', type: 'macro', cfg: { steps: 'tab.group\npage.save\nu_c' } });
    const c = custom({ id: 'u_c', type: 'copy', cfg: { text: '{clipboard}' } });
    expect(permsFor('u_m', [m, c]).sort()).toEqual(['clipboardRead', 'downloads', 'pageCapture', 'tabGroups']);
  });
});

describe('registry', () => {
  it('has unique ids and at most 4 manifest keys', () => {
    expect(new Set(ACTIONS.map((a) => a.id)).size).toBe(ACTIONS.length);
    expect(ACTIONS.filter((a) => a.manifestKey).map((a) => a.id)).toEqual(['palette.open', 'page.qr', 'page.copyUrl', 'page.screenshot']);
  });
  it('has no duplicate default in-page keys', () => {
    const keys = ACTIONS.map((a) => a.key).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('recorded steps', () => {
  const steps: Step[] = [
    { do: 'click', sel: '#search', tag: 'button', text: 'Search' },
    { do: 'fill', sel: 'input[name="q"]', value: 'hello {title}' },
    { do: 'key', sel: 'input[name="q"]', key: 'Enter', nav: true },
    { do: 'wait', ms: 300 },
  ];
  it('round-trips through the line format', () => {
    expect(parseSteps(stringifySteps(steps))).toEqual(steps);
    expect(stringifySteps(steps).split('\n')).toHaveLength(4);
  });
  it('rejects unknown steps', () => {
    expect(() => parseSteps('{"do":"rm"}')).toThrow(/Unknown step/);
  });
  it('merges repeated fills of one field and drops the change event after Enter', () => {
    let s: Step[] = [];
    s = pushStep(s, { do: 'fill', sel: '#q', value: 'h' });
    s = pushStep(s, { do: 'fill', sel: '#q', value: 'hello' });
    expect(s).toEqual([{ do: 'fill', sel: '#q', value: 'hello' }]);
    s = pushStep(s, { do: 'key', sel: '#q', key: 'Enter' });
    s = pushStep(s, { do: 'fill', sel: '#q', value: 'hello' });
    expect(s).toHaveLength(2);
    s = pushStep(s, { do: 'click', sel: '#go' });
    s = pushStep(s, { do: 'click', sel: '#go' });
    expect(s).toHaveLength(4); // repeated clicks are real steps
  });
  it('describes steps for the settings list', () => {
    expect(describeStep(steps[0])).toBe('Click “Search”');
    expect(describeStep(steps[1])).toMatch(/^Type “hello \{title\}” into/);
    expect(describeStep(steps[3])).toBe('Wait 300 ms');
  });
});