// Spec 009B (Task 26): the /admin pending queue page. Server component — the
// FIFO moderation queue arrives through the real tRPC caller (admin.pendingPosts,
// oldest-first) and is handed to the client <PendingQueue> for the per-row
// Approve/Reject actions. The layout is the SERVER-SIDE admin gate; pendingPosts
// (adminProcedure) is the boundary that actually protects this data. A
// data-layer failure renders the retry card, never the raw error (board/creator
// precedent).
import { EmptyState } from "@/components/empty-state";
import { appRouter } from "@/server/api/root";
import { createCallerFactory, createTRPCContext } from "@/server/api/trpc";
import { PendingQueue } from "./pending-queue";

// Per-request render, same reasoning as the board page: the queue is live
// moderation state, never prerendered.
export const dynamic = "force-dynamic";

const createCaller = createCallerFactory(appRouter);

async function loadPending() {
  const caller = createCaller(
    await createTRPCContext({ headers: new Headers() }),
  );
  return caller.admin.pendingPosts();
}

export default async function AdminPendingPage() {
  const posts = await loadPending().catch((error: unknown) => {
    console.error("admin.pending.load_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  });

  if (posts === null) {
    return (
      <EmptyState
        message="The queue hit a snag loading. Give it another try."
        cta={{ href: "/admin", label: "Retry", reload: true }}
      />
    );
  }

  return <PendingQueue initialPosts={posts} />;
}
