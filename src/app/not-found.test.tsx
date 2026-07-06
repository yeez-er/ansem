// Task 23 (spec 008): the styled 404. A plain synchronous server component —
// render it directly and assert the branded copy plus the way back. It sits
// at the app root so every notFound() (unknown/banned creator now, the admin
// gate later) and any unmatched URL gets the same branded card inside the
// root layout; the e2e spec proves the 404 status + layout chrome.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import NotFound from "./not-found";

describe("styled 404", () => {
  it("renders the branded message with a route back to the board", () => {
    const html = renderToStaticMarkup(<NotFound />);

    expect(html).toContain("the bull ran off with that page");
    expect(html).toMatch(/<a\b[^>]*href="\/"[^>]*>Back to the board<\/a>/);
  });
});
