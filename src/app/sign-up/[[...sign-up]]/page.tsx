// Task 4 (spec 009A): Clerk-hosted sign-up UI on a local catch-all route.
import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="flex flex-1 items-center justify-center py-16">
      <SignUp />
    </main>
  );
}
