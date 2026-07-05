// Task 15 (spec 005): shared low-level X API v2 client — ONE authenticated
// GET pipeline (bearer auth, 10s timeout, typed error mapping) used by the
// metrics provider (spec 003) and the discovery orchestration (spec 005).
// Never throws: every upstream failure resolves to a typed failure, so
// callers keep the never-reject contract without their own try-catch.
const X_API_BASE_URL = "https://api.x.com/2";
const REQUEST_TIMEOUT_MS = 10_000;

export type XApiFailure = {
  ok: false;
  error: "RATE_LIMITED" | "PROVIDER_ERROR";
  retryable: boolean;
};

export type XApiResponse = { ok: true; body: unknown } | XApiFailure;

export class XClient {
  private readonly bearerToken: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { bearerToken: string; fetchImpl?: typeof fetch }) {
    this.bearerToken = options.bearerToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async get(
    path: string,
    params: Record<string, string>,
  ): Promise<XApiResponse> {
    let response: Response;
    try {
      const url = new URL(`${X_API_BASE_URL}${path}`);
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
      response = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.bearerToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // Network failure or timeout — transient, worth retrying next run.
      return { ok: false, error: "PROVIDER_ERROR", retryable: true };
    }

    if (response.status === 429) {
      return { ok: false, error: "RATE_LIMITED", retryable: true };
    }
    if (!response.ok) {
      return {
        ok: false,
        error: "PROVIDER_ERROR",
        retryable: response.status >= 500,
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, error: "PROVIDER_ERROR", retryable: false };
    }
    return { ok: true, body };
  }
}
