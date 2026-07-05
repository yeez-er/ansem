"use client";

// Spec 008: icon-only copy control — the aria-label is the accessible name.
// The clipboard is an external browser API: both outcomes surface as feedback,
// and a missing/blocked clipboard degrades to the failed state, never a crash
// and never a false "Copied".

import { useState } from "react";

type CopyButtonProps = {
  value: string;
  label: string;
  className?: string;
};

type CopyState = "idle" | "copied" | "failed";

const FEEDBACK: Record<Exclude<CopyState, "idle">, string> = {
  copied: "Copied",
  failed: "Copy failed",
};

export function CopyButton({ value, label, className }: CopyButtonProps) {
  const [state, setState] = useState<CopyState>("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
  };

  const classes = [
    "inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-foreground/80 hover:border-accent hover:text-accent",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type="button" aria-label={label} onClick={copy} className={classes}>
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      {state !== "idle" ? <span>{FEEDBACK[state]}</span> : null}
    </button>
  );
}
