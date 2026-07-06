"use client";

// Spec 009B (Task 27): the searchable creator moderation list. Ban/Unban sit
// behind a confirm dialog whose Confirm button is a PLAIN button — it STAYS OPEN
// until the banCreator mutation settles (an auto-closing dialog action would
// dismiss before the request resolves and swallow a failure), closing only in
// onSuccess. Both callbacks surface truthful feedback in an aria-live region;
// onError keeps the dialog open with mapped copy — never the raw error — so the
// moderator can retry. Search filters client-side (the v1 roster is small and
// fetched whole). No toast/dialog library in the project (CopyButton /
// PendingQueue precedent). This is the 2nd occurrence of the plain-button-async
// + error-map + aria-live shape; extract a shared admin-feedback helper on the
// 3rd (Task 26 note).

import type { inferRouterOutputs } from "@trpc/server";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { PlatformBadge } from "@/components/platform-badge";
import { creatorLabel } from "@/lib/creator-display";
import type { AppRouter } from "@/server/api/root";
import { api } from "@/trpc/react";

// Derived from the router output (trpc/react's AppRouter type precedent) — no
// hand-written parallel UI shape to drift from the procedure.
export type AdminCreator =
  inferRouterOutputs<AppRouter>["admin"]["creators"][number];

type FeedbackTone = "success" | "error";
type Feedback = { tone: FeedbackTone; text: string };
type BanErrorLike = {
  message?: string | null;
  data?: { code?: string | null } | null;
};

// Typed server message → friendly copy (banCreator sets CREATOR_NOT_FOUND).
const MESSAGE_COPY: Record<string, string> = {
  CREATOR_NOT_FOUND: "That creator no longer exists — refresh the list.",
};
const GENERIC_ERROR = "Something went wrong — please try again.";

export function messageForBanError(error: BanErrorLike): Feedback {
  const copy = error.message ? MESSAGE_COPY[error.message] : undefined;
  return { tone: "error", text: copy ?? GENERIC_ERROR };
}

function matches(creator: AdminCreator, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const name = creator.displayName ?? "";
  return (
    creator.handle.toLowerCase().includes(q) || name.toLowerCase().includes(q)
  );
}

const HEADERS = ["Creator", "Platform", "Posts", "Status"];
const ACTION_BASE =
  "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50";

export function CreatorsList({
  initialCreators,
}: {
  initialCreators: AdminCreator[];
}) {
  const [creators, setCreators] = useState(initialCreators);
  const [query, setQuery] = useState("");
  // The creator whose ban/unban is awaiting confirmation, or null when closed.
  const [confirming, setConfirming] = useState<AdminCreator | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const visible = useMemo(
    () => creators.filter((c) => matches(c, query)),
    [creators, query],
  );

  const mutation = api.admin.banCreator.useMutation({
    onSuccess: (updated) => {
      setCreators((rows) =>
        rows.map((row) =>
          row.id === updated.id ? { ...row, isBanned: updated.isBanned } : row,
        ),
      );
      setFeedback({
        tone: "success",
        text: updated.isBanned ? "Creator banned." : "Creator unbanned.",
      });
      setPending(false);
      setConfirming(null); // close manually only once the mutation succeeded
    },
    onError: (error) => {
      // Keep the dialog open so the moderator can retry; surface mapped copy.
      setFeedback(messageForBanError(error));
      setPending(false);
    },
  });

  const openConfirm = (creator: AdminCreator) => {
    if (pending) return;
    setFeedback(null);
    setConfirming(creator);
  };

  const cancel = () => {
    if (pending) return;
    setConfirming(null);
  };

  const confirm = () => {
    if (confirming === null || pending) return;
    setPending(true);
    setFeedback(null);
    mutation.mutate({ creatorId: confirming.id, banned: !confirming.isBanned });
  };

  return (
    <div className="flex flex-col gap-4">
      <input
        type="search"
        aria-label="Search creators"
        placeholder="Search creators…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full max-w-sm rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm outline-none focus:border-accent"
      />

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

      {creators.length === 0 ? (
        <EmptyState message="No creators yet — they appear once posts are submitted or discovered." />
      ) : visible.length === 0 ? (
        <p className="px-3 py-8 text-center text-sm text-foreground/50">
          No creators match your search.
        </p>
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
              {visible.map((creator) => (
                <tr key={creator.id} className="border-t border-white/5">
                  <td className="px-3 py-3 font-medium">
                    {creatorLabel(creator)}
                  </td>
                  <td className="px-3 py-3">
                    <PlatformBadge platform={creator.platform} />
                  </td>
                  <td className="px-3 py-3 tabular-nums text-foreground/70">
                    {creator.postCount}
                  </td>
                  <td className="px-3 py-3">
                    {creator.isBanned ? (
                      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-400">
                        Banned
                      </span>
                    ) : (
                      <span className="text-xs text-foreground/50">Active</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => openConfirm(creator)}
                        disabled={pending}
                        className={
                          creator.isBanned
                            ? `${ACTION_BASE} bg-accent/15 text-accent hover:bg-accent/25`
                            : `${ACTION_BASE} border border-white/15 text-foreground/70 hover:border-red-400 hover:text-red-400`
                        }
                      >
                        {creator.isBanned ? "Unban" : "Ban"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirming ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm creator moderation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
        >
          <div className="w-full max-w-sm rounded-lg border border-white/10 bg-background p-6">
            <p className="text-sm text-foreground/80">
              {confirming.isBanned ? "Unban" : "Ban"}{" "}
              <span className="font-semibold">{creatorLabel(confirming)}</span>?
              {confirming.isBanned
                ? " They will appear on the public board again."
                : " They will be hidden from the public board and their pending posts rejected."}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancel}
                disabled={pending}
                className={`${ACTION_BASE} border border-white/15 text-foreground/70 hover:text-foreground`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={pending}
                className={`${ACTION_BASE} bull-gradient text-white`}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
