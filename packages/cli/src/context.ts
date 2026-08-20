import { mkdir } from "node:fs/promises";
import path from "node:path";

import { SCHEMA_VERSION } from "./constants.js";
import { EngineContextSchema, runEngine } from "./engine.js";
import { OpenVideoError } from "./errors.js";
import { pathExists } from "./files.js";
import { loadIndex, resolveMediaPath } from "./index-store.js";
import { ContextResponseSchema, type ContextResponse } from "./schemas.js";
import { captionsInWindow, readVtt } from "./vtt.js";

export interface ContextOptions {
  at: number;
  before: number;
  after: number;
  frames: number;
}

export async function getContext(reference: string, options: ContextOptions): Promise<ContextResponse> {
  if (!Number.isInteger(options.frames) || options.frames < 1 || options.frames > 20) {
    throw new OpenVideoError("usage", "Context frame count must be between 1 and 20.");
  }
  if (![options.at, options.before, options.after].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new OpenVideoError("usage", "Context time values must be non-negative integer milliseconds.");
  }
  const index = await loadIndex(reference);
  if (options.at < 0 || options.at > index.manifest.duration_ms) {
    throw new OpenVideoError("usage", `Context timestamp is outside the video duration (${index.manifest.duration_ms}ms).`);
  }
  const start = Math.max(0, options.at - options.before);
  const end = Math.min(index.manifest.duration_ms, options.at + options.after);
  if (end <= start) throw new OpenVideoError("usage", "Context window is empty; increase --before or --after.");
  let cues;
  try {
    cues = await readVtt(path.join(index.directory, "subtitles.vtt"));
  } catch (error) {
    throw new OpenVideoError("index", `Subtitle artifact is missing or corrupt: ${error instanceof Error ? error.message : String(error)}`);
  }
  const mediaPath = resolveMediaPath(index);
  let frames;
  if (await pathExists(mediaPath)) {
    const output = path.join(
      index.directory,
      ".contexts",
      `${options.at}-${options.before}-${options.after}-${options.frames}`,
    );
    await mkdir(output, { recursive: true });
    const result = await runEngine(
      "context",
      [
        "--media",
        mediaPath,
        "--output",
        output,
        "--at-ms",
        String(options.at),
        "--before-ms",
        String(options.before),
        "--after-ms",
        String(options.after),
        "--duration-ms",
        String(index.manifest.duration_ms),
        "--frames",
        String(options.frames),
      ],
      EngineContextSchema,
    );
    frames = result.frames.map((frame) => ({
      id: frame.id,
      timestamp_ms: frame.timestamp_ms,
      path: path.resolve(frame.path),
      scene_id: frame.scene_id,
    }));
  } else {
    const candidates = index.timeline
      .flatMap((entry) => entry.frames)
      .filter((frame) => frame.timestamp_ms >= start && frame.timestamp_ms <= end);
    const selected = candidates.length <= options.frames
      ? candidates
      : Array.from({ length: options.frames }, (_, position) =>
          candidates[Math.floor(((position + 1) * candidates.length) / (options.frames + 1))],
        ).filter((frame) => frame !== undefined);
    frames = selected.map((frame) => ({ ...frame, path: path.resolve(index.directory, frame.path) }));
    if (frames.length === 0) {
      throw new OpenVideoError("index", `Original media is unavailable and no indexed frames cover ${options.at}ms.`);
    }
  }

  let youtubeUrl: string | undefined;
  if (index.manifest.source.canonical_url) {
    const url = new URL(index.manifest.source.canonical_url);
    url.searchParams.set("t", String(Math.floor(options.at / 1_000)));
    youtubeUrl = url.toString();
  }
  return ContextResponseSchema.parse({
    schema_version: SCHEMA_VERSION,
    video_id: index.manifest.video_id,
    at_ms: options.at,
    start_ms: start,
    end_ms: end,
    subtitle: captionsInWindow(cues, start, end),
    frames,
    youtube_url: youtubeUrl,
  });
}
