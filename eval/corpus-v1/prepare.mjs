import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { captionsToVtt, readCorpus, validateCorpus, verifyMediaFile } from "./lib.mjs";

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function download(video, destination) {
  const temporary = `${destination}.part`;
  await rm(temporary, { force: true });
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(video.source.download_url, {
        headers: { "user-agent": "open-video-eval/0.1 (open source evaluation corpus)" },
        redirect: "follow",
      });
      if (!response.ok) {
        const retryAfter = response.headers.get("retry-after");
        throw new Error(`HTTP ${response.status}${retryAfter ? `; retry-after=${retryAfter}` : ""}`);
      }
      await writeFile(temporary, Buffer.from(await response.arrayBuffer()));
      await verifyMediaFile(temporary, video);
      await rename(temporary, destination);
      return;
    } catch (error) {
      lastError = error;
      await rm(temporary, { force: true });
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw new Error(`${video.id}: download failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function runIndex(cli, mediaPath, subtitlePath, indexDirectory, offline) {
  const args = [cli, "index", mediaPath, "--subtitles", subtitlePath, "--output", indexDirectory, "--json"];
  if (offline) args.splice(-1, 0, "--offline");
  const result = spawnSync(process.execPath, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `open-video index exited with ${result.status}`);
  return JSON.parse(result.stdout);
}

const workspaceOption = optionValue("--workspace");
if (!workspaceOption) {
  process.stderr.write("Usage: node eval/corpus-v1/prepare.mjs --workspace <directory> [--split development|holdout|all] [--offline] [--acknowledge-holdout]\n");
  process.exit(2);
}
const split = optionValue("--split") ?? "development";
if (!["development", "holdout", "all"].includes(split)) throw new Error("--split must be development, holdout, or all.");
const includesHoldout = split === "holdout" || split === "all";
if (includesHoldout && !process.argv.includes("--acknowledge-holdout")) {
  throw new Error("Holdout preparation requires --acknowledge-holdout. Do not use holdout results for tuning.");
}
const offline = process.argv.includes("--offline");
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const corpusPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "corpus.json");
const cli = path.join(repository, "packages", "cli", "dist", "cli.js");
if (!await exists(cli)) throw new Error("CLI build is missing. Run pnpm build first.");
const corpus = await readCorpus(corpusPath);
validateCorpus(corpus);

const selected = corpus.videos.filter((video) => split === "all" || video.split === split);
const workspace = path.resolve(workspaceOption);
const mediaDirectory = path.join(workspace, "media");
const subtitleDirectory = path.join(workspace, "subtitles");
const indexRoot = path.join(workspace, "indexes");
await Promise.all([mkdir(mediaDirectory, { recursive: true }), mkdir(subtitleDirectory, { recursive: true }), mkdir(indexRoot, { recursive: true })]);

const preparedVideos = [];
for (const video of selected) {
  const mediaPath = path.join(mediaDirectory, video.filename);
  process.stderr.write(`[corpus] ${video.id}: verifying media\n`);
  if (await exists(mediaPath)) {
    try {
      await verifyMediaFile(mediaPath, video);
    } catch (error) {
      if (offline) throw error;
      process.stderr.write(`[corpus] ${video.id}: replacing media that failed verification\n`);
      await download(video, mediaPath);
    }
  } else {
    if (offline) throw new Error(`${video.id}: media is missing in offline mode.`);
    process.stderr.write(`[corpus] ${video.id}: downloading ${video.source.page_url}\n`);
    await download(video, mediaPath);
  }
  const subtitlePath = path.join(subtitleDirectory, `${video.id}.vtt`);
  const vtt = captionsToVtt(video.captions);
  if (!await exists(subtitlePath) || await readFile(subtitlePath, "utf8") !== vtt) await writeFile(subtitlePath, vtt, "utf8");
  const indexDirectory = path.join(indexRoot, video.id);
  process.stderr.write(`[corpus] ${video.id}: indexing\n`);
  const indexed = runIndex(cli, mediaPath, subtitlePath, indexDirectory, offline);
  preparedVideos.push({
    source_id: video.id,
    split: video.split,
    video_id: indexed.video_id,
    index_directory: indexed.index_directory,
    queries: video.queries,
  });
}

const dataset = {
  schema_version: "open-video/eval-dataset/v1",
  corpus_id: corpus.corpus_id,
  corpus_fingerprint: corpus.label_fingerprint,
  split,
  contains_holdout: includesHoldout,
  report_policy: includesHoldout ? "aggregate-only" : "query-details",
  expected_video_count: preparedVideos.length,
  expected_query_count: preparedVideos.reduce((count, video) => count + video.queries.length, 0),
  prepared_at: new Date().toISOString(),
  videos: preparedVideos,
};
const datasetPath = path.join(workspace, `dataset.${split}.json`);
const temporaryDataset = `${datasetPath}.tmp`;
await writeFile(temporaryDataset, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
await rename(temporaryDataset, datasetPath);
process.stdout.write(`${JSON.stringify({ dataset: datasetPath, videos: dataset.expected_video_count, queries: dataset.expected_query_count })}\n`);
