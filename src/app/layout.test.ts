// Spec 008 / Task 21: the root layout is an App Router server component —
// it can't render in jsdom, so its public contract is pinned by source
// verification (header brand/nav/Clerk, footer links + mint constant, dark
// theme + gradient utility in globals.css). Behavior lives in e2e/smoke.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const layout = read("./layout.tsx");
const css = read("./globals.css");

// Extract a whole opening tag by one identifying attribute, so assertions on
// its other attributes never depend on prop order.
const openingTag = (source: string, tag: string, attr: string) => {
  const match = source.match(
    new RegExp(`<${tag}[^>]*${attr.replace(/[/.$?]/g, "\\$&")}[^>]*>`),
  );
  return match?.[0] ?? null;
};

describe("root layout — header", () => {
  it("shows the brand with the bull logo image and the tagline", () => {
    expect(layout).toContain("$ANSEM · THE BLACK BULL");
    expect(layout).toContain('src="/bull.png"');
    expect(layout).toContain('alt="$ANSEM black bull"');
    expect(layout).toContain("Post. Farm views. Climb.");
  });

  it("titles the document with the brand", () => {
    expect(layout).toMatch(/title:\s*"\$ANSEM · THE BLACK BULL"/);
  });

  it("nav links Leaderboard to / and Submit to /submit", () => {
    expect(openingTag(layout, "Link", 'href="/"')).not.toBeNull();
    expect(openingTag(layout, "Link", 'href="/submit"')).not.toBeNull();
    expect(layout).toContain("Leaderboard");
    expect(layout).toMatch(/>\s*Submit\s*</);
  });

  it("renders the Clerk sign-in button signed out and the user button signed in", () => {
    expect(layout).toMatch(
      /import\s*{[^}]*SignInButton[^}]*}\s*from\s*"@clerk\/nextjs"/,
    );
    // Clerk v7 removed <SignedIn>/<SignedOut>; <Show when="..."> is the
    // server-compatible control component
    const show = openingTag(layout, "Show", 'when="signed-out"');
    expect(show).not.toBeNull();
    expect(layout).toContain("<SignInButton");
    expect(layout).toContain("<UserButton");
  });
});

describe("root layout — footer", () => {
  it("links out to blackbullsol.com and @blackbullsol with noopener", () => {
    for (const href of [
      'href="https://blackbullsol.com"',
      'href="https://x.com/blackbullsol"',
    ]) {
      const anchor = openingTag(layout, "a", href);
      expect(anchor, href).not.toBeNull();
      expect(anchor).toContain('target="_blank"');
      expect(anchor).toContain('rel="noopener');
    }
  });

  it("renders the mint from the single token constant, never inline", () => {
    // the token.test.ts sweep proves no inline literal exists anywhere in src;
    // this pins that the footer actually consumes the constant
    expect(layout).toMatch(
      /import\s*{\s*ANSEM_MINT\s*}\s*from\s*"@\/lib\/token"/,
    );
    expect(layout).toContain("{ANSEM_MINT}");
  });

  it("has a copy button fed by the constant, plus the caption", () => {
    const copyButton = openingTag(layout, "CopyButton", "value={ANSEM_MINT}");
    expect(copyButton).not.toBeNull();
    expect(layout).toMatch(
      /import\s*{\s*CopyButton\s*}\s*from\s*"@\/components\/copy-button"/,
    );
    expect(layout).toContain("the only real one");
  });
});

describe("globals.css — dark theme", () => {
  it("pins the near-black background and off-white foreground unconditionally", () => {
    expect(css).toMatch(/--background:\s*#050705/);
    expect(css).toMatch(/--foreground:\s*#d7f2de/);
  });

  it("never swaps the theme on prefers-color-scheme (always dark)", () => {
    // control: prove the matcher fires on the old scaffold payload
    const scaffoldPayload =
      "@media (prefers-color-scheme: dark) { :root { --background: #0a0a0a; } }";
    expect(/prefers-color-scheme/.test(scaffoldPayload)).toBe(true);
    expect(
      /--background:\s*#ffffff/.test(":root { --background: #ffffff; }"),
    ).toBe(true);

    expect(/prefers-color-scheme/.test(css)).toBe(false);
    expect(/--background:\s*#ffffff/.test(css)).toBe(false);
  });

  it("exposes the arcade-green accent as a themed color", () => {
    expect(css).toMatch(/--accent:\s*#4cf08a/);
    expect(css).toMatch(/--color-accent:\s*var\(--accent\)/);
  });

  it("defines the bull gradient utility with the exact spec stops", () => {
    expect(css).toMatch(/@utility bull-gradient\s*{[^}]*#4cf08a[^}]*#2f8a57/);
  });
});
