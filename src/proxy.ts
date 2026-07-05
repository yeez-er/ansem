import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Only /submit and /admin/** require a session (spec 009A) — every public
// route must keep working with Clerk unreachable.
const isProtectedRoute = createRouteMatcher(["/submit(.*)", "/admin(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes so tRPC context can read the session
    "/(api|trpc)(.*)",
  ],
};
