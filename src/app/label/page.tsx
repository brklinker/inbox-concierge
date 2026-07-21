import { auth } from "@/auth";
import { LabelMode } from "@/components/label/label-mode";

// Hidden labeling route: not linked from the main UI. Assigns gold labels
// used as eval ground truth by `npm run eval`.
export default async function LabelPage() {
  const session = await auth();
  if (!session?.user?.email || session.error) {
    return (
      <main className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Sign in on the home page first.
      </main>
    );
  }
  return <LabelMode />;
}
