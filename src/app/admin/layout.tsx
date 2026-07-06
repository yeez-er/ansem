// Spec 009B (Task 26): the /admin layout is the SERVER-SIDE gate for every admin
// route. isAdmin is session-derived in the tRPC context (never from input); a
// signed-in non-admin gets notFound() → the styled root 404, with no admin
// chrome or child data in the response. Page hiding is UX only — adminProcedure
// is the real boundary. The edge proxy already redirects signed-OUT visitors, so
// this gate's job is the authed-non-admin case. Renders the Pending/Creators
// tabs around each admin page.
import Link from "next/link";
import { notFound } from "next/navigation";
import { createTRPCContext } from "@/server/api/trpc";

// Per-request render: the gate reads the live session; a static prerender would
// bake one visitor's admin state into the bundle.
export const dynamic = "force-dynamic";

const CONTAINER = "mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6";
const TAB =
  "rounded-md px-3 py-1.5 text-sm font-medium text-foreground/60 transition-colors hover:text-accent";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const ctx = await createTRPCContext({ headers: new Headers() });
  if (!ctx.isAdmin) notFound();

  return (
    <div className={CONTAINER}>
      <div>
        <h1 className="text-2xl font-bold uppercase tracking-tight">Admin</h1>
        <nav
          aria-label="Admin sections"
          className="mt-3 flex w-fit gap-1 rounded-lg bg-white/[0.05] p-1"
        >
          <Link href="/admin" className={TAB}>
            Pending
          </Link>
          <Link href="/admin/creators" className={TAB}>
            Creators
          </Link>
        </nav>
      </div>
      {children}
    </div>
  );
}
