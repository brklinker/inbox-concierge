import { auth, signIn } from "@/auth";
import { InboxApp } from "@/components/inbox/inbox-app";
import { Button } from "@/components/ui/button";

export default async function Home() {
  const session = await auth();

  if (!session?.user?.email || session.error) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-24 text-center">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Inbox Concierge</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Sign in with Google and your last 200 inbox threads get sorted into
            buckets — Important, Can Wait, Newsletter, Notifications,
            Auto-Archive — plus any bucket you define in plain English.
          </p>
          {session?.error && (
            <p className="text-sm text-destructive">
              Your session expired — please sign in again.
            </p>
          )}
        </div>
        <form
          action={async () => {
            "use server";
            await signIn("google");
          }}
        >
          <Button type="submit">Sign in with Google</Button>
        </form>
        <p className="max-w-md text-xs text-muted-foreground">
          Read-only Gmail access. Classification sees only subjects, senders,
          and preview snippets — full bodies are fetched just-in-time when you
          open a thread, and never stored.
        </p>
      </main>
    );
  }

  return <InboxApp userEmail={session.user.email} />;
}
