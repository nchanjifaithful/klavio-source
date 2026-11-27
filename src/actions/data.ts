import { confirmIt, toast } from '../background/ui';
import type { Run } from './page';

export const DATA: Record<string, Run> = {
  async 'data.clearCache'(ctx) {
    await confirmIt(ctx, 'Clear the browser cache from the last hour?', 'Clear cache');
    await chrome.browsingData.removeCache({ since: Date.now() - 3600_000 });
    await toast(ctx, 'Cache cleared (last hour)');
  },
};
