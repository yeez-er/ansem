// @vitest-environment jsdom
// Task 22 (spec 008): recent-posts rail — external card links (new tab,
// noopener), platform badge + handle, caption, view count. A never-polled
// post (latestSnapshotAt === null) reads "— pending", never a fake 0 count.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RecentPost } from "@/server/api/routers/leaderboard/recent-posts";
import { RecentPosts } from "./recent-posts";

afterEach(cleanup);

type PostOverrides = Partial<Omit<RecentPost, "creator">> & {
  creator?: Partial<RecentPost["creator"]>;
};

function makePost(over: PostOverrides = {}): RecentPost {
  const { creator, ...rest } = over;
  return {
    id: "22222222-2222-4222-8222-222222222222",
    url: "https://x.com/bullpostoor/status/1234567890",
    caption: "ANSEM is so back",
    postedAt: "2026-07-01T12:00:00.000Z",
    views: "1234567",
    likes: "10",
    comments: "2",
    shares: "1",
    score: "1510",
    latestSnapshotAt: "2026-07-05T18:00:00.000Z",
    creator: {
      id: "11111111-1111-4111-8111-111111111111",
      platform: "x",
      handle: "bullpostoor",
      displayName: "Bull Postoor",
      avatarUrl: null,
      profileUrl: "https://x.com/bullpostoor",
      ...creator,
    },
    ...rest,
  };
}

describe("RecentPosts", () => {
  it("renders nothing for an empty feed", () => {
    const { container } = render(<RecentPosts posts={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the rail heading", () => {
    render(<RecentPosts posts={[makePost()]} />);
    expect(screen.getByRole("heading", { name: "Recent posts" })).toBeTruthy();
  });

  it("links each card to the source post in a new tab with noopener", () => {
    render(<RecentPosts posts={[makePost()]} />);
    const link = screen.getByRole("link", { name: /@bullpostoor/ });
    expect(link.getAttribute("href")).toBe(
      "https://x.com/bullpostoor/status/1234567890",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("shows badge, handle, caption and the abbreviated view count", () => {
    render(<RecentPosts posts={[makePost()]} />);
    expect(screen.getByRole("img", { name: "X" })).toBeTruthy();
    expect(screen.getByText("@bullpostoor")).toBeTruthy();
    expect(screen.getByText("ANSEM is so back")).toBeTruthy();
    expect(screen.getByTitle("1,234,567").textContent).toBe("1.2M");
    expect(screen.getByText("views")).toBeTruthy();
  });

  it("renders a never-polled post as pending — never a 0 count", () => {
    render(
      <RecentPosts
        posts={[makePost({ latestSnapshotAt: null, views: "0" })]}
      />,
    );
    const card = screen.getByRole("link", { name: /@bullpostoor/ });
    expect(within(card).getByText("— pending")).toBeTruthy();
    expect(within(card).queryByText("views")).toBeNull();
    expect(within(card).queryByText("0")).toBeNull();
  });

  it("omits the caption line when caption is null", () => {
    render(<RecentPosts posts={[makePost({ caption: null })]} />);
    const card = screen.getByRole("link", { name: /@bullpostoor/ });
    expect(card.textContent).not.toContain("null");
  });

  it("renders placeholder creators as Unclaimed creator, never the raw handle", () => {
    const { container } = render(
      <RecentPosts
        posts={[
          makePost({
            url: "https://www.instagram.com/reel/CSEEDPH01/",
            creator: {
              handle: "placeholder:CSEEDPH01",
              displayName: null,
              platform: "instagram",
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Unclaimed creator")).toBeTruthy();
    expect(container.textContent).not.toContain("placeholder:");
  });

  it("renders one card per post", () => {
    render(
      <RecentPosts
        posts={[
          makePost(),
          makePost({
            id: "33333333-3333-4333-8333-333333333333",
            url: "https://www.tiktok.com/@ansemtok/video/999",
            creator: { id: "c2", handle: "ansemtok", platform: "tiktok" },
          }),
        ]}
      />,
    );
    expect(screen.getAllByRole("link").length).toBe(2);
  });
});
