// @vitest-environment jsdom
// Task 22 (spec 008): board table rows — rank medals, rank-1 bull-gradient
// border, creator cell (avatar / label / platform badge), bigint-safe stat
// columns, and the whole row as a link to the creator page. Placeholder
// creators read "Unclaimed creator", never the raw placeholder: handle.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PublicBoardEntry } from "@/server/api/routers/leaderboard/dto";
import { LeaderboardTable } from "./leaderboard-table";

afterEach(cleanup);

type EntryOverrides = Partial<Omit<PublicBoardEntry, "creator">> & {
  creator?: Partial<PublicBoardEntry["creator"]>;
};

function makeEntry(over: EntryOverrides = {}): PublicBoardEntry {
  const { creator, ...rest } = over;
  return {
    rank: 1,
    creator: {
      id: "11111111-1111-4111-8111-111111111111",
      platform: "x",
      handle: "bullpostoor",
      displayName: "Bull Postoor",
      avatarUrl: "https://images.example/bull.png",
      profileUrl: "https://x.com/bullpostoor",
      ...creator,
    },
    score: "1510",
    views: "1234567",
    likes: "10",
    comments: "2",
    shares: "1",
    postCount: 7,
    ...rest,
  };
}

const FOUR_RANKS: PublicBoardEntry[] = [
  makeEntry(),
  makeEntry({ rank: 2, creator: { id: "c2", handle: "second" } }),
  makeEntry({ rank: 3, creator: { id: "c3", handle: "third" } }),
  makeEntry({ rank: 4, creator: { id: "c4", handle: "fourth" } }),
];

describe("LeaderboardTable", () => {
  it("renders nothing for an empty board (the page owns the empty state)", () => {
    const { container } = render(<LeaderboardTable entries={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders each row as a link to the creator page", () => {
    render(<LeaderboardTable entries={[makeEntry()]} />);
    const row = screen.getByRole("link", { name: /@bullpostoor/ });
    expect(row.getAttribute("href")).toBe(
      "/creator/11111111-1111-4111-8111-111111111111",
    );
  });

  it("labels every stat column", () => {
    render(<LeaderboardTable entries={[makeEntry()]} />);
    for (const label of [
      "Rank",
      "Creator",
      "Score",
      "Views",
      "Likes",
      "Comments",
      "Shares",
      "Posts",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("shows the platform badge with its accessible name", () => {
    render(<LeaderboardTable entries={[makeEntry()]} />);
    expect(screen.getByRole("img", { name: "X" })).toBeTruthy();
  });

  it("abbreviates stat columns with the exact grouped value in title", () => {
    render(<LeaderboardTable entries={[makeEntry()]} />);
    expect(screen.getByTitle("1,234,567").textContent).toBe("1.2M");
    expect(screen.getByTitle("1,510").textContent).toBe("1.5K");
  });

  it("survives > 2^53 view counts exactly", () => {
    render(
      <LeaderboardTable entries={[makeEntry({ views: "9007199254740993" })]} />,
    );
    expect(screen.getByTitle("9,007,199,254,740,993").textContent).toBe(
      "9007.2T",
    );
  });

  it("renders the post count", () => {
    render(<LeaderboardTable entries={[makeEntry()]} />);
    expect(screen.getByText("7")).toBeTruthy();
  });

  it("gives ranks 1–3 decorative medals and later ranks none", () => {
    render(<LeaderboardTable entries={FOUR_RANKS} />);
    for (const medal of ["👑", "🥈", "🥉"]) {
      expect(screen.getByText(medal).getAttribute("aria-hidden")).toBe("true");
    }
    const fourth = screen.getByRole("link", { name: /@fourth/ });
    expect(fourth.textContent).not.toMatch(/👑|🥈|🥉/);
  });

  it("wraps exactly the rank-1 row in the bull-gradient border", () => {
    const { container } = render(<LeaderboardTable entries={FOUR_RANKS} />);
    const wrappers = container.querySelectorAll(".bull-gradient");
    expect(wrappers.length).toBe(1);
    expect(wrappers[0]?.textContent).toContain("@bullpostoor");
  });

  it("renders placeholder creators as Unclaimed creator, never the raw handle", () => {
    const { container } = render(
      <LeaderboardTable
        entries={[
          makeEntry({
            creator: {
              handle: "placeholder:CSEEDPH01",
              displayName: null,
              avatarUrl: null,
              platform: "instagram",
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Unclaimed creator")).toBeTruthy();
    expect(container.textContent).not.toContain("placeholder:");
  });

  it("paints the avatar from avatarUrl and hides it from assistive tech", () => {
    const { container } = render(<LeaderboardTable entries={[makeEntry()]} />);
    const avatar = container.querySelector('[style*="bull.png"]');
    expect(avatar).not.toBeNull();
    expect(avatar?.getAttribute("aria-hidden")).toBe("true");
  });

  it("falls back to an initial when avatarUrl is null", () => {
    render(
      <LeaderboardTable
        entries={[makeEntry({ creator: { avatarUrl: null } })]}
      />,
    );
    expect(screen.getByText("B")).toBeTruthy(); // initial of @bullpostoor
  });

  it("treats an unsafe avatarUrl as missing (no style injection)", () => {
    const hostile =
      'https://images.example/a.png") , url("https://evil.example';
    const { container } = render(
      <LeaderboardTable
        entries={[makeEntry({ creator: { avatarUrl: hostile } })]}
      />,
    );
    expect(screen.getByText("B")).toBeTruthy();
    expect(container.querySelector('[style*="evil.example"]')).toBeNull();
  });
});
