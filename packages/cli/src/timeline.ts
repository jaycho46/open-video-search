import path from "node:path";

import { SCHEMA_VERSION } from "./constants.js";
import { OpenVideoError } from "./errors.js";
import { loadIndex } from "./index-store.js";
import { TimelineResponseSchema, type TimelineResponse } from "./schemas.js";

interface CursorValue {
  video_id: string;
  chunk_ms: number;
  offset: number;
}

function encodeCursor(value: CursorValue): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(value: string): CursorValue {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<CursorValue>;
    if (typeof parsed.video_id !== "string" || !Number.isInteger(parsed.chunk_ms) || !Number.isInteger(parsed.offset)) {
      throw new Error("invalid fields");
    }
    return parsed as CursorValue;
  } catch {
    throw new OpenVideoError("usage", "Invalid timeline cursor.");
  }
}

export async function getTimeline(
  reference: string,
  chunkMS: number,
  cursor: string | undefined,
  pageSize: number,
): Promise<TimelineResponse> {
  if (!Number.isSafeInteger(chunkMS) || chunkMS < 1_000) {
    throw new OpenVideoError("usage", "Timeline chunk size must be at least one second.");
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new OpenVideoError("usage", "Timeline page size must be between 1 and 100.");
  }
  const index = await loadIndex(reference);
  let offset = 0;
  if (cursor) {
    const value = decodeCursor(cursor);
    if (value.video_id !== index.manifest.video_id || value.chunk_ms !== chunkMS) {
      throw new OpenVideoError("usage", "Timeline cursor belongs to a different video or chunk size.");
    }
    offset = value.offset;
  }
  const chunkCount = Math.ceil(index.manifest.duration_ms / chunkMS);
  const upper = Math.min(chunkCount, offset + pageSize);
  const items = [];
  for (let chunk = offset; chunk < upper; chunk += 1) {
    const start = chunk * chunkMS;
    const end = Math.min(index.manifest.duration_ms, start + chunkMS);
    const entries = index.timeline.filter((entry) => entry.end_ms > start && entry.start_ms < end);
    const subtitleParts: string[] = [];
    for (const entry of entries) {
      if (entry.subtitle && subtitleParts.at(-1) !== entry.subtitle) subtitleParts.push(entry.subtitle);
    }
    const allFrames = entries.flatMap((entry) => entry.frames);
    const selectedFrames = allFrames.length <= 2
      ? allFrames
      : [allFrames[0], allFrames.at(-1)].filter((frame) => frame !== undefined);
    items.push({
      start_ms: start,
      end_ms: end,
      subtitle: subtitleParts.join(" "),
      frames: selectedFrames.map((frame) => ({ ...frame, path: path.resolve(index.directory, frame.path) })),
    });
  }
  const nextOffset = offset + items.length;
  return TimelineResponseSchema.parse({
    schema_version: SCHEMA_VERSION,
    video_id: index.manifest.video_id,
    chunk_ms: chunkMS,
    items,
    next_cursor: nextOffset < chunkCount
      ? encodeCursor({ video_id: index.manifest.video_id, chunk_ms: chunkMS, offset: nextOffset })
      : null,
  });
}
