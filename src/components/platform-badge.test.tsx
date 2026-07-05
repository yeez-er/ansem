// @vitest-environment jsdom
// Spec 008: platform badges — X white glyph, TikTok cyan/pink, Instagram
// purple/pink gradient — icon-only, so every badge MUST carry an accessible
// name (a11y acceptance criterion).

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Platform } from "@/lib/post-url";
import { PlatformBadge } from "./platform-badge";

afterEach(cleanup);

describe("PlatformBadge", () => {
  it.each<[Platform, string]>([
    ["x", "X"],
    ["tiktok", "TikTok"],
    ["instagram", "Instagram"],
  ])("%s badge has accessible name %j (icon-only a11y)", (platform, name) => {
    render(<PlatformBadge platform={platform} />);
    expect(screen.getByRole("img", { name })).toBeTruthy();
  });

  it.each<[Platform]>([["x"], ["tiktok"], ["instagram"]])(
    "%s glyph svg is decorative (aria-hidden) — the badge itself is the img",
    (platform) => {
      const { container } = render(<PlatformBadge platform={platform} />);
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
    },
  );

  it("X glyph is white", () => {
    const { container } = render(<PlatformBadge platform="x" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("text-white");
    expect(svg?.querySelector("path")?.getAttribute("fill")).toBe(
      "currentColor",
    );
  });

  it("TikTok glyph layers the cyan and pink brand fills", () => {
    const { container } = render(<PlatformBadge platform="tiktok" />);
    const fills = Array.from(container.querySelectorAll("path")).map((p) =>
      p.getAttribute("fill"),
    );
    expect(fills).toContain("#25F4EE");
    expect(fills).toContain("#FE2C55");
  });

  it("Instagram glyph strokes with a purple → pink gradient", () => {
    const { container } = render(<PlatformBadge platform="instagram" />);
    // jsdom quirk: the compound selector "linearGradient stop" matches
    // nothing (camelCase SVG tag inside a descendant selector) — query stops
    // directly; the badge svg contains no other <stop> elements.
    const stops = Array.from(container.querySelectorAll("stop"))
      .map((s) => s.getAttribute("stop-color"))
      .join(",");
    expect(stops).toContain("#a855f7");
    expect(stops).toContain("#ec4899");
    const gradientId = container
      .querySelector("linearGradient")
      ?.getAttribute("id");
    expect(gradientId).toBeTruthy();
    const rect = container.querySelector("rect");
    expect(rect?.getAttribute("stroke")).toBe(`url(#${gradientId})`);
  });

  it("two Instagram badges on one page get distinct gradient ids", () => {
    const { container } = render(
      <div>
        <PlatformBadge platform="instagram" />
        <PlatformBadge platform="instagram" />
      </div>,
    );
    const ids = Array.from(container.querySelectorAll("linearGradient")).map(
      (g) => g.getAttribute("id"),
    );
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("merges a caller className onto the badge", () => {
    render(<PlatformBadge platform="x" className="ml-2" />);
    const badge = screen.getByRole("img", { name: "X" });
    expect(badge.className).toContain("ml-2");
  });
});
