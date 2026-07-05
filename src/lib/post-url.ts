// Spec 002: pure post-URL parser — no I/O, no ambient clock. Returns null for
// anything unrecognized; never throws. TikTok short links come back with
// needsResolution: true and are resolved server-side at submit time.

export type Platform = "x" | "tiktok" | "instagram";

export type ParsedPost = {
  platform: Platform;
  platformPostId: string | null;
  handle: string | null;
  canonicalUrl: string;
  needsResolution?: boolean;
};

// Canonical profile URL per platform — shared by submission's creator upsert
// and ingestion's placeholder rename (spec 004): a resolved creator must never
// keep its stand-in post-URL profile.
export function profileUrlFor(platform: Platform, handle: string): string {
  switch (platform) {
    case "x":
      return `https://x.com/${handle}`;
    case "tiktok":
      return `https://www.tiktok.com/@${handle}`;
    case "instagram":
      return `https://www.instagram.com/${handle}/`;
  }
}

// Canonical X status URL — shared by the parser's canonical rebuild and
// discovery's post insert (spec 005): stored URLs are always rebuilt, never
// raw upstream data.
export function xPostUrl(handle: string, id: string): string {
  return `https://x.com/${handle}/status/${id}`;
}

// Canonical TikTok video URL — shared by the parser's canonical rebuild and
// the seed fixtures (spec 010), extracted on the 2nd occurrence like xPostUrl.
export function tiktokPostUrl(handle: string, id: string): string {
  return `https://www.tiktok.com/@${handle}/video/${id}`;
}

// Canonical Instagram post URL: both /reel/ and /p/ forms canonicalize to
// /reel/ (spec 002 table). IG URLs carry no author handle.
export function igPostUrl(shortcode: string): string {
  return `https://www.instagram.com/reel/${shortcode}/`;
}

// Creators store handles lowercased with no leading '@' (schema invariant,
// matching parsePostUrl). Providers and discovery return raw author handles —
// normalize before any (platform, handle) lookup or insert. Shared by
// ingestion's placeholder merge (spec 004) and discovery's upsert (spec 005).
export function normalizeHandle(raw: string | null): string | null {
  if (raw === null) return null;
  const handle = raw.trim().replace(/^@/, "").toLowerCase();
  return handle === "" ? null : handle;
}

const X_HANDLE = /^[a-z0-9_]{1,15}$/;
const TIKTOK_HANDLE = /^[a-z0-9._]{1,24}$/;
const NUMERIC_ID = /^\d+$/;
const IG_SHORTCODE = /^[A-Za-z0-9_-]+$/;
const SHORT_LINK_CODE = /^[A-Za-z0-9]+$/;

export function parsePostUrl(raw: string): ParsedPost | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const segments = url.pathname.split("/").filter(Boolean);

  switch (host) {
    case "x.com":
    case "twitter.com":
      return parseX(segments);
    case "tiktok.com":
      return parseTikTok(segments);
    case "vm.tiktok.com":
      return parseTikTokShortLink(segments);
    case "instagram.com":
      return parseInstagram(segments);
    default:
      return null;
  }
}

function parseX(segments: string[]): ParsedPost | null {
  const [rawHandle, statusLiteral, id] = segments;
  if (statusLiteral !== "status") return null;
  if (!id || !NUMERIC_ID.test(id)) return null;
  const handle = rawHandle?.toLowerCase();
  if (!handle || !X_HANDLE.test(handle)) return null;
  return {
    platform: "x",
    platformPostId: id,
    handle,
    canonicalUrl: xPostUrl(handle, id),
  };
}

function parseTikTok(segments: string[]): ParsedPost | null {
  const [rawHandle, videoLiteral, id] = segments;
  if (videoLiteral !== "video") return null;
  if (!id || !NUMERIC_ID.test(id)) return null;
  if (!rawHandle?.startsWith("@")) return null;
  const handle = rawHandle.slice(1).toLowerCase();
  if (!TIKTOK_HANDLE.test(handle)) return null;
  return {
    platform: "tiktok",
    platformPostId: id,
    handle,
    canonicalUrl: tiktokPostUrl(handle, id),
  };
}

function parseTikTokShortLink(segments: string[]): ParsedPost | null {
  // Short-link codes are case-sensitive — normalized but never lowercased.
  const [code] = segments;
  if (segments.length !== 1 || !code || !SHORT_LINK_CODE.test(code)) {
    return null;
  }
  return {
    platform: "tiktok",
    platformPostId: null,
    handle: null,
    canonicalUrl: `https://vm.tiktok.com/${code}`,
    needsResolution: true,
  };
}

function parseInstagram(segments: string[]): ParsedPost | null {
  // Shortcodes are case-sensitive; IG URLs carry no author handle.
  const [kind, shortcode] = segments;
  if (kind !== "reel" && kind !== "p") return null;
  if (!shortcode || !IG_SHORTCODE.test(shortcode)) return null;
  return {
    platform: "instagram",
    platformPostId: shortcode,
    handle: null,
    canonicalUrl: igPostUrl(shortcode),
  };
}
