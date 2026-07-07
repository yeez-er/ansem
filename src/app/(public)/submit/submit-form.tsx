"use client";

// Spec 008 (Task 24): the submit form. The platform auto-detect chip reuses the
// SAME parsePostUrl as the server (src/lib/post-url.ts) — no client copy of the
// parser. The submit mutation handles BOTH outcomes: onSuccess derives truthful
// copy from the returned status/alreadyTracked (no celebration on a no-op) and
// clears the input; onError maps typed error codes to friendly copy — never the
// raw error string (global rule). No toast library in the project, so feedback
// renders inline in an aria-live region (CopyButton precedent).

import { useState } from "react";
import { PlatformBadge } from "@/components/platform-badge";
import { parsePostUrl } from "@/lib/post-url";
import { api } from "@/trpc/react";

type FeedbackTone = "success" | "info" | "error";
type Feedback = { tone: FeedbackTone; text: string };

type SubmitResult = { status: string; alreadyTracked: boolean };
type SubmitErrorLike = {
  message?: string | null;
  data?: { code?: string | null } | null;
};

const RATE_LIMIT_COPY =
  "You've hit today's submission limit — try again in a bit.";

// Typed server `message` → friendly copy (the submit procedure sets these).
const MESSAGE_COPY: Record<string, string> = {
  UNSUPPORTED_URL:
    "That link isn't a supported X, TikTok, or Instagram post URL.",
  UNRESOLVABLE_URL:
    "We couldn't resolve that TikTok link — paste the full video URL.",
  RATE_LIMITED: RATE_LIMIT_COPY,
  CREATOR_BANNED: "That creator has been removed from the board.",
};
// tRPC `code` → friendly copy, for errors that carry no custom message.
const CODE_COPY: Record<string, string> = {
  TOO_MANY_REQUESTS: RATE_LIMIT_COPY,
  UNAUTHORIZED: "Sign in to submit posts.",
};
const GENERIC_ERROR = "Something went wrong — please try again.";

export function messageForSubmitError(error: SubmitErrorLike): Feedback {
  const byMessage = error.message ? MESSAGE_COPY[error.message] : undefined;
  const byCode = error.data?.code ? CODE_COPY[error.data.code] : undefined;
  return { tone: "error", text: byMessage ?? byCode ?? GENERIC_ERROR };
}

export function messageForSubmitSuccess(result: SubmitResult): Feedback {
  if (result.alreadyTracked) {
    return {
      tone: "info",
      text: "We're already tracking this post — it's on the board.",
    };
  }
  if (result.status === "approved") {
    return {
      tone: "success",
      text: "On the board — metrics update within the hour.",
    };
  }
  return {
    tone: "success",
    text: "Pending review — we'll add it to the board once it's approved.",
  };
}

const TONE_CLASS: Record<FeedbackTone, string> = {
  success: "text-accent",
  info: "text-foreground/70",
  error: "text-red-400",
};

export function SubmitForm() {
  const [url, setUrl] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const trimmed = url.trim();
  const parsed = trimmed ? parsePostUrl(trimmed) : null;

  const mutation = api.submissions.submit.useMutation({
    onSuccess: (result) => {
      setFeedback(messageForSubmitSuccess(result));
      // A no-op duplicate keeps the URL visible; a real submission clears it.
      if (!result.alreadyTracked) setUrl("");
    },
    onError: (error) => setFeedback(messageForSubmitError(error)),
  });

  // parsed !== null blocks garbage before it ever reaches the server; isPending
  // blocks a double submit while the first is in flight.
  const canSubmit = parsed !== null && !mutation.isPending;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setFeedback(null);
    mutation.mutate({ url: trimmed });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label htmlFor="post-url" className="text-sm font-medium">
        Post URL
      </label>
      <div className="flex items-center gap-3">
        {parsed ? <PlatformBadge platform={parsed.platform} /> : null}
        <input
          id="post-url"
          name="url"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://x.com/handle/status/…"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          className="flex-1 rounded-md border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>
      <button
        type="submit"
        disabled={!canSubmit}
        className="bull-gradient w-fit rounded-md px-4 py-2 font-mono font-semibold uppercase tracking-wide text-background box-glow disabled:opacity-50"
      >
        {mutation.isPending ? "Submitting…" : "Submit post"}
      </button>
      {feedback ? (
        <p
          role={feedback.tone === "error" ? "alert" : "status"}
          className={`text-sm ${TONE_CLASS[feedback.tone]}`}
        >
          {feedback.text}
        </p>
      ) : null}
    </form>
  );
}
