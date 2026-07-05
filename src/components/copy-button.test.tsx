// @vitest-environment jsdom
// Spec 008: <CopyButton> — icon-only control, so the aria-label carries the
// accessible name. The clipboard is an external browser API: BOTH outcomes
// surface as feedback (copied / failed), and a missing clipboard (insecure
// context, old browser) degrades to the failed state instead of crashing.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "./copy-button";

const stubClipboard = (writeText: (text: string) => Promise<void>) => {
  Object.defineProperty(window.navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
};

afterEach(() => {
  cleanup();
  // remove any stubbed clipboard so the "clipboard absent" test stays honest
  delete (window.navigator as { clipboard?: unknown }).clipboard;
});

describe("CopyButton", () => {
  it("is a plain button with the aria-label as its accessible name", () => {
    render(<CopyButton value="abc" label="Copy the $ANSEM mint address" />);
    const button = screen.getByRole("button", {
      name: "Copy the $ANSEM mint address",
    });
    expect(button.getAttribute("type")).toBe("button");
  });

  it("writes the value to the clipboard and shows copied feedback", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    render(<CopyButton value="mint-address" label="Copy the mint" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy the mint" }));

    expect(await screen.findByText("Copied")).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith("mint-address");
  });

  it("shows failed feedback when the clipboard write rejects — never a false Copied", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    render(<CopyButton value="mint-address" label="Copy the mint" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy the mint" }));

    expect(await screen.findByText("Copy failed")).toBeTruthy();
    expect(screen.queryByText("Copied")).toBeNull();
  });

  it("degrades to failed feedback when no clipboard API exists (no crash)", async () => {
    render(<CopyButton value="mint-address" label="Copy the mint" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy the mint" }));

    expect(await screen.findByText("Copy failed")).toBeTruthy();
  });
});
