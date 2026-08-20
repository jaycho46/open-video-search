import { readdir, rm } from "node:fs/promises";
import path from "node:path";

import { OpenVideoError } from "./errors.js";
import { directorySize, pathExists, readJson } from "./files.js";
import { listIndexDirectories } from "./index-store.js";
import { openVideoPaths } from "./paths.js";
import { ManifestSchema } from "./schemas.js";

export interface CacheEntry {
  video_id: string;
  title: string;
  path: string;
  size_bytes: number;
  created_at: string;
}

export async function listCache(): Promise<CacheEntry[]> {
  const directories = await listIndexDirectories();
  const entries: CacheEntry[] = [];
  for (const directory of directories) {
    try {
      const manifest = await readJson(path.join(directory, "manifest.json"), ManifestSchema);
      entries.push({
        video_id: manifest.video_id,
        title: manifest.title,
        path: directory,
        size_bytes: await directorySize(directory),
        created_at: manifest.created_at,
      });
    } catch {
      // Corrupt entries are reported by prune instead of masquerading as usable indexes.
    }
  }
  return entries.sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export async function removeCache(videoId: string): Promise<{ removed: string }> {
  if (!/^(youtube|local)-[A-Za-z0-9_-]+$/u.test(videoId)) {
    throw new OpenVideoError("usage", "cache remove expects a video ID returned by open-video index.");
  }
  const target = path.join(openVideoPaths().indexes, videoId);
  if (!(await pathExists(target))) throw new OpenVideoError("index", `Cached video does not exist: ${videoId}`);
  await rm(target, { recursive: true, force: true });
  return { removed: videoId };
}

export async function pruneCache(): Promise<{ removed: string[] }> {
  const paths = openVideoPaths();
  const removed: string[] = [];
  for (const root of [paths.indexes, paths.temporary]) {
    if (!(await pathExists(root))) continue;
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(root, entry.name);
      const temporary = entry.name.includes(".tmp-") || entry.name.includes(".old-");
      let corrupt = false;
      if (root === paths.indexes && entry.isDirectory() && !temporary) {
        try {
          await readJson(path.join(target, "manifest.json"), ManifestSchema);
        } catch {
          corrupt = true;
        }
      }
      if (temporary || corrupt) {
        await rm(target, { recursive: true, force: true });
        removed.push(target);
      }
    }
  }
  return { removed };
}

