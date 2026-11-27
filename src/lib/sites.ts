// Kept dependency-free: imported by the always-loaded content script.
export function hostDisabled(host: string, sites: string[]): boolean {
  return sites.some((d) => host === d || host.endsWith('.' + d));
}
