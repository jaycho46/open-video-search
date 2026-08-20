import { describe, expect, it } from "vitest";

import {
  buildEvidenceWindows,
  normalizeSearchConstraints,
  parseSearchConstraint,
  type ConstraintEvidence,
} from "./compositional-search.js";

function evidence(
  constraintId: string,
  timestampMS: number,
  rank = 1,
  modality: "visual" | "text" = "visual",
  query = constraintId,
): ConstraintEvidence {
  return {
    constraintId,
    modality,
    query,
    rank,
    timestampMS,
    segmentId: String(timestampMS),
  };
}

describe("compositional search windows", () => {
  it("parses repeatable id=query constraints without consuming equals in the query", () => {
    expect(parseSearchConstraint("appearance=coat=color:white", "visual")).toEqual({
      id: "appearance",
      modality: "visual",
      query: "coat=color:white",
    });
    expect(() => parseSearchConstraint("MissingQuery", "text")).toThrow(/id=query/u);
    expect(() => parseSearchConstraint("Not_Lowercase=value", "text")).toThrow(/Constraint id/u);
  });

  it("deduplicates identical variants and rejects modalities excluded by mode", () => {
    expect(normalizeSearchConstraints([
      { id: "object", modality: "visual", query: "green bicycle" },
      { id: "object", modality: "visual", query: "green bicycle" },
      { id: "object", modality: "visual", query: "a green bike" },
    ], "hybrid")).toHaveLength(2);
    expect(() => normalizeSearchConstraints([
      { id: "object", modality: "visual", query: "green bicycle" },
    ], "text")).toThrow(/--mode text/u);
  });

  it("matches all logical constraints whose evidence is at most twelve seconds apart", () => {
    const windows = buildEvidenceWindows([
      evidence("action", 20_000, 2, "text", "opens the door"),
      evidence("object", 27_000, 3, "visual", "red suitcase"),
      evidence("attribute", 32_000, 1, "visual", "silver handle"),
    ], ["action", "object", "attribute"], 60_000, 12_000, true);

    expect(windows[0]).toMatchObject({
      startMS: 20_000,
      timestampMS: 26_000,
      matchedConstraints: ["action", "object", "attribute"],
      coverage: 3,
    });
  });

  it("does not merge evidence that is more than the configured window apart", () => {
    const windows = buildEvidenceWindows([
      evidence("action", 5_000),
      evidence("attribute", 17_001),
    ], ["action", "attribute"], 30_000, 12_000, true);
    expect(windows).toEqual([]);
  });

  it("excludes an attractive attribute-only scene when all constraints are required", () => {
    const windows = buildEvidenceWindows([
      evidence("attribute", 44_000, 1, "visual", "striped scarf"),
      evidence("attribute", 48_000, 2, "visual", "patterned scarf"),
    ], ["event", "subject", "attribute"], 90_000, 8_000, true);
    expect(windows).toEqual([]);
  });

  it("uses only the best variant per modality for one logical constraint", () => {
    const windows = buildEvidenceWindows([
      evidence("object", 10_000, 1, "visual", "orange cup"),
      evidence("object", 11_000, 2, "visual", "orange mug"),
      evidence("object", 12_000, 3, "text", "cup"),
    ], ["object"], 30_000, 8_000, true);
    expect(windows[0]?.evidence).toHaveLength(2);
    expect(windows[0]?.evidence.map((item) => item.query)).toEqual(["orange cup", "cup"]);
  });
});
