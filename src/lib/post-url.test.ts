// Task 5 (spec 002): parsePostUrl pure parser — table-driven cases pinning
// exact ParsedPost shapes per the spec's canonical-URL table. `toEqual` on the
// full object rejects extra keys, so shape drift fails loudly.
import { describe, expect, it } from "vitest";
import { type ParsedPost, parsePostUrl } from "./post-url";

describe("parsePostUrl — valid URLs (canonical rebuild per spec table)", () => {
  const cases: Array<{ name: string; input: string; expected: ParsedPost }> = [
    {
      name: "x.com status link",
      input: "https://x.com/someuser/status/1234567890",
      expected: {
        platform: "x",
        platformPostId: "1234567890",
        handle: "someuser",
        canonicalUrl: "https://x.com/someuser/status/1234567890",
      },
    },
    {
      name: "twitter.com legacy host + uppercase handle lowercased",
      input: "https://twitter.com/SomeUser/status/1234567890",
      expected: {
        platform: "x",
        platformPostId: "1234567890",
        handle: "someuser",
        canonicalUrl: "https://x.com/someuser/status/1234567890",
      },
    },
    {
      name: "www.x.com with query-string junk stripped",
      input: "https://www.x.com/someuser/status/1234567890?s=20&t=tracking",
      expected: {
        platform: "x",
        platformPostId: "1234567890",
        handle: "someuser",
        canonicalUrl: "https://x.com/someuser/status/1234567890",
      },
    },
    {
      name: "http scheme accepted, rebuilt as https",
      input: "http://twitter.com/a_b/status/999",
      expected: {
        platform: "x",
        platformPostId: "999",
        handle: "a_b",
        canonicalUrl: "https://x.com/a_b/status/999",
      },
    },
    {
      name: "x.com trailing /photo/1 segment ignored",
      input: "https://x.com/someuser/status/1234567890/photo/1",
      expected: {
        platform: "x",
        platformPostId: "1234567890",
        handle: "someuser",
        canonicalUrl: "https://x.com/someuser/status/1234567890",
      },
    },
    {
      name: "surrounding whitespace trimmed",
      input: "  https://x.com/someuser/status/42  ",
      expected: {
        platform: "x",
        platformPostId: "42",
        handle: "someuser",
        canonicalUrl: "https://x.com/someuser/status/42",
      },
    },
    {
      name: "www.tiktok.com video link",
      input: "https://www.tiktok.com/@cooluser/video/7301234567890123456",
      expected: {
        platform: "tiktok",
        platformPostId: "7301234567890123456",
        handle: "cooluser",
        canonicalUrl:
          "https://www.tiktok.com/@cooluser/video/7301234567890123456",
      },
    },
    {
      name: "tiktok.com bare host + uppercase handle + query junk",
      input:
        "https://tiktok.com/@CoolUser/video/7301234?is_from_webapp=1&sender_device=pc",
      expected: {
        platform: "tiktok",
        platformPostId: "7301234",
        handle: "cooluser",
        canonicalUrl: "https://www.tiktok.com/@cooluser/video/7301234",
      },
    },
    {
      name: "instagram reel link with trailing slash",
      input: "https://www.instagram.com/reel/DAbC123xYz/",
      expected: {
        platform: "instagram",
        platformPostId: "DAbC123xYz",
        handle: null,
        canonicalUrl: "https://www.instagram.com/reel/DAbC123xYz/",
      },
    },
    {
      name: "instagram /p/ shortcode normalized to canonical reel URL",
      input: "https://instagram.com/p/DAbC123xYz",
      expected: {
        platform: "instagram",
        platformPostId: "DAbC123xYz",
        handle: null,
        canonicalUrl: "https://www.instagram.com/reel/DAbC123xYz/",
      },
    },
    {
      name: "instagram reel with query junk stripped",
      input: "https://www.instagram.com/reel/DAbC123xYz/?igsh=MzRlODBiNWFlZA==",
      expected: {
        platform: "instagram",
        platformPostId: "DAbC123xYz",
        handle: null,
        canonicalUrl: "https://www.instagram.com/reel/DAbC123xYz/",
      },
    },
  ];

  it.each(cases)("$name", ({ input, expected }) => {
    expect(parsePostUrl(input)).toEqual(expected);
  });

  it("preserves instagram shortcode case (shortcodes are case-sensitive, not handles)", () => {
    const result = parsePostUrl("https://www.instagram.com/reel/DAbC123xYz/");
    expect(result?.platformPostId).toBe("DAbC123xYz");
  });
});

describe("parsePostUrl — tiktok short links (exact pinned shape, spec-review note #1)", () => {
  it("vm.tiktok.com short link returns the needsResolution shape verbatim", () => {
    expect(parsePostUrl("https://vm.tiktok.com/ZM8abcDEF/")).toEqual({
      platform: "tiktok",
      platformPostId: null,
      handle: null,
      canonicalUrl: "https://vm.tiktok.com/ZM8abcDEF",
      needsResolution: true,
    });
  });

  it("strips tracking params from the short link and preserves code case", () => {
    expect(
      parsePostUrl("https://vm.tiktok.com/ZM8abcDEF?utm_campaign=spam&_r=1"),
    ).toEqual({
      platform: "tiktok",
      platformPostId: null,
      handle: null,
      canonicalUrl: "https://vm.tiktok.com/ZM8abcDEF",
      needsResolution: true,
    });
  });
});

describe("parsePostUrl — garbage returns null (never throws, never {})", () => {
  const garbage: Array<{ name: string; input: string }> = [
    { name: "empty string", input: "" },
    { name: "whitespace only", input: "   " },
    { name: "not a url", input: "not a url" },
    { name: "javascript: scheme", input: "javascript:alert(1)" },
    { name: "ftp scheme on a known host", input: "ftp://x.com/user/status/1" },
    { name: "unknown host", input: "https://example.com/watch?v=123" },
    { name: "x profile link without status", input: "https://x.com/someuser" },
    {
      name: "x status id not numeric",
      input: "https://x.com/someuser/status/notanumber",
    },
    {
      name: "tiktok path without @handle",
      input: "https://www.tiktok.com/video/7301234",
    },
    {
      name: "tiktok video id not numeric",
      input: "https://www.tiktok.com/@user/video/abc",
    },
    { name: "vm.tiktok.com without a code", input: "https://vm.tiktok.com/" },
    {
      name: "instagram without shortcode",
      input: "https://www.instagram.com/reel/",
    },
    {
      name: "instagram profile link",
      input: "https://www.instagram.com/someuser/",
    },
    {
      name: "subdomain spoof of x.com",
      input: "https://x.com.evil.io/a/status/1",
    },
    { name: "data: scheme", input: "data:text/html,hello" },
  ];

  it.each(garbage)("$name → null", ({ input }) => {
    let result: unknown = "sentinel-not-assigned";
    expect(() => {
      result = parsePostUrl(input);
    }).not.toThrow();
    // exactly null — `{}` would pass a falsy-flavored check and is banned
    expect(result).toBeNull();
  });
});
