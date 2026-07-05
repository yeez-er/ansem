// Task 15 (spec 005): XClient — the single low-level X API v2 HTTP pipeline
// (bearer auth, 10s timeout, typed error mapping) shared by the metrics
// provider (spec 003) and the discovery orchestration (spec 005). Never
// throws: every upstream failure resolves to a typed failure result.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureFetch, jsonResponse } from "@/tests/helpers/metrics";
import { XClient } from "./x-client";

const makeClient = (fetchImpl: typeof fetch) =>
  new XClient({ bearerToken: "test-token", fetchImpl });

describe("XClient — request shape", () => {
  it("GETs the X API v2 base + path with params, bearer auth, and an abort signal", async () => {
    const { impl, calls } = captureFetch(() => jsonResponse({ data: [] }));
    await makeClient(impl).get("/tweets/search/recent", {
      query: "$ANSEM",
      max_results: "100",
    });

    const call = calls[0];
    if (!call) throw new Error("expected the client to call fetch");
    expect(call.url.origin).toBe("https://api.x.com");
    expect(call.url.pathname).toBe("/2/tweets/search/recent");
    expect(call.url.searchParams.get("query")).toBe("$ANSEM");
    expect(call.url.searchParams.get("max_results")).toBe("100");
    expect(call.init.headers).toMatchObject({
      Authorization: "Bearer test-token",
    });
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("a 200 body comes back verbatim as { ok: true, body }", async () => {
    const body = { data: [{ id: "1" }], meta: { next_token: "t" } };
    const { impl } = captureFetch(() => jsonResponse(body));
    await expect(makeClient(impl).get("/tweets", {})).resolves.toEqual({
      ok: true,
      body,
    });
  });
});

describe("XClient — typed error mapping", () => {
  it("HTTP 429 → exactly { ok:false, error:'RATE_LIMITED', retryable:true }", async () => {
    const { impl } = captureFetch(() =>
      jsonResponse({ title: "Too Many Requests" }, 429),
    );
    await expect(makeClient(impl).get("/tweets", {})).resolves.toEqual({
      ok: false,
      error: "RATE_LIMITED",
      retryable: true,
    });
  });

  it("HTTP 500 → PROVIDER_ERROR retryable; HTTP 403 → PROVIDER_ERROR not retryable", async () => {
    const at = (status: number) =>
      captureFetch(() => jsonResponse({ title: "err" }, status)).impl;
    await expect(makeClient(at(500)).get("/tweets", {})).resolves.toEqual({
      ok: false,
      error: "PROVIDER_ERROR",
      retryable: true,
    });
    await expect(makeClient(at(403)).get("/tweets", {})).resolves.toEqual({
      ok: false,
      error: "PROVIDER_ERROR",
      retryable: false,
    });
  });

  it("malformed JSON on a 200 → PROVIDER_ERROR, not retryable, never a rejection", async () => {
    const { impl } = captureFetch(
      () => new Response("<html>gateway error</html>", { status: 200 }),
    );
    await expect(makeClient(impl).get("/tweets", {})).resolves.toEqual({
      ok: false,
      error: "PROVIDER_ERROR",
      retryable: false,
    });
  });

  it("a fetch that throws (sync or async) resolves to a retryable PROVIDER_ERROR", async () => {
    const syncThrow = (() => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const asyncReject = (() =>
      Promise.reject(new Error("socket hang up"))) as typeof fetch;

    for (const impl of [syncThrow, asyncReject]) {
      await expect(makeClient(impl).get("/tweets", {})).resolves.toEqual({
        ok: false,
        error: "PROVIDER_ERROR",
        retryable: true,
      });
    }
  });

  it("control: the rejection matcher fires on a client that rejects", async () => {
    // Proves the resolve-style assertions in this suite are not vacuous — a
    // client that rejects IS detectable by the matcher we rely on.
    const rejecting: Pick<XClient, "get"> = {
      get: () => Promise.reject(new Error("pipeline exploded")),
    };
    await expect(rejecting.get("/tweets", {})).rejects.toThrowError(
      "pipeline exploded",
    );
  });
});

describe("XClient — source verification", () => {
  it("owns the spec 10s timeout via AbortSignal.timeout (moved here with the pipeline)", () => {
    const source = readFileSync(
      join(process.cwd(), "src/server/metrics/x-client.ts"),
      "utf8",
    );
    expect(source).toMatch(/REQUEST_TIMEOUT_MS = 10_000\b/);
    expect(source).toMatch(/AbortSignal\.timeout\(REQUEST_TIMEOUT_MS\)/);
  });

  it("has a live caller: the X metrics provider consumes the shared pipeline", () => {
    const provider = readFileSync(
      join(process.cwd(), "src/server/metrics/x-api-provider.ts"),
      "utf8",
    );
    expect(provider).toMatch(/from "\.\/x-client"/);
  });
});
