import { createTRPCRouter } from "@/server/api/trpc";
import { banCreator } from "./ban-creator";
import { reviewPost } from "./review-post";

// pendingPosts + refreshPost land in the next iteration (scoped per the build
// loop's "utility + 2 critical consumers" rule).
export const adminRouter = createTRPCRouter({ reviewPost, banCreator });
