import OpenAI from "openai";

let instance: OpenAI | null = null;

// Lazy proxy: don't require OPENAI_API_KEY at module load (next build
// evaluates route modules without runtime env).
export const openai = new Proxy({} as OpenAI, {
  get(_target, prop) {
    instance ??= new OpenAI({ maxRetries: 4 });
    return Reflect.get(instance, prop, instance);
  },
});

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
