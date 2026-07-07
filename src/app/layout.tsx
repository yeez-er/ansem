import { ClerkProvider, Show, SignInButton, UserButton } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { ANSEM_MINT } from "@/lib/token";
import { TRPCReactProvider } from "@/trpc/react";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "$ANSEM · THE BLACK BULL",
  description: "Post. Farm views. Climb.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* inside <body>, not around <html>: required with cache components (Clerk Core 3) */}
        <ClerkProvider>
          <TRPCReactProvider>
            <header className="border-b border-line">
              <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-4">
                <div className="flex items-center gap-3">
                  <Image
                    src="/bull.png"
                    alt="$ANSEM black bull"
                    width={44}
                    height={44}
                    priority
                    className="rounded-lg border border-accent-dim box-glow"
                  />
                  <div>
                    <Link
                      href="/"
                      className="font-mono text-sm font-bold uppercase tracking-wide text-accent text-glow"
                    >
                      $ANSEM · THE BLACK BULL
                    </Link>
                    <p className="font-mono text-[0.6rem] uppercase tracking-[0.28em] text-muted">
                      Post. Farm views. Climb.
                    </p>
                  </div>
                </div>
                <nav
                  aria-label="Main"
                  className="flex items-center gap-4 font-mono text-xs uppercase tracking-wider"
                >
                  <Link
                    href="/"
                    className="text-muted transition-colors hover:text-accent"
                  >
                    Leaderboard
                  </Link>
                  <Link
                    href="/submit"
                    className="text-muted transition-colors hover:text-accent"
                  >
                    Submit
                  </Link>
                  {/* Clerk v7: <Show> replaces <SignedIn>/<SignedOut> */}
                  <Show when="signed-out" fallback={<UserButton />}>
                    <SignInButton>
                      <button
                        type="button"
                        className="rounded-md bg-accent px-3 py-1.5 font-semibold uppercase tracking-wide text-background transition-colors hover:bg-accent-bright box-glow"
                      >
                        Sign in
                      </button>
                    </SignInButton>
                  </Show>
                </nav>
              </div>
            </header>
            <main className="flex flex-1 flex-col">{children}</main>
            <footer className="border-t border-line">
              <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-6 font-mono text-xs text-muted">
                <div className="flex items-center gap-4">
                  <a
                    href="https://blackbullsol.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="uppercase tracking-wider transition-colors hover:text-accent"
                  >
                    blackbullsol.com
                  </a>
                  <a
                    href="https://x.com/blackbullsol"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="uppercase tracking-wider transition-colors hover:text-accent"
                  >
                    @blackbullsol
                  </a>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.6rem] uppercase tracking-[0.2em] text-accent-dim">
                    Mint
                  </span>
                  <code className="break-all text-accent">{ANSEM_MINT}</code>
                  <CopyButton
                    value={ANSEM_MINT}
                    label="Copy the $ANSEM mint address"
                  />
                  <span className="uppercase tracking-wider">
                    — the only real one
                  </span>
                </div>
              </div>
            </footer>
          </TRPCReactProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
