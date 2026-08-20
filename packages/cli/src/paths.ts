import { homedir } from "node:os";
import path from "node:path";

export interface OpenVideoPaths {
  root: string;
  assets: string;
  binaries: string;
  models: string;
  indexes: string;
  temporary: string;
}

export function cacheRoot(): string {
  const override = process.env.OPEN_VIDEO_CACHE_DIR?.trim();
  if (override) return path.resolve(override);
  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Caches", "open-video");
  }
  const xdg = process.env.XDG_CACHE_HOME?.trim();
  return path.join(xdg ? path.resolve(xdg) : path.join(homedir(), ".cache"), "open-video");
}

export function openVideoPaths(): OpenVideoPaths {
  const root = cacheRoot();
  const assets = path.join(root, "assets");
  return {
    root,
    assets,
    binaries: path.join(assets, "bin"),
    models: path.join(assets, "models"),
    indexes: path.join(root, "indexes"),
    temporary: path.join(root, "tmp"),
  };
}

export function defaultIndexDirectory(videoId: string): string {
  return path.join(openVideoPaths().indexes, videoId);
}

