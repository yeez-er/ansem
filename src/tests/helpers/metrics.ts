// Shared metrics-provider test helpers, extracted on the 3rd occurrence
// (mock, X API, and SocialData suites all narrow results and mock fetch the
// same way).
import type { MetricsResult } from "@/server/metrics/provider";

// Narrow to the ok branch or fail loudly — keeps every assertion downstream
// unconditional (a not-ok result can never silently skip assertions).
export function metricsOf(result: MetricsResult | undefined) {
  if (!result?.ok) {
    throw new Error(
      `expected an ok MetricsResult, got ${JSON.stringify(result)}`,
    );
  }
  return result.metrics;
}

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// Captures every call the provider makes so request-shape assertions stay
// typed without fighting vi.fn generics across the fetch overloads.
export function captureFetch(respond: () => Response | Promise<Response>) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), init: init ?? {} });
    return respond();
  }) as typeof fetch;
  return { impl, calls };
}
