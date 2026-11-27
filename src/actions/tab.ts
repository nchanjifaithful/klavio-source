import { confirmIt, promptText, toast } from '../background/ui';
import { getSettings } from '../lib/storage';
import type { Run } from './page';

async function closeMany(ctx: Parameters<Run>[0], ids: number[]) {
  if (!ids.length) return toast(ctx, 'No tabs to close');
  const { opts } = await getSettings();
  if (ids.length > opts.closeThreshold) await confirmIt(ctx, `Close ${ids.length} tabs?`, 'Close tabs');
  await chrome.tabs.remove(ids);
}

export const TAB: Record<string, Run> = {
  async 'tab.duplicate'(ctx) { return chrome.tabs.duplicate(ctx.tab.id!); },
  async 'tab.pin'(ctx) { return chrome.tabs.update(ctx.tab.id!, { pinned: !ctx.tab.pinned }); },
  async 'tab.mute'(ctx) { return chrome.tabs.update(ctx.tab.id!, { muted: !ctx.tab.mutedInfo?.muted }); },

  async 'tab.toNewWindow'(ctx) {
    const w = await chrome.windows.create({ tabId: ctx.tab.id!, focused: true });
    return w?.tabs?.[0] ?? ctx.tab;
  },

  async 'tab.closeOthers'(ctx) {
    const tabs = await chrome.tabs.query({ windowId: ctx.tab.windowId, pinned: false });
    await closeMany(ctx, tabs.filter((t) => t.id !== ctx.tab.id).map((t) => t.id!));
  },

  async 'tab.closeRight'(ctx) {
    const tabs = await chrome.tabs.query({ windowId: ctx.tab.windowId });
    await closeMany(ctx, tabs.filter((t) => t.index > ctx.tab.index).map((t) => t.id!));
  },

  async 'tab.group'(ctx) {
    const title = await promptText(ctx, 'Name the new tab group (optional)');
    const groupId = await chrome.tabs.group({ tabIds: [ctx.tab.id!] });
    if (title.trim()) await chrome.tabGroups.update(groupId, { title: title.trim() });
  },

  async 'tab.discard'(ctx) {
    const tabs = await chrome.tabs.query({ windowId: ctx.tab.windowId, active: false, discarded: false });
    let n = 0;
    await Promise.all(tabs.map((t) => chrome.tabs.discard(t.id!).then((r) => { if (r) n++; }).catch(() => {})));
    await toast(ctx, n ? `Freed memory from ${n} tab${n > 1 ? 's' : ''}` : 'No background tabs to discard');
  },

  async 'tab.reopenClosed'() { await chrome.sessions.restore(); },

  async 'tab.bookmark'(ctx) {
    const url = ctx.tab.url;
    if (!url) return;
    const existing = await chrome.bookmarks.search({ url });
    if (existing.length) return toast(ctx, 'Already bookmarked');
    const { opts } = await getSettings();
    const parentId = opts.bookmarkFolder || undefined;
    await chrome.bookmarks.create({ title: ctx.tab.title || url, url, parentId }).catch(() => chrome.bookmarks.create({ title: ctx.tab.title || url, url }));
    await toast(ctx, 'Bookmarked');
  },

  async 'tab.readingList'(ctx) {
    const url = ctx.tab.url;
    if (!url || !/^https?:/.test(url)) throw new Error('Only web pages can be added to the reading list');
    try {
      await chrome.readingList.addEntry({ title: ctx.tab.title || url, url, hasBeenRead: false });
      await toast(ctx, 'Added to reading list');
    } catch (e) {
      if (/exist/i.test(String(e))) return toast(ctx, 'Already in your reading list');
      throw e;
    }
  },
};
