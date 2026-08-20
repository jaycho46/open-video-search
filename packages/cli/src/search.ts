import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { modelFingerprint } from "./assets.js";
import {
  buildEvidenceWindows,
  normalizeSearchConstraints,
  validateSearchWindow,
  type ConstraintEvidence,
  type EvidenceWindow,
  type SearchConstraintInput,
} from "./compositional-search.js";
import { CLIP_MODEL, DEFAULT_SEARCH_WINDOW_MS, SCHEMA_VERSION } from "./constants.js";
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
type TextIndex = ReturnType<typeof loadTextIndex>;

interface RankedVisualCandidate extends RankedCandidate {
  timestampMS: number;
  frameId: string;
}

export interface SearchOptions {
  visualQuery?: string;
  mode: "hybrid" | "visual" | "text";
  top: number;
  constraints?: SearchConstraintInput[];
  windowMS?: number;
  requireAll?: boolean;
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
): RankedVisualCandidate[] {
  const scored = frames.map((frame) => ({
    frame,
    score: cosineSimilarity(query, readVector(vectors, frame.vector_index, frame.vector_dimension)),
  }));
  scored.sort((left, right) => right.score - left.score || left.frame.timestamp_ms - right.frame.timestamp_ms);
  const bestBySegment = new Map<string, RankedVisualCandidate>();
  for (const [position, item] of scored.slice(0, 50).entries()) {
    const segment = segmentForFrame(timeline, item.frame.timestamp_ms);
    if (!segment) continue;
    const id = String(segment.start_ms);
    if (!bestBySegment.has(id)) {
      bestBySegment.set(id, {
        id,
        rank: position + 1,
        timestampMS: item.frame.timestamp_ms,
        frameId: item.frame.id,
      });
    }
  }
  return [...bestBySegment.values()];
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

function windowEvidenceFrames(index: LoadedIndex, frames: IndexedFrame[], window: EvidenceWindow): Frame[] {
  const selectedFrameIds = new Set(window.evidence.flatMap((item) => item.frameId ? [item.frameId] : []));
  const midpoint = window.timestampMS;
  return frames
    .filter((frame) => frame.timestamp_ms >= window.startMS - 2_000 && frame.timestamp_ms <= window.endMS + 2_000)
    .sort((left, right) => {
      const leftSelected = selectedFrameIds.has(left.id) ? 0 : 1;
      const rightSelected = selectedFrameIds.has(right.id) ? 0 : 1;
      const leftInside = left.timestamp_ms >= window.startMS && left.timestamp_ms <= window.endMS ? 0 : 1;
      const rightInside = right.timestamp_ms >= window.startMS && right.timestamp_ms <= window.endMS ? 0 : 1;
      return leftSelected - rightSelected || leftInside - rightInside ||
        Math.abs(left.timestamp_ms - midpoint) - Math.abs(right.timestamp_ms - midpoint) ||
        left.timestamp_ms - right.timestamp_ms;
    })
    .slice(0, 3)
    .sort((left, right) => left.timestamp_ms - right.timestamp_ms)
    .map((frame) => ({ ...frame, path: path.resolve(index.directory, frame.path) }));
}

function subtitlesForWindow(timeline: TimelineEntry[], window: EvidenceWindow): string {
  const values = timeline
    .filter((entry) => entry.start_ms <= window.endMS && entry.end_ms >= window.startMS)
    .map((entry) => entry.subtitle.trim())
    .filter(Boolean);
  return [...new Set(values)].join("\n");
}

function constraintPlan(query: string, options: SearchOptions): SearchConstraintInput[] {
  const constraints: SearchConstraintInput[] = [];
  if (options.mode !== "visual") constraints.push({ id: "query", modality: "text", query });
  if (options.mode !== "text") {
    constraints.push({ id: "query", modality: "visual", query: options.visualQuery ?? query });
  }
  constraints.push(...(options.constraints ?? []));
  return normalizeSearchConstraints(constraints, options.mode);
}

export async function searchIndex(reference: string, query: string, options: SearchOptions): Promise<SearchResponse> {
  if (!query.trim()) throw new OpenVideoError("usage", "Search query must not be empty.");
  if (!Number.isInteger(options.top) || options.top < 1 || options.top > 50) {
    throw new OpenVideoError("usage", "Search result count must be between 1 and 50.");
  }
  const constraints = constraintPlan(query.trim(), options);
  const compositional = (options.constraints?.length ?? 0) > 0 || options.windowMS !== undefined ||
    options.requireAll === true;
  const windowMS = compositional ? validateSearchWindow(options.windowMS ?? DEFAULT_SEARCH_WINDOW_MS) : undefined;
  const requireAll = options.requireAll ?? false;
  const index = await loadIndex(reference);
  let frames: IndexedFrame[];
  try {
    frames = await readJsonLines(path.join(index.directory, "index", "frames.jsonl"), IndexedFrameSchema);
  } catch (error) {
    throw new OpenVideoError("index", `Frame metadata is missing or corrupt: ${error instanceof Error ? error.message : String(error)}`);
  }
  const timelineById = new Map(index.timeline.map((entry) => [String(entry.start_ms), entry]));

  let vectors: Buffer | undefined;
  let textIndex: TextIndex | undefined;
  const visualRankings = new Map<string, RankedVisualCandidate[]>();
  const textRankings = new Map<string, RankedCandidate[]>();

  const getVisualRanking = async (visualQuery: string): Promise<RankedVisualCandidate[]> => {
    const existing = visualRankings.get(visualQuery);
    if (existing) return existing;
    if (index.manifest.visual_model.fingerprint !== modelFingerprint(CLIP_MODEL)) {
      throw new OpenVideoError("index", "This index uses a different visual model fingerprint; re-run open-video index.");
    }
    const firstFrame = frames[0];
    if (!firstFrame) throw new OpenVideoError("index", "The index contains no visual frames.");
    if (!vectors) {
      try {
        vectors = await readFile(path.join(index.directory, "index", "vectors.f32"));
      } catch (error) {
        throw new OpenVideoError("index", `Vector data is missing: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const queryVector = await embedText(visualQuery, path.resolve(index.directory, firstFrame.path), true);
    const ranking = visualCandidates(frames, vectors, queryVector, index.timeline);
    visualRankings.set(visualQuery, ranking);
    return ranking;
  };

  const getTextRanking = async (textQuery: string): Promise<RankedCandidate[]> => {
    const existing = textRankings.get(textQuery);
    if (existing) return existing;
    if (!textIndex) {
      try {
        const serialized = await readFile(path.join(index.directory, "index", "text-index.json"), "utf8");
        textIndex = loadTextIndex(serialized);
      } catch (error) {
        throw new OpenVideoError("index", `Text index is missing or corrupt: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const ranking = searchTextIndex(textIndex, textQuery, 50).map((result, position) => ({
      id: String(result.id),
      rank: position + 1,
    }));
    textRankings.set(textQuery, ranking);
    return ranking;
  };

  if (!compositional) {
    const visualConstraint = constraints.find((constraint) => constraint.modality === "visual");
    const textConstraint = constraints.find((constraint) => constraint.modality === "text");
    const visual = visualConstraint ? await getVisualRanking(visualConstraint.query) : [];
    const text = textConstraint ? await getTextRanking(textConstraint.query) : [];
    const fused = reciprocalRankFusion(
      visual,
      text,
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
        matched_constraints: ["query"],
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
      query: query.trim(),
      visual_query: options.mode === "text" ? undefined : (options.visualQuery ?? query.trim()),
      mode: options.mode,
      constraints,
      require_all: false,
      hits,
    });
  }

  const allEvidence: ConstraintEvidence[] = [];
  for (const constraint of constraints) {
    if (constraint.modality === "visual") {
      const ranking = await getVisualRanking(constraint.query);
      allEvidence.push(...ranking.map((candidate) => ({
        constraintId: constraint.id,
        modality: constraint.modality,
        query: constraint.query,
        rank: candidate.rank,
        timestampMS: candidate.timestampMS,
        segmentId: candidate.id,
        frameId: candidate.frameId,
      })));
    } else {
      const ranking = await getTextRanking(constraint.query);
      allEvidence.push(...ranking.flatMap((candidate) => {
        const entry = timelineById.get(candidate.id);
        if (!entry) return [];
        return [{
          constraintId: constraint.id,
          modality: constraint.modality,
          query: constraint.query,
          rank: candidate.rank,
          timestampMS: entry.start_ms,
          segmentId: candidate.id,
        }];
      }));
    }
  }
  const constraintOrder = [...new Set(constraints.map((constraint) => constraint.id))];
  const windows = buildEvidenceWindows(
    allEvidence,
    constraintOrder,
    index.manifest.duration_ms,
    windowMS ?? DEFAULT_SEARCH_WINDOW_MS,
    requireAll,
  );
  const hits = windows.slice(0, options.top).map((window, position) => {
    const evidence = windowEvidenceFrames(index, frames, window);
    return {
      rank: position + 1,
      score: window.score,
      match: window.match,
      matched_constraints: window.matchedConstraints,
      start_ms: window.startMS,
      end_ms: window.endMS,
      timestamp_ms: window.timestampMS,
      subtitle: subtitlesForWindow(index.timeline, window),
      frames: evidence.map(({ id, timestamp_ms, path: framePath, scene_id }) => ({
        id,
        timestamp_ms,
        path: framePath,
        scene_id,
      })),
      youtube_url: youtubeDeepLink(index, window.timestampMS),
    };
  });

  return SearchResponseSchema.parse({
    schema_version: SCHEMA_VERSION,
    video_id: index.manifest.video_id,
    query: query.trim(),
    visual_query: options.mode === "text" ? undefined : (options.visualQuery ?? query.trim()),
    mode: options.mode,
    constraints,
    window_ms: windowMS,
    require_all: requireAll,
    hits,
  });
}
