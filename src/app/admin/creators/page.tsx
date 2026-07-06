// Spec 009B (Task 27): the /admin/creators page. Server component — the creator
// roster arrives through the real tRPC caller (admin.creators, busiest-first)
// and is handed to the client <CreatorsList> for search + ban/unban. The admin
// layout is the SERVER-SIDE gate; creators (adminProcedure) is the boundary that
// actually protects this data. A data-layer failure renders the retry card,
// never the raw error (pending-queue/board/creator precedent).
import { EmptyState } from "@/components/empty-state";
import { appRouter } from "@/server/api/root";
import { createCallerFactory, createTRPCContext } from "@/server/api/trpc";
import { CreatorsList } from "./creators-list";

// Per-request render, same reasoning as the pending page: this is live
// moderation state, never prerendered.
export const dynamic = "force-dynamic";

const createCaller = createCallerFactory(appRouter);

async function loadCreators() {
  const caller = createCaller(
    await createTRPCContext({ headers: new Headers() }),
  );
  return caller.admin.creators();
}

export default async function AdminCreatorsPage() {
  const creators = await loadCreators().catch((error: unknown) => {
    console.error("admin.creators.load_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  });

  if (creators === null) {
    return (
      <EmptyState
        message="The creator list hit a snag loading. Give it another try."
        cta={{ href: "/admin/creators", label: "Retry", reload: true }}
      />
    );
  }

  return <CreatorsList initialCreators={creators} />;
}
