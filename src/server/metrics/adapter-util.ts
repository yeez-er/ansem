// Shared primitives for live metrics adapters (extracted on the 2nd
// occurrence — X API and SocialData map upstream JSON the same way).
import type { MetricsResult, PostRef } from "./provider";

// Chunked fetch loop shared by every live adapter (extracted on the 3rd
// occurrence — X API, SocialData, Apify). Slices refs into provider-sized
// batches and backstops the never-reject contract: an unexpected bug in a
// batch degrades to typed errors for that chunk instead of rejecting the
// whole run.
export async function fetchMetricsInChunks(
  refs: PostRef[],
  chunkSize: number,
  fetchBatch: (chunk: PostRef[]) => Promise<Map<string, MetricsResult>>,
): Promise<Map<string, MetricsResult>> {
  const results = new Map<string, MetricsResult>();
  for (let i = 0; i < refs.length; i += chunkSize) {
    const chunk = refs.slice(i, i + chunkSize);
    let batch: Map<string, MetricsResult>;
    try {
      batch = await fetchBatch(chunk);
    } catch {
      batch = errorForAll(
        chunk.map((ref) => ref.platformPostId),
        "PROVIDER_ERROR",
        false,
      );
    }
    for (const [id, result] of batch) results.set(id, result);
  }
  return results;
}

export function errorForAll(
  ids: string[],
  error: "RATE_LIMITED" | "PROVIDER_ERROR",
  retryable: boolean,
): Map<string, MetricsResult> {
  return new Map(ids.map((id) => [id, { ok: false, error, retryable }]));
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function dateOrNull(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// JSON numbers are exact up to 2^53 − 1, which covers real platform counts;
// anything non-numeric or unsafe throws and the post degrades to a per-post
// PROVIDER_ERROR in the adapter's mapper.
export function toBigInt(value: unknown): bigint {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `expected a non-negative safe integer, got ${String(value)}`,
    );
  }
  return BigInt(value);
}
