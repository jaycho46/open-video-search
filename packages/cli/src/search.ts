import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { modelFingerprint } from "./assets.js";
import { CLIP_MODEL, SCHEMA_VERSION } from "./constants.js";
import { OpenVideoError } from "./errors.js";
import { readJsonLines } from "./files.js";
import { loadIndex, type LoadedIndex } from "./index-store.js";
import { embedText } from "./models.js";
import { cosineSimilarity, reciprocalRankFusion, type RankedCandidate } from "./ranking.js";
import { FrameSchema, SearchResponseSchema, type Frame, type SearchResponse, type TimelineEntry } from "./schemas.js";
import { loadTextIndex, searchTextIndex } from "./text-index.js";

const IndexedFrameSchema = FrameSchema.extend({
  vector_index: z.int().nonnegative(),
  vector_dimension: z.int().positive(),
});

type IndexedFrame = z.infer<typeof IndexedFrameSchema>;

export interface SearchOptions {
  visualQuery?: string;
  mode: "hybrid" | "visual" | "text";
  top: number;
}

function segmentForFrame(timeline: TimelineEntry[], timestampMS: number): TimelineEntry | undefined {
  return timeline.find((entry) => timestampMS >= entry.start_ms && timestampMS < entry.end_ms) ?? timeline.at(-1);
}

function youtubeDeepLink(index: LoadedIndex, timestampMS: number): string | undefined {
  const source = index.manifest.source.canonical_url;
  if (!source) return undefined;
  const url = new URL(source);
  url.searchParams.set("t", String(Math.floor(timestampMS / 1_000)));
  return url.toString();
}

function readVector(buffer: Buffer, index: number, dimension: number): Float32Array {
  const offset = index * dimension * 4;
  if (offset < 0 || offset + dimension * 4 > buffer.byteLength) {
    throw new OpenVideoError("index", "Vector file is truncated or inconsistent with frames.jsonl.");
  }
  const vector = new Float32Array(dimension);
  for (let column = 0; column < dimension; column += 1) {
    vector[column] = buffer.readFloatLE(offset + column * 4);
  }
  return vector;
}

function visualCandidates(
  frames: IndexedFrame[],
  vectors: Buffer,
  query: Float32Array,
  timeline: TimelineEntry[],
): RankedCandidate[] {
  const scored = frames.map((frame) => ({
    frame,
    score: cosineSimilarity(query, readVector(vectors, frame.vector_index, frame.vector_dimension)),
  }));
  scored.sort((left, right) => right.score - left.score || left.frame.timestamp_ms - right.frame.timestamp_ms);
  const bestBySegment = new Map<string, number>();
  for (const [position, item] of scored.slice(0, 50).entries()) {
    const segment = segmentForFrame(timeline, item.frame.timestamp_ms);
    if (!segment) continue;
    const id = String(segment.start_ms);
    if (!bestBySegment.has(id)) bestBySegment.set(id, position + 1);
  }
  return [...bestBySegment].map(([id, rank]) => ({ id, rank }));
}

function evidenceFrames(index: LoadedIndex, frames: IndexedFrame[], entry: TimelineEntry): Frame[] {
  const midpoint = (entry.start_ms + entry.end_ms) / 2;
  return frames
    .filter((frame) => frame.timestamp_ms >= entry.start_ms - 4_000 && frame.timestamp_ms <= entry.end_ms + 4_000)
    .sort(
      (left, right) =>
        Math.abs(left.timestamp_ms - midpoint) - Math.abs(right.timestamp_ms - midpoint) ||
        left.timestamp_ms - right.timestamp_ms,
    )
    .slice(0, 3)
    .sort((left, right) => left.timestamp_ms - right.timestamp_ms)
    .map((frame) => ({
      ...frame,
      path: path.resolve(index.directory, frame.path),
    }));
}

export async function searchIndex(
  reference: string,
  query: string,
  options: SearchOptions,
): Promise<SearchResponse> {
  if (!query.trim()) throw new OpenVideoError("usage", "Search query must not be empty.");
  if (!Number.isInteger(options.top) || options.top < 1 || options.top > 50) {
    throw new OpenVideoError("usage", "Search result count must be between 1 and 50.");
  }
  const index = await loadIndex(reference);
  let frames: IndexedFrame[];
  try {
    frames = await readJsonLines(path.join(index.directory, "index", "frames.jsonl"), IndexedFrameSchema);
  } catch (error) {
    throw new OpenVideoError("index", `Frame metadata is missing or corrupt: ${error instanceof Error ? error.message : String(error)}`);
  }
  const timelineById = new Map(index.timeline.map((entry) => [String(entry.start_ms), entry]));

  let visual: RankedCandidate[] = [];
  if (options.mode !== "text") {
    if (index.manifest.visual_model.fingerprint !== modelFingerprint(CLIP_MODEL)) {
      throw new OpenVideoError("index", "This index uses a different visual model fingerprint; re-run open-video index.");
    }
    const firstFrame = frames[0];
    if (!firstFrame) throw new OpenVideoError("index", "The index contains no visual frames.");
    const visualQuery = options.visualQuery ?? query;
    const queryVector = await embedText(visualQuery, path.resolve(index.directory, firstFrame.path), true);
    let vectors: Buffer;
    try {
      vectors = await readFile(path.join(index.directory, "index", "vectors.f32"));
    } catch (error) {
      throw new OpenVideoError("index", `Vector data is missing: ${error instanceof Error ? error.message : String(error)}`);
    }
    visual = visualCandidates(frames, vectors, queryVector, index.timeline);
  }

  let text: RankedCandidate[] = [];
  if (options.mode !== "visual") {
    let textIndex;
    try {
      const serialized = await readFile(path.join(index.directory, "index", "text-index.json"), "utf8");
      textIndex = loadTextIndex(serialized);
    } catch (error) {
      throw new OpenVideoError("index", `Text index is missing or corrupt: ${error instanceof Error ? error.message : String(error)}`);
    }
    text = searchTextIndex(textIndex, query, 50).map((result, position) => ({
      id: String(result.id),
      rank: position + 1,
    }));
  }

  const fused = reciprocalRankFusion(
    options.mode === "text" ? [] : visual,
    options.mode === "visual" ? [] : text,
    options.mode === "text" ? 0 : options.mode === "visual" ? 1 : undefined,
    options.mode === "visual" ? 0 : options.mode === "text" ? 1 : undefined,
  );
  const hits = fused.slice(0, options.top).flatMap((candidate, position) => {
    const entry = timelineById.get(candidate.id);
    if (!entry) return [];
    const evidence = evidenceFrames(index, frames, entry);
    const timestamp = evidence.find(
      (frame) => frame.timestamp_ms >= entry.start_ms && frame.timestamp_ms < entry.end_ms,
    )?.timestamp_ms ?? entry.start_ms;
    return [{
      rank: position + 1,
      score: candidate.score,
      match: candidate.match,
      start_ms: entry.start_ms,
      end_ms: entry.end_ms,
      timestamp_ms: timestamp,
      subtitle: entry.subtitle,
      frames: evidence.map(({ id, timestamp_ms, path: framePath, scene_id }) => ({
        id,
        timestamp_ms,
        path: framePath,
        scene_id,
      })),
      youtube_url: youtubeDeepLink(index, timestamp),
    }];
  });

  return SearchResponseSchema.parse({
    schema_version: SCHEMA_VERSION,
    video_id: index.manifest.video_id,
    query,
    visual_query: options.mode === "text" ? undefined : (options.visualQuery ?? query),
    mode: options.mode,
    hits,
  });
}
