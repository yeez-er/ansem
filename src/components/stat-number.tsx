// Spec 008: abbreviated count with the exact grouped value in `title` and
// tabular numerals. Renders in server and client components alike (no state).
// A malformed count renders an em-dash with no title — never a fake number.

import { abbreviateCount, formatFullCount } from "@/lib/format";

type StatNumberProps = {
  // decimal string straight from the API DTOs (bigint-safe, spec 007)
  value: string;
  className?: string;
};

export function StatNumber({ value, className }: StatNumberProps) {
  const classes = ["tabular-nums", className].filter(Boolean).join(" ");
  const abbreviated = abbreviateCount(value);
  if (abbreviated === null) {
    return <span className={classes}>—</span>;
  }
  return (
    <span className={classes} title={formatFullCount(value) ?? undefined}>
      {abbreviated}
    </span>
  );
}
