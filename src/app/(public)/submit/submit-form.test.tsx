// @vitest-environment jsdom
// Task 24 (spec 008): <SubmitForm> — the platform detect chip reuses the shared
// parsePostUrl (no client copy of the parser), the submit button disables in
// flight (no double submit), and the mutation's BOTH callbacks surface truthful
// feedback: onSuccess derives copy from status/alreadyTracked (no celebration on
// a no-op), onError maps typed codes to friendly text — never the raw error.

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Control surface for the mocked submit mutation: capture the options the form
// passes so tests can fire onSuccess/onError, and steer isPending per render.
const mutationState = { isPending: false };
type SuccessResult = { status: string; alreadyTracked: boolean };
type ErrorLike = {
  message?: string | null;
  data?: { code?: string | null } | null;
};
let capturedOptions: {
  onSuccess: (result: SuccessResult) => void;
  onError: (error: ErrorLike) => void;
};
const mutate = vi.fn();

vi.mock("@/trpc/react", () => ({
  api: {
    submissions: {
      submit: {
        useMutation: (options: typeof capturedOptions) => {
          capturedOptions = options;
          return { mutate, isPending: mutationState.isPending };
        },
      },
    },
  },
}));

import {
  messageForSubmitError,
  messageForSubmitSuccess,
  SubmitForm,
} from "./submit-form";

const X_URL = "https://x.com/someone/status/1234567890";
const TIKTOK_URL = "https://www.tiktok.com/@someone/video/1234567890";

const urlInput = () =>
  screen.getByRole("textbox", { name: /post url/i }) as HTMLInputElement;
const submitButton = () =>
  screen.getByRole("button", { name: /submit/i }) as HTMLButtonElement;

beforeEach(() => {
  mutationState.isPending = false;
  mutate.mockClear();
});
afterEach(() => cleanup());

describe("platform detect chip (shared parser)", () => {
  it("shows the chip for a valid URL and switches platform as the URL changes", () => {
    render(<SubmitForm />);
    fireEvent.change(urlInput(), { target: { value: X_URL } });
    expect(screen.getByRole("img", { name: "X" })).toBeTruthy();

    fireEvent.change(urlInput(), { target: { value: TIKTOK_URL } });
    expect(screen.getByRole("img", { name: "TikTok" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "X" })).toBeNull();
  });

  it("shows no chip and disables submit for an unrecognized URL", () => {
    render(<SubmitForm />);
    fireEvent.change(urlInput(), { target: { value: "not a url" } });
    expect(screen.queryByRole("img")).toBeNull();
    expect(submitButton().disabled).toBe(true);
  });
});

describe("submit + in-flight guard", () => {
  it("submits the trimmed URL through the mutation", () => {
    render(<SubmitForm />);
    fireEvent.change(urlInput(), { target: { value: `  ${X_URL}  ` } });
    fireEvent.click(submitButton());
    expect(mutate).toHaveBeenCalledWith({ url: X_URL });
  });

  it("disables the submit button while a submission is in flight (no double submit)", () => {
    mutationState.isPending = true;
    render(<SubmitForm />);
    fireEvent.change(urlInput(), { target: { value: X_URL } });
    expect(submitButton().disabled).toBe(true);
  });
});

describe("onSuccess feedback", () => {
  it("celebrates a newly-tracked approved post and clears the input", () => {
    render(<SubmitForm />);
    fireEvent.change(urlInput(), { target: { value: X_URL } });
    act(() =>
      capturedOptions.onSuccess({ status: "approved", alreadyTracked: false }),
    );
    expect(
      screen.getByText(/On the board — metrics update within the hour/),
    ).toBeTruthy();
    expect(urlInput().value).toBe("");
  });

  it("tells the user a pending post is awaiting review", () => {
    render(<SubmitForm />);
    fireEvent.change(urlInput(), { target: { value: X_URL } });
    act(() =>
      capturedOptions.onSuccess({ status: "pending", alreadyTracked: false }),
    );
    expect(screen.getByText(/Pending review/)).toBeTruthy();
  });

  it("gives already-tracked posts truthful copy, never the success toast", () => {
    render(<SubmitForm />);
    fireEvent.change(urlInput(), { target: { value: X_URL } });
    act(() =>
      capturedOptions.onSuccess({ status: "approved", alreadyTracked: true }),
    );
    expect(screen.getByText(/already tracking/i)).toBeTruthy();
    expect(
      screen.queryByText(/On the board — metrics update within the hour/),
    ).toBeNull();
  });
});

describe("onError feedback", () => {
  it("maps a known error to friendly copy and never leaks the raw code", () => {
    render(<SubmitForm />);
    act(() =>
      capturedOptions.onError({
        message: "UNSUPPORTED_URL",
        data: { code: "BAD_REQUEST" },
      }),
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/supported/i);
    expect(alert.textContent).not.toContain("UNSUPPORTED_URL");
  });
});

describe("messageForSubmitError (pure)", () => {
  it.each([
    [
      { message: "UNSUPPORTED_URL", data: { code: "BAD_REQUEST" } },
      /supported/i,
    ],
    [
      { message: "UNRESOLVABLE_URL", data: { code: "BAD_REQUEST" } },
      /resolve/i,
    ],
    [
      { message: "RATE_LIMITED", data: { code: "TOO_MANY_REQUESTS" } },
      /limit/i,
    ],
    [{ message: "CREATOR_BANNED", data: { code: "FORBIDDEN" } }, /removed/i],
    // maps by tRPC code even when the server sets no message
    [{ data: { code: "TOO_MANY_REQUESTS" } }, /limit/i],
    [{ data: { code: "UNAUTHORIZED" } }, /sign in/i],
  ])("maps %o to friendly copy", (error, pattern) => {
    expect(messageForSubmitError(error).text).toMatch(pattern);
  });

  it("falls back to a generic message without echoing the raw error", () => {
    const raw = "boom: internal stack trace leaked";
    const result = messageForSubmitError({
      message: raw,
      data: { code: "INTERNAL_SERVER_ERROR" },
    });
    expect(result.tone).toBe("error");
    expect(result.text).toMatch(/went wrong|try again/i);
    expect(result.text).not.toContain(raw);
  });
});

describe("messageForSubmitSuccess (pure)", () => {
  it("celebrates an approved new post", () => {
    expect(
      messageForSubmitSuccess({ status: "approved", alreadyTracked: false })
        .text,
    ).toMatch(/On the board/);
  });

  it("flags a pending new post for review", () => {
    expect(
      messageForSubmitSuccess({ status: "pending", alreadyTracked: false })
        .text,
    ).toMatch(/Pending review/);
  });

  it("uses an info tone, not success, for an already-tracked no-op", () => {
    const feedback = messageForSubmitSuccess({
      status: "approved",
      alreadyTracked: true,
    });
    expect(feedback.tone).toBe("info");
    expect(feedback.text).toMatch(/already/i);
  });
});
