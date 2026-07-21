import pLimit from "p-limit";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

// Gmail per-user quota is 250 units/sec; threads.get is 10 units.
const limit = pLimit(10);

async function gmailFetch<T>(accessToken: string, path: string): Promise<T> {
  const maxAttempts = 4;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${GMAIL_BASE}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) return res.json() as Promise<T>;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= maxAttempts - 1) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gmail API ${res.status} on ${path}: ${body.slice(0, 300)}`);
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt + Math.random() * 250));
  }
}

interface ThreadListResponse {
  threads?: { id: string }[];
  nextPageToken?: string;
}

export async function listThreadIds(
  accessToken: string,
  max = 200,
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  while (ids.length < max) {
    const pageSize = Math.min(100, max - ids.length);
    const data = await gmailFetch<ThreadListResponse>(
      accessToken,
      `/threads?maxResults=${pageSize}&labelIds=INBOX${pageToken ? `&pageToken=${pageToken}` : ""}`,
    );
    ids.push(...(data.threads ?? []).map((t) => t.id));
    pageToken = data.nextPageToken;
    if (!pageToken || !data.threads?.length) break;
  }
  return ids.slice(0, max);
}

interface GmailMessage {
  internalDate?: string;
  snippet?: string;
  payload?: { headers?: { name: string; value: string }[] };
}

interface GmailThread {
  id: string;
  messages?: GmailMessage[];
}

export interface ThreadMetadata {
  id: string;
  subject: string | null;
  sender: string | null;
  senderDomain: string | null;
  snippet: string | null;
  internalDate: Date | null;
}

function header(message: GmailMessage | undefined, name: string): string | null {
  return (
    message?.payload?.headers?.find(
      (h) => h.name.toLowerCase() === name.toLowerCase(),
    )?.value ?? null
  );
}

export function extractDomain(sender: string | null): string | null {
  const match = sender?.match(/@([\w.-]+)/);
  return match ? match[1].toLowerCase() : null;
}

export async function getThreadMetadata(
  accessToken: string,
  id: string,
): Promise<ThreadMetadata> {
  const thread = await limit(() =>
    gmailFetch<GmailThread>(
      accessToken,
      `/threads/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
    ),
  );
  const messages = thread.messages ?? [];
  // Subject and sender from the first message (thread origin); snippet and
  // date from the last (most recent activity), matching how Gmail lists threads.
  const first = messages[0];
  const last = messages[messages.length - 1];
  const sender = header(first, "From");
  return {
    id: thread.id,
    subject: header(first, "Subject"),
    sender,
    senderDomain: extractDomain(sender),
    snippet: last?.snippet ?? null,
    internalDate: last?.internalDate ? new Date(Number(last.internalDate)) : null,
  };
}
