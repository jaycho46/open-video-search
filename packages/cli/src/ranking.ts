import { RRF_K, TEXT_WEIGHT, VISUAL_WEIGHT } from "./constants.js";

export type MatchKind = "visual" | "text";

export interface RankedCandidate {
  id: string;
  rank: number;
}

export interface FusedCandidate {
  id: string;
  score: number;
  match: MatchKind[];
}

export function reciprocalRankFusion(
  visual: RankedCandidate[],
  text: RankedCandidate[],
  visualWeight = VISUAL_WEIGHT,
  textWeight = TEXT_WEIGHT,
  k = RRF_K,
): FusedCandidate[] {
  const values = new Map<string, FusedCandidate>();
  const add = (candidate: RankedCandidate, kind: MatchKind, weight: number): void => {
    const value = values.get(candidate.id) ?? { id: candidate.id, score: 0, match: [] };
    value.score += weight / (k + candidate.rank);
    if (!value.match.includes(kind)) value.match.push(kind);
    values.set(candidate.id, value);
  };
  for (const candidate of visual) add(candidate, "visual", visualWeight);
  for (const candidate of text) add(candidate, "text", textWeight);
  return [...values.values()].sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

export function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export function normalizeVector(vector: Float32Array): Float32Array {
  let total = 0;
  for (const value of vector) total += value * value;
  const norm = Math.sqrt(total);
  if (norm === 0) return new Float32Array(vector);
  return Float32Array.from(vector, (value) => value / norm);
}

