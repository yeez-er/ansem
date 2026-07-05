// Spec 008: per-platform badge — X white glyph, TikTok cyan/pink layered
// glyph, Instagram purple→pink gradient glyph. Icon-only, so the badge span
// carries the accessible name; the svg inside is decorative. No state — safe
// in server and client components (useId is RSC-legal).

import { useId } from "react";
import type { Platform } from "@/lib/post-url";

const PLATFORM_LABELS: Record<Platform, string> = {
  x: "X",
  tiktok: "TikTok",
  instagram: "Instagram",
};

// simple-icons brand paths (24×24 viewBox)
const X_GLYPH =
  "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z";
const TIKTOK_GLYPH =
  "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z";

const GLYPH_CLASSES = "h-3.5 w-3.5";

function XGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${GLYPH_CLASSES} text-white`}
      aria-hidden="true"
    >
      <path d={X_GLYPH} fill="currentColor" />
    </svg>
  );
}

// The TikTok mark is the note glyph with cyan and pink copies offset behind a
// white one — layered here exactly so, at badge scale.
function TikTokGlyph() {
  return (
    <svg viewBox="0 0 24 24" className={GLYPH_CLASSES} aria-hidden="true">
      <path d={TIKTOK_GLYPH} fill="#25F4EE" transform="translate(-1 -1)" />
      <path d={TIKTOK_GLYPH} fill="#FE2C55" transform="translate(1 1)" />
      <path d={TIKTOK_GLYPH} fill="#fff" />
    </svg>
  );
}

// Camera outline stroked with the brand gradient. Gradient ids must be unique
// per instance — a board renders many badges and duplicate SVG ids resolve to
// whichever element appeared first in the document.
function InstagramGlyph() {
  const gradientId = useId();
  const stroke = `url(#${gradientId})`;
  return (
    <svg viewBox="0 0 24 24" className={GLYPH_CLASSES} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#ec4899" />
        </linearGradient>
      </defs>
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="5"
        fill="none"
        stroke={stroke}
        strokeWidth="2"
      />
      <circle
        cx="12"
        cy="12"
        r="4"
        fill="none"
        stroke={stroke}
        strokeWidth="2"
      />
      <circle cx="16.8" cy="7.2" r="1.2" fill={stroke} />
    </svg>
  );
}

const GLYPHS: Record<Platform, () => React.JSX.Element> = {
  x: XGlyph,
  tiktok: TikTokGlyph,
  instagram: InstagramGlyph,
};

type PlatformBadgeProps = {
  platform: Platform;
  className?: string;
};

export function PlatformBadge({ platform, className }: PlatformBadgeProps) {
  const Glyph = GLYPHS[platform];
  const classes = [
    "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span role="img" aria-label={PLATFORM_LABELS[platform]} className={classes}>
      <Glyph />
    </span>
  );
}
