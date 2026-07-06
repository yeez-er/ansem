// Spec 008 (Task 23): the styled 404, rendered inside the root layout so the
// brand chrome stays. One boundary at the app root serves every notFound() —
// unknown/banned creators today, the admin gate later — and unmatched URLs.
import { EmptyState } from "@/components/empty-state";

export default function NotFound() {
  return (
    <EmptyState
      message="Nothing here — the bull ran off with that page."
      cta={{ href: "/", label: "Back to the board" }}
    />
  );
}
