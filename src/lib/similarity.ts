// OpenAI embeddings are unit-normalized, so dot product == cosine similarity.
export function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export interface Neighbor {
  id: string;
  similarity: number;
}

/** Top-k most similar items to `query` among `pool` (excluding `excludeId`). */
export function topK(
  query: number[],
  pool: { id: string; embedding: number[] }[],
  k: number,
  excludeId?: string,
): Neighbor[] {
  return pool
    .filter((p) => p.id !== excludeId)
    .map((p) => ({ id: p.id, similarity: dot(query, p.embedding) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);
}

/** Most common value and the fraction of items that disagree with `label`. */
export function neighborConsensus(
  neighborLabels: string[],
  label: string,
): { majority: string | null; disagreement: number } {
  if (neighborLabels.length === 0) return { majority: null, disagreement: 0 };
  const counts = new Map<string, number>();
  for (const l of neighborLabels) counts.set(l, (counts.get(l) ?? 0) + 1);
  const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const agreeing = neighborLabels.filter((l) => l === label).length;
  return { majority, disagreement: 1 - agreeing / neighborLabels.length };
}
