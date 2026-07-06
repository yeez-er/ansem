import { createTRPCRouter } from "@/server/api/trpc";
import { banCreator } from "./ban-creator";
import { pendingPosts } from "./pending-posts";
import { refreshPost } from "./refresh-post";
import { reviewPost } from "./review-post";

export const adminRouter = createTRPCRouter({
  pendingPosts,
  reviewPost,
  banCreator,
  refreshPost,
});
