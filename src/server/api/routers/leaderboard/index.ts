// Spec 007 leaderboard router: the public read surface (boards, creator
// profiles, recent-posts ticker).
import { createTRPCRouter } from "@/server/api/trpc";
import { creator } from "./creator";
import { get } from "./get";
import { recentPosts } from "./recent-posts";

export const leaderboardRouter = createTRPCRouter({
  get,
  creator,
  recentPosts,
});
