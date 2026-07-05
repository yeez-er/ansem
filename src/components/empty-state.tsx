// Spec 008: shared empty state — bull glyph + message + optional CTA link.
// The glyph is decorative; the message carries the meaning. The CTA navigates,
// so it is a real link (buttons act, links navigate — never href="#").

import Link from "next/link";

type EmptyStateProps = {
  message: string;
  cta?: { href: string; label: string };
};

export function EmptyState({ message, cta }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-4 px-4 py-16 text-center">
      <span aria-hidden="true" className="text-5xl">
        🐂
      </span>
      <p className="max-w-sm text-sm text-foreground/60">{message}</p>
      {cta ? (
        <Link
          href={cta.href}
          className="bull-gradient rounded-md px-4 py-2 text-sm font-semibold text-white"
        >
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}
