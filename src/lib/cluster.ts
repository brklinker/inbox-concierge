import { dot } from "./similarity";

export interface ClusterItem {
  id: string;
  embedding: number[];
}

export interface Cluster {
  centroid: number[];
  memberIds: string[];
}

function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

function mean(vectors: number[][]): number[] {
  const out = new Array(vectors[0].length).fill(0);
  for (const v of vectors) for (let i = 0; i < v.length; i++) out[i] += v[i];
  return out.map((x) => x / vectors.length);
}

/**
 * Spherical k-means over unit vectors (dot product == cosine). Deterministic:
 * seeded by farthest-point init from the most central item, so repeat runs
 * suggest the same clusters — same reasoning as temperature 0.
 */
export function kmeans(
  items: ClusterItem[],
  k: number,
  iterations = 15,
): Cluster[] {
  if (items.length === 0 || k <= 0) return [];
  k = Math.min(k, items.length);

  const globalMean = normalize(mean(items.map((i) => i.embedding)));
  let seedIdx = 0;
  let best = -Infinity;
  items.forEach((item, i) => {
    const sim = dot(item.embedding, globalMean);
    if (sim > best) {
      best = sim;
      seedIdx = i;
    }
  });
  const centroids: number[][] = [items[seedIdx].embedding];
  while (centroids.length < k) {
    let farIdx = 0;
    let farScore = Infinity;
    items.forEach((item, i) => {
      const nearest = Math.max(...centroids.map((c) => dot(item.embedding, c)));
      if (nearest < farScore) {
        farScore = nearest;
        farIdx = i;
      }
    });
    centroids.push(items[farIdx].embedding);
  }

  let assignment = new Array(items.length).fill(0);
  for (let iter = 0; iter < iterations; iter++) {
    const next = items.map((item) => {
      let bestC = 0;
      let bestSim = -Infinity;
      centroids.forEach((c, ci) => {
        const sim = dot(item.embedding, c);
        if (sim > bestSim) {
          bestSim = sim;
          bestC = ci;
        }
      });
      return bestC;
    });
    if (next.every((c, i) => c === assignment[i]) && iter > 0) break;
    assignment = next;
    for (let ci = 0; ci < centroids.length; ci++) {
      const members = items.filter((_, i) => assignment[i] === ci);
      if (members.length > 0) {
        centroids[ci] = normalize(mean(members.map((m) => m.embedding)));
      }
    }
  }

  return centroids
    .map((centroid, ci) => ({
      centroid,
      memberIds: items.filter((_, i) => assignment[i] === ci).map((i) => i.id),
    }))
    .filter((c) => c.memberIds.length > 0);
}
