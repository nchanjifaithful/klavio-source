import type { Run } from './page';

const open = (url: string): Run => async (ctx) =>
  chrome.tabs.create({ url, index: ctx.tab.index + 1, windowId: ctx.tab.windowId });

export const OPEN: Record<string, Run> = {
  'open.settings': open('chrome://settings'),
  'open.history': open('chrome://history'),
  'open.downloads': open('chrome://downloads'),
  'open.extensions': open('chrome://extensions'),
  'open.passwords': open('chrome://password-manager/passwords'),
  'open.shortcuts': open('chrome://extensions/shortcuts'),
  async 'open.klavio'() { await chrome.runtime.openOptionsPage(); },
};
