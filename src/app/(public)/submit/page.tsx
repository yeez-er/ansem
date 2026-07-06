// Spec 008 (Task 24): the submit page. Signed-out visitors get an in-page gate
// (Clerk <Show>), not an edge redirect — /submit is publicly reachable (proxy.ts
// protects /admin only) so the gate's copy is what they actually see. The submit
// mutation is a protectedProcedure, which stays the real server-side boundary.
// Signed-in visitors get the client submit form.
import { Show, SignInButton } from "@clerk/nextjs";
import { SubmitForm } from "./submit-form";

// Clerk's <Show> reads the session, so the page renders per request. Explicit
// force-dynamic keeps a build-time prerender from baking the signed-out gate.
export const dynamic = "force-dynamic";

const CONTAINER = "mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10";

export default function SubmitPage() {
  return (
    <div className={CONTAINER}>
      <div>
        <h1 className="text-2xl font-bold uppercase tracking-tight">
          Submit a post
        </h1>
        <p className="text-sm text-foreground/60">
          Drop an X, TikTok, or Instagram post URL to put it on the board.
        </p>
      </div>
      <Show when="signed-out" fallback={<SubmitForm />}>
        <div className="flex flex-col items-start gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-6">
          <p className="text-sm text-foreground/80">Sign in to submit posts.</p>
          <SignInButton>
            <button
              type="button"
              className="bull-gradient rounded-md px-4 py-2 font-semibold text-white"
            >
              Sign in
            </button>
          </SignInButton>
        </div>
      </Show>
    </div>
  );
}
