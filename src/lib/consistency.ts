import { neighborConsensus, topK } from "./similarity";

export interface ConsistencyThread {
  id: string;
  embedding: number[];
  bucketName: string | null;
  confidence: number | null;
  corrected: boolean;
}

export interface ConsistencyFlag {
  id: string;
  majority: string;
}

export const CONSISTENCY_NEIGHBORS = 10;
export const CONSISTENCY_DISAGREEMENT = 0.6;
export const CONSISTENCY_CONFIDENCE = 0.7;

/**
 * Flag threads whose nearest neighbors mostly carry a different label and
 * whose own confidence is low. Corrected threads inform their neighbors but
 * are never flagged themselves — human placement isn't second-guessed.
 */
export function findInconsistent(
  pool: ConsistencyThread[],
  targetIds: ReadonlySet<string>,
  opts = {
    neighbors: CONSISTENCY_NEIGHBORS,
    disagreement: CONSISTENCY_DISAGREEMENT,
    confidence: CONSISTENCY_CONFIDENCE,
  },
): ConsistencyFlag[] {
  const vectors = pool.map((p) => ({ id: p.id, embedding: p.embedding }));
  const byId = new Map(pool.map((p) => [p.id, p]));
  const flags: ConsistencyFlag[] = [];
  for (const t of pool) {
    if (!targetIds.has(t.id)) continue;
    if (t.corrected) continue;
    if ((t.confidence ?? 1) >= opts.confidence) continue;
    if (!t.bucketName) continue;
    const neighborLabels = topK(t.embedding, vectors, opts.neighbors, t.id)
      .map((n) => byId.get(n.id)?.bucketName)
      .filter((l): l is string => !!l);
    const { majority, disagreement } = neighborConsensus(
      neighborLabels,
      t.bucketName,
    );
    if (disagreement > opts.disagreement && majority && majority !== t.bucketName) {
      flags.push({ id: t.id, majority });
    }
  }
  return flags;
}
