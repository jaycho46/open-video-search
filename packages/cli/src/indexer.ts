import { readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { ensureClipModel, ensureYtDlp, modelFingerprint } from "./assets.js";
import {
  CLI_VERSION,
  CLIP_MODEL,
  ENGINE_PROTOCOL_VERSION,
  SAMPLING_CONFIG,
  SCHEMA_VERSION,
  TIMELINE_SEGMENT_MS,
  WHISPER_MODEL,
} from "./constants.js";
import {
  EngineAudioSchema,
  EnginePrepareSchema,
  runEngine,
  type EnginePrepare,
} from "./engine.js";
import { OpenVideoError } from "./errors.js";
import {
  atomicReplaceDirectory,
  makeSiblingTemporary,
  pathExists,
  readJson,
  sha256File,
  sha256Text,
  writeJson,
  writeJsonLines,
} from "./files.js";
import { InternalStateSchema } from "./index-store.js";
import { embedImages, transcribeAudio } from "./models.js";
import { defaultIndexDirectory } from "./paths.js";
import {
  FrameSchema,
  IndexResponseSchema,
  ManifestSchema,
  type Frame,
  type IndexResponse,
  type Manifest,
  type TimelineEntry,
} from "./schemas.js";
import { resolveSource } from "./source.js";
import { createTextIndex, serializeTextIndex } from "./text-index.js";
import { captionsInWindow, readVtt, writeVtt, type CaptionCue } from "./vtt.js";

export interface IndexOptions {
  language?: string;
  subtitles?: string;
  asr: boolean;
  output?: string;
  offline: boolean;
  onProgress?: (stage: string, message: string) => void;
}

function report(options: IndexOptions, stage: string, message: string): void {
  options.onProgress?.(stage, message);
}

async function indexFingerprint(
  sourceIdentity: string,
  options: IndexOptions,
): Promise<string> {
  let subtitleHash: string | undefined;
  if (options.subtitles) {
    try {
      subtitleHash = await sha256File(path.resolve(options.subtitles));
    } catch {
      throw new OpenVideoError("acquisition", `Subtitle file does not exist or cannot be read: ${path.resolve(options.subtitles)}`);
    }
  }
  return sha256Text(
    JSON.stringify({
      schema: SCHEMA_VERSION,
      cli_version: CLI_VERSION,
      engine_protocol: ENGINE_PROTOCOL_VERSION,
      source: sourceIdentity,
      language: options.language ?? null,
      subtitles: subtitleHash ?? null,
      asr: options.asr,
      clip: modelFingerprint(CLIP_MODEL),
      whisper: options.asr ? modelFingerprint(WHISPER_MODEL) : null,
      sampling: SAMPLING_CONFIG,
    }),
  );
}

async function reusableManifest(target: string, fingerprint: string): Promise<Manifest | undefined> {
  if (!(await pathExists(path.join(target, "manifest.json")))) return undefined;
  try {
    const manifest = await readJson(path.join(target, "manifest.json"), ManifestSchema);
    if (manifest.fingerprint !== fingerprint) return undefined;
    const required = [
      "timeline.jsonl",
      "subtitles.vtt",
      "index/frames.jsonl",
      "index/vectors.f32",
      "index/text-index.json",
      ".state.json",
    ];
    for (const relative of required) {
      if (!(await pathExists(path.join(target, relative)))) return undefined;
    }
    return manifest;
  } catch {
    return undefined;
  }
}

function buildTimeline(durationMS: number, frames: Frame[], cues: CaptionCue[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (let start = 0; start < durationMS; start += TIMELINE_SEGMENT_MS) {
    const end = Math.min(durationMS, start + TIMELINE_SEGMENT_MS);
    const segmentFrames = frames
      .filter((frame) => frame.timestamp_ms >= start && (frame.timestamp_ms < end || end === durationMS))
      .map((frame) => ({
        id: frame.id,
        timestamp_ms: frame.timestamp_ms,
        path: frame.path,
        scene_id: frame.scene_id,
      }));
    const prior = frames.filter((frame) => frame.timestamp_ms <= start).at(-1);
    const sceneIds = [...new Set((segmentFrames.length > 0 ? segmentFrames : prior ? [prior] : []).map((frame) => frame.scene_id))];
    entries.push({
      start_ms: start,
      end_ms: end,
      subtitle: captionsInWindow(cues, start, end),
      scene_ids: sceneIds,
      frames: segmentFrames,
    });
  }
  return entries;
}

function assertSafeRelativeFrame(framePath: string): void {
  if (path.isAbsolute(framePath) || framePath.split(/[\\/]/u).includes("..")) {
    throw new OpenVideoError("processing", `Engine returned an unsafe frame path: ${framePath}`);
  }
}

function assertFrameCoverage(frames: Frame[], durationMS: number): void {
  const timestamps = frames.map((frame) => frame.timestamp_ms).sort((left, right) => left - right);
  if (timestamps.some((timestamp) => timestamp > durationMS)) {
    throw new OpenVideoError("processing", "Engine returned a frame beyond the video duration.");
  }
  const gaps = [
    timestamps[0] ?? durationMS,
    ...timestamps.slice(1).map((timestamp, index) => timestamp - (timestamps[index] ?? 0)),
    durationMS - (timestamps.at(-1) ?? 0),
  ];
  const maximum = Math.max(...gaps);
  if (maximum > SAMPLING_CONFIG.max_gap_ms) {
    throw new OpenVideoError(
      "processing",
      `Extracted frame coverage has a ${maximum}ms gap, exceeding ${SAMPLING_CONFIG.max_gap_ms}ms.`,
    );
  }
}

async function writeVectors(target: string, vectors: Float32Array[]): Promise<void> {
  const buffers = vectors.map((vector) => Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength));
  await writeFile(target, Buffer.concat(buffers));
}

async function acquireCaptions(
  temporary: string,
  prepared: EnginePrepare,
  options: IndexOptions,
  warnings: string[],
): Promise<{ cues: CaptionCue[]; subtitleSource?: string; usedAsr: boolean }> {
  const subtitleTarget = path.join(temporary, "subtitles.vtt");
  if (prepared.subtitle_path && (await pathExists(prepared.subtitle_path))) {
    return {
      cues: await readVtt(prepared.subtitle_path),
      subtitleSource: prepared.subtitle_source,
      usedAsr: false,
    };
  }
  if (!options.asr) {
    await writeVtt(subtitleTarget, []);
    return { cues: [], usedAsr: false };
  }
  if (!prepared.probe.has_audio) {
    warnings.push("ASR was requested, but this video has no audio stream.");
    await writeVtt(subtitleTarget, []);
    return { cues: [], usedAsr: false };
  }

  report(options, "asr", "Extracting audio for local Whisper transcription");
  const audioPath = path.join(temporary, ".audio.f32le");
  await runEngine("audio", ["--media", prepared.media_path, "--output", audioPath], EngineAudioSchema);
  try {
    const cues = await transcribeAudio(audioPath, prepared.probe.duration_ms, options.language, options.offline);
    await writeVtt(subtitleTarget, cues);
    for (let index = warnings.length - 1; index >= 0; index -= 1) {
      if (warnings[index]?.startsWith("no subtitles were available")) warnings.splice(index, 1);
    }
    if (cues.length === 0) warnings.push("Local Whisper ASR completed but found no timestamped speech.");
    return { cues, subtitleSource: "asr", usedAsr: true };
  } finally {
    await rm(audioPath, { force: true });
  }
}

export async function indexVideo(sourceInput: string, options: IndexOptions): Promise<IndexResponse> {
  report(options, "source", "Identifying source and calculating a stable video ID");
  const source = await resolveSource(sourceInput);
  const sourceIdentity = source.contentHash ?? source.videoId;
  const fingerprint = await indexFingerprint(sourceIdentity, options);
  const target = path.resolve(options.output ?? defaultIndexDirectory(source.videoId));
  const existing = await reusableManifest(target, fingerprint);
  if (existing) {
    return IndexResponseSchema.parse({
      schema_version: SCHEMA_VERSION,
      video_id: existing.video_id,
      index_directory: target,
      reused: true,
      manifest: existing,
    });
  }

  if (source.type === "youtube" && options.offline) {
    throw new OpenVideoError(
      "acquisition",
      "This YouTube video is not already indexed with the requested settings; offline mode cannot download it.",
    );
  }

  if (await pathExists(target)) {
    const targetInfo = await stat(target);
    if (!targetInfo.isDirectory()) throw new OpenVideoError("index", `Index output is not a directory: ${target}`);
    const contents = await readdir(target);
    if (contents.length > 0 && !(await pathExists(path.join(target, "manifest.json")))) {
      throw new OpenVideoError("index", `Refusing to replace a non-index directory: ${target}`);
    }
    if (options.output && contents.length > 0) {
      try {
        await readJson(path.join(target, "manifest.json"), ManifestSchema);
      } catch {
        throw new OpenVideoError("index", `Refusing to replace a corrupt explicit output directory: ${target}`);
      }
    }
  }

  report(options, "model", "Preparing the pinned quantized CLIP model");
  await ensureClipModel(options.offline);

  const temporary = await makeSiblingTemporary(target);
  try {
    const args = ["--source", source.input, "--work-dir", temporary];
    if (options.language) args.push("--language", options.language);
    if (options.subtitles) args.push("--subtitles", path.resolve(options.subtitles));
    if (source.type === "youtube") {
      report(options, "download", "Preparing pinned yt-dlp and downloading a 720p proxy");
      args.push("--yt-dlp", await ensureYtDlp(options.offline), "--js-runtime", process.execPath);
    }
    const prepared = await runEngine("prepare", args, EnginePrepareSchema, {
      onProgress: (stage, message) => report(options, stage, message),
    });
    if (prepared.video_id !== source.videoId) {
      throw new OpenVideoError("processing", "Source identity changed between CLI validation and media preparation.");
    }

    const warnings = [...(prepared.warnings ?? [])];
    const captions = await acquireCaptions(temporary, prepared, options, warnings);
    const frames = prepared.frames.map((frame) => {
      assertSafeRelativeFrame(frame.path);
      return FrameSchema.parse(frame);
    });
    assertFrameCoverage(frames, prepared.probe.duration_ms);

    report(options, "embeddings", `Embedding ${frames.length} frames with local CLIP`);
    const framePaths = frames.map((frame) => path.join(temporary, frame.path));
    const vectors = await embedImages(framePaths, options.offline, ({ current, total }) => {
      report(options, "embeddings", `Embedded ${current}/${total} frames`);
    });
    if (vectors.length !== frames.length || vectors.length === 0) {
      throw new OpenVideoError("processing", "CLIP embedding count does not match extracted frames.");
    }
    const dimension = vectors[0]?.length ?? 0;
    if (dimension === 0 || vectors.some((vector) => vector.length !== dimension)) {
      throw new OpenVideoError("processing", "CLIP returned inconsistent vector dimensions.");
    }

    const timeline = buildTimeline(prepared.probe.duration_ms, frames, captions.cues);
    const textIndex = createTextIndex(timeline);
    const indexDirectory = path.join(temporary, "index");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(indexDirectory, { recursive: true });
    await writeJsonLines(path.join(temporary, "timeline.jsonl"), timeline);
    await writeJsonLines(
      path.join(indexDirectory, "frames.jsonl"),
      frames.map((frame, vector_index) => ({ ...frame, vector_index, vector_dimension: dimension })),
    );
    await writeVectors(path.join(indexDirectory, "vectors.f32"), vectors);
    await writeFile(path.join(indexDirectory, "text-index.json"), serializeTextIndex(textIndex), "utf8");

    const mediaRelative = prepared.source_type === "youtube";
    const mediaPath = mediaRelative ? path.relative(temporary, prepared.media_path) : prepared.media_path;
    await writeJson(
      path.join(temporary, ".state.json"),
      InternalStateSchema.parse({
        schema_version: "open-video/internal-v1",
        video_id: prepared.video_id,
        media_path: mediaPath,
        media_path_relative: mediaRelative,
        source_hash: source.contentHash,
      }),
    );

    const manifest = ManifestSchema.parse({
      schema_version: SCHEMA_VERSION,
      video_id: prepared.video_id,
      fingerprint,
      source: {
        type: prepared.source_type,
        value: prepared.source_type === "local" ? source.input : (source.canonicalUrl ?? source.input),
        canonical_url: prepared.canonical_url || source.canonicalUrl,
      },
      title: prepared.source_type === "local"
        ? path.basename(source.input)
        : (prepared.title || prepared.probe.title || prepared.video_id),
      duration_ms: prepared.probe.duration_ms,
      language: prepared.language || options.language,
      subtitle_source: captions.subtitleSource,
      created_at: new Date().toISOString(),
      cli_version: CLI_VERSION,
      engine_version: prepared.engine_version,
      protocol_version: prepared.protocol_version,
      visual_model: {
        id: CLIP_MODEL.id,
        revision: CLIP_MODEL.revision,
        dtype: CLIP_MODEL.dtype,
        fingerprint: modelFingerprint(CLIP_MODEL),
      },
      asr_model: captions.usedAsr
        ? {
            id: WHISPER_MODEL.id,
            revision: WHISPER_MODEL.revision,
            dtype: WHISPER_MODEL.dtype,
            fingerprint: modelFingerprint(WHISPER_MODEL),
          }
        : undefined,
      sampling: SAMPLING_CONFIG,
      frame_count: frames.length,
      timeline_count: timeline.length,
      warnings,
    });
    await writeJson(path.join(temporary, "manifest.json"), manifest);
    await atomicReplaceDirectory(temporary, target);
    return IndexResponseSchema.parse({
      schema_version: SCHEMA_VERSION,
      video_id: manifest.video_id,
      index_directory: target,
      reused: false,
      manifest,
    });
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    if (error instanceof z.ZodError) {
      throw new OpenVideoError("processing", `Generated data failed its public schema: ${error.message}`);
    }
    throw error;
  }
}
