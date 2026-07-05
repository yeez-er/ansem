// Spec 008: count formatting for the UI. Counts arrive as decimal strings
// (bigint-safe API boundary, spec 007) and can exceed 2^53, so all math here
// is bigint — a Number round-trip would silently corrupt large X view counts.
// Pure: no I/O, no ambient clock. Malformed input → null, never NaN text.

const UNITS = [
  { threshold: 1_000_000_000_000n, suffix: "T" },
  { threshold: 1_000_000_000n, suffix: "B" },
  { threshold: 1_000_000n, suffix: "M" },
  { threshold: 1_000n, suffix: "K" },
] as const;

function parseCount(value: string): bigint | null {
  if (!/^\d+$/.test(value)) return null;
  return BigInt(value);
}

// value rounded half-up to tenths of the unit, e.g. 1234567 @ 1e6 → 12n (1.2M)
function roundedTenths(n: bigint, threshold: bigint): bigint {
  return (n * 10n + threshold / 2n) / threshold;
}

export function abbreviateCount(value: string): string | null {
  const n = parseCount(value);
  if (n === null) return null;
  if (n < 1000n) return n.toString();

  let unitIndex = UNITS.findIndex((unit) => n >= unit.threshold);
  let tenths = roundedTenths(n, UNITS[unitIndex].threshold);
  // 999,950 rounds to "1000.0K" — promote to the next unit up instead
  if (tenths >= 10_000n && unitIndex > 0) {
    unitIndex -= 1;
    tenths = roundedTenths(n, UNITS[unitIndex].threshold);
  }
  const whole = tenths / 10n;
  const frac = tenths % 10n;
  const suffix = UNITS[unitIndex].suffix;
  return frac === 0n ? `${whole}${suffix}` : `${whole}.${frac}${suffix}`;
}

export function formatFullCount(value: string): string | null {
  const n = parseCount(value);
  if (n === null) return null;
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
