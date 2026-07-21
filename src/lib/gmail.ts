import pLimit from "p-limit";
import { decodeHtmlEntities } from "./html-entities";

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
    snippet: last?.snippet ? decodeHtmlEntities(last.snippet) : null,
    internalDate: last?.internalDate ? new Date(Number(last.internalDate)) : null,
  };
}

interface GmailBodyPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailBodyPart[];
}

function findBody(part: GmailBodyPart | undefined, mimeType: string): string | null {
  if (!part) return null;
  if (part.mimeType === mimeType && part.body?.data) return part.body.data;
  for (const child of part.parts ?? []) {
    const found = findBody(child, mimeType);
    if (found) return found;
  }
  return null;
}

export interface ThreadMessageBody {
  from: string | null;
  date: string | null;
  html: string | null;
  text: string | null;
}

interface GmailFullMessage extends GmailMessage {
  payload?: GmailBodyPart & { headers?: { name: string; value: string }[] };
}

/**
 * Full message bodies for the read view. Fetched on demand, returned to the
 * client, and never written to the database — classification only ever sees
 * metadata.
 */
export async function getThreadMessages(
  accessToken: string,
  id: string,
): Promise<ThreadMessageBody[]> {
  const thread = await gmailFetch<{ messages?: GmailFullMessage[] }>(
    accessToken,
    `/threads/${id}?format=full`,
  );
  return (thread.messages ?? []).map((m) => {
    const html = findBody(m.payload, "text/html");
    const text = findBody(m.payload, "text/plain");
    return {
      from: header(m, "From"),
      date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
      html: html ? Buffer.from(html, "base64url").toString("utf8") : null,
      text: text ? Buffer.from(text, "base64url").toString("utf8") : null,
    };
  });
}
