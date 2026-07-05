// Specs 002/004/008: creators submitted via an IG shortcode URL get a
// deterministic `placeholder:<platformPostId>` handle until ingestion
// resolves the real author and merges them. That prefix is defined ONCE here
// (submit.ts builds with it, refresh-metrics.ts detects with it), and the UI
// renders such creators as "Unclaimed creator" — the raw handle never ships.
// Pure module: client-safe, no I/O, no clock.

export const PLACEHOLDER_HANDLE_PREFIX = "placeholder:";

export const UNCLAIMED_CREATOR_LABEL = "Unclaimed creator";

export function isPlaceholderHandle(handle: string): boolean {
  return handle.startsWith(PLACEHOLDER_HANDLE_PREFIX);
}

export function creatorLabel(creator: { handle: string }): string {
  if (isPlaceholderHandle(creator.handle)) return UNCLAIMED_CREATOR_LABEL;
  return `@${creator.handle}`;
}
