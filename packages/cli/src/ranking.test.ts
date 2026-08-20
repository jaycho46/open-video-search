import { describe, expect, it } from "vitest";

import { cosineSimilarity, normalizeVector, reciprocalRankFusion } from "./ranking.js";

describe("ranking", () => {
  it("normalizes vectors and computes cosine similarity", () => {
    const normalized = normalizeVector(new Float32Array([3, 4]));
    expect(normalized[0]).toBeCloseTo(0.6);
    expect(normalized[1]).toBeCloseTo(0.8);
    expect(cosineSimilarity(normalized, normalized)).toBeCloseTo(1);
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBe(0);
  });

  it("uses weighted reciprocal rank fusion", () => {
    const results = reciprocalRankFusion(
      [{ id: "visual-only", rank: 1 }, { id: "both", rank: 2 }],
      [{ id: "both", rank: 1 }, { id: "text-only", rank: 2 }],
    );
    expect(results[0]?.id).toBe("both");
    expect(results[0]?.match).toEqual(["visual", "text"]);
  });
});

