import OpenAI from "openai";

export const openai = new OpenAI({ maxRetries: 4 });

export const CLASSIFY_MODEL = process.env.OPENAI_CLASSIFY_MODEL ?? "gpt-4o-mini";
export const EMBEDDING_MODEL = "text-embedding-3-small";

/** Text embedded for a thread: subject | sender domain | snippet, truncated. */
export function embeddingInput(t: {
  subject: string | null;
  senderDomain: string | null;
  snippet: string | null;
}): string {
  return [t.subject ?? "", t.senderDomain ?? "", t.snippet ?? ""]
    .join(" | ")
    .slice(0, 500);
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts.map((t) => (t.trim() === "" ? "(empty)" : t)),
  });
  return res.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}
