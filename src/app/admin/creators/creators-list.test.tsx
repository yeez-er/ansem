// @vitest-environment jsdom
// Task 27 (spec 009B): <CreatorsList> — the searchable creator moderation list.
// Ban/Unban sit behind a confirm dialog whose Confirm button is a PLAIN button:
// it STAYS OPEN until the banCreator mutation settles (no auto-closing dialog
// action that would dismiss before the request resolves and swallow a failure),
// closing manually only in onSuccess. Both callbacks surface truthful feedback in
// an aria-live region — onError keeps the dialog open with mapped copy (never the
// raw error) so the moderator can retry. Search filters client-side (the e2e
// waits for the filtered row, never a fixed sleep). No toast library / no dialog
// library in the project (CopyButton / PendingQueue precedent).

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mutate = vi.fn();
type Updated = { id: string; isBanned: boolean };
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
      banCreator: {
        useMutation: (options: typeof capturedOptions) => {
          capturedOptions = options;
          return { mutate };
        },
      },
    },
  },
}));

import {
  type AdminCreator,
  CreatorsList,
  messageForBanError,
} from "./creators-list";

function makeCreator(overrides: Partial<AdminCreator> = {}): AdminCreator {
  return {
    id: "creator-1",
    platform: "x",
    handle: "alpha",
    displayName: "Alpha One",
    isBanned: false,
    postCount: 3,
    ...overrides,
  };
}

const searchbox = () => screen.getByRole("searchbox") as HTMLInputElement;
const dialog = () => screen.queryByRole("dialog");
const confirmButton = () =>
  screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement;

beforeEach(() => {
  mutate.mockClear();
});
afterEach(() => cleanup());

describe("row rendering", () => {
  it("shows the handle, platform badge, post count, and a Ban button for an active creator", () => {
    render(<CreatorsList initialCreators={[makeCreator()]} />);
    expect(screen.getByText("@alpha")).toBeTruthy();
    expect(screen.getByRole("img", { name: "X" })).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy(); // post count
    expect(screen.getByRole("button", { name: "Ban" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Unban" })).toBeNull();
  });

  it("shows a banned badge and an Unban button for a banned creator", () => {
    render(
      <CreatorsList
        initialCreators={[makeCreator({ handle: "villain", isBanned: true })]}
      />,
    );
    expect(screen.getByText(/banned/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unban" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ban" })).toBeNull();
  });

  it("renders a placeholder creator as Unclaimed creator, never the raw handle", () => {
    render(
      <CreatorsList
        initialCreators={[
          makeCreator({
            handle: "placeholder:1899000000000000042",
            displayName: null,
          }),
        ]}
      />,
    );
    expect(screen.getByText("Unclaimed creator")).toBeTruthy();
    expect(screen.queryByText(/placeholder:1899/)).toBeNull();
  });
});

describe("search", () => {
  const roster = [
    makeCreator({ id: "a", handle: "alpha", displayName: "Alpha One" }),
    makeCreator({ id: "b", handle: "bravo", displayName: "Bravo Two" }),
  ];

  it("filters by handle, case-insensitively", () => {
    render(<CreatorsList initialCreators={roster} />);
    fireEvent.change(searchbox(), { target: { value: "BRAV" } });
    expect(screen.getByText("@bravo")).toBeTruthy();
    expect(screen.queryByText("@alpha")).toBeNull();
  });

  it("filters by display name", () => {
    render(<CreatorsList initialCreators={roster} />);
    fireEvent.change(searchbox(), { target: { value: "two" } });
    expect(screen.getByText("@bravo")).toBeTruthy();
    expect(screen.queryByText("@alpha")).toBeNull();
  });

  it("shows a no-match state (not a blank table) when nothing matches", () => {
    render(<CreatorsList initialCreators={roster} />);
    fireEvent.change(searchbox(), { target: { value: "zzz" } });
    expect(screen.queryByText("@alpha")).toBeNull();
    expect(screen.queryByText("@bravo")).toBeNull();
    expect(screen.getByText(/no creators match/i)).toBeTruthy();
  });
});

describe("confirm dialog", () => {
  it("opens a confirm dialog on Ban without calling the mutation yet", () => {
    render(<CreatorsList initialCreators={[makeCreator()]} />);
    expect(dialog()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ban" }));
    expect(dialog()).not.toBeNull();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("Cancel closes the dialog and never calls the mutation", () => {
    render(<CreatorsList initialCreators={[makeCreator()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Ban" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(dialog()).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("Confirm calls banCreator and KEEPS the dialog open (disabled) until it settles", () => {
    render(<CreatorsList initialCreators={[makeCreator({ id: "c1" })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Ban" }));
    fireEvent.click(confirmButton());

    expect(mutate).toHaveBeenCalledWith({ creatorId: "c1", banned: true });
    // NOT auto-closing: the dialog stays until the async op resolves
    expect(dialog()).not.toBeNull();
    // no double-submit while in flight
    expect(confirmButton().disabled).toBe(true);
  });

  it("confirms an unban with banned: false", () => {
    render(
      <CreatorsList
        initialCreators={[makeCreator({ id: "c2", isBanned: true })]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Unban" }));
    fireEvent.click(confirmButton());
    expect(mutate).toHaveBeenCalledWith({ creatorId: "c2", banned: false });
  });
});

describe("onSuccess", () => {
  it("closes the dialog, flips the row to banned, and confirms in an aria-live region", () => {
    render(<CreatorsList initialCreators={[makeCreator({ id: "c1" })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Ban" }));
    fireEvent.click(confirmButton());

    act(() => capturedOptions.onSuccess({ id: "c1", isBanned: true }));

    expect(dialog()).toBeNull(); // closed manually in onSuccess
    expect(screen.getByRole("button", { name: "Unban" })).toBeTruthy(); // flipped
    expect(screen.getByRole("status").textContent).toMatch(/banned/i);
  });
});

describe("onError", () => {
  it("keeps the dialog open, re-enables Confirm, and shows mapped copy — never the raw code", () => {
    render(<CreatorsList initialCreators={[makeCreator({ id: "c1" })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Ban" }));
    fireEvent.click(confirmButton());

    act(() =>
      capturedOptions.onError({
        message: "CREATOR_NOT_FOUND",
        data: { code: "NOT_FOUND" },
      }),
    );

    expect(dialog()).not.toBeNull(); // stays open for a retry
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/no longer exists/i);
    expect(alert.textContent).not.toContain("CREATOR_NOT_FOUND");
    expect(confirmButton().disabled).toBe(false); // retryable
  });
});

describe("empty list", () => {
  it("renders an empty state when there are no creators at all", () => {
    render(<CreatorsList initialCreators={[]} />);
    expect(screen.getByText(/no creators/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ban" })).toBeNull();
  });
});

describe("messageForBanError (pure)", () => {
  it("maps CREATOR_NOT_FOUND to friendly copy", () => {
    expect(
      messageForBanError({
        message: "CREATOR_NOT_FOUND",
        data: { code: "NOT_FOUND" },
      }).text,
    ).toMatch(/no longer exists/i);
  });

  it("falls back to a generic message without echoing the raw error", () => {
    const raw = "boom: internal stack trace leaked";
    const result = messageForBanError({
      message: raw,
      data: { code: "INTERNAL_SERVER_ERROR" },
    });
    expect(result.tone).toBe("error");
    expect(result.text).toMatch(/went wrong|try again/i);
    expect(result.text).not.toContain(raw);
  });
});
