// @vitest-environment jsdom
// Task 26 (spec 009B): <PendingQueue> — the moderation table. Approve/Reject are
// PLAIN buttons that disable in flight (no double-submit, no auto-closing dialog
// wrapping the async mutation). The reviewPost mutation's BOTH callbacks surface
// truthful feedback: onSuccess removes the row from the local list without a
// reload and confirms the decision; onError maps typed codes to friendly copy —
// never the raw error string. Empty queue → "Queue clear" (submit-form precedent
// for the mocked-mutation harness).

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mutate = vi.fn();
type Updated = { id: string; status: string };
type ErrorLike = {
  message?: string | null;
  data?: { code?: string | null } | null;
};
let capturedOptions: {
  onSuccess: (updated: Updated) => void;
  onError: (error: ErrorLike) => void;
};

vi.mock("@/trpc/react", () => ({
  api: {
    admin: {
      reviewPost: {
        useMutation: (options: typeof capturedOptions) => {
          capturedOptions = options;
          return { mutate };
        },
      },
    },
  },
}));

import {
  formatSubmittedDate,
  messageForReviewError,
  PendingQueue,
  type PendingPost,
} from "./pending-queue";

function makePost(overrides: Partial<PendingPost> = {}): PendingPost {
  return {
    id: "post-1",
    platform: "x",
    url: "https://x.com/someone/status/1",
    submittedByUserId: "user_123",
    submittedAt: new Date("2026-07-05T12:00:00Z"),
    creator: { id: "creator-1", handle: "someone", displayName: "Some One" },
    ...overrides,
  };
}

const approveButton = () =>
  screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement;
const rejectButton = () =>
  screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement;

beforeEach(() => {
  mutate.mockClear();
});
afterEach(() => cleanup());

describe("row rendering", () => {
  it("shows submitted date, platform badge, creator, link out, and submitter", () => {
    render(<PendingQueue initialPosts={[makePost()]} />);

    expect(screen.getByText("2026-07-05")).toBeTruthy(); // UTC submitted date
    expect(screen.getByRole("img", { name: "X" })).toBeTruthy(); // platform badge
    expect(screen.getByText("@someone")).toBeTruthy(); // creator label
    const link = screen.getByRole("link", { name: /view post/i });
    expect(link.getAttribute("href")).toBe("https://x.com/someone/status/1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText("user_123")).toBeTruthy(); // submitter (Clerk id)
  });

  it("labels a discovery-sourced submission (null submitter) as Discovery", () => {
    render(
      <PendingQueue initialPosts={[makePost({ submittedByUserId: null })]} />,
    );
    expect(screen.getByText(/discovery/i)).toBeTruthy();
  });

  it("renders a placeholder creator as Unclaimed creator, never the raw handle", () => {
    render(
      <PendingQueue
        initialPosts={[
          makePost({
            creator: {
              id: "c",
              handle: "placeholder:1899000000000000042",
              displayName: null,
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Unclaimed creator")).toBeTruthy();
    expect(screen.queryByText(/placeholder:1899/)).toBeNull();
  });
});

describe("approve / reject", () => {
  it("approves a row: calls reviewPost approved and disables all actions in flight", () => {
    render(<PendingQueue initialPosts={[makePost({ id: "p1" })]} />);
    fireEvent.click(approveButton());
    expect(mutate).toHaveBeenCalledWith({ postId: "p1", decision: "approved" });
    // no double-submit: every action button disables while one is in flight
    expect(approveButton().disabled).toBe(true);
    expect(rejectButton().disabled).toBe(true);
  });

  it("rejects a row: calls reviewPost with the rejected decision", () => {
    render(<PendingQueue initialPosts={[makePost({ id: "p2" })]} />);
    fireEvent.click(rejectButton());
    expect(mutate).toHaveBeenCalledWith({ postId: "p2", decision: "rejected" });
  });
});

describe("onSuccess", () => {
  it("removes the reviewed row without a reload and confirms the decision", () => {
    render(
      <PendingQueue
        initialPosts={[
          makePost({
            id: "p1",
            creator: { id: "c", handle: "gone", displayName: null },
          }),
        ]}
      />,
    );
    expect(screen.getByText("@gone")).toBeTruthy();

    fireEvent.click(approveButton());
    act(() => capturedOptions.onSuccess({ id: "p1", status: "approved" }));

    expect(screen.queryByText("@gone")).toBeNull(); // row left the queue
    expect(screen.getByRole("status").textContent).toMatch(/approved/i);
  });

  it("shows the Queue clear empty state once the last row is reviewed", () => {
    render(<PendingQueue initialPosts={[makePost({ id: "only" })]} />);
    fireEvent.click(approveButton());
    act(() => capturedOptions.onSuccess({ id: "only", status: "rejected" }));
    expect(screen.getByText(/queue clear/i)).toBeTruthy();
  });
});

describe("onError", () => {
  it("keeps the row, re-enables actions, and shows a mapped message — never the raw code", () => {
    render(
      <PendingQueue
        initialPosts={[
          makePost({
            id: "p1",
            creator: { id: "c", handle: "stay", displayName: null },
          }),
        ]}
      />,
    );
    fireEvent.click(approveButton());
    act(() =>
      capturedOptions.onError({
        message: "ALREADY_REVIEWED",
        data: { code: "PRECONDITION_FAILED" },
      }),
    );

    expect(screen.getByText("@stay")).toBeTruthy(); // row stays for a retry
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/already reviewed/i);
    expect(alert.textContent).not.toContain("ALREADY_REVIEWED");
    expect(approveButton().disabled).toBe(false); // usable again
  });
});

describe("empty queue", () => {
  it("renders the Queue clear empty state and no action buttons", () => {
    render(<PendingQueue initialPosts={[]} />);
    expect(screen.getByText(/queue clear/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});

describe("formatSubmittedDate (pure, UTC)", () => {
  it("formats to a UTC YYYY-MM-DD across the day boundary", () => {
    expect(formatSubmittedDate(new Date("2026-07-05T23:59:59Z"))).toBe(
      "2026-07-05",
    );
    expect(formatSubmittedDate(new Date("2026-07-06T00:00:00Z"))).toBe(
      "2026-07-06",
    );
  });
});

describe("messageForReviewError (pure)", () => {
  it.each([
    [
      { message: "ALREADY_REVIEWED", data: { code: "PRECONDITION_FAILED" } },
      /already reviewed/i,
    ],
    [{ message: "POST_NOT_FOUND", data: { code: "NOT_FOUND" } }, /no longer/i],
  ])("maps %o to friendly copy", (error, pattern) => {
    expect(messageForReviewError(error).text).toMatch(pattern);
  });

  it("falls back to a generic message without echoing the raw error", () => {
    const raw = "boom: internal stack trace leaked";
    const result = messageForReviewError({
      message: raw,
      data: { code: "INTERNAL_SERVER_ERROR" },
    });
    expect(result.tone).toBe("error");
    expect(result.text).toMatch(/went wrong|try again/i);
    expect(result.text).not.toContain(raw);
  });
});
