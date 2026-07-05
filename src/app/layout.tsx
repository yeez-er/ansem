import { ClerkProvider, Show, SignInButton, UserButton } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
            <header className="border-b border-white/10">
              <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-4">
                <div>
                  <Link
                    href="/"
                    className="text-lg font-bold uppercase tracking-tight"
                  >
                    <span aria-hidden="true">🐂</span> $ANSEM · THE BLACK BULL
                  </Link>
                  <p className="text-xs text-foreground/60">
                    Post. Farm views. Climb.
                  </p>
                </div>
                <nav
                  aria-label="Main"
                  className="flex items-center gap-5 text-sm"
                >
                  <Link href="/" className="hover:text-accent">
                    Leaderboard
                  </Link>
                  <Link href="/submit" className="hover:text-accent">
                    Submit
                  </Link>
                  {/* Clerk v7: <Show> replaces <SignedIn>/<SignedOut> */}
                  <Show when="signed-out" fallback={<UserButton />}>
                    <SignInButton>
                      <button
                        type="button"
                        className="bull-gradient rounded-md px-3 py-1.5 font-semibold text-white"
                      >
                        Sign in
                      </button>
                    </SignInButton>
                  </Show>
                </nav>
              </div>
            </header>
            <main className="flex flex-1 flex-col">{children}</main>
            <footer className="border-t border-white/10">
              <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-6 text-xs text-foreground/60">
                <div className="flex items-center gap-4">
                  <a
                    href="https://blackbullsol.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-accent"
                  >
                    blackbullsol.com
                  </a>
                  <a
                    href="https://x.com/blackbullsol"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-accent"
                  >
                    @blackbullsol
                  </a>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="break-all font-mono">{ANSEM_MINT}</code>
                  <CopyButton
                    value={ANSEM_MINT}
                    label="Copy the $ANSEM mint address"
                  />
                  <span>— the only real one</span>
                </div>
              </div>
            </footer>
          </TRPCReactProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
