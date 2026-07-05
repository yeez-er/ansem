// @vitest-environment jsdom
// Task 22 (spec 008): <BoardControls> — the period toggle and platform tabs
// are LINKS carrying URL state (shareable, back-button-safe), never buttons
// with handlers; the active choice is marked with aria-current. The "resets
// 00:00 UTC" caption carries a live countdown that only exists on the daily
// board, ticks on a 1s interval, and cleans that interval up on unmount.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardControls } from "./board-controls";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const linkHref = (name: string) =>
  screen.getByRole("link", { name }).getAttribute("href");
const ariaCurrent = (name: string) =>
  screen.getByRole("link", { name }).getAttribute("aria-current");

describe("period toggle", () => {
  it("links Today and All Time, keeping the platform and dropping pagination", () => {
    render(<BoardControls period="daily" platform="tiktok" />);
    expect(linkHref("Today")).toBe("/?platform=tiktok");
    expect(linkHref("All Time")).toBe("/?period=alltime&platform=tiktok");
  });

  it("marks exactly the active period with aria-current", () => {
    render(<BoardControls period="alltime" platform="all" />);
    expect(ariaCurrent("All Time")).toBe("page");
    expect(ariaCurrent("Today")).toBeNull();
  });
});

describe("platform tabs", () => {
  it("renders all four tabs preserving the period", () => {
    render(<BoardControls period="alltime" platform="all" />);
    expect(linkHref("All")).toBe("/?period=alltime");
    expect(linkHref("X")).toBe("/?period=alltime&platform=x");
    expect(linkHref("TikTok")).toBe("/?period=alltime&platform=tiktok");
    expect(linkHref("Instagram")).toBe("/?period=alltime&platform=instagram");
  });

  it("marks exactly the active platform with aria-current", () => {
    render(<BoardControls period="daily" platform="x" />);
    expect(ariaCurrent("X")).toBe("page");
    expect(ariaCurrent("All")).toBeNull();
    expect(ariaCurrent("TikTok")).toBeNull();
    expect(ariaCurrent("Instagram")).toBeNull();
  });

  it("labels the period and platform groups for assistive tech", () => {
    render(<BoardControls period="daily" platform="all" />);
    expect(screen.getByRole("group", { name: "Period" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Platform" })).toBeTruthy();
  });
});

describe("reset countdown", () => {
  it("shows the live countdown to the next 00:00 UTC and ticks each second", () => {
    vi.useFakeTimers({ now: new Date("2026-07-06T21:00:00.000Z") });
    render(<BoardControls period="daily" platform="all" />);

    expect(screen.getByText("resets 00:00 UTC · 03:00:00")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("resets 00:00 UTC · 02:59:59")).toBeTruthy();
  });

  it("hides the reset caption on the all-time board (nothing resets there)", () => {
    render(<BoardControls period="alltime" platform="all" />);
    expect(screen.queryByText(/resets 00:00 UTC/)).toBeNull();
  });

  it("clears its interval on unmount (no timer leak)", () => {
    vi.useFakeTimers({ now: new Date("2026-07-06T21:00:00.000Z") });
    // React schedules (and clears) timers of its own, so raw timer counts are
    // meaningless — capture OUR interval id and assert it is the one cleared.
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = render(<BoardControls period="daily" platform="all" />);
    expect(setSpy).toHaveBeenCalledTimes(1);
    const intervalId = setSpy.mock.results[0]?.value as unknown;

    unmount();
    expect(clearSpy).toHaveBeenCalledWith(intervalId);
  });
});
