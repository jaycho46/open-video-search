import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { WATCH_BEHAVIOR_CASES } from "./cases.mjs";
import {
  completeEvidenceGroups,
  overlapsInterval,
  verifiedEvidenceGroups,
} from "./compositional-evidence.mjs";

const cli = fileURLToPath(new URL("../../packages/cli/dist/cli.js", import.meta.url));

function runCli(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `open-video exited with ${result.status}`);
  }
  return JSON.parse(result.stdout);
}

for (const behaviorCase of WATCH_BEHAVIOR_CASES) {
  const indexed = runCli(["index", behaviorCase.source, "--language", "ko", "--json"]);
  assert.equal(indexed.video_id, behaviorCase.video_id);

  const anchors = behaviorCase.anchors.map((anchor) => {
    const reviews = new Map(anchor.hits.map((hit) => [hit.timestamp_ms, hit.verified]));
    return {
      id: anchor.id,
      hits: runCli(anchor.args).hits.map((hit) => ({
        rank: hit.rank,
        timestamp_ms: hit.timestamp_ms,
        verified: reviews.get(hit.timestamp_ms),
      })),
    };
  });
  const groups = completeEvidenceGroups(anchors);
  const grounded = groups.find((group) => overlapsInterval(group, behaviorCase.ground_truth_ms));
  assert.ok(grounded, `${behaviorCase.id}: no complete group overlaps the labeled interval`);
  const context = runCli([
    "context",
    behaviorCase.video_id,
    "--at",
    String(grounded.timestamp_ms),
    "--before",
    "6s",
    "--after",
    "6s",
    "--frames",
    "5",
    "--json",
  ]);
  assert.ok(context.start_ms <= grounded.start_ms, `${behaviorCase.id}: context misses the first anchor`);
  assert.ok(context.end_ms >= grounded.end_ms, `${behaviorCase.id}: context misses the last anchor`);
  assert.equal(context.frames.length, 5, `${behaviorCase.id}: context did not return five frames`);
  const reviewed = verifiedEvidenceGroups(anchors).filter((group) =>
    overlapsInterval(group, behaviorCase.ground_truth_ms),
  );
  if (behaviorCase.expected_outcome === "match") {
    assert.ok(reviewed.length > 0, `${behaviorCase.id}: ${behaviorCase.review_note}`);
  } else {
    assert.equal(reviewed.length, 0, `${behaviorCase.id}: ${behaviorCase.review_note}`);
  }
  if (behaviorCase.reject_timestamp_ms !== undefined) {
    assert.equal(
      groups.some(
        (group) =>
          group.start_ms <= behaviorCase.reject_timestamp_ms &&
          group.end_ms >= behaviorCase.reject_timestamp_ms,
      ),
      false,
      `${behaviorCase.id}: selected the attribute-only fallback scene`,
    );
  }
  const result = behaviorCase.expected_outcome === "match" ? "verified-match" : "insufficient-after-frame-review";
  process.stdout.write(
    `PASS ${behaviorCase.id} ${grounded.start_ms}-${grounded.end_ms} ${result} constraints=${grounded.matched_constraints.join(",")}\n`,
  );
}
