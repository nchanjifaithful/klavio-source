// The single action registry: metadata (./meta) joined with implementations.
// Palette, settings page and shortcut layer all read ACTIONS; the service worker reads REGISTRY.

import { type Ctx, overlay, scriptable } from '../background/ui';
import { buildItems } from '../lib/items';
import { DATA } from './data';
import { ACTIONS, type ActionMeta } from './meta';
import { OPEN } from './open';
import { PAGE, type Run, showPopup } from './page';
import { TAB } from './tab';

const GENERAL: Record<string, Run> = {
  async 'palette.open'(ctx: Ctx) {
    if (scriptable(ctx.tab)) {
      try {
        const items = await buildItems(ctx.tab.url);
        if (await overlay(ctx.tab.id!, 'palette', { items })) return;
      } catch { /* restricted after all: use the popup */ }
    }
    await showPopup({ view: 'palette', tab: String(ctx.tab.id) });
  },
};

const RUNS: Record<string, Run> = { ...GENERAL, ...PAGE, ...TAB, ...OPEN, ...DATA };

export interface Action extends ActionMeta { run?: Run }

export const REGISTRY: Record<string, Action> = Object.fromEntries(
  ACTIONS.map((m) => [m.id, { ...m, run: m.unsupported ? undefined : RUNS[m.id] }]),
);
