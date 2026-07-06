// @vitest-environment node
// Task 26 (spec 009B): the /admin layout is the SERVER-SIDE gate. isAdmin is
// session-derived in the tRPC context (never from input); a signed-in non-admin
// gets notFound() → the styled root 404 with NO admin chrome or child data, an
// admin gets the Pending/Creators tabs. createTRPCContext is mocked to steer
// isAdmin without a live Clerk session (creator page.test digest precedent).
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ctxState = { isAdmin: false };
vi.mock("@/server/api/trpc", () => ({
  createTRPCContext: async () => ({ isAdmin: ctxState.isAdmin }),
}));

import AdminLayout from "./layout";

const NOT_FOUND_DIGEST = "NEXT_HTTP_ERROR_FALLBACK;404";
const CHILD = <div>child queue content</div>;

async function renderLayout(): Promise<string> {
  return renderToStaticMarkup(await AdminLayout({ children: CHILD }));
}

// Capture the outcome unconditionally (never a vacuous negative): a render that
// completes yields no digest and fails the notFound assertion loudly.
async function layoutOutcome(): Promise<unknown> {
  return AdminLayout({ children: CHILD }).then(
    () => "rendered",
    (error: unknown) => error,
  );
}

function digestOf(outcome: unknown): string | undefined {
  if (typeof outcome !== "object" || outcome === null) return undefined;
  if (!("digest" in outcome)) return undefined;
  return String((outcome as { digest: unknown }).digest);
}

beforeEach(() => {
  ctxState.isAdmin = false;
});

describe("admin layout gate", () => {
  it("non-admin → notFound(), never the admin chrome or child data", async () => {
    ctxState.isAdmin = false;
    const outcome = await layoutOutcome();
    expect(digestOf(outcome)).toBe(NOT_FOUND_DIGEST);
  });

  it("admin → renders the Pending and Creators tabs around the children", async () => {
    ctxState.isAdmin = true;
    const html = await renderLayout();
    expect(html).toMatch(/<a[^>]*href="\/admin"[^>]*>Pending<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/admin\/creators"[^>]*>Creators<\/a>/);
    expect(html).toContain("child queue content");
  });
});
