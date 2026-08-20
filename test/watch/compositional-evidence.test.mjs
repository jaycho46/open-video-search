import assert from "node:assert/strict";
import test from "node:test";

import { WATCH_BEHAVIOR_CASES } from "./cases.mjs";
import {
  completeEvidenceGroups,
  overlapsInterval,
  verifiedEvidenceGroups,
} from "./compositional-evidence.mjs";

for (const behaviorCase of WATCH_BEHAVIOR_CASES) {
  test(`${behaviorCase.id} requires all anchors in one time window`, () => {
    const groups = completeEvidenceGroups(behaviorCase.anchors);
    const candidates = groups.filter((group) => overlapsInterval(group, behaviorCase.ground_truth_ms));

    assert.ok(candidates.length > 0, "expected a search candidate in the labeled interval");
    assert.deepEqual(
      new Set(candidates[0].matched_constraints),
      new Set(behaviorCase.anchors.map((anchor) => anchor.id)),
    );
    assert.ok(candidates[0].end_ms - candidates[0].start_ms <= 12_000);

    const reviewed = verifiedEvidenceGroups(behaviorCase.anchors).filter((group) =>
      overlapsInterval(group, behaviorCase.ground_truth_ms),
    );
    if (behaviorCase.expected_outcome === "match") {
      assert.ok(reviewed.length > 0, behaviorCase.review_note);
    } else {
      assert.equal(reviewed.length, 0, behaviorCase.review_note);
    }

    if (behaviorCase.reject_timestamp_ms !== undefined) {
      assert.equal(
        groups.some(
          (group) =>
            group.start_ms <= behaviorCase.reject_timestamp_ms &&
            group.end_ms >= behaviorCase.reject_timestamp_ms,
        ),
        false,
        "an attribute-only scene must not become a complete evidence group",
      );
    }
  });
}
