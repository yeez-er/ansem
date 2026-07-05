"use client";

// Spec 008 (Task 22): period toggle + platform tabs as URL state — these are
// LINKS (navigation), so every view is shareable and back-button-safe; the
// active choice carries aria-current. Switching a filter drops pagination
// (boardHref without limit). Client module solely for the live countdown; the
// server render shows the caption without digits so hydration never
// mismatches.

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  type BoardPeriod,
  type BoardPlatformFilter,
  boardHref,
  formatCountdown,
  msUntilNextUtcMidnight,
} from "@/lib/board-params";

const PERIODS: ReadonlyArray<[BoardPeriod, string]> = [
  ["daily", "Today"],
  ["alltime", "All Time"],
];

const PLATFORMS: ReadonlyArray<[BoardPlatformFilter, string]> = [
  ["all", "All"],
  ["x", "X"],
  ["tiktok", "TikTok"],
  ["instagram", "Instagram"],
];

const PILL_ACTIVE = "rounded-md bg-accent/15 px-3 py-1 font-medium text-accent";
const PILL_IDLE =
  "rounded-md px-3 py-1 text-foreground/60 transition-colors hover:text-foreground";

function PillLinks<T extends string>({
  label,
  options,
  active,
  hrefOf,
}: {
  label: string;
  options: ReadonlyArray<[T, string]>;
  active: T;
  hrefOf: (value: T) => string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex w-fit gap-1 rounded-lg bg-white/[0.05] p-1 text-sm"
    >
      {options.map(([value, text]) => (
        <Link
          key={value}
          href={hrefOf(value)}
          aria-current={value === active ? "page" : undefined}
          className={value === active ? PILL_ACTIVE : PILL_IDLE}
        >
          {text}
        </Link>
      ))}
    </div>
  );
}

function ResetCountdown() {
  // null until mounted: the server knows the caption but not the client's
  // render instant — digits fill in after hydration.
  const [remaining, setRemaining] = useState<string | null>(null);

  useEffect(() => {
    const tick = () =>
      setRemaining(formatCountdown(msUntilNextUtcMidnight(new Date())));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <p className="text-xs text-foreground/50">
      resets 00:00 UTC{remaining === null ? "" : ` · ${remaining}`}
    </p>
  );
}

export type BoardControlsProps = {
  period: BoardPeriod;
  platform: BoardPlatformFilter;
};

export function BoardControls({ period, platform }: BoardControlsProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <PillLinks
          label="Period"
          options={PERIODS}
          active={period}
          hrefOf={(value) => boardHref({ period: value, platform })}
        />
        {period === "daily" ? <ResetCountdown /> : null}
      </div>
      <PillLinks
        label="Platform"
        options={PLATFORMS}
        active={platform}
        hrefOf={(value) => boardHref({ period, platform: value })}
      />
    </div>
  );
}
