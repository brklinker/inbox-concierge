import { auth } from "@/auth";
import { getThreadMessages } from "@/lib/gmail";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Full bodies for the read view. On-demand only: the response goes straight
// to the client and nothing here touches the database.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email || !session.accessToken || session.error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    // The Gmail call runs with the user's own token, so it can only ever
    // reach threads in their mailbox.
    const messages = await getThreadMessages(session.accessToken, id);
    return NextResponse.json({ messages });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
