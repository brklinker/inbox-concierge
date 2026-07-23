import { topK, type Neighbor } from "./similarity";

// Semantic inbox search, stage one (cheap retrieval): the natural-language
// query is embedded with the same model as the threads, then cosine-ranked
// against the user's vectors. Only the top-k survivors go to the LLM judgment
// stage — the same cascade the classifier uses, pointed at a query instead of
// a bucket description.
export const SEARCH_CANDIDATE_K = 30;
// Below this best-match similarity the query is unrelated to anything in the
// mailbox; skip the LLM call and answer "nothing matched" for free.
export const SEARCH_SIMILARITY_FLOOR = 0.2;

export interface SearchPoolItem {
  id: string;
  embedding: number[];
}

export interface SearchCandidateSelection {
  /** Top-k neighbours, most similar first. Empty when the pool is empty. */
  neighbors: Neighbor[];
  /** True when even the closest thread is below the similarity floor. */
  belowFloor: boolean;
}

/**
 * Which threads the LLM should judge for a search query: the top-k most
 * similar, ranked. `belowFloor` lets the caller short-circuit the LLM when
 * nothing in the mailbox is even loosely related to the query.
 */
export function selectSearchCandidates(
  queryEmbedding: number[],
  pool: SearchPoolItem[],
  opts = { k: SEARCH_CANDIDATE_K, similarityFloor: SEARCH_SIMILARITY_FLOOR },
): SearchCandidateSelection {
  const neighbors = topK(queryEmbedding, pool, opts.k);
  const belowFloor = (neighbors[0]?.similarity ?? 0) < opts.similarityFloor;
  return { neighbors, belowFloor };
}
