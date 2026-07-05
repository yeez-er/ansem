// Spec 007 leaderboard router. recentPosts lands in iteration 2 of Task 18.
import { createTRPCRouter } from "@/server/api/trpc";
import { creator } from "./creator";
import { get } from "./get";

export const leaderboardRouter = createTRPCRouter({ get, creator });
