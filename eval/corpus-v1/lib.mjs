import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";

export const CORPUS_SCHEMA_VERSION = "open-video/eval-corpus/v1";
const REQUIRED_REGRESSION_EXCLUSIONS = ["Djiel71Ioic", "JS87kxzpHzg"];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function normalized(value) {
  return value.normalize("NFKC").toLocaleLowerCase("und");
}

function overlaps(left, right) {
  return left.end_ms > right.start_ms && left.start_ms < right.end_ms;
}

export function fingerprintPayload(corpus) {
  return {
    corpus_id: corpus.corpus_id,
    frozen_at: corpus.frozen_at,
    policy: corpus.policy,
    videos: corpus.videos.map((video) => ({
      id: video.id,
      split: video.split,
      duration_ms: video.duration_ms,
      source_sha256: video.source.sha256,
      captions: video.captions,
      queries: video.queries,
    })),
  };
}

export function labelFingerprint(corpus) {
  return createHash("sha256").update(JSON.stringify(fingerprintPayload(corpus))).digest("hex");
}

export function validateCorpus(corpus, { verifyFingerprint = true } = {}) {
  invariant(corpus && typeof corpus === "object", "Corpus must be a JSON object.");
  invariant(corpus.schema_version === CORPUS_SCHEMA_VERSION, `Expected ${CORPUS_SCHEMA_VERSION}.`);
  invariant(typeof corpus.corpus_id === "string" && corpus.corpus_id.length > 0, "corpus_id is required.");
  invariant(/^\d{4}-\d{2}-\d{2}$/u.test(corpus.frozen_at), "frozen_at must be YYYY-MM-DD.");
  invariant(corpus.annotation_license === "CC0-1.0", "Annotations must declare CC0-1.0.");
  invariant(corpus.policy && typeof corpus.policy === "object", "policy is required.");
  invariant(Array.isArray(corpus.policy.excluded_source_tokens), "policy.excluded_source_tokens must be an array.");
  for (const token of REQUIRED_REGRESSION_EXCLUSIONS) {
    invariant(corpus.policy.excluded_source_tokens.includes(token), `Required regression exclusion '${token}' is missing.`);
  }
  invariant(Array.isArray(corpus.videos), "videos must be an array.");

  const expectedVideos = corpus.policy.development_videos + corpus.policy.holdout_videos;
  invariant(corpus.videos.length === expectedVideos, `Expected exactly ${expectedVideos} videos.`);
  const videoIds = new Set();
  const filenames = new Set();
  const downloadUrls = new Set();
  const sourceHashes = new Set();
  const queryIds = new Set();
  const splitCounts = { development: 0, holdout: 0 };
  const kindCounts = { text: 0, visual: 0, hybrid: 0 };

  for (const video of corpus.videos) {
    invariant(typeof video.id === "string" && /^[a-z0-9][a-z0-9-]+$/u.test(video.id), `Invalid video id '${video.id}'.`);
    invariant(!videoIds.has(video.id), `Duplicate video id '${video.id}'.`);
    videoIds.add(video.id);
    invariant(video.split === "development" || video.split === "holdout", `${video.id}: invalid split.`);
    splitCounts[video.split] += 1;
    invariant(typeof video.filename === "string" && video.filename.length > 0, `${video.id}: filename is required.`);
    invariant(!filenames.has(video.filename), `${video.id}: duplicate filename.`);
    filenames.add(video.filename);
    invariant(Number.isInteger(video.duration_ms) && video.duration_ms > 0, `${video.id}: invalid duration_ms.`);

    const source = video.source;
    invariant(source && typeof source === "object", `${video.id}: source is required.`);
    for (const field of ["page_url", "download_url", "license", "license_url", "attribution"]) {
      invariant(typeof source[field] === "string" && source[field].length > 0, `${video.id}: source.${field} is required.`);
    }
    invariant(source.page_url.startsWith("https://") && source.download_url.startsWith("https://"), `${video.id}: source URLs must use HTTPS.`);
    invariant(/^[a-f0-9]{64}$/u.test(source.sha256), `${video.id}: invalid source SHA-256.`);
    invariant(Number.isInteger(source.bytes) && source.bytes > 0, `${video.id}: invalid source byte count.`);
    invariant(!downloadUrls.has(source.download_url), `${video.id}: duplicate download URL.`);
    invariant(!sourceHashes.has(source.sha256), `${video.id}: duplicate source content.`);
    downloadUrls.add(source.download_url);
    sourceHashes.add(source.sha256);
    const searchableVideo = JSON.stringify({ id: video.id, filename: video.filename, source, captions: video.captions, queries: video.queries });
    for (const token of corpus.policy.excluded_source_tokens) {
      invariant(!searchableVideo.includes(token), `${video.id}: excluded regression source token '${token}' is present.`);
    }

    invariant(video.annotation?.method?.startsWith("manual "), `${video.id}: manual annotation method is required.`);
    invariant(/^\d{4}-\d{2}-\d{2}$/u.test(video.annotation?.reviewed_at ?? ""), `${video.id}: reviewed_at is required.`);
    invariant(Array.isArray(video.captions) && video.captions.length >= 5, `${video.id}: at least five captions are required.`);
    invariant(video.captions[0].start_ms === 0, `${video.id}: captions must start at zero.`);
    invariant(video.captions.at(-1).end_ms === video.duration_ms, `${video.id}: captions must cover through duration_ms.`);
    let previousEnd = 0;
    for (const [index, caption] of video.captions.entries()) {
      invariant(Number.isInteger(caption.start_ms) && Number.isInteger(caption.end_ms), `${video.id}: caption ${index} timestamps must be integers.`);
      invariant(caption.start_ms === previousEnd && caption.end_ms > caption.start_ms, `${video.id}: caption ${index} leaves a gap, overlaps, or is empty.`);
      invariant(caption.end_ms <= video.duration_ms, `${video.id}: caption ${index} exceeds duration.`);
      invariant(typeof caption.text === "string" && caption.text.trim().length > 0, `${video.id}: caption ${index} text is empty.`);
      previousEnd = caption.end_ms;
    }

    invariant(Array.isArray(video.queries), `${video.id}: queries must be an array.`);
    invariant(video.queries.length === corpus.policy.queries_per_video, `${video.id}: expected ${corpus.policy.queries_per_video} queries.`);
    const perVideoKinds = { text: 0, visual: 0, hybrid: 0 };
    for (const query of video.queries) {
      invariant(typeof query.id === "string" && query.id.length > 0, `${video.id}: query id is required.`);
      invariant(!queryIds.has(query.id), `${video.id}: duplicate query id '${query.id}'.`);
      queryIds.add(query.id);
      invariant(query.kind === "text" || query.kind === "visual" || query.kind === "hybrid", `${query.id}: invalid query kind.`);
      perVideoKinds[query.kind] += 1;
      kindCounts[query.kind] += 1;
      invariant(typeof query.query === "string" && query.query.trim().length > 0, `${query.id}: query text is required.`);
      if (query.kind !== "text") {
        invariant(typeof query.visual_query === "string" && query.visual_query.trim().length > 0, `${query.id}: visual_query is required.`);
      }
      invariant(Array.isArray(query.relevant_ranges) && query.relevant_ranges.length > 0, `${query.id}: relevant_ranges are required.`);
      for (const range of query.relevant_ranges) {
        invariant(Number.isInteger(range.start_ms) && Number.isInteger(range.end_ms), `${query.id}: range timestamps must be integers.`);
        invariant(range.start_ms >= 0 && range.end_ms > range.start_ms && range.end_ms <= video.duration_ms, `${query.id}: invalid relevant range.`);
        invariant(range.end_ms - range.start_ms <= 12_000, `${query.id}: relevant range exceeds twelve seconds.`);
        invariant(video.captions.some((caption) => overlaps(caption, range)), `${query.id}: range has no reviewed caption.`);
      }
      if (query.kind === "text" || query.kind === "hybrid") {
        const relevantCaptionText = video.captions
          .filter((caption) => query.relevant_ranges.some((range) => overlaps(caption, range)))
          .map((caption) => caption.text)
          .join(" ");
        invariant(normalized(relevantCaptionText).includes(normalized(query.query)), `${query.id}: text query is not grounded in its relevant caption.`);
      }
    }
    invariant(perVideoKinds.text === 2 && perVideoKinds.visual === 2 && perVideoKinds.hybrid === 1, `${video.id}: expected two text, two visual, and one hybrid query.`);
  }

  invariant(splitCounts.development === corpus.policy.development_videos, "Development split count does not match policy.");
  invariant(splitCounts.holdout === corpus.policy.holdout_videos, "Holdout split count does not match policy.");
  invariant(queryIds.size === expectedVideos * corpus.policy.queries_per_video, "Total query count does not match policy.");
  if (verifyFingerprint) {
    invariant(/^[a-f0-9]{64}$/u.test(corpus.label_fingerprint), "label_fingerprint must be a SHA-256 digest.");
    invariant(labelFingerprint(corpus) === corpus.label_fingerprint, "Label fingerprint mismatch; corpus labels changed after freezing.");
  }
  return {
    videos: corpus.videos.length,
    queries: queryIds.size,
    splits: splitCounts,
    kinds: kindCounts,
    label_fingerprint: labelFingerprint(corpus),
  };
}

export async function readCorpus(corpusPath) {
  return JSON.parse(await readFile(corpusPath, "utf8"));
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

export async function verifyMediaFile(filePath, video) {
  const info = await stat(filePath);
  invariant(info.isFile(), `${video.id}: media path is not a file.`);
  invariant(info.size === video.source.bytes, `${video.id}: expected ${video.source.bytes} bytes, found ${info.size}.`);
  invariant(await sha256File(filePath) === video.source.sha256, `${video.id}: media SHA-256 mismatch.`);
}

function vttTimestamp(milliseconds) {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor(milliseconds / 60_000) % 60;
  const seconds = Math.floor(milliseconds / 1_000) % 60;
  const millis = milliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function captionsToVtt(captions) {
  const cues = captions.map((caption) =>
    `${vttTimestamp(caption.start_ms)} --> ${vttTimestamp(caption.end_ms)}\n${caption.text}`);
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}
