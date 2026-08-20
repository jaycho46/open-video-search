import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const datasetPath = process.argv.slice(2).find((value) => value !== "--" && !value.startsWith("--"));
if (!datasetPath) {
  console.error("Usage: pnpm eval -- /absolute/path/to/dataset.json [--acknowledge-holdout]");
  process.exit(2);
}
const dataset = JSON.parse(await readFile(path.resolve(datasetPath), "utf8"));
if (!Array.isArray(dataset.videos)) throw new Error("dataset.videos must be an array");
if (dataset.contains_holdout && !process.argv.includes("--acknowledge-holdout")) {
  throw new Error("This dataset contains the frozen holdout. Re-run with --acknowledge-holdout and do not tune from its results.");
}
const expectedVideoCount = dataset.expected_video_count ?? 12;
const expectedQueryCount = dataset.expected_query_count ?? 60;
if (!Number.isInteger(expectedVideoCount) || !Number.isInteger(expectedQueryCount)) {
  throw new Error("Dataset expected counts must be integers.");
}

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repository, "packages", "cli", "dist", "cli.js");
const inRange = (timestamp, ranges, tolerance = 0) =>
  ranges.some((range) => timestamp >= range.start_ms - tolerance && timestamp <= range.end_ms + tolerance);

let visualTotal = 0;
let visualFound = 0;
let textTotal = 0;
let textFound = 0;
let frameTotal = 0;
let frameFound = 0;
const details = [];

for (const video of dataset.videos) {
  const inspect = JSON.parse(execFileSync(process.execPath, [cli, "inspect", video.index_directory, "--json"], { encoding: "utf8" }));
  if (inspect.manifest.video_id !== video.video_id) throw new Error(`video_id mismatch for ${video.index_directory}`);
  const framesText = await readFile(path.join(video.index_directory, "index", "frames.jsonl"), "utf8");
  const frameTimes = framesText.trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line).timestamp_ms);
  const gaps = [
    frameTimes[0] ?? inspect.manifest.duration_ms,
    ...frameTimes.slice(1).map((value, index) => value - frameTimes[index]),
    inspect.manifest.duration_ms - (frameTimes.at(-1) ?? 0),
  ];
  const maxGap = Math.max(...gaps);
  if (maxGap > 4_000) details.push({ video_id: video.video_id, failure: "frame-gap", max_gap_ms: maxGap });

  for (const query of video.queries ?? []) {
    const mode = query.kind === "text" ? "text" : query.kind === "visual" ? "visual" : "hybrid";
    const limit = mode === "text" ? 5 : 10;
    const args = [cli, "search", video.index_directory, query.query, "--mode", mode, "--top", String(limit), "--json"];
    if (query.visual_query) args.splice(-1, 0, "--visual-query", query.visual_query);
    const response = JSON.parse(execFileSync(process.execPath, args, { encoding: "utf8" }));
    const relevantHit = response.hits.find((hit) =>
      query.relevant_ranges.some((range) => hit.end_ms > range.start_ms && hit.start_ms < range.end_ms),
    );
    if (mode === "text") {
      textTotal += 1;
      if (relevantHit) textFound += 1;
    } else {
      visualTotal += 1;
      if (relevantHit) visualFound += 1;
    }
    if (relevantHit) {
      frameTotal += 1;
      if (relevantHit.frames?.some((frame) => inRange(frame.timestamp_ms, query.relevant_ranges, 2_000))) {
        frameFound += 1;
      } else {
        details.push({ video_id: video.video_id, query_id: query.id, failure: "evidence-frame" });
      }
    }
    if (!relevantHit) details.push({ video_id: video.video_id, query_id: query.id, failure: `recall@${limit}` });
  }
}

const queryCount = visualTotal + textTotal;
const metrics = {
  corpus_id: dataset.corpus_id,
  corpus_fingerprint: dataset.corpus_fingerprint,
  split: dataset.split ?? "custom",
  videos: dataset.videos.length,
  queries: queryCount,
  visual_hybrid_recall_at_10: visualTotal === 0 ? null : visualFound / visualTotal,
  text_recall_at_5: textTotal === 0 ? null : textFound / textTotal,
  evidence_frame_within_2s_given_relevant_hit: frameTotal === 0 ? null : frameFound / frameTotal,
  ...(dataset.contains_holdout || dataset.report_policy === "aggregate-only"
    ? {
        failure_counts: Object.fromEntries(
          [...new Set(details.map((detail) => detail.failure))]
            .sort()
            .map((failure) => [failure, details.filter((detail) => detail.failure === failure).length]),
        ),
      }
    : { details }),
};
console.log(JSON.stringify(metrics, null, 2));

const failed =
  dataset.videos.length !== expectedVideoCount ||
  queryCount !== expectedQueryCount ||
  visualTotal === 0 ||
  textTotal === 0 ||
  visualFound / visualTotal < 0.8 ||
  textFound / textTotal < 0.95 ||
  frameFound < frameTotal ||
  details.some((detail) => detail.failure === "frame-gap");
if (failed) process.exit(1);
