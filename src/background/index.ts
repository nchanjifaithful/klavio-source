// Service worker: one router for all triggers (chrome.commands, in-page keys, palette/popup).
// Stateless by design: everything is read from chrome.storage on each event, so cold starts just work.

import { REGISTRY } from '../actions/registry';
import { SLOT_IDS } from '../actions/meta';
import type { CustomAction } from '../lib/custom';
import { buildItems } from '../lib/items';
import { hasPerms, permsFor, requestPerms } from '../lib/permissions';
import { compile, getCustom, getSettings, pushMru } from '../lib/storage';
import { runCustom } from './custom';
import { Cancelled, type Ctx, friendly, openPopupWindow, settleDialog, toast } from './ui';

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return t;
}

async function ensurePerms(perms: string[], id: string, tab: chrome.tabs.Tab): Promise<boolean> {
  if (!perms.length || (await hasPerms(perms))) return true;
  try { if (await requestPerms(perms)) return true; } catch { /* no user gesture in this context */ }
  await openPopupWindow(new URLSearchParams({ view: 'grant', id, tab: String(tab.id), perms: perms.join(',') }).toString(), 440, 300);
  return false;
}

export async function runAction(id: string, ctx: Ctx, draft?: CustomAction): Promise<unknown> {
  let custom: CustomAction[] | undefined;
  if (id.startsWith('custom.slot')) {
    const { slots } = await getSettings();
    if (!slots[id]) return toast(ctx, `${id.replace('custom.slot', 'Custom slot ')} has no action assigned`, 'err');
    id = slots[id];
  }
  const builtin = REGISTRY[id];
  let action: CustomAction | undefined = draft;
  if (!builtin && !action) {
    custom = await getCustom();
    action = custom.find((c) => c.id === id);
    if (!action) throw new Error(`Unknown action: ${id}`);
  }
  if (builtin?.unsupported) return toast(ctx, builtin.unsupported, 'err');

  if (ctx.via === 'command' || ctx.via === 'page') {
    const { disabled } = await getSettings();
    if (disabled.includes(id)) return;
  }
  const perms = builtin ? builtin.perms ?? [] : permsFor(id, custom ?? (await getCustom()), 0, action);
  if (!(await ensurePerms(perms, id, ctx.tab))) return;
  if (ctx.depth === 0 && id !== 'palette.open' && !ctx.tab.incognito && !draft) void pushMru(id);

  if (builtin) return builtin.run!(ctx);
  return runCustom(action!, ctx, (sid, sctx) => runAction(sid, sctx));
}

async function run(id: string, ctx: Ctx, draft?: CustomAction) {
  try {
    return { ok: true, result: await runAction(id, ctx, draft) };
  } catch (e) {
    if (e instanceof Cancelled) return { ok: false, cancelled: true };
    const msg = friendly(e);
    await toast(ctx, msg, 'err').catch(() => {});
    return { ok: false, error: msg };
  }
}

// --- triggers ------------------------------------------------------------------------------------

chrome.commands.onCommand.addListener(async (command, tab) => {
  tab ??= await activeTab();
  if (tab) void run(command, { tab, via: 'command', depth: 0 });
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.target === 'offscreen') return;
  switch (msg.type) {
    case 'run': {
      // Ack immediately so the sender (palette/popup) can close; the action runs on.
      const tabP = msg.tabId != null ? chrome.tabs.get(msg.tabId) : Promise.resolve(sender.tab ?? null);
      tabP.then((tab) => tab ?? activeTab()).then((tab) => {
        if (tab) void run(msg.id, { tab, via: msg.via ?? (sender.tab ? 'page' : 'popup'), depth: 0 }, msg.draft);
      });
      reply({ ok: true });
      return;
    }
    case 'dlg': settleDialog(msg.id, msg.value); return;
    case 'items': buildItems(msg.url).then(reply); return true;
    case 'compile': recompile().then(() => reply(true)); return true;
  }
});

chrome.alarms.onAlarm.addListener(async (a) => {
  const [kind, extId, enable] = a.name.split('|');
  if (kind === 'revert' && chrome.management) await chrome.management.setEnabled(extId, enable === '1').catch(() => {});
});

// --- keymap compilation for content scripts ------------------------------------------------------

async function recompile() {
  const [s, custom] = await Promise.all([getSettings(), getCustom()]);
  await chrome.storage.local.set({ compiled: compile(s, custom) });
}

chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'sync' || (area === 'local' && ch.custom)) void recompile();
});

chrome.runtime.onStartup.addListener(() => void recompile());

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await recompile();
  // Content scripts only arrive with new page loads; inject the (tiny) key listener into open tabs.
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file:///*'] });
  await Promise.all(tabs.map((t) => chrome.scripting.executeScript({ target: { tabId: t.id! }, files: ['keys.js'] }).catch(() => {})));
  if (reason === 'install') chrome.runtime.openOptionsPage();
});

// Exposed for end-to-end tests (Playwright evaluates in the worker).
(globalThis as any).__klavio = { runAction: (id: string, tabId: number) => chrome.tabs.get(tabId).then((tab) => run(id, { tab, via: 'test', depth: 0 })), recompile, SLOT_IDS };
