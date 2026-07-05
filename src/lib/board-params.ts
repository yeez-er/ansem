// Task 22 (spec 008): board URL state as pure data. The page (server) and the
// controls (client) both speak ?period=&platform=&limit= through these
// helpers, so a shared link, the back button, and a server render can never
// disagree about what the board shows. Junk input falls back to the defaults —
// a mangled URL renders the default board, never a 500. No I/O, no ambient
// clock: `now` is always a parameter.

import { dayWindow } from "./scoring";

export const BOARD_PERIODS = ["daily", "alltime"] as const;
export type BoardPeriod = (typeof BOARD_PERIODS)[number];

export const BOARD_PLATFORM_FILTERS = [
  "all",
  "x",
  "tiktok",
  "instagram",
] as const;
export type BoardPlatformFilter = (typeof BOARD_PLATFORM_FILTERS)[number];

export type BoardParams = {
  period: BoardPeriod;
  platform: BoardPlatformFilter;
  limit: number;
};

// Mirror leaderboard.get's zod input (default 25, cap 100) — the page can only
// ask for what the API accepts.
export const BOARD_PAGE_SIZE = 25;
export const BOARD_LIMIT_MAX = 100;

type RawParam = string | string[] | undefined;

function pickEnum<T extends string>(
  raw: RawParam,
  allowed: readonly T[],
): T | null {
  if (typeof raw !== "string") return null; // repeated params are junk
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

function parseLimit(raw: RawParam): number {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return BOARD_PAGE_SIZE;
  const limit = Number(raw);
  if (limit < 1) return BOARD_PAGE_SIZE;
  // clamp instead of rejecting so an oversized shared link still works
  return Math.min(limit, BOARD_LIMIT_MAX);
}

export function parseBoardParams(raw: Record<string, RawParam>): BoardParams {
  return {
    period: pickEnum(raw.period, BOARD_PERIODS) ?? "daily",
    platform: pickEnum(raw.platform, BOARD_PLATFORM_FILTERS) ?? "all",
    limit: parseLimit(raw.limit),
  };
}

// Canonical board URL. Defaults are omitted so "/" stays the shareable home of
// the default board; param order is pinned (period, platform, limit).
export function boardHref(params: {
  period: BoardPeriod;
  platform: BoardPlatformFilter;
  limit?: number;
}): string {
  const search = new URLSearchParams();
  if (params.period !== "daily") search.set("period", params.period);
  if (params.platform !== "all") search.set("platform", params.platform);
  if (params.limit !== undefined && params.limit !== BOARD_PAGE_SIZE)
    search.set("limit", String(params.limit));
  const query = search.toString();
  return query === "" ? "/" : `/?${query}`;
}

// The next "Load more" limit; null once the API cap is already on screen so
// the page never renders a dead control.
export function nextBoardLimit(limit: number): number | null {
  if (limit >= BOARD_LIMIT_MAX) return null;
  return Math.min(limit + BOARD_PAGE_SIZE, BOARD_LIMIT_MAX);
}

// The countdown ends when the scoring engine's board day does — derive it
// from dayWindow (spec 006) so there is never a second midnight definition
// that could drift from the one the daily board is ranked by.
export function msUntilNextUtcMidnight(now: Date): number {
  return dayWindow(now).end.getTime() - now.getTime();
}

// Ceil to whole seconds so a live countdown never reads 00:00:00 while time
// remains; the exact reset instant reads 24:00:00 (a full day to the next).
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
