import { auth, signIn } from "@/auth";
import { InboxApp } from "@/components/inbox/inbox-app";
import { Button } from "@/components/ui/button";

export default async function Home() {
  const session = await auth();

  if (!session?.user?.email || session.error) {
    return (
      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col justify-center px-6 py-16">
        <div className="border-b-[3px] border-ink pb-3">
          <p className="kicker text-press-700">
            A calmer inbox · sorted for you, live
          </p>
          <h1 className="mt-1 text-5xl font-semibold tracking-tight">
            Inbox Concierge
          </h1>
        </div>
        <div className="mt-px h-px bg-ink" />
        <p className="mt-8 max-w-[48ch] text-[17px] leading-relaxed">
          Your last 200 threads, filed into buckets — including any you
          describe in plain English. It sorts live, checks its own work, and
          learns when you re-file.
        </p>
        {session?.error && (
          <p className="mt-4 text-sm text-destructive">
            Your session expired — please sign in again.
          </p>
        )}
        <form
          className="mt-8"
          action={async () => {
            "use server";
            await signIn("google");
          }}
        >
          <Button type="submit" size="lg" className="rounded-[2px] text-[15px]">
            Sign in with Google
          </Button>
        </form>
        <p className="mt-6 max-w-[54ch] text-[13px] text-muted-foreground">
          Read-only. Only subjects, senders, and snippets — never message
          bodies. Delete everything any time.
        </p>
      </main>
    );
  }

  return <InboxApp userEmail={session.user.email} />;
}
