import { createTRPCRouter } from "@/server/api/trpc";
import { banCreator } from "./ban-creator";
import { creatorList } from "./creators";
import { pendingPosts } from "./pending-posts";
import { refreshPost } from "./refresh-post";
import { reviewPost } from "./review-post";

export const adminRouter = createTRPCRouter({
  pendingPosts,
  creators: creatorList,
  reviewPost,
  banCreator,
  refreshPost,
});
