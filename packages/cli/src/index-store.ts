import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { OpenVideoError } from "./errors.js";
import { pathExists, readJson, readJsonLines } from "./files.js";
import { defaultIndexDirectory } from "./paths.js";
import { ManifestSchema, TimelineEntrySchema, type Manifest, type TimelineEntry } from "./schemas.js";

export const InternalStateSchema = z.object({
  schema_version: z.literal("open-video/internal-v1"),
  video_id: z.string(),
  media_path: z.string(),
  media_path_relative: z.boolean(),
  source_hash: z.string().optional(),
});

export type InternalState = z.infer<typeof InternalStateSchema>;

export interface LoadedIndex {
  directory: string;
  manifest: Manifest;
  timeline: TimelineEntry[];
  state: InternalState;
}

export async function resolveIndexDirectory(reference: string): Promise<string> {
  const direct = path.resolve(reference);
  if (await pathExists(direct)) {
    const info = await stat(direct);
    if (!info.isDirectory()) throw new OpenVideoError("index", `Index reference is not a directory: ${direct}`);
    return direct;
  }
  const cached = defaultIndexDirectory(reference);
  if (await pathExists(cached)) return cached;
  throw new OpenVideoError("index", `No index exists for '${reference}'. Run open-video index first.`);
}

export async function loadIndex(reference: string): Promise<LoadedIndex> {
  const directory = await resolveIndexDirectory(reference);
  try {
    const [manifest, timeline, state] = await Promise.all([
      readJson(path.join(directory, "manifest.json"), ManifestSchema),
      readJsonLines(path.join(directory, "timeline.jsonl"), TimelineEntrySchema),
      readJson(path.join(directory, ".state.json"), InternalStateSchema),
    ]);
    if (manifest.video_id !== state.video_id) throw new Error("manifest and internal state video IDs differ");
    return { directory, manifest, timeline, state };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new OpenVideoError("index", `Index is missing or corrupt: ${directory} (${detail})`);
  }
}

export function resolveMediaPath(index: LoadedIndex): string {
  return index.state.media_path_relative
    ? path.resolve(index.directory, index.state.media_path)
    : index.state.media_path;
}

export async function listIndexDirectories(): Promise<string[]> {
  const { openVideoPaths } = await import("./paths.js");
  const root = openVideoPaths().indexes;
  if (!(await pathExists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name));
}

