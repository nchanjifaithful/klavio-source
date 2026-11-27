// Runner for user-built custom actions.

import { macroSteps, type CustomAction } from '../lib/custom';
import { parseSteps } from '../lib/recording';
import { matches } from '../lib/pattern';
import { pageVars, promptsIn, render, varsIn, type Mode } from '../lib/template';
import { replay } from './record';
import { copyText, type Ctx, NOT_AVAILABLE, promptText, readClipboard, scriptable, toast } from './ui';

type RunById = (id: string, ctx: Ctx) => Promise<unknown>;

async function selection(tab: chrome.tabs.Tab): Promise<string> {
  if (!scriptable(tab)) return '';
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: () => {
        const el = document.activeElement as HTMLInputElement | null;
        if (el && (el.localName === 'textarea' || el.localName === 'input') && el.selectionStart != null && el.selectionEnd != null) {
          const v = el.value.slice(el.selectionStart, el.selectionEnd);
          if (v) return v;
        }
        return getSelection()?.toString() ?? '';
      },
    });
    return (r?.result as string) ?? '';
  } catch {
    return '';
  }
}

/** Fill every template, collecting only the variables they actually use. Prompts are asked once per label. */
async function fill(ctx: Ctx, items: [string | undefined, Mode][]): Promise<string[]> {
  const tpls = items.map((i) => i[0]);
  const need = varsIn(...tpls);
  const vars = pageVars(ctx.tab.url, ctx.tab.title);
  if (need.has('selection')) vars.selection = await selection(ctx.tab);
  if (need.has('clipboard')) vars.clipboard = (await readClipboard().catch(() => '')) ?? '';
  for (const label of promptsIn(...tpls)) vars['prompt:' + label] = await promptText(ctx, label || 'Input');
  return items.map(([t, mode]) => render(t ?? '', vars, mode));
}

async function openUrl(ctx: Ctx, url: string, target = 'newTab') {
  if (!url) throw new Error('No URL set');
  switch (target) {
    case 'current': return chrome.tabs.update(ctx.tab.id!, { url });
    case 'newWindow': return (await chrome.windows.create({ url, focused: true }))?.tabs?.[0];
    case 'incognito':
      if (!(await chrome.extension.isAllowedIncognitoAccess())) throw new Error('Allow Klavio in incognito (chrome://extensions) to use this');
      return (await chrome.windows.create({ url, incognito: true, focused: true }))?.tabs?.[0];
    default: return chrome.tabs.create({ url, index: ctx.tab.index + 1, openerTabId: ctx.tab.id, windowId: ctx.tab.windowId });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runCustom(a: CustomAction, ctx: Ctx, runById: RunById): Promise<unknown> {
  if (!matches(ctx.tab.url, a.scope)) throw new Error(`“${a.title}” is not active on this site`);
  const c = a.cfg;
  const tabId = ctx.tab.id!;

  switch (a.type) {
    case 'url': {
      const [url] = await fill(ctx, [[c.url, 'url']]);
      return openUrl(ctx, url, c.target);
    }
    case 'protocol': {
      const [url] = await fill(ctx, [[c.url, 'url']]);
      if (/^https?:/i.test(url)) return openUrl(ctx, url, 'newTab');
      try {
        return await chrome.tabs.update(tabId, { url });
      } catch {
        if (!scriptable(ctx.tab)) throw new Error(NOT_AVAILABLE);
        await chrome.scripting.executeScript({ target: { tabId }, func: (u: string) => { location.href = u; }, args: [url] });
      }
      return;
    }
    case 'extPage': {
      const ext = await chrome.management.get(c.ext);
      const url = c.path ? `chrome-extension://${ext.id}/${c.path.replace(/^\//, '')}` : ext.optionsUrl;
      if (!url) throw new Error(`${ext.name} has no options page`);
      return openUrl(ctx, url, 'newTab');
    }
    case 'extToggle': {
      const ext = await chrome.management.get(c.ext);
      const enable = c.mode === 'enable' ? true : c.mode === 'disable' ? false : !ext.enabled;
      await chrome.management.setEnabled(ext.id, enable);
      const mins = parseFloat(c.revert);
      if (mins > 0) await chrome.alarms.create(`revert|${ext.id}|${enable ? 0 : 1}`, { delayInMinutes: Math.max(mins, 0.5) });
      await toast(ctx, `${ext.name} ${enable ? 'enabled' : 'disabled'}${mins > 0 ? ` for ${mins} min` : ''}`);
      return;
    }
    case 'extMessage': {
      const [payload] = await fill(ctx, [[c.payload || '{}', 'json']]);
      let msg: unknown;
      try { msg = JSON.parse(payload); } catch { throw new Error('Payload is not valid JSON'); }
      const res = await chrome.runtime.sendMessage(c.ext, msg);
      await toast(ctx, res === undefined ? 'Message sent' : `Reply: ${JSON.stringify(res).slice(0, 80)}`);
      return res;
    }
    case 'search': {
      let q = await selection(ctx.tab);
      if (!q.trim()) q = await promptText(ctx, 'Search for');
      if (!q.trim()) return;
      const [tpl] = await fill(ctx, [[c.url, 'url']]);
      return openUrl(ctx, tpl.replace(/%s/g, encodeURIComponent(q.trim())), c.target);
    }
    case 'copy': {
      if (c.format === 'html') {
        const [html, text] = await fill(ctx, [[c.text, 'html'], [c.text, 'text']]);
        return copyText(ctx, text.replace(/<[^>]+>/g, ''), html);
      }
      const [text] = await fill(ctx, [[c.text, 'text']]);
      return copyText(ctx, text);
    }
    case 'css': {
      if (!scriptable(ctx.tab)) throw new Error(NOT_AVAILABLE);
      const marker = `--klv-${a.id}`;
      const css = `${c.css}\n:root{${marker}:1}`;
      const [r] = await chrome.scripting.executeScript({
        target: { tabId }, func: (m: string) => getComputedStyle(document.documentElement).getPropertyValue(m).trim() === '1', args: [marker],
      });
      if (r?.result) await chrome.scripting.removeCSS({ target: { tabId }, css });
      else await chrome.scripting.insertCSS({ target: { tabId }, css });
      await toast(ctx, `${a.title}: ${r?.result ? 'off' : 'on'}`);
      return;
    }
    case 'element': {
      if (!scriptable(ctx.tab)) throw new Error(NOT_AVAILABLE);
      const [text] = c.mode === 'fill' ? await fill(ctx, [[c.text, 'text']]) : [''];
      const [r] = await chrome.scripting.executeScript({
        target: { tabId },
        args: [c.selector, c.mode, text],
        func: (sel: string, mode: string, txt: string) => {
          let el: HTMLElement | null = null;
          try { el = document.querySelector<HTMLElement>(sel); } catch { return 'bad'; }
          if (!el) return 'none';
          el.scrollIntoView({ block: 'center' });
          if (mode !== 'fill') { el.click(); return 'ok'; }
          el.focus();
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            const proto = Object.getPrototypeOf(el);
            Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, txt);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (el.isContentEditable) {
            document.execCommand('insertText', false, txt);
          } else return 'notext';
          return 'ok';
        },
      });
      const res = r?.result;
      if (res === 'none') throw new Error(`No element matches ${c.selector}`);
      if (res === 'bad') throw new Error(`Invalid selector: ${c.selector}`);
      if (res === 'notext') throw new Error('That element does not accept text');
      return;
    }
    case 'js': {
      if (!scriptable(ctx.tab)) throw new Error(NOT_AVAILABLE);
      if (!chrome.userScripts) throw new Error('Turn on “Allow User Scripts” for Klavio at chrome://extensions');
      try {
        const [r] = await chrome.userScripts.execute({ target: { tabId }, js: [{ code: c.code }], world: 'USER_SCRIPT' });
        return r?.result;
      } catch (e) {
        if (/user ?scripts/i.test(String(e))) throw new Error('Turn on “Allow User Scripts” for Klavio at chrome://extensions');
        throw e;
      }
    }
    case 'tabset': {
      const urls = (c.urls ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
      if (!urls.length) throw new Error('No URLs in this tab set');
      const tabs = await Promise.all(urls.map((url, i) => chrome.tabs.create({ url, active: i === 0, windowId: ctx.tab.windowId })));
      if (c.group?.trim()) {
        const groupId = await chrome.tabs.group({ tabIds: tabs.map((t) => t.id!) as [number, ...number[]] });
        await chrome.tabGroups.update(groupId, { title: c.group.trim() });
      }
      return tabs[0];
    }
    case 'gotoTab': {
      let found: chrome.tabs.Tab[] = [];
      try { found = await chrome.tabs.query({ url: c.pattern }); } catch {
        const all = await chrome.tabs.query({});
        found = all.filter((t) => matches(t.url, [c.pattern]));
      }
      const t = found.find((x) => x.id !== tabId) ?? found[0];
      if (t) {
        await chrome.tabs.update(t.id!, { active: true });
        await chrome.windows.update(t.windowId, { focused: true });
        return t;
      }
      if (c.url) { const [url] = await fill(ctx, [[c.url, 'url']]); return openUrl(ctx, url, 'newTab'); }
      throw new Error('No open tab matches');
    }
    case 'webhook': {
      if (!/^https?:\/\//.test(c.url)) throw new Error('Webhook URL must start with http(s)://');
      const [body] = await fill(ctx, [[c.body || '{"url":"{url}","title":"{title}"}', 'json']]);
      try { JSON.parse(body); } catch { throw new Error('Body template is not valid JSON'); }
      const res = await fetch(c.url, { method: c.method || 'POST', headers: { 'Content-Type': 'application/json' }, body });
      if (!res.ok) throw new Error(`Webhook failed: HTTP ${res.status}`);
      await toast(ctx, `Sent (${res.status})`);
      return;
    }
    case 'recording': {
      const steps = parseSteps(c.steps);
      const idx = steps.flatMap((s, i) => (s.value?.includes('{') ? [i] : []));
      if (idx.length) {
        const vals = await fill(ctx, idx.map((i) => [steps[i].value, 'text'] as [string, Mode]));
        idx.forEach((i, k) => (steps[i] = { ...steps[i], value: vals[k] }));
      }
      await replay(ctx, steps, c.start || 'auto', c.startUrl || '');
      return;
    }
    case 'macro': {
      if (ctx.depth > 4) throw new Error('Macro nesting is too deep');
      let tab = ctx.tab;
      for (const step of macroSteps(c.steps)) {
        if (step.wait) { await sleep(step.wait); continue; }
        tab = (await chrome.tabs.get(tab.id!).catch(() => tab)) as chrome.tabs.Tab;
        const out = await runById(step.id!, { tab, via: 'macro', depth: ctx.depth + 1 });
        if (out && typeof out === 'object' && 'id' in out && 'windowId' in out) tab = out as chrome.tabs.Tab;
      }
      return tab;
    }
  }
}
