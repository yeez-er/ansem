// @vitest-environment jsdom
// Spec 008: <EmptyState> — bull glyph + message + optional CTA link. The
// glyph is decorative (the message carries the meaning); the CTA is a real
// link (navigation), never a button with an href handler.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EmptyState } from "./empty-state";

afterEach(cleanup);

const BOARD_COPY =
  "No posts on the board yet. Be the first — submit your post.";

describe("EmptyState", () => {
  it("renders the message", () => {
    render(<EmptyState message={BOARD_COPY} />);
    expect(screen.getByText(BOARD_COPY)).toBeTruthy();
  });

  it("renders the bull glyph as decorative (aria-hidden)", () => {
    render(<EmptyState message={BOARD_COPY} />);
    const glyph = screen.getByText("🐂");
    expect(glyph.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders the CTA as a link with the exact href", () => {
    render(
      <EmptyState
        message={BOARD_COPY}
        cta={{ href: "/submit", label: "Submit your post" }}
      />,
    );
    const link = screen.getByRole("link", { name: "Submit your post" });
    expect(link.getAttribute("href")).toBe("/submit");
  });

  it("renders no link when the CTA is omitted", () => {
    render(<EmptyState message="Queue clear" />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
