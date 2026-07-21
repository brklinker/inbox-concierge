import { dot } from "./similarity";

export interface CandidateThread {
  id: string;
  embedding: number[];
  confidence: number | null;
  corrected: boolean;
}

// Candidate retrieval: top-k threads by similarity to the bucket embedding,
// plus anything the classifier was unsure about.
const CANDIDATE_K = 40;
const CANDIDATE_CONFIDENCE = 0.6;
// Vague bucket names ("Misc") retrieve nothing meaningful; if even the best
// match is this weak, fall back to evaluating every thread.
const SIMILARITY_FLOOR = 0.25;

export interface CandidateSelection {
  ids: Set<string>;
  usedFallback: boolean;
}

/**
 * Which threads the LLM should evaluate for a newly created bucket. Corrected
 * threads are excluded either way — human placement is never auto-moved.
 */
export function selectCandidates(
  pool: CandidateThread[],
  bucketEmbedding: number[],
  opts = {
    k: CANDIDATE_K,
    confidenceFloor: CANDIDATE_CONFIDENCE,
    similarityFloor: SIMILARITY_FLOOR,
  },
): CandidateSelection {
  const movable = pool.filter((t) => !t.corrected);
  const ranked = movable
    .map((t) => ({ id: t.id, similarity: dot(t.embedding, bucketEmbedding) }))
    .sort((a, b) => b.similarity - a.similarity);

  const usedFallback = (ranked[0]?.similarity ?? 0) < opts.similarityFloor;
  const ids = new Set<string>();
  if (usedFallback) {
    for (const r of ranked) ids.add(r.id);
  } else {
    for (const r of ranked.slice(0, opts.k)) ids.add(r.id);
    for (const t of movable) {
      if ((t.confidence ?? 0) < opts.confidenceFloor) ids.add(t.id);
    }
  }
  return { ids, usedFallback };
}
