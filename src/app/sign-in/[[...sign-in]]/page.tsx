// Task 4 (spec 009A): Clerk-hosted sign-in UI on a local catch-all route —
// auth.protect() in src/proxy.ts redirects here via NEXT_PUBLIC_CLERK_SIGN_IN_URL.
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="flex flex-1 items-center justify-center py-16">
      <SignIn />
    </main>
  );
}
