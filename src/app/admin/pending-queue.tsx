"use client";

// Spec 009B (Task 26): the pending moderation queue. Each row is a pending
// submission; Approve/Reject are PLAIN buttons — no auto-closing dialog wrapping
// the async mutation (the dialog would dismiss before the request settles and
// swallow a failure). The reviewPost mutation handles BOTH callbacks: onSuccess
// removes the row from the local list without a full reload and confirms the
// decision; onError maps typed codes to friendly copy — never the raw error
// string. No toast library in the project, so feedback renders in an aria-live
// region (CopyButton/SubmitForm precedent). While a decision is in flight every
// action button disables, so a moderator cannot double-submit.

import type { inferRouterOutputs } from "@trpc/server";
import { useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { PlatformBadge } from "@/components/platform-badge";
import { creatorLabel } from "@/lib/creator-display";
import type { AppRouter } from "@/server/api/root";
import { api } from "@/trpc/react";

// Derived from the router output (trpc/react's AppRouter type precedent) — no
// hand-written parallel UI shape to drift from the procedure.
export type PendingPost =
  inferRouterOutputs<AppRouter>["admin"]["pendingPosts"][number];

type Decision = "approved" | "rejected";
type FeedbackTone = "success" | "error";
type Feedback = { tone: FeedbackTone; text: string };
type ReviewErrorLike = {
  message?: string | null;
  data?: { code?: string | null } | null;
};

// Typed server message → friendly copy (reviewPost sets these on its errors).
const MESSAGE_COPY: Record<string, string> = {
  ALREADY_REVIEWED:
    "That post was already reviewed — refresh to see the current queue.",
  POST_NOT_FOUND: "That post is no longer in the queue.",
};
const GENERIC_ERROR = "Something went wrong — please try again.";

export function messageForReviewError(error: ReviewErrorLike): Feedback {
  const copy = error.message ? MESSAGE_COPY[error.message] : undefined;
  return { tone: "error", text: copy ?? GENERIC_ERROR };
}

// Submitted-at as a UTC date (YYYY-MM-DD): identical on server and client, so no
// hydration mismatch and no timezone boundary bug (UTC-everywhere rule).
export function formatSubmittedDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const HEADERS = ["Submitted", "Platform", "Creator", "Post", "Submitter"];
const ACTION_BASE =
  "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50";

export function PendingQueue({
  initialPosts,
}: {
  initialPosts: PendingPost[];
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [pending, setPending] = useState<{
    postId: string;
    decision: Decision;
  } | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const mutation = api.admin.reviewPost.useMutation({
    onSuccess: (updated) => {
      setPosts((rows) => rows.filter((row) => row.id !== updated.id));
      setFeedback({
        tone: "success",
        text: `Post ${updated.status === "approved" ? "approved" : "rejected"}.`,
      });
      setPending(null);
    },
    onError: (error) => {
      setFeedback(messageForReviewError(error));
      setPending(null);
    },
  });

  const review = (postId: string, decision: Decision) => {
    if (pending !== null) return; // one decision in flight at a time
    setPending({ postId, decision });
    setFeedback(null);
    mutation.mutate({ postId, decision });
  };

  return (
    <div className="flex flex-col gap-4">
      {feedback ? (
        <p
          role={feedback.tone === "error" ? "alert" : "status"}
          className={`text-sm ${
            feedback.tone === "error" ? "text-red-400" : "text-accent"
          }`}
        >
          {feedback.text}
        </p>
      ) : null}

      {posts.length === 0 ? (
        <EmptyState message="Queue clear — nothing waiting for review." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-foreground/50">
                {HEADERS.map((header) => (
                  <th key={header} className="px-3 py-2 font-medium">
                    {header}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.id} className="border-t border-white/5">
                  <td className="whitespace-nowrap px-3 py-3 text-foreground/70">
                    {formatSubmittedDate(post.submittedAt)}
                  </td>
                  <td className="px-3 py-3">
                    <PlatformBadge platform={post.platform} />
                  </td>
                  <td className="px-3 py-3 font-medium">
                    {creatorLabel(post.creator)}
                  </td>
                  <td className="px-3 py-3">
                    <a
                      href={post.url}
                      target="_blank"
                      rel="noopener"
                      className="text-accent hover:underline"
                    >
                      View post
                    </a>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-foreground/60">
                    {post.submittedByUserId ?? "Discovery"}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => review(post.id, "approved")}
                        disabled={pending !== null}
                        className={`${ACTION_BASE} bg-accent/15 text-accent hover:bg-accent/25`}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => review(post.id, "rejected")}
                        disabled={pending !== null}
                        className={`${ACTION_BASE} border border-white/15 text-foreground/70 hover:border-red-400 hover:text-red-400`}
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
