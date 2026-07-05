// @vitest-environment jsdom
// Spec 008: <StatNumber> renders abbreviated counts with the exact value in
// `title`, tabular numerals, and never turns "0" into blank (truthiness guard)
// or a malformed count into a fake number.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatNumber } from "./stat-number";

afterEach(cleanup);

describe("StatNumber", () => {
  it("renders 1234567 as 1.2M with the full value in title (spec example)", () => {
    render(<StatNumber value="1234567" />);
    const el = screen.getByText("1.2M");
    expect(el.getAttribute("title")).toBe("1,234,567");
  });

  it("renders 48300 as 48.3K (spec example)", () => {
    render(<StatNumber value="48300" />);
    expect(screen.getByText("48.3K").getAttribute("title")).toBe("48,300");
  });

  it("renders 0 as 0 — truthiness bug guard", () => {
    render(<StatNumber value="0" />);
    const el = screen.getByText("0");
    expect(el.getAttribute("title")).toBe("0");
  });

  it("renders 2^53+1 exactly (string/bigint path, no Number collapse)", () => {
    render(<StatNumber value="9007199254740993" />);
    const el = screen.getByText("9007.2T");
    expect(el.getAttribute("title")).toBe("9,007,199,254,740,993");
  });

  it("uses tabular numerals", () => {
    render(<StatNumber value="1234567" />);
    expect(screen.getByText("1.2M").className).toContain("tabular-nums");
  });

  it("renders an em-dash with NO title for a malformed count — never a fake value", () => {
    render(<StatNumber value="not a number" />);
    const el = screen.getByText("—");
    expect(el.hasAttribute("title")).toBe(false);
  });

  it("merges a caller className onto the element", () => {
    render(<StatNumber value="42" className="text-orange-500" />);
    const el = screen.getByText("42");
    expect(el.className).toContain("text-orange-500");
    expect(el.className).toContain("tabular-nums");
  });
});
