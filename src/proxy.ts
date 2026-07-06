import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Only /admin/** redirects a signed-out visitor at the edge. /submit is
// publicly reachable and self-gates in-page (spec 008, Task 24): its "Sign in
// to submit posts." gate must be visible to signed-out visitors, and the submit
// mutation (protectedProcedure) is the real server-side boundary. Every public
// route must keep working with Clerk unreachable.
const isProtectedRoute = createRouteMatcher(["/admin(.*)"]);

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
